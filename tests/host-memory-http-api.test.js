import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHmac } from 'node:crypto';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { createApiServer } from '../src/api/server.js';
import { getAuthenticatedHostSessionContext } from '../src/application/host-session-context.js';
import { HostAssertionNonceStore } from '../src/application/host-assertion-nonce-store.js';

const API_TOKEN = 'host-memory-api-token-long-enough';
const ADMIN_TOKEN = 'host-memory-admin-token-long-enough';
const ADAPTER_TOKEN = 'host-memory-adapter-token-long-enough';
const ADAPTER_ID = 'st-host-adapter';
const INSTALLATION = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const CONVERSATION = '44444444-4444-4444-8444-444444444444';
const NONCE = '55555555-5555-4555-8555-555555555555';
const conversationId = SESSION + ':' + INSTALLATION + ':' + CONVERSATION;

function sign(assertion) {
  const canonical = JSON.stringify([
    assertion.protocol_version, assertion.host_installation_id,
    assertion.authenticated_account_id, assertion.host_session_id,
    assertion.conversation_id, assertion.world_id, assertion.actor_id,
    assertion.issued_at, assertion.nonce,
  ]);
  return createHmac('sha256', ADAPTER_TOKEN).update(canonical, 'utf8').digest('hex');
}
function post(base, pathname, headers, body) {
  return fetch(base + pathname, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('Core Host context and Memory retrieval routes enforce PC-NEXT-11 and signed adapter assertions', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'host-memory-http-'));
  const corePath = join(directory, 'core.sqlite');
  const coordinatorPath = resolve(join(directory, 'coordinator.sqlite'));
  const store = new SQLiteStore(corePath);
  const engine = new LogicEngine(store);
  const nonceStore = new HostAssertionNonceStore({
    path: join(directory, 'host-assertion-nonces.sqlite'),
    coreDatabasePath: corePath,
    coordinatorPath,
  });
  engine.createWorld({
    world_id: 'host-memory-world', world_pack_id: 'test.host-memory',
    world_pack_version: '1', game_time: '2026-01-01T00:00:00Z',
  });
  engine.commitEvent('host-memory-world', {
    idempotency_key: 'host-memory-seed-actor', turn_id: 'host-memory-seed-actor',
    event_type: 'action.completed', expected_revision: 0,
    effects: [{ kind: 'entity.create', entity_id: 'host-memory-actor', entity_type: 'character' }],
  });
  let calls = 0;
  const consumer = {
    adapterId: ADAPTER_ID,
    async retrieveForNpc({ conversationId: requested }) {
      calls += 1;
      const context = getAuthenticatedHostSessionContext();
      assert.equal(context.conversation_id, requested);
      assert.equal(context.host_session_id, SESSION);
      assert.equal(context.host_installation_id, INSTALLATION);
      assert.equal(context.authenticated_account_id, ACCOUNT);
      assert.equal(context.world_id, 'host-memory-world');
      assert.equal(context.actor_id, 'host-memory-actor');
      return { status: 'ready', admitted: [], candidates: [], snapshot: { world_revision: 0, commit_sequence: 0 } };
    },
  };
  let server = createApiServer({
    engine, token: API_TOKEN, adminToken: ADMIN_TOKEN,
    adapterTokens: { [ADAPTER_ID]: ADAPTER_TOKEN },
    memoryNpcConsumers: { [ADAPTER_ID]: consumer },
    hostAssertionNonceStore: nonceStore,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    nonceStore.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const headers = { authorization: 'Bearer ' + API_TOKEN };
  const adapterHeaders = { ...headers, 'x-adapter-id': ADAPTER_ID, 'x-adapter-token': ADAPTER_TOKEN };
  const adminHeaders = { ...headers, 'x-admin-token': ADMIN_TOKEN };

  const actorBinding = await post(base, '/v1/worlds/host-memory-world/actor-bindings', adminHeaders, {
    adapter_id: ADAPTER_ID, entity_id: 'host-memory-actor',
  });
  assert.equal(actorBinding.status, 201);
  const worldBinding = await post(base, '/v1/host-conversation-bindings', adminHeaders, {
    adapter_id: ADAPTER_ID, conversation_id: conversationId, world_id: 'host-memory-world',
  });
  assert.equal(worldBinding.status, 201);

  const contextResponse = await post(base, '/v1/host-context/resolve', adapterHeaders, {
    conversation_id: conversationId,
  });
  assert.equal(contextResponse.status, 200);
  assert.deepEqual((await contextResponse.json()).context, {
    adapter_id: ADAPTER_ID, conversation_id: conversationId,
    world_id: 'host-memory-world', actor_id: 'host-memory-actor', actor_type: 'character',
  });

  const assertion = {
    protocol_version: 1, host_installation_id: INSTALLATION,
    authenticated_account_id: ACCOUNT, host_session_id: SESSION,
    conversation_id: conversationId, world_id: 'host-memory-world',
    actor_id: 'host-memory-actor', issued_at: Math.floor(Date.now() / 1000), nonce: NONCE,
  };
  const body = {
    assertion, signature: sign(assertion),
    request_id: '66666666-6666-4666-8666-666666666666',
    context_size: 4096, generation_type: 'normal',
  };
  const retrieved = await post(base, '/v1/host/memory-npc/retrieve', adapterHeaders, body);
  assert.equal(retrieved.status, 200);
  assert.deepEqual((await retrieved.json()).retrieval.status, 'ready');
  assert.equal(calls, 1);

  const replay = await post(base, '/v1/host/memory-npc/retrieve', adapterHeaders, body);
  assert.equal(replay.status, 409);
  assert.equal((await replay.json()).error.code, 'HOST_SESSION_ASSERTION_REPLAYED');
  assert.equal(calls, 1);

  const tamperedAssertion = { ...assertion, actor_id: 'attacker-selected-actor' };
  const tampered = await post(base, '/v1/host/memory-npc/retrieve', adapterHeaders, {
    ...body, assertion: tamperedAssertion,
  });
  assert.equal(tampered.status, 401);
  assert.equal(calls, 1);

  // The nonce ledger is durable in the Core SQLite store, not a process-local Map.
  await new Promise(resolve => server.close(resolve));
  server = createApiServer({
    engine, token: API_TOKEN, adminToken: ADMIN_TOKEN,
    adapterTokens: { [ADAPTER_ID]: ADAPTER_TOKEN },
    memoryNpcConsumers: { [ADAPTER_ID]: consumer },
    hostAssertionNonceStore: nonceStore,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const restartedBase = 'http://127.0.0.1:' + server.address().port;
  const replayAfterRestart = await post(restartedBase, '/v1/host/memory-npc/retrieve', adapterHeaders, body);
  assert.equal(replayAfterRestart.status, 409);
  assert.equal((await replayAfterRestart.json()).error.code, 'HOST_SESSION_ASSERTION_REPLAYED');
  assert.equal(calls, 1);

  const callerSelectedWorld = await post(restartedBase, '/v1/host-context/resolve', adapterHeaders, {
    conversation_id: conversationId, world_id: 'attacker-world',
  });
  assert.equal(callerSelectedWorld.status, 400);
});
