import { existsSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { ActorBindingService } from './actor-bindings.js';
import { HostConversationWorldBindingService } from './host-conversation-world-bindings.js';
import { AuthorizedReadService } from './authorized-read-service.js';
import {
  createCanonicalEntityInventoryValidator,
  createCanonicalEntitySourceVersionValidator,
} from './canonical-entity-source-version.js';
import { MemoryNpcConsumer } from './memory-npc-consumer.js';
import { createHostBoundNpcKnowledgeAuthorizers } from './npc-knowledge-authorization.js';
import { SQLiteMemoryProvider } from './sqlite-memory-provider.js';
import { isMechanicPolicyAuthority } from './mechanic-policy-authority.js';
import { runWithAuthenticatedHostSession } from './host-session-context.js';

function canonicalFilePath(path) {
  let candidate = resolve(path);
  const suffix = [];
  while (!existsSync(candidate)) {
    const parent = dirname(candidate);
    if (parent === candidate) break;
    suffix.unshift(basename(candidate));
    candidate = parent;
  }
  return resolve(realpathSync(candidate), ...suffix);
}

function aliasesSameFile(left, right) {
  const canonicalLeft = canonicalFilePath(left);
  const canonicalRight = canonicalFilePath(right);
  if (canonicalLeft === canonicalRight) return true;
  if (!existsSync(canonicalLeft) || !existsSync(canonicalRight)) return false;
  const leftStat = statSync(canonicalLeft, { bigint: true });
  const rightStat = statSync(canonicalRight, { bigint: true });
  return leftStat.ino !== 0n && rightStat.ino !== 0n
    && leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino;
}

/**
 * Compose the real file-backed SQLite Provider with Core-owned source,
 * inventory, query and field authorization. No caller-supplied validator
 * callbacks or mock Provider are accepted by this production composition.
 *
 * This is an internal adapter factory, not an HTTP route or final-send gateway.
 * The configured adapter identity is pinned into the returned consumer. The
 * Host caller supplies only its stable conversation identity; Core verifies
 * the exact conversation/world/adapter/actor binding.
 */
export function createMemoryNpcProviderAdapter({
  engine,
  providerPath,
  coordinatorPath,
  adapterId,
  trustedInitialKnowledgeSources,
  fieldPolicy,
  contentFields,
  isAuthenticatedHostRequest,
  resolveHostConversationId,
  resolveHostIdentity,
}) {
  if (!engine?.store?.db || typeof engine.getSnapshot !== 'function') {
    throw new TypeError('Memory Provider adapter requires the live Core LogicEngine and persistent store');
  }
  if (typeof providerPath !== 'string' || !providerPath.trim() || providerPath === ':memory:') {
    throw new TypeError('Memory Provider adapter requires a durable file-backed providerPath');
  }
  const coreDatabasePath = engine.store.db.prepare('PRAGMA database_list').all()
    .find((entry) => entry.name === 'main')?.file;
  if (typeof coreDatabasePath !== 'string' || !coreDatabasePath
    || aliasesSameFile(providerPath, coreDatabasePath)) {
    throw new Error('Memory Provider database must be a separate file from Core');
  }
  if (typeof coordinatorPath !== 'string' || !coordinatorPath.trim()) {
    throw new TypeError('Memory Provider adapter requires the shared Core coordinatorPath');
  }
  if (!engine.store.coordinatorDb || process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH !== resolve(coordinatorPath)) {
    throw new Error('Memory Provider adapter requires the same live coordinator database as Core');
  }
  if (typeof adapterId !== 'string' || !adapterId.trim()) {
    throw new TypeError('Memory Provider adapter requires one configured authenticated adapterId');
  }
  const inProcessHostGateConfigured = [
    isAuthenticatedHostRequest, resolveHostConversationId, resolveHostIdentity,
  ].some(value => value !== undefined && value !== null);
  if (inProcessHostGateConfigured
    && [isAuthenticatedHostRequest, resolveHostConversationId, resolveHostIdentity]
      .some(value => typeof value !== 'function')) {
    throw new TypeError('In-process Host gate configuration requires all three trusted resolver functions.');
  }
  if (!Array.isArray(trustedInitialKnowledgeSources)) {
    throw new TypeError('Memory Provider adapter requires the deployment-owned source registry');
  }
  if (typeof fieldPolicy !== 'function' && !isMechanicPolicyAuthority(fieldPolicy)) {
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
    const hostConversationWorldBindingService = new HostConversationWorldBindingService(engine);
    // Bind the authenticated Host capability to the exact Core-owned World and
    // unique Actor binding. The resolver is deployment-composed here; callers
    // cannot provide or override adapter/world/actor selectors.
    const resolveHostBindings = (_request, conversationId) => {
      const conversationBinding = hostConversationWorldBindingService.resolve({
        adapterId, conversationId,
      });
      const worldId = conversationBinding?.world_id;
      if (typeof worldId !== 'string' || !worldId.trim()) return null;
      const actorBinding = actorBindingService.resolveForAdapter(worldId, adapterId);
      const actorId = actorBinding?.actor?.entity_id;
      const exactBinding = actorBindingService.resolve(worldId, adapterId, actorId);
      if (exactBinding?.world_id !== worldId
        || exactBinding?.adapter_id !== adapterId
        || exactBinding?.actor?.entity_id !== actorId) return null;
      return { world_id: worldId, actor_id: actorId };
    };
    const authorizedReadService = new AuthorizedReadService(engine, actorBindingService, fieldPolicy);
    const coreAuthorizers = createHostBoundNpcKnowledgeAuthorizers({
      store: engine.store,
      adapterIds: [adapterId],
      trustedInitialKnowledgeSources,
    });
    const consumer = new MemoryNpcConsumer({
      authorizedReadService,
      actorBindingService,
      hostConversationWorldBindingService,
      adapterId,
      memoryProvider: provider,
      coreQueryAuthorizer: coreAuthorizers.memoryQueryAuthorizer,
      contentFields,
    });

    // Expose only trusted ingestion/grant administration. Retrieval and
    // record-authorization methods remain private to MemoryNpcConsumer so a
    // caller cannot bypass Core's authenticated Host-session query gate.
    const providerControl = Object.freeze({
      putRecord: (...args) => provider.putRecord(...args),
      grantQuery: (...args) => provider.grantQuery(...args),
      grantRecord: (...args) => provider.grantRecord(...args),
      revokeRecord: (...args) => provider.revokeRecord(...args),
    });

    // Host receives only the two supported consumer operations. Core/Provider
    // dependencies and authorization methods remain private to this closure.
    const consumerFacade = Object.freeze({
      retrieveForNpc: (...args) => consumer.retrieveForNpc(...args),
      revalidateForFinalDispatch: (...args) => consumer.revalidateForFinalDispatch(...args),
      readDispatchEvidenceSync: (...args) => consumer.readDispatchEvidenceSync(...args),
    });

    const adapter = {
      adapterId,
      provider: providerControl,
      consumer: consumerFacade,
      // Internal Final-Send composition only. This is a synchronous, read-only
      // evidence seam and still requires the exact shared Coordinator lease.
      readDispatchEvidenceSync: input => provider.readDispatchEvidenceSync(input),
      async prepareWorld(worldId) {
        await provider.rebuildIndex(worldId);
        return provider.reconcile(worldId);
      },
      close() {
        provider.close();
      },
    };
    // The HTTP Host assertion runner establishes the same branded AsyncLocalStorage
    // capability for cross-process retrieval. In-process callers may opt into the
    // exact ST request WeakMap gate; do not require an unused second auth path.
    if (inProcessHostGateConfigured) {
      adapter.runWithAuthenticatedHostSession = (request, conversationId, callback) =>
        runWithAuthenticatedHostSession(
          request, conversationId, callback, isAuthenticatedHostRequest, resolveHostConversationId,
          resolveHostBindings, resolveHostIdentity,
        );
    }
    return Object.freeze(adapter);
  } catch (error) {
    provider.close();
    throw error;
  }
}
