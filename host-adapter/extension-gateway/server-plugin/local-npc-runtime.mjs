import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { SQLiteStore } from '../../../src/storage/sqlite-store.js';
import { LogicEngine } from '../../../src/application/engine.js';
import { openCoordinatorDatabase } from '../../../src/storage/coordinator-lock.js';
import { createHostBoundNpcKnowledgeAuthorizers } from '../../../src/application/npc-knowledge-authorization.js';
import { createMemoryNpcProviderAdapter } from '../../../src/application/memory-npc-provider-adapter.js';
import { loadTrustedWorldPackCatalog } from '../../../src/application/world-pack-catalog.js';
import { defaultMechanicPolicyFieldPolicy } from '../../../src/application/mechanic-policy-authority.js';

function parseTrustedInitialKnowledgeSources(env) {
  let sources;
  try {
    sources = JSON.parse(env.ENGINE_TRUSTED_INITIAL_KNOWLEDGE_SOURCES || '[]');
  } catch {
    throw new Error('ENGINE_TRUSTED_INITIAL_KNOWLEDGE_SOURCES must be a JSON array.');
  }
  if (!Array.isArray(sources)) throw new Error('ENGINE_TRUSTED_INITIAL_KNOWLEDGE_SOURCES must be a JSON array.');
  const identities = new Set();
  for (const [index, source] of sources.entries()) {
    const allowed = ['world_pack_id', 'world_pack_version', 'source_kind', 'source_ref',
      'authorization_ref', 'sha256', 'source_path'];
    if (!source || typeof source !== 'object' || Array.isArray(source)
      || Object.keys(source).some(key => !allowed.includes(key))
      || ['world_pack_id', 'world_pack_version', 'source_kind', 'source_ref', 'authorization_ref', 'sha256']
        .some(key => typeof source[key] !== 'string' || !source[key].trim())) {
      throw new Error('Trusted source registry entry ' + index + ' is malformed.');
    }
    if (!['author_initial', 'imported'].includes(source.source_kind)
      || !/^[a-f0-9]{64}$/.test(source.sha256)) {
      throw new Error('Trusted source registry entry ' + index + ' has invalid source kind or digest.');
    }
    if (source.source_kind === 'imported'
      && (typeof source.source_path !== 'string' || !isAbsolute(source.source_path))) {
      throw new Error('Imported trusted source entry ' + index + ' requires an absolute source_path.');
    }
    if (source.source_kind === 'author_initial' && source.source_path !== undefined) {
      throw new Error('Author-initial trusted source entry ' + index + ' must not define source_path.');
    }
    const identity = JSON.stringify([source.world_pack_id, source.world_pack_version,
      source.source_kind, source.source_ref, source.authorization_ref]);
    if (identities.has(identity)) throw new Error('Trusted source registry contains a duplicate identity.');
    identities.add(identity);
  }
  return Object.freeze(sources.map(source => Object.freeze({ ...source })));
}

/**
 * Opens a read-only Core view and an observer-only Provider in the native
 * SillyTavern process. The ordinary Core API process remains the sole writer.
 * All NPC reads still use the shared Coordinator and Core-owned authorizers.
 */
export function createSillyTavernLocalNpcRuntime({ env = process.env, hostAdapter } = {}) {
  if (!env || typeof env !== 'object' || !hostAdapter
    || typeof hostAdapter.isAuthenticatedHostRequest !== 'function'
    || typeof hostAdapter.resolveHostConversationId !== 'function'
    || typeof hostAdapter.resolveHostIdentity !== 'function') {
    throw new TypeError('Local NPC runtime requires the authenticated SillyTavern Host Adapter.');
  }

  const corePath = resolve(env.ENGINE_DB_PATH || './data/logic-engine.sqlite');
  const providerPathValue = env.ENGINE_MEMORY_PROVIDER_DB_PATH;
  const coordinatorPath = env.LOGIC_ENGINE_COORDINATOR_DB_PATH;
  const adapterId = env.LOGIC_ENGINE_ADAPTER_ID;
  if (typeof providerPathValue !== 'string' || !providerPathValue.trim()
    || typeof coordinatorPath !== 'string' || !isAbsolute(coordinatorPath)
    || typeof adapterId !== 'string' || !adapterId.trim()) {
    throw new Error('Local NPC runtime requires Core, Provider, Coordinator and adapter identity configuration.');
  }
  const providerPath = resolve(providerPathValue);
  let adapterTokens;
  try { adapterTokens = JSON.parse(env.ENGINE_ADAPTER_TOKENS || '{}'); }
  catch { throw new Error('ENGINE_ADAPTER_TOKENS must be a JSON object.'); }
  if (!adapterTokens || typeof adapterTokens !== 'object' || Array.isArray(adapterTokens)
    || typeof adapterTokens[adapterId] !== 'string'
    || adapterTokens[adapterId] !== env.LOGIC_ENGINE_ADAPTER_TOKEN) {
    throw new Error('Host adapter identity/token does not match the Core adapter registry.');
  }

  const catalogPath = env.LOGIC_ENGINE_WORLD_PACK_CATALOG_PATH;
  if (typeof catalogPath !== 'string' || !catalogPath.trim()) {
    throw new Error('LOGIC_ENGINE_WORLD_PACK_CATALOG_PATH is required for the local NPC runtime.');
  }
  const worldPackCatalog = loadTrustedWorldPackCatalog(resolve(catalogPath));
  const trustedInitialKnowledgeSources = parseTrustedInitialKnowledgeSources(env);
  let contentFields;
  try { contentFields = JSON.parse(env.ENGINE_MEMORY_NPC_CONTENT_FIELDS || '[]'); }
  catch { throw new Error('ENGINE_MEMORY_NPC_CONTENT_FIELDS must be a JSON array.'); }
  if (!Array.isArray(contentFields) || contentFields.length === 0
    || contentFields.some(field => typeof field !== 'string' || !field.trim())
    || new Set(contentFields).size !== contentFields.length) {
    throw new Error('ENGINE_MEMORY_NPC_CONTENT_FIELDS must be a non-empty unique string array.');
  }

  const store = Object.create(SQLiteStore.prototype);
  store.db = new DatabaseSync(corePath, { readOnly: true });
  store.coordinatorDb = openCoordinatorDatabase(coordinatorPath);
  store.coordinatorLeaseDepth = 0;
  store.txDepth = 0;
  store.inventoryCursorKey = randomBytes(32);
  const authorizers = createHostBoundNpcKnowledgeAuthorizers({
    store,
    adapterIds: [adapterId],
    trustedInitialKnowledgeSources,
  });
  const engine = Object.create(LogicEngine.prototype);
  engine.store = store;
  engine.worldPackCatalog = worldPackCatalog;
  engine.trustedInitialKnowledgeSources = trustedInitialKnowledgeSources;
  engine.npcKnowledgeReadAuthorizer = authorizers.readAuthorizer;
  engine.npcKnowledgeVisibilityAuthorizer = authorizers.visibilityAuthorizer;

  let adapter;
  try {
    adapter = createMemoryNpcProviderAdapter({
      engine,
      providerPath,
      coordinatorPath: resolve(coordinatorPath),
      adapterId,
      trustedInitialKnowledgeSources,
      fieldPolicy: defaultMechanicPolicyFieldPolicy,
      contentFields,
      isAuthenticatedHostRequest: hostAdapter.isAuthenticatedHostRequest,
      resolveHostConversationId: hostAdapter.resolveHostConversationId,
      resolveHostIdentity: hostAdapter.resolveHostIdentity,
      observerOnly: true,
    });
    if (!adapter.npcGenerationContext || typeof adapter.runWithAuthenticatedHostSession !== 'function') {
      throw new Error('LOCAL_NPC_CONTEXT_RUNTIME_NOT_READY');
    }
  } catch (error) {
    try { store.db.close(); } catch {}
    try { store.coordinatorDb.close(); } catch {}
    throw error;
  }

  let closed = false;
  return Object.freeze({
    adapter,
    engine,
    store,
    runWithAuthenticatedHostSession: adapter.runWithAuthenticatedHostSession,
    close() {
      if (closed) return;
      closed = true;
      try { adapter.close(); } finally {
        try { store.db.close(); } catch {}
        try { store.coordinatorDb.close(); } catch {}
      }
    },
  });
}
