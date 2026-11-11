import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHostLifecycleJournalProxy } from '../server-plugin/st-server-digest-proxy.mjs';
import { verifyHostMutationReceiptSignature } from '../server-plugin/st-host-mutation-receipt-signature.mjs';

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
const MUTATION = '55555555-5555-4555-8555-555555555555';
const PREPARED_EVENT = '66666666-6666-4666-8666-666666666666';
const TERMINAL_EVENT = '77777777-7777-4777-8777-777777777777';
const conversationId = [INSTALLATION, ACCOUNT, CONVERSATION].join(':');
const occurredAt = '2026-11-11T14:00:00.000Z';
const root = path.join(tmpdir(), 'logic-engine-host-proxy-root');
const directories = {
  root,
  chats: path.join(root, 'chats'),
  groups: path.join(root, 'groups'),
  groupChats: path.join(root, 'groupChats'),
  extensions: path.join(root, 'extensions'),
};

function responseRecorder() {
  return {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

function requestFor(eventId, eventType) {
  return {
    user: { profile: { handle: 'alice' }, directories },
    session: {
      handle: 'alice',
      logicEngineSessionId: SESSION,
      logicEngineSessionHandle: 'alice',
    },
    body: {
      conversation_id: conversationId,
      event_id: eventId,
      event_type: eventType,
      mutation_id: MUTATION,
      operation: 'rename-chat',
      mutation_digest: 'c'.repeat(64),
      occurred_at: occurredAt,
    },
  };
}

test('production lifecycle proxy accepts receipt-backed rename-chat and signs its terminal event for Core', async t => {
  const previousDataRoot = globalThis.DATA_ROOT;
  globalThis.DATA_ROOT = path.join(tmpdir(), 'logic-engine-st-data-root');
  t.after(() => {
    if (previousDataRoot === undefined) delete globalThis.DATA_ROOT;
    else globalThis.DATA_ROOT = previousDataRoot;
  });

  const observed = [];
  const receiptStore = {
    directory: path.join(tmpdir(), 'logic-engine-host-receipts'),
    async assertOutsideRoot() { return true; },
    async prepare(scope) {
      observed.push({ phase: 'prepare', scope });
      return { prepared: { occurred_at: scope.occurred_at } };
    },
    async commit(scope) {
      observed.push({ phase: 'commit', scope });
      return { receipt_digest: 'd'.repeat(64), occurred_at: scope.occurred_at };
    },
    async abort(scope) {
      observed.push({ phase: 'abort', scope });
      return { receipt_digest: 'e'.repeat(64), occurred_at: scope.occurred_at };
    },
    async recover() { return { status: 'RECOVERY_REQUIRED' }; },
  };
  const identityStore = {
    async assertOutsideRoot() { return true; },
    async resolveAuthenticatedAccount(handle) {
      assert.equal(handle, 'alice');
      return { host_installation_id: INSTALLATION, authenticated_account_id: ACCOUNT };
    },
  };
  const upstreamEvents = [];
  const proxy = createHostLifecycleJournalProxy({
    env: ENV,
    identityStore,
    receiptStore,
    fetchImpl: async (_url, options) => {
      upstreamEvents.push(JSON.parse(options.body));
      return { status: 201, json: async () => ({ lifecycle: { status: 'appended' } }) };
    },
  });

  const preparedResponse = responseRecorder();
  await proxy.append(requestFor(PREPARED_EVENT, 'MUTATION_PREPARED'), preparedResponse);
  assert.equal(preparedResponse.statusCode, 201);
  assert.equal(observed[0].scope.operation, 'rename-chat');
  assert.equal(upstreamEvents[0].operation, 'rename-chat');
  assert.equal(upstreamEvents[0].receipt_digest, undefined);

  const committedResponse = responseRecorder();
  await proxy.append(requestFor(TERMINAL_EVENT, 'MUTATION_COMMITTED'), committedResponse);
  assert.equal(committedResponse.statusCode, 201);
  assert.equal(observed[1].phase, 'commit');
  assert.equal(upstreamEvents[1].operation, 'rename-chat');
  assert.equal(upstreamEvents[1].receipt_digest, 'd'.repeat(64));
  assert.equal(verifyHostMutationReceiptSignature({
    adapterId: ENV.LOGIC_ENGINE_ADAPTER_ID,
    adapterToken: ENV.LOGIC_ENGINE_ADAPTER_TOKEN,
    event: upstreamEvents[1],
  }), true);
});

test('production lifecycle proxy rejects unreceipted mutation operations', async t => {
  const previousDataRoot = globalThis.DATA_ROOT;
  globalThis.DATA_ROOT = path.join(tmpdir(), 'logic-engine-st-data-root');
  t.after(() => {
    if (previousDataRoot === undefined) delete globalThis.DATA_ROOT;
    else globalThis.DATA_ROOT = previousDataRoot;
  });
  let receiptCalls = 0;
  const proxy = createHostLifecycleJournalProxy({
    env: ENV,
    identityStore: {
      async assertOutsideRoot() {},
      async resolveAuthenticatedAccount() {
        return { host_installation_id: INSTALLATION, authenticated_account_id: ACCOUNT };
      },
    },
    receiptStore: {
      directory: path.join(tmpdir(), 'logic-engine-host-receipts'),
      async assertOutsideRoot() {},
      async prepare() { receiptCalls++; },
      async commit() { receiptCalls++; },
      async abort() { receiptCalls++; },
      async recover() { return { status: 'RECOVERY_REQUIRED' }; },
    },
    fetchImpl: async () => { throw new Error('unregistered operation must not reach Core'); },
  });
  const response = responseRecorder();
  const request = requestFor(PREPARED_EVENT, 'MUTATION_PREPARED');
  request.body.operation = 'create-branch';
  await proxy.append(request, response);
  assert.equal(response.statusCode, 400);
  assert.equal(response.payload.error.code, 'INVALID_HOST_LIFECYCLE_EVENT');
  assert.equal(receiptCalls, 0);
});
