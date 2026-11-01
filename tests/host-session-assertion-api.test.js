import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApiServer } from '../src/api/server.js';
import { LogicEngine } from '../src/application/engine.js';
import { ActorBindingService } from '../src/application/actor-bindings.js';
import { HostConversationWorldBindingService } from '../src/application/host-conversation-world-bindings.js';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { createHostContextRoute } from '../host-adapter/server-plugin/context-route.mjs';

const apiToken = 'host-session-api-test-token-2026';
const adapterToken = 'host-session-adapter-test-token-2026';
const adapterId = 'st-adapter';
const worldId = 'host-session-world';
const actorId = 'host-session-actor';
const installationId = '11111111-1111-4111-8111-111111111111';
const accountId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
const conversationUuid = '44444444-4444-4444-8444-444444444444';
const conversationId = [installationId, accountId, conversationUuid].join(':');
const directories = { root: '/st', chats: '/st/chats', groups: '/st/groups', groupChats: '/st/groupChats' };

function makeResponse() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    sendStatus(code) { this.statusCode = code; return this; },
  };
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

test('real ST server middleware -> Host Adapter -> Core HTTP assertion creates a non-forgeable session capability', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-host-session-api-'));
  const store = new SQLiteStore(join(directory, 'core.sqlite'));
  const engine = new LogicEngine(store);
  engine.createWorld({
    world_id: worldId,
    world_pack_id: 'test.host-session',
    world_pack_version: '1',
    game_time: '2026-01-01T00:00:00Z',
  });
  engine.commitEvent(worldId, {
    event_id: 'host-session-seed',
    idempotency_key: 'host-session-seed',
    turn_id: 'host-session-seed',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [{ kind: 'entity.create', entity_id: actorId, entity_type: 'character' }],
  });
  new ActorBindingService(engine).bind(worldId, adapterId, actorId);
  new HostConversationWorldBindingService(engine).bind({
    adapterId, conversationId, worldId,
  });

  const core = createApiServer({
    engine,
    token: apiToken,
    adapterTokens: { [adapterId]: adapterToken },
  });
  core.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    core.once('listening', resolve);
    core.once('error', reject);
  });
  const address = core.address();
  const coreUrl = `http://127.0.0.1:${address.port}`;

  const corePost = async (route, body) => {
    const response = await fetch(coreUrl + route, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiToken}`,
        'content-type': 'application/json',
        'x-adapter-id': adapterId,
        'x-adapter-token': adapterToken,
      },
      body: JSON.stringify(body),
      redirect: 'error',
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.code ?? 'CORE_REQUEST_REJECTED');
    return payload;
  };

  const route = createHostContextRoute({
    identityStore: {
      async resolveAuthenticatedAccount(handle) {
        assert.equal(handle, 'default-user');
        return { host_installation_id: installationId, authenticated_account_id: accountId };
      },
    },
    enumerate: async input => {
      assert.deepEqual(input.directories, directories);
      return {
        filesystem: { status: 'complete' },
        source: {
          status: 'DOUBLE_SCAN_CANDIDATE',
          files: [{ logical_identity: { conversation_uuid: conversationUuid } }],
        },
      };
    },
    corePost,
    config: { adapterId, actorEntityId: actorId, adapterToken },
  });

  t.after(async () => {
    await closeServer(core);
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const request = {
    user: { profile: { handle: 'default-user' }, directories },
    session: { logicEngineSessionId: sessionId, logicEngineSessionHandle: 'default-user' },
    body: { conversation_uuid: conversationUuid },
  };
  const response = makeResponse();
  let nextCalls = 0;
  await route.middleware(request, response, () => { nextCalls++; });
  assert.equal(nextCalls, 1);
  await route.handler(request, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, 'AUTHENTICATED_HOST_CONTEXT');
  assert.equal(response.body.authentication, 'AUTHENTICATED_HOST_SESSION');
  assert.equal(response.body.conversation_id, conversationId);
  assert.deepEqual(response.body.binding, {
    world_id: worldId,
    actor_id: actorId,
    adapter_id: adapterId,
  });
});

test('Core Host assertion nonce remains consumed after Core API restart', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-host-session-replay-'));
  const store = new SQLiteStore(join(directory, 'core.sqlite'));
  const engine = new LogicEngine(store);
  const assertion = {
    protocol_version: 1,
    host_installation_id: installationId,
    authenticated_account_id: accountId,
    host_session_id: sessionId,
    conversation_id: conversationId,
    world_id: worldId,
    actor_id: actorId,
    issued_at: Math.floor(Date.now() / 1000),
    nonce: '55555555-5555-4555-8555-555555555555',
  };
  const { createHmac } = await import('node:crypto');
  const signature = createHmac('sha256', adapterToken).update(JSON.stringify([
    assertion.protocol_version,
    assertion.host_installation_id,
    assertion.authenticated_account_id,
    assertion.host_session_id,
    assertion.conversation_id,
    assertion.world_id,
    assertion.actor_id,
    assertion.issued_at,
    assertion.nonce,
  ]), 'utf8').digest('hex');

  const start = async () => {
    const server = createApiServer({ engine, token: apiToken, adapterTokens: { [adapterId]: adapterToken } });
    server.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    return server;
  };
  const post = async server => {
    const address = server.address();
    return fetch(`http://127.0.0.1:${address.port}/v1/host-sessions/verify`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiToken}`,
        'content-type': 'application/json',
        'x-adapter-id': adapterId,
        'x-adapter-token': adapterToken,
      },
      body: JSON.stringify({ assertion, signature }),
    });
  };

  let server = await start();
  t.after(async () => {
    await closeServer(server);
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const first = await post(server);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).status, 'AUTHENTICATED_HOST_SESSION');
  await closeServer(server);

  server = await start();
  const replay = await post(server);
  assert.equal(replay.status, 403);
  assert.equal((await replay.json()).error.code, 'HOST_SESSION_ASSERTION_REJECTED');
});
