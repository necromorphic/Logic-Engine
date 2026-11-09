import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostDigestProxyHandler, createHostInventoryReconcileProxyHandler } from '../server-plugin/st-server-digest-proxy.mjs';

const ENV = {
  LOGIC_ENGINE_CORE_URL: 'http://127.0.0.1:8787',
  LOGIC_ENGINE_API_TOKEN: 'a'.repeat(32),
  LOGIC_ENGINE_ADAPTER_ID: 'host-adapter-test',
  LOGIC_ENGINE_ADAPTER_TOKEN: 'b'.repeat(32),
};

const INSTALLATION = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const CONVERSATION = '44444444-4444-4444-8444-444444444444';
const MESSAGE = '55555555-5555-4555-8555-555555555555';
const VERSION = '66666666-6666-4666-8666-666666666666';

function responseRecorder() {
  return {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

function requestFor(overrides = {}) {
  return {
    user: { profile: { handle: 'alice' } },
    session: {
      handle: 'alice',
      logicEngineSessionId: SESSION,
      logicEngineSessionHandle: 'alice',
    },
    body: {
      conversation_id: [INSTALLATION, ACCOUNT, CONVERSATION].join(':'),
      message_id: MESSAGE,
      version_id: VERSION,
      parent_version_id: null,
      content_sha256: 'c'.repeat(64),
      active: true,
      deleted: false,
    },
    ...overrides,
  };
}

test('production digest proxy reports exact bounded Host session rejection reasons without upstream calls', async () => {
  let upstreamCalls = 0;
  const handler = createHostDigestProxyHandler({
    env: ENV,
    fetchImpl: async () => { upstreamCalls++; throw new Error('must not call Core'); },
  });
  const cases = [
    [{ user: { profile: {} } }, 'HOST_USER_IDENTITY_MISSING'],
    [{ session: { handle: 'bob', logicEngineSessionId: SESSION, logicEngineSessionHandle: 'alice' } }, 'HOST_SESSION_ACCOUNT_MISMATCH'],
    [{ session: { handle: 'alice', logicEngineSessionId: SESSION, logicEngineSessionHandle: 'bob' } }, 'HOST_SESSION_HANDLE_MISMATCH'],
    [{ session: { handle: 'alice', logicEngineSessionHandle: 'alice' } }, 'HOST_SESSION_ID_MISSING_OR_INVALID'],
    [{ body: { conversation_id: 'not-a-host-conversation-id' } }, 'HOST_CONVERSATION_ID_INVALID'],
  ];

  for (const [overrides, reason] of cases) {
    const response = responseRecorder();
    await handler(requestFor(overrides), response);
    assert.equal(response.statusCode, 403);
    assert.equal(response.payload.error.code, 'HOST_SESSION_SCOPE_REQUIRED');
    assert.equal(response.payload.error.reason, reason);
  }
  assert.equal(upstreamCalls, 0);
});

test('production digest proxy uses the configured bounded timeout after successful session authentication', async () => {
  let observed;
  const handler = createHostDigestProxyHandler({
    env: ENV,
    timeoutMs: 1234,
    fetchImpl: async (_url, options) => {
      observed = options;
      return { status: 201, json: async () => ({ status: 'captured' }) };
    },
  });
  const response = responseRecorder();
  await handler(requestFor(), response);
  assert.equal(response.statusCode, 201);
  assert.equal(response.payload.status, 'captured');
  assert.equal(observed.method, 'POST');
  assert.equal(observed.signal instanceof AbortSignal, true);
  assert.equal(observed.signal.aborted, false);
});

test('production inventory reconciliation proxy reports the same bounded session reason', async () => {
  let upstreamCalls = 0;
  const handler = createHostInventoryReconcileProxyHandler({
    env: ENV,
    fetchImpl: async () => { upstreamCalls++; throw new Error('must not call Core'); },
  });
  const response = responseRecorder();
  await handler(requestFor({
    body: { conversation_id: 'invalid' },
  }), response);
  assert.equal(response.statusCode, 403);
  assert.equal(response.payload.error.code, 'HOST_SESSION_SCOPE_REQUIRED');
  assert.equal(response.payload.error.reason, 'HOST_CONVERSATION_ID_INVALID');
  assert.equal(upstreamCalls, 0);
});
