import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHmac, randomUUID } from 'node:crypto';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { ActorBindingService } from '../src/application/actor-bindings.js';
import { HostConversationWorldBindingService } from '../src/application/host-conversation-world-bindings.js';
import { createApiServer } from '../src/api/server.js';

const TOKEN = 'host-context-api-token-123456';
const ADMIN = 'host-context-admin-token-123456';
const ADAPTER = 'host-context-adapter-token-123456';
const ADAPTER_ID = 'st-host';
const INSTALLATION = '2e6b0a80-4e73-4c66-aaf3-7a6e62c7f401';
const ACCOUNT = '3e6b0a80-4e73-4c66-aaf3-7a6e62c7f402';
const SESSION = '4e6b0a80-4e73-4c66-aaf3-7a6e62c7f403';
const CONVERSATION = '5e6b0a80-4e73-4c66-aaf3-7a6e62c7f404';
const WORLD = 'host-context-world';
const ACTOR = 'host-context-actor';
const conversationId = [INSTALLATION, ACCOUNT, CONVERSATION].join(':');

function assertion(overrides = {}) {
  return {
    protocol_version: 1,
    host_installation_id: INSTALLATION,
    authenticated_account_id: ACCOUNT,
    host_session_id: SESSION,
    conversation_id: conversationId,
    world_id: WORLD,
    actor_id: ACTOR,
    issued_at: Math.floor(Date.now() / 1000),
    nonce: randomUUID(),
    ...overrides,
  };
}

function signature(value) {
  const canonical = JSON.stringify([
    value.protocol_version,
    value.host_installation_id,
    value.authenticated_account_id,
    value.host_session_id,
    value.conversation_id,
    value.world_id,
    value.actor_id,
    value.issued_at,
    value.nonce,
  ]);
  return createHmac('sha256', ADAPTER).update(canonical, 'utf8').digest('hex');
}

async function startServer(store, engine) {
  const server = createApiServer({
    engine,
    token: TOKEN,
    adminToken: ADMIN,
    adapterTokens: { [ADAPTER_ID]: ADAPTER },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, base: 'http://127.0.0.1:' + server.address().port };
}

function hostHeaders() {
  return {
    authorization: 'Bearer ' + TOKEN,
    'content-type': 'application/json',
    'x-adapter-id': ADAPTER_ID,
    'x-adapter-token': ADAPTER,
  };
}

async function setup(t) {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  const running = await startServer(store, engine);
  t.after(() => {
    running.server.close();
    store.close();
  });
  const worldResponse = await fetch(running.base + '/v1/worlds', {
    method: 'POST',
    headers: { ...hostHeaders(), 'x-admin-token': ADMIN },
    body: JSON.stringify({
      world_id: WORLD,
      world_pack_id: 'test.world',
      world_pack_version: '1.0.0',
      game_time: '2026-01-01T00:00:00Z',
    }),
  });
  assert.equal(worldResponse.status, 201);
  store.db.prepare(`INSERT INTO entities(
    world_id,entity_id,entity_type,status,attributes_json,created_by_event_id,updated_revision
  ) VALUES(?,?,?,?,?,?,?)`).run(WORLD, ACTOR, 'person', 'active', '{}', 'host-context-test-seed', 0);
  new ActorBindingService(engine).bind(WORLD, ADAPTER_ID, ACTOR);
  new HostConversationWorldBindingService(engine).bind({
    adapterId: ADAPTER_ID,
    conversationId,
    worldId: WORLD,
  });
  return { store, engine, ...running };
}

test('Core accepts only signed Gateway assertions matching current conversation, World and Actor bindings', async t => {
  const { base } = await setup(t);
  const value = assertion();
  const response = await fetch(base + '/v1/host/session-context', {
    method: 'POST',
    headers: hostHeaders(),
    body: JSON.stringify({ assertion: value, signature: signature(value) }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: 'HOST_CONTEXT_AUTHENTICATED',
    host_installation_id: INSTALLATION,
    authenticated_account_id: ACCOUNT,
    host_session_id: SESSION,
    conversation_id: conversationId,
    world_binding_verified: true,
    actor_binding_verified: true,
  });
});

test('Core denies caller-selected World or Actor even when the assertion is correctly signed', async t => {
  const { base } = await setup(t);
  for (const value of [
    assertion({ world_id: 'attacker-world' }),
    assertion({ actor_id: 'attacker-actor' }),
    assertion({ conversation_id: [INSTALLATION, ACCOUNT, randomUUID()].join(':') }),
  ]) {
    const response = await fetch(base + '/v1/host/session-context', {
      method: 'POST',
      headers: hostHeaders(),
      body: JSON.stringify({ assertion: value, signature: signature(value) }),
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'HOST_CONTEXT_DENIED');
  }
});

test('Core rejects assertion replay across API server restart using durable nonce state', async t => {
  const { base, server, store, engine } = await setup(t);
  const value = assertion();
  const envelope = { assertion: value, signature: signature(value) };
  const first = await fetch(base + '/v1/host/session-context', {
    method: 'POST', headers: hostHeaders(), body: JSON.stringify(envelope),
  });
  assert.equal(first.status, 200);

  await new Promise(resolve => server.close(resolve));
  const restarted = await startServer(store, engine);
  t.after(() => restarted.server.close());
  const replay = await fetch(restarted.base + '/v1/host/session-context', {
    method: 'POST', headers: hostHeaders(), body: JSON.stringify(envelope),
  });
  assert.equal(replay.status, 403);
  assert.equal((await replay.json()).error.code, 'HOST_CONTEXT_DENIED');
});

test('Core rejects ambiguous adapter-to-Actor bindings at the context boundary', async t => {
  const { base, store, engine } = await setup(t);
  const secondActor = 'host-context-second-actor';
  store.db.prepare(`INSERT INTO entities(
    world_id,entity_id,entity_type,status,attributes_json,created_by_event_id,updated_revision
  ) VALUES(?,?,?,?,?,?,?)`).run(WORLD, secondActor, 'person', 'active', '{}', 'host-context-test-seed-2', 0);
  new ActorBindingService(engine).bind(WORLD, ADAPTER_ID, secondActor);
  const value = assertion();
  const response = await fetch(base + '/v1/host/session-context', {
    method: 'POST',
    headers: hostHeaders(),
    body: JSON.stringify({ assertion: value, signature: signature(value) }),
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'HOST_CONTEXT_DENIED');
});

test('Core rechecks conversation binding after revocation before accepting Host context', async t => {
  const { base, engine } = await setup(t);
  new HostConversationWorldBindingService(engine).revoke({
    adapterId: ADAPTER_ID,
    conversationId,
    reason: 'test-revoke-before-context',
  });
  const value = assertion();
  const response = await fetch(base + '/v1/host/session-context', {
    method: 'POST',
    headers: hostHeaders(),
    body: JSON.stringify({ assertion: value, signature: signature(value) }),
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'HOST_CONTEXT_DENIED');
});

test('Core denies malformed assertions and missing adapter authentication', async t => {
  const { base } = await setup(t);
  const valid = assertion();
  const malformed = { ...valid, extra: 'not-allowed' };
  const badShape = await fetch(base + '/v1/host/session-context', {
    method: 'POST', headers: hostHeaders(),
    body: JSON.stringify({ assertion: malformed, signature: signature(valid) }),
  });
  assert.equal(badShape.status, 403);

  const noAdapter = await fetch(base + '/v1/host/session-context', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify({ assertion: valid, signature: signature(valid) }),
  });
  assert.equal(noAdapter.status, 403);
});
