import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createHostSessionRevocationClient } from '../server-plugin/st-host-session-revocation.mjs';
import { createHostSessionHandler } from '../server-plugin/st-host-inventory-handler.mjs';

const INSTALLATION = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const NONCE = '44444444-4444-4444-8444-444444444444';
const API_TOKEN = 'core-api-token-123456';
const ADAPTER_TOKEN = 'adapter-secret-123456';

function fixture(status = 204) {
  const calls = [];
  const identityStore = {
    async assertOutsideRoot(root) { assert.equal(root, '/srv/st-data'); },
    async resolveAuthenticatedAccount(handle) {
      assert.equal(handle, 'alice');
      return { host_installation_id: INSTALLATION, authenticated_account_id: ACCOUNT };
    },
  };
  const revoke = createHostSessionRevocationClient({
    env: {
      LOGIC_ENGINE_CORE_URL: 'http://127.0.0.1:8787',
      LOGIC_ENGINE_API_TOKEN: API_TOKEN,
      LOGIC_ENGINE_ADAPTER_ID: 'st-host-adapter',
      LOGIC_ENGINE_ADAPTER_TOKEN: ADAPTER_TOKEN,
    },
    identityStore,
    getDataRoot: () => '/srv/st-data',
    now: () => 1_800_000_000_000,
    createNonce: () => NONCE,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return { status };
    },
  });
  return { revoke, calls };
}

test('logout revocation signs the exact adapter/installation/account/session tuple without conversation_id', async () => {
  const { revoke, calls } = fixture();
  const request = { session: { logicEngineSessionId: SESSION, logicEngineSessionHandle: 'alice' } };
  assert.equal(await revoke(request, 'logout'), true);
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.url, 'http://127.0.0.1:8787/v1/host/session/revoke');
  assert.equal(call.options.method, 'POST');
  assert.equal(call.options.headers.authorization, 'Bearer ' + API_TOKEN);
  assert.equal(call.options.headers['x-adapter-id'], 'st-host-adapter');
  const body = JSON.parse(call.options.body);
  assert.deepEqual(Object.keys(body).sort(), [
    'authenticated_account_id', 'host_installation_id', 'host_session_id',
    'issued_at', 'nonce', 'protocol_version', 'reason', 'signature',
  ]);
  assert.equal(body.reason, 'logout');
  assert.equal(body.host_session_id, SESSION);
  const proof = JSON.stringify([1, 'st-host-adapter', INSTALLATION, ACCOUNT, SESSION, 1_800_000_000, NONCE, 'logout']);
  assert.equal(body.signature, createHmac('sha256', ADAPTER_TOKEN).update(proof).digest('hex'));
});

test('session rotation revokes the old session identity', async () => {
  const { revoke, calls } = fixture();
  await revoke({ session: { logicEngineSessionId: SESSION, logicEngineSessionHandle: 'alice' } }, 'session_rotation');
  assert.equal(JSON.parse(calls[0].options.body).reason, 'session_rotation');
});

test('logout without a Host session does not require the Core bridge', async () => {
  const { revoke, calls } = fixture();
  assert.equal(await revoke({ session: {} }, 'logout'), false);
  assert.equal(calls.length, 0);
});

test('revocation failure rejects and prevents logout/session rotation', async () => {
  const { revoke } = fixture(503);
  await assert.rejects(
    revoke({ session: { logicEngineSessionId: SESSION, logicEngineSessionHandle: 'alice' } }, 'logout'),
    /HOST_SESSION_REVOCATION_UNAVAILABLE/,
  );
});

test('Host session rotation revokes the old capability before issuing a new session ID', async () => {
  const oldSession = {
    logicEngineSessionId: SESSION,
    logicEngineSessionHandle: 'alice',
  };
  const calls = [];
  const handler = createHostSessionHandler({
    createId: () => '55555555-5555-4555-8555-555555555555',
    revokeSession: async (request, reason) => {
      calls.push({ sessionId: request.session.logicEngineSessionId, reason });
      return true;
    },
  });
  const response = {
    set() { return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; },
  };
  await handler({ session: oldSession, user: { profile: { handle: 'bob' } } }, response);
  assert.deepEqual(calls, [{ sessionId: SESSION, reason: 'session_rotation' }]);
  assert.equal(oldSession.logicEngineSessionId, '55555555-5555-4555-8555-555555555555');
  assert.equal(oldSession.logicEngineSessionHandle, 'bob');
  assert.equal(response.statusCode, 200);
});

test('Host session rotation preserves the old session when revocation fails', async () => {
  const oldSession = {
    logicEngineSessionId: SESSION,
    logicEngineSessionHandle: 'alice',
  };
  const handler = createHostSessionHandler({
    createId: () => '55555555-5555-4555-8555-555555555555',
    revokeSession: async () => { throw new Error('upstream unavailable'); },
  });
  const response = {
    set() { return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; },
  };
  await handler({ session: oldSession, user: { profile: { handle: 'bob' } } }, response);
  assert.equal(response.statusCode, 503);
  assert.equal(oldSession.logicEngineSessionId, SESSION);
  assert.equal(oldSession.logicEngineSessionHandle, 'alice');
});

test('session rotation rejects a non-confirming revocation result', async () => {
  const oldSession = {
    logicEngineSessionId: SESSION,
    logicEngineSessionHandle: 'alice',
  };
  const handler = createHostSessionHandler({
    createId: () => '55555555-5555-4555-8555-555555555555',
    revokeSession: async () => false,
  });
  const response = {
    set() { return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; },
  };
  await handler({ session: oldSession, user: { profile: { handle: 'bob' } } }, response);
  assert.equal(response.statusCode, 503);
  assert.equal(oldSession.logicEngineSessionId, SESSION);
  assert.equal(oldSession.logicEngineSessionHandle, 'alice');
});
