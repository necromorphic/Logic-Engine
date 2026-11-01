import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createHostContextTransportHandler } from '../server-plugin/host-context-transport.mjs';

const INSTALLATION = '2e6b0a80-4e73-4c66-aaf3-7a6e62c7f401';
const ACCOUNT = '3e6b0a80-4e73-4c66-aaf3-7a6e62c7f402';
const SESSION = '4e6b0a80-4e73-4c66-aaf3-7a6e62c7f403';
const CONVERSATION = '5e6b0a80-4e73-4c66-aaf3-7a6e62c7f404';
const NONCE = '6e6b0a80-4e73-4c66-aaf3-7a6e62c7f405';
const ADAPTER_TOKEN = 'host-adapter-secret-long-enough';
const CORE_TOKEN = 'core-api-token-long-enough-123';

function makeResponse() {
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

function fixture({ inventoryConversation = CONVERSATION, coreStatus = 200, coreBody = null } = {}) {
  const calls = [];
  const env = {
    LOGIC_ENGINE_CORE_URL: 'https://core.internal.example',
    LOGIC_ENGINE_API_TOKEN: CORE_TOKEN,
    LOGIC_ENGINE_ADAPTER_ID: 'st-host',
    LOGIC_ENGINE_ADAPTER_TOKEN: ADAPTER_TOKEN,
    LOGIC_ENGINE_HOST_WORLD_ID: 'world-from-server-config',
    LOGIC_ENGINE_HOST_ACTOR_ID: 'actor-from-server-config',
    LOGIC_ENGINE_HOST_BUILD_SHA: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
  };
  const handler = createHostContextTransportHandler({
    identityStore: {
      async resolveAuthenticatedAccount(handle) {
        assert.equal(handle, 'default-user');
        return {
          host_installation_id: INSTALLATION,
          authenticated_account_id: ACCOUNT,
        };
      },
    },
    enumerate: async ({ directories, hostCommit }) => {
      assert.deepEqual(directories, { root: '/st/data', chats: '/st/data/chats', groups: '/st/data/groups', groupChats: '/st/data/groupChats' });
      assert.equal(hostCommit, env.LOGIC_ENGINE_HOST_BUILD_SHA);
      return {
        filesystem: { status: 'complete' },
        source: {
          status: 'DOUBLE_SCAN_CANDIDATE',
          logical_identity_status: 'CURRENT_FILE_IDENTITIES_VERIFIED',
          files: [{ logical_identity: { conversation_uuid: inventoryConversation } }],
        },
      };
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: coreStatus === 200,
        status: coreStatus,
        json: async () => coreBody || {
          status: 'HOST_CONTEXT_AUTHENTICATED',
          host_session_id: SESSION,
          conversation_id: [INSTALLATION, ACCOUNT, CONVERSATION].join(':'),
          world_binding_verified: true,
          actor_binding_verified: true,
        },
      };
    },
    env,
    now: () => 1_800_000_000_000,
    createNonce: () => NONCE,
  });
  const request = {
    user: {
      profile: { handle: 'default-user' },
      directories: { root: '/st/data', chats: '/st/data/chats', groups: '/st/data/groups', groupChats: '/st/data/groupChats' },
    },
    session: { logicEngineSessionId: SESSION, logicEngineSessionHandle: 'default-user' },
    body: { conversation_uuid: CONVERSATION },
  };
  return { handler, request, calls, env };
}

test('Gateway validates the account-owned conversation then sends a signed assertion server-to-server', async () => {
  const { handler, request, calls, env } = fixture();
  const response = makeResponse();
  await handler(request, response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    status: 'HOST_CONTEXT_AUTHENTICATED',
    conversation_id: [INSTALLATION, ACCOUNT, CONVERSATION].join(':'),
    host_session_id: SESSION,
    world_binding_verified: true,
    actor_binding_verified: true,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://core.internal.example/v1/host/session-context');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.authorization, 'Bearer ' + CORE_TOKEN);
  assert.equal(calls[0].options.headers['x-adapter-id'], 'st-host');
  assert.equal(calls[0].options.headers['x-adapter-token'], ADAPTER_TOKEN);
  const envelope = JSON.parse(calls[0].options.body);
  assert.deepEqual(envelope.assertion, {
    protocol_version: 1,
    host_installation_id: INSTALLATION,
    authenticated_account_id: ACCOUNT,
    host_session_id: SESSION,
    conversation_id: [INSTALLATION, ACCOUNT, CONVERSATION].join(':'),
    world_id: 'world-from-server-config',
    actor_id: 'actor-from-server-config',
    issued_at: 1_800_000_000,
    nonce: NONCE,
  });
  const canonical = JSON.stringify([
    1, INSTALLATION, ACCOUNT, SESSION, [INSTALLATION, ACCOUNT, CONVERSATION].join(':'),
    'world-from-server-config', 'actor-from-server-config', 1_800_000_000, NONCE,
  ]);
  assert.equal(envelope.signature, createHmac('sha256', ADAPTER_TOKEN).update(canonical, 'utf8').digest('hex'));
});

test('Gateway never accepts caller-selected World, Actor, Core URL or identity fields', async () => {
  const { handler, request, calls } = fixture();
  request.body.world_id = 'attacker-world';
  const response = makeResponse();
  await handler(request, response);
  assert.equal(response.statusCode, 400);
  assert.equal(calls.length, 0);
});

test('Gateway denies a conversation UUID not present exactly once in the authenticated account inventory', async () => {
  const { handler, request, calls } = fixture({ inventoryConversation: '7e6b0a80-4e73-4c66-aaf3-7a6e62c7f406' });
  const response = makeResponse();
  await handler(request, response);
  assert.equal(response.statusCode, 403);
  assert.equal(response.body.code, 'HOST_CONVERSATION_NOT_IN_AUTHENTICATED_ACCOUNT');
  assert.equal(calls.length, 0);
});

test('Gateway rejects account/session mismatch before inventory or Core calls', async () => {
  const { handler, request, calls } = fixture();
  request.session.logicEngineSessionHandle = 'another-user';
  const response = makeResponse();
  await handler(request, response);
  assert.equal(response.statusCode, 403);
  assert.equal(calls.length, 0);
});

test('Gateway fails closed when Core denies current bindings or returns an invalid context envelope', async () => {
  const denied = fixture({ coreStatus: 403 });
  const deniedResponse = makeResponse();
  await denied.handler(denied.request, deniedResponse);
  assert.equal(deniedResponse.statusCode, 403);
  assert.equal(deniedResponse.body.code, 'CORE_HOST_CONTEXT_DENIED');

  const invalid = fixture({ coreBody: { status: 'HOST_CONTEXT_AUTHENTICATED', world_binding_verified: false } });
  const invalidResponse = makeResponse();
  await invalid.handler(invalid.request, invalidResponse);
  assert.equal(invalidResponse.statusCode, 502);
  assert.equal(invalidResponse.body.code, 'CORE_HOST_CONTEXT_RESPONSE_INVALID');
});

test('Gateway refuses insecure remote Core URLs and incomplete server credentials', async () => {
  const { handler, request, calls } = fixture();
  handler.dependencies;
  const unsafe = fixture();
  unsafe.env.LOGIC_ENGINE_CORE_URL = 'http://core.internal.example:8787';
  const unsafeHandler = createHostContextTransportHandler({
    identityStore: { resolveAuthenticatedAccount: async () => ({ host_installation_id: INSTALLATION, authenticated_account_id: ACCOUNT }) },
    enumerate: async () => ({ filesystem: { status: 'complete' }, source: { status: 'DOUBLE_SCAN_CANDIDATE', logical_identity_status: 'CURRENT_FILE_IDENTITIES_VERIFIED', files: [{ logical_identity: { conversation_uuid: CONVERSATION } }] } }),
    fetchImpl: async () => { calls.push('unexpected'); },
    env: unsafe.env,
  });
  const response = makeResponse();
  await unsafeHandler(request, response);
  assert.equal(response.statusCode, 503);
  assert.equal(calls.length, 0);
});
