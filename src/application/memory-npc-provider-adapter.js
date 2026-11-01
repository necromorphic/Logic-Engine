import { resolve } from 'node:path';
import { ActorBindingService } from './actor-bindings.js';
import { AuthorizedReadService } from './authorized-read-service.js';
import {
  createCanonicalEntityInventoryValidator,
  createCanonicalEntitySourceVersionValidator,
} from './canonical-entity-source-version.js';
import { MemoryNpcConsumer } from './memory-npc-consumer.js';
import { createHostBoundNpcKnowledgeAuthorizers } from './npc-knowledge-authorization.js';
import { SQLiteMemoryProvider } from './sqlite-memory-provider.js';

/**
 * Compose the real file-backed SQLite Provider with Core-owned source,
 * inventory, query and field authorization. No caller-supplied validator
 * callbacks or mock Provider are accepted by this production composition.
 *
 * This is an internal adapter factory, not an HTTP route or final-send gateway.
 * The Host caller must supply its authenticated adapter identity and stable
 * conversation identity; Core verifies both against its durable bindings.
 */
export function createMemoryNpcProviderAdapter({
  engine,
  providerPath,
  coordinatorPath,
  adapterIds,
  trustedInitialKnowledgeSources,
  fieldPolicy,
  contentFields,
}) {
  if (!engine?.store?.db || typeof engine.getSnapshot !== 'function') {
    throw new TypeError('Memory Provider adapter requires the live Core LogicEngine and persistent store');
  }
  if (typeof providerPath !== 'string' || !providerPath.trim() || providerPath === ':memory:') {
    throw new TypeError('Memory Provider adapter requires a durable file-backed providerPath');
  }
  if (typeof coordinatorPath !== 'string' || !coordinatorPath.trim()) {
    throw new TypeError('Memory Provider adapter requires the shared Core coordinatorPath');
  }
  if (!engine.store.coordinatorDb || process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH !== resolve(coordinatorPath)) {
    throw new Error('Memory Provider adapter requires the same live coordinator database as Core');
  }
  if (!Array.isArray(adapterIds) || adapterIds.length === 0
    || adapterIds.some((id) => typeof id !== 'string' || !id.trim())
    || new Set(adapterIds).size !== adapterIds.length) {
    throw new TypeError('Memory Provider adapter requires configured unique adapterIds');
  }
  if (!Array.isArray(trustedInitialKnowledgeSources)) {
    throw new TypeError('Memory Provider adapter requires the deployment-owned source registry');
  }
  if (typeof fieldPolicy !== 'function'
    && !(fieldPolicy && typeof fieldPolicy.authorizeField === 'function')) {
    throw new TypeError('Memory Provider adapter requires a trusted Core field policy');
  }
  if (!Array.isArray(contentFields) || contentFields.length === 0) {
    throw new TypeError('Memory Provider adapter requires an explicit content field allowlist');
  }

  const canonicalSourceValidator = createCanonicalEntitySourceVersionValidator(engine);
  const canonicalInventoryValidator = createCanonicalEntityInventoryValidator(engine);
  const provider = new SQLiteMemoryProvider({
    path: resolve(providerPath),
    coordinatorPath: resolve(coordinatorPath),
    getSnapshot: async (worldId) => {
      const snapshot = engine.getSnapshot(worldId);
      return {
        world_revision: snapshot.world_revision,
        commit_sequence: snapshot.commit_sequence,
      };
    },
    validateSourceVersion: canonicalSourceValidator,
    validateInventory: canonicalInventoryValidator,
  });

  try {
    const actorBindingService = new ActorBindingService(engine);
    const authorizedReadService = new AuthorizedReadService(engine, actorBindingService, fieldPolicy);
    const coreAuthorizers = createHostBoundNpcKnowledgeAuthorizers({
      store: engine.store,
      adapterIds,
      trustedInitialKnowledgeSources,
    });
    const consumer = new MemoryNpcConsumer({
      authorizedReadService,
      actorBindingService,
      memoryProvider: provider,
      coreQueryAuthorizer: coreAuthorizers.memoryQueryAuthorizer,
      contentFields,
    });

    return Object.freeze({
      provider,
      consumer,
      async prepareWorld(worldId) {
        await provider.rebuildIndex(worldId);
        return provider.reconcile(worldId);
      },
      close() {
        provider.close();
      },
    });
  } catch (error) {
    provider.close();
    throw error;
  }
}
