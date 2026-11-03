import { once } from 'node:events';
import { SQLiteStore } from '../../src/storage/sqlite-store.js';
import { LogicEngine } from '../../src/application/engine.js';
import { ActorBindingService } from '../../src/application/actor-bindings.js';
import { HostConversationWorldBindingService } from '../../src/application/host-conversation-world-bindings.js';
import { createMemoryNpcProviderAdapter } from '../../src/application/memory-npc-provider-adapter.js';
import { HostAssertionNonceStore } from '../../src/application/host-assertion-nonce-store.js';
import { createApiServer } from '../../src/api/server.js';

const {
  CORE_DB_PATH,
  PROVIDER_DB_PATH,
  COORDINATOR_DB_PATH,
  NONCE_DB_PATH,
  API_TOKEN,
  ADAPTER_ID,
  ADAPTER_TOKEN,
  SESSION_ID,
  HOST_INSTALLATION_ID,
} = process.env;

for (const [name, value] of Object.entries({
  CORE_DB_PATH, PROVIDER_DB_PATH, COORDINATOR_DB_PATH, NONCE_DB_PATH,
  API_TOKEN, ADAPTER_ID, ADAPTER_TOKEN, SESSION_ID, HOST_INSTALLATION_ID,
})) {
  if (typeof value !== 'string' || !value) throw new Error('Missing required child-server setting: ' + name);
}
process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH = COORDINATOR_DB_PATH;

const store = new SQLiteStore(CORE_DB_PATH);
const engine = new LogicEngine(store);
const worldId = 'cross-process-world';
const actorId = 'cross-process-npc';
const sourceId = 'cross-process-source';
const conversationUuid = '44444444-4444-4444-8444-444444444444';
const conversationId = SESSION_ID + ':' + HOST_INSTALLATION_ID + ':' + conversationUuid;

let providerAdapter;
let nonceStore;
let server;
let stopping = false;

async function shutdown() {
  if (stopping) return;
  stopping = true;
  if (server?.listening) {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
  try { nonceStore?.close(); } catch {}
  try { providerAdapter?.close(); } catch {}
  try { store.close(); } catch {}
}

try {
  engine.createWorld({
    world_id: worldId,
    world_pack_id: 'test.host-core-cross-process',
    world_pack_version: '1',
    game_time: '2026-01-01T00:00:00Z',
  });
  engine.commitEvent(worldId, {
    idempotency_key: 'cross-process-seed',
    turn_id: 'cross-process-seed',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [
      { kind: 'entity.create', entity_id: actorId, entity_type: 'character', attributes: { name: 'NPC' } },
      { kind: 'entity.create', entity_id: sourceId, entity_type: 'character', attributes: { public_note: 'retrieved across process boundary' } },
    ],
  });
  new ActorBindingService(engine).bind(worldId, ADAPTER_ID, actorId);
  new HostConversationWorldBindingService(engine).bind({
    adapterId: ADAPTER_ID,
    conversationId,
    worldId,
  });

  providerAdapter = createMemoryNpcProviderAdapter({
    engine,
    providerPath: PROVIDER_DB_PATH,
    coordinatorPath: COORDINATOR_DB_PATH,
    adapterId: ADAPTER_ID,
    trustedInitialKnowledgeSources: [],
    fieldPolicy: (_context, _entity, field) => field === 'entity_id' || field === 'attributes.public_note',
    contentFields: ['attributes.public_note'],
  });
  const source = engine.getSnapshot(worldId, {
    entityIds: [sourceId],
    includeSourceVersions: true,
  }).entities[0];
  const scope = { world_id: worldId, subject_id: actorId, purpose: 'npc_decision' };
  const record = {
    ...scope,
    record_ref: 'memory:cross-process-record',
    record_version: 'v1',
    source_kind: 'canonical_entity',
    source_entity_id: sourceId,
    source_version: source.source_version,
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer_kind: 'host-core-cross-process',
    content_disposition: 'usable',
    evidence_assessment: 'unassessed',
    lineage: [{
      source_kind: 'canonical_entity',
      entity_id: sourceId,
      source_version: source.source_version,
    }],
  };
  providerAdapter.provider.putRecord(record);
  providerAdapter.provider.grantQuery(scope, true);
  providerAdapter.provider.grantRecord(scope, record.record_ref, record.record_version, true);
  const prepared = await providerAdapter.prepareWorld(worldId);
  if (prepared.status !== 'current') throw new Error('Provider reconciliation failed: ' + prepared.status);

  nonceStore = new HostAssertionNonceStore({
    path: NONCE_DB_PATH,
    coreDatabasePath: CORE_DB_PATH,
    coordinatorPath: COORDINATOR_DB_PATH,
  });
  const memoryNpcConsumers = { [ADAPTER_ID]: providerAdapter.consumer };
  server = createApiServer({
    engine,
    token: API_TOKEN,
    adapterTokens: { [ADAPTER_ID]: ADAPTER_TOKEN },
    memoryNpcConsumers,
    hostAssertionNonceStore: nonceStore,
    resolveHostLifecycleIdentity: input => ({
      authorized: true, adapter_id: ADAPTER_ID,
      host_installation_id: input.host_installation_id,
      authenticated_account_id: input.authenticated_account_id,
      host_session_id: input.host_session_id,
      conversation_uuid: input.conversation_uuid,
      root_id: 'a'.repeat(64), authority_id: 'cross-process-test-authority',
      generation: 1, snapshot_fingerprint: 'b'.repeat(64),
    }),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  process.stdout.write(JSON.stringify({ ready: true, port: server.address().port }) + '\n');
} catch (error) {
  await shutdown();
  process.stderr.write((error?.stack || String(error)) + '\n');
  process.exitCode = 1;
}

process.on('message', message => {
  if (message?.type === 'shutdown') void shutdown().then(() => process.exit(0));
});
process.on('SIGTERM', () => { void shutdown().then(() => process.exit(0)); });
process.on('SIGINT', () => { void shutdown().then(() => process.exit(0)); });
