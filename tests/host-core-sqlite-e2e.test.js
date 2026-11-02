import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { ActorBindingService } from '../src/application/actor-bindings.js';
import { HostConversationWorldBindingService } from '../src/application/host-conversation-world-bindings.js';
import { createMemoryNpcProviderAdapter } from '../src/application/memory-npc-provider-adapter.js';
import { HostAssertionNonceStore } from '../src/application/host-assertion-nonce-store.js';
import { createHostSessionAssertionRunner } from '../src/application/host-session-context.js';
import { createApiServer } from '../src/api/server.js';
import { createHostMemoryDispatchProxyHandler } from '../host-adapter/prototype/st-server-digest-proxy.mjs';

const API_TOKEN = 'host-core-sqlite-api-token-long-enough';
const ADAPTER_TOKEN = 'host-core-sqlite-adapter-token-long-enough';
const ADAPTER_ID = 'st-host-sqlite-e2e';
const INSTALLATION = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const CONVERSATION = '44444444-4444-4444-8444-444444444444';
const REQUEST_ID = '55555555-5555-4555-8555-555555555555';

function responseRecorder() {
  return {
    statusCode: null,
    payload: null,
    headers: {},
    set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    sendStatus(code) { this.statusCode = code; return this; },
  };
}

test('Host dispatch proxy retrieves a real SQLite Provider record through Core HTTP and MemoryNpcConsumer', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'host-core-sqlite-e2e-'));
  const corePath = join(directory, 'core.sqlite');
  const providerPath = join(directory, 'memory-provider.sqlite');
  const coordinatorPath = resolve(join(directory, 'coordinator.sqlite'));
  const previousCoordinator = process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH;
  process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH = coordinatorPath;

  let store;
  let providerAdapter;
  let nonceStore;
  let server;
  try {
    store = new SQLiteStore(corePath);
    const engine = new LogicEngine(store);
    const worldId = 'host-core-sqlite-world';
    const actorId = 'host-core-sqlite-npc';
    const sourceId = 'host-core-sqlite-source';
    const conversationId = SESSION + ':' + INSTALLATION + ':' + CONVERSATION;
    const hostConversationKey = INSTALLATION + ':' + ACCOUNT + ':' + CONVERSATION;

    engine.createWorld({
      world_id: worldId,
      world_pack_id: 'test.host-core-sqlite-e2e',
      world_pack_version: '1',
      game_time: '2026-01-01T00:00:00Z',
    });
    engine.commitEvent(worldId, {
      idempotency_key: 'host-core-sqlite-seed',
      turn_id: 'host-core-sqlite-seed',
      event_type: 'action.completed',
      expected_revision: 0,
      effects: [
        { kind: 'entity.create', entity_id: actorId, entity_type: 'character', attributes: { name: 'NPC' } },
        { kind: 'entity.create', entity_id: sourceId, entity_type: 'character', attributes: { public_note: 'retrieved from real SQLite Provider' } },
      ],
    });
    new ActorBindingService(engine).bind(worldId, ADAPTER_ID, actorId);
    new HostConversationWorldBindingService(engine).bind({
      adapterId: ADAPTER_ID, conversationId, worldId,
    });

    providerAdapter = createMemoryNpcProviderAdapter({
      engine,
      providerPath,
      coordinatorPath,
      adapterId: ADAPTER_ID,
      trustedInitialKnowledgeSources: [],
      fieldPolicy: (_context, _entity, field) => field === 'entity_id' || field === 'attributes.public_note',
      contentFields: ['attributes.public_note'],
    });
    const source = engine.getSnapshot(worldId, {
      entityIds: [sourceId], includeSourceVersions: true,
    }).entities[0];
    const scope = { world_id: worldId, subject_id: actorId, purpose: 'npc_decision' };
    const record = {
      ...scope,
      record_ref: 'memory:host-core-sqlite-record',
      record_version: 'v1',
      source_kind: 'canonical_entity',
      source_entity_id: sourceId,
      source_version: source.source_version,
      content_kind: 'claim',
      epistemic_kind: 'acquired_report',
      producer_kind: 'host-core-sqlite-e2e',
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
    assert.equal((await providerAdapter.prepareWorld(worldId)).status, 'current');

    const diagnosticAssertion = {
      protocol_version: 1,
      host_installation_id: INSTALLATION,
      authenticated_account_id: ACCOUNT,
      host_session_id: SESSION,
      conversation_id: conversationId,
      world_id: worldId,
      actor_id: actorId,
      issued_at: Math.floor(Date.now() / 1000),
      nonce: '66666666-6666-4666-8666-666666666666',
    };
    const diagnosticSignature = createHmac('sha256', ADAPTER_TOKEN).update(JSON.stringify([
      diagnosticAssertion.protocol_version, diagnosticAssertion.host_installation_id,
      diagnosticAssertion.authenticated_account_id, diagnosticAssertion.host_session_id,
      diagnosticAssertion.conversation_id, diagnosticAssertion.world_id,
      diagnosticAssertion.actor_id, diagnosticAssertion.issued_at, diagnosticAssertion.nonce,
    ]), 'utf8').digest('hex');
    const diagnosticRunner = createHostSessionAssertionRunner({ secret: ADAPTER_TOKEN });
    const diagnosticRetrieval = await diagnosticRunner.run(
      diagnosticAssertion, diagnosticSignature,
      () => providerAdapter.consumer.retrieveForNpc({ conversationId }),
    );
    if (diagnosticRetrieval.status !== 'ready') {
      throw new Error('Direct signed-context Consumer diagnostic: ' + JSON.stringify(diagnosticRetrieval));
    }

    nonceStore = new HostAssertionNonceStore({
      path: join(directory, 'host-assertion-nonces.sqlite'),
      coreDatabasePath: corePath,
      coordinatorPath,
    });
    server = createApiServer({
      engine,
      token: API_TOKEN,
      adapterTokens: { [ADAPTER_ID]: ADAPTER_TOKEN },
      memoryNpcConsumers: { [ADAPTER_ID]: providerAdapter.consumer },
      hostAssertionNonceStore: nonceStore,
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    const env = {
      LOGIC_ENGINE_CORE_URL: 'http://127.0.0.1:' + server.address().port,
      LOGIC_ENGINE_API_TOKEN: API_TOKEN,
      LOGIC_ENGINE_ADAPTER_ID: ADAPTER_ID,
      LOGIC_ENGINE_ADAPTER_TOKEN: ADAPTER_TOKEN,
    };
    const proxy = createHostMemoryDispatchProxyHandler({
      env,
      resolveHostContext: () => ({
        host_installation_id: INSTALLATION,
        authenticated_account_id: ACCOUNT,
        host_session_id: SESSION,
        conversation_id: hostConversationKey,
      }),
    });
    const invoke = async () => {
      const response = responseRecorder();
      await proxy({
        body: {
          request_id: REQUEST_ID,
          conversation_uuid: CONVERSATION,
          context_size: 4096,
          generation_type: 'normal',
        },
      }, response);
      return response;
    };

    const retrieved = await invoke();
    assert.equal(retrieved.statusCode, 200);
    if (retrieved.payload.retrieval.status !== 'ready') throw new Error('HTTP retrieval diagnostic: ' + JSON.stringify(retrieved.payload));
    assert.equal(retrieved.payload.retrieval.candidates.length, 1);
    assert.equal(
      retrieved.payload.retrieval.candidates[0].content['attributes.public_note'],
      'retrieved from real SQLite Provider',
    );

    providerAdapter.provider.revokeRecord(scope, record.record_ref, record.record_version);
    const revoked = await invoke();
    assert.equal(revoked.statusCode, 200);
    assert.ok(['ready', 'non_ready'].includes(revoked.payload.retrieval.status));
    assert.deepEqual(revoked.payload.retrieval.candidates, []);
    assert.deepEqual(revoked.payload.retrieval.admitted, []);
    assert.equal(JSON.stringify(revoked.payload).includes('retrieved from real SQLite Provider'), false);
  } finally {
    if (server?.listening) await new Promise(resolveClose => server.close(resolveClose));
    try { nonceStore?.close(); } catch {}
    try { providerAdapter?.close(); } catch {}
    try { store?.close(); } catch {}
    if (previousCoordinator === undefined) delete process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH;
    else process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH = previousCoordinator;
    rmSync(directory, { recursive: true, force: true });
  }
});
