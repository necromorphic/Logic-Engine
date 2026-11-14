import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostLifecycleJournalProxy } from '../server-plugin/st-server-digest-proxy.mjs';

const ids = {
  installation: '11111111-1111-4111-8111-111111111111',
  account: '22222222-2222-4222-8222-222222222222',
  session: '33333333-3333-4333-8333-333333333333',
  conversation: '44444444-4444-4444-8444-444444444444',
};

function responseCapture() {
  return {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

test('first lifecycle preflight bootstraps missing Root Inventory through the authenticated Host gate and retries once', async (t) => {
  const previousDataRoot = globalThis.DATA_ROOT;
  globalThis.DATA_ROOT = process.cwd();
  t.after(() => { if (previousDataRoot === undefined) delete globalThis.DATA_ROOT; else globalThis.DATA_ROOT = previousDataRoot; });
  let upstreamCalls = 0;
  let bootstrapCalls = 0;
  const fetchImpl = async (url, options) => {
    assert.equal(url.pathname, '/v1/host-lifecycle/status');
    assert.equal(options.method, 'GET');
    upstreamCalls += 1;
    if (upstreamCalls === 1) {
      return {
        status: 403,
        ok: false,
        async json() { return { error: { code: 'HOST_LIFECYCLE_NOT_AUTHORIZED' } }; },
      };
    }
    return {
      status: 200,
      ok: true,
      async json() { return { lifecycle: { status: 'READY' } }; },
    };
  };
  const proxy = createHostLifecycleJournalProxy({
    env: {
      LOGIC_ENGINE_CORE_URL: 'http://127.0.0.1:52087',
      LOGIC_ENGINE_API_TOKEN: 'a'.repeat(32),
      LOGIC_ENGINE_ADAPTER_ID: 'sillytavern-main',
      LOGIC_ENGINE_ADAPTER_TOKEN: 'b'.repeat(32),
    },
    fetchImpl,
    identityStore: {
      directory: '/tmp/logic-engine-host-identity',
      async assertOutsideRoot() {},
      async resolveAuthenticatedAccount() {
        return {
          host_installation_id: ids.installation,
          authenticated_account_id: ids.account,
        };
      },
    },
    receiptStore: {
      async prepare() {},
      async commit() {},
      async abort() {},
      async recover() {},
    },
    ensureRootInventory: async (_request, conversationUuid) => {
      bootstrapCalls += 1;
      assert.equal(conversationUuid, ids.conversation);
      return { status: 'READY' };
    },
  });
  const request = {
    user: { profile: { handle: 'default-user' } },
    session: {
      handle: 'default-user',
      logicEngineSessionHandle: 'default-user',
      logicEngineSessionId: ids.session,
    },
    query: {
      conversation_id: [ids.installation, ids.account, ids.conversation].join(':'),
    },
  };
  const response = responseCapture();

  await proxy.status(request, response);

  assert.equal(bootstrapCalls, 1);
  assert.equal(upstreamCalls, 2);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload, { lifecycle: { status: 'READY' } });
});

test('lifecycle preflight does not bootstrap or retry unrelated authorization failures', async (t) => {
  const previousDataRoot = globalThis.DATA_ROOT;
  globalThis.DATA_ROOT = process.cwd();
  t.after(() => { if (previousDataRoot === undefined) delete globalThis.DATA_ROOT; else globalThis.DATA_ROOT = previousDataRoot; });
  let upstreamCalls = 0;
  let bootstrapCalls = 0;
  const proxy = createHostLifecycleJournalProxy({
    env: {
      LOGIC_ENGINE_CORE_URL: 'http://127.0.0.1:52087',
      LOGIC_ENGINE_API_TOKEN: 'a'.repeat(32),
      LOGIC_ENGINE_ADAPTER_ID: 'sillytavern-main',
      LOGIC_ENGINE_ADAPTER_TOKEN: 'b'.repeat(32),
    },
    fetchImpl: async () => {
      upstreamCalls += 1;
      return {
        status: 403,
        ok: false,
        async json() { return { error: { code: 'HOST_ROOT_INVENTORY_NOT_AUTHORIZED' } }; },
      };
    },
    identityStore: {
      directory: '/tmp/logic-engine-host-identity',
      async assertOutsideRoot() {},
      async resolveAuthenticatedAccount() {
        return {
          host_installation_id: ids.installation,
          authenticated_account_id: ids.account,
        };
      },
    },
    receiptStore: {
      async prepare() {},
      async commit() {},
      async abort() {},
      async recover() {},
    },
    ensureRootInventory: async () => {
      bootstrapCalls += 1;
      return { status: 'READY' };
    },
  });
  const request = {
    user: { profile: { handle: 'default-user' } },
    session: {
      handle: 'default-user',
      logicEngineSessionHandle: 'default-user',
      logicEngineSessionId: ids.session,
    },
    query: {
      conversation_id: [ids.installation, ids.account, ids.conversation].join(':'),
    },
  };
  const response = responseCapture();

  await proxy.status(request, response);

  assert.equal(bootstrapCalls, 0);
  assert.equal(upstreamCalls, 1);
  assert.equal(response.statusCode, 403);
  assert.equal(response.payload.error.code, 'HOST_ROOT_INVENTORY_NOT_AUTHORIZED');
});
