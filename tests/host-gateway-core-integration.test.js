import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { ActorBindingService } from '../src/application/actor-bindings.js';
import { HostConversationWorldBindingService } from '../src/application/host-conversation-world-bindings.js';
import { createApiServer } from '../src/api/server.js';
import { HostIdentityStore } from '../host-adapter/prototype/server-plugin/st-host-identity-store.mjs';
import { createHostContextTransportHandler } from '../host-adapter/prototype/server-plugin/host-context-transport.mjs';

const API_TOKEN = 'host-gateway-integration-api-token';
const ADAPTER_ID = 'st-host';
const ADAPTER_TOKEN = 'host-gateway-integration-adapter-token';
const WORLD_ID = 'gateway-integration-world';
const ACTOR_ID = 'gateway-integration-actor';
const CONVERSATION_UUID = '8e6b0a80-4e73-4c66-aaf3-7a6e62c7f408';
const SESSION_ID = '9e6b0a80-4e73-4c66-aaf3-7a6e62c7f409';
const PINNED_HOST = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';

function responseStub() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    sendStatus(code) { this.statusCode = code; return this; },
  };
}

test('SillyTavern Gateway makes a real signed Core call using server identity and Core-owned bindings', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'logic-engine-host-gateway-'));
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  const server = createApiServer({
    engine,
    token: API_TOKEN,
    adminToken: 'host-gateway-integration-admin-token',
    adapterTokens: { [ADAPTER_ID]: ADAPTER_TOKEN },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    store.close();
    await rm(directory, { recursive: true, force: true });
  });

  const coreUrl = 'http://127.0.0.1:' + server.address().port;
  const worldResponse = await fetch(coreUrl + '/v1/worlds', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + API_TOKEN,
      'x-admin-token': 'host-gateway-integration-admin-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      world_id: WORLD_ID,
      world_pack_id: 'test.world',
      world_pack_version: '1.0.0',
      game_time: '2026-01-01T00:00:00Z',
    }),
  });
  assert.equal(worldResponse.status, 201);

  store.db.prepare(`INSERT INTO entities(
    world_id,entity_id,entity_type,status,attributes_json,created_by_event_id,updated_revision
  ) VALUES(?,?,?,?,?,?,?)`).run(WORLD_ID, ACTOR_ID, 'person', 'active', '{}', 'gateway-integration-seed', 0);
  new ActorBindingService(engine).bind(WORLD_ID, ADAPTER_ID, ACTOR_ID);

  const identityStore = new HostIdentityStore({ directory });
  const account = await identityStore.resolveAuthenticatedAccount('default-user');
  const conversationId = [account.host_installation_id, account.authenticated_account_id, CONVERSATION_UUID].join(':');
  new HostConversationWorldBindingService(engine).bind({
    adapterId: ADAPTER_ID,
    conversationId,
    worldId: WORLD_ID,
  });

  const handler = createHostContextTransportHandler({
    identityStore,
    enumerate: async ({ directories, hostCommit }) => {
      assert.equal(hostCommit, PINNED_HOST);
      assert.equal(directories.root, '/st/data');
      return {
        filesystem: { status: 'complete' },
        source: {
          status: 'DOUBLE_SCAN_CANDIDATE',
          logical_identity_status: 'CURRENT_FILE_IDENTITIES_VERIFIED',
          files: [{ logical_identity: { conversation_uuid: CONVERSATION_UUID } }],
        },
      };
    },
    env: {
      LOGIC_ENGINE_CORE_URL: coreUrl,
      LOGIC_ENGINE_API_TOKEN: API_TOKEN,
      LOGIC_ENGINE_ADAPTER_ID: ADAPTER_ID,
      LOGIC_ENGINE_ADAPTER_TOKEN: ADAPTER_TOKEN,
      LOGIC_ENGINE_HOST_WORLD_ID: WORLD_ID,
      LOGIC_ENGINE_HOST_ACTOR_ID: ACTOR_ID,
      LOGIC_ENGINE_HOST_BUILD_SHA: PINNED_HOST,
    },
  });

  const response = responseStub();
  await handler({
    user: {
      profile: { handle: 'default-user' },
      directories: { root: '/st/data', chats: '/st/data/chats', groups: '/st/data/groups', groupChats: '/st/data/groupChats' },
    },
    session: {
      logicEngineSessionId: SESSION_ID,
      logicEngineSessionHandle: 'default-user',
    },
    body: { conversation_uuid: CONVERSATION_UUID },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    status: 'HOST_CONTEXT_AUTHENTICATED',
    conversation_id: conversationId,
    host_session_id: SESSION_ID,
    world_binding_verified: true,
    actor_binding_verified: true,
  });
});
