import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostDigestProxyHandler, createHostInventoryReconcileProxyHandler } from '../st-server-digest-proxy.mjs';

const CONFIG = {
  LOGIC_ENGINE_CORE_URL: 'http://192.168.1.10:8787',
  LOGIC_ENGINE_API_TOKEN: 'core-api-token-long-enough',
  LOGIC_ENGINE_ADAPTER_ID: 'sillytavern-phone',
  LOGIC_ENGINE_ADAPTER_TOKEN: 'adapter-token-long-enough',
};
const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const HOST_CONVERSATION_ID = SESSION_ID + ':22222222-2222-4222-8222-222222222222:33333333-3333-4333-8333-333333333333';
const requestFor = (body, { sessionId = SESSION_ID, userHandle = 'alice', sessionHandle = userHandle } = {}) => ({
  body,
  user: { profile: { handle: userHandle } },
  session: { handle: sessionHandle, logicEngineSessionId: sessionId },
});
const capture = {
  conversation_id: HOST_CONVERSATION_ID,
  message_id: 'message-1',
  version_id: 'version-1',
  parent_version_id: null,
  content_sha256: 'a'.repeat(64),
  active: true,
  deleted: false,
};
function responseRecorder() {
  return {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

test('unconfigured proxy fails closed without making an upstream request', async () => {
  let called = false;
  const handler = createHostDigestProxyHandler({ env: {}, fetchImpl: async () => { called = true; } });
  const response = responseRecorder();
  await handler(requestFor(capture), response);
  assert.equal(response.statusCode, 503);
  assert.equal(response.payload.error.code, 'LOGIC_ENGINE_PROXY_UNCONFIGURED');
  assert.equal(called, false);
});

test('proxy forwards only allowlisted digest fields with server-side credentials', async () => {
  let observed;
  const handler = createHostDigestProxyHandler({
    env: CONFIG,
    fetchImpl: async (url, options) => {
      observed = { url: String(url), options };
      return { status: 201, json: async () => ({ capture: { status: 'captured' } }) };
    },
  });
  const response = responseRecorder();
  await handler(requestFor(capture), response);
  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.payload, { capture: { status: 'captured' } });
  assert.equal(observed.url, 'http://192.168.1.10:8787/v1/host-version-ledger/capture');
  assert.equal(observed.options.method, 'POST');
  assert.equal(observed.options.headers.authorization, 'Bearer ' + CONFIG.LOGIC_ENGINE_API_TOKEN);
  assert.equal(observed.options.headers['x-adapter-id'], CONFIG.LOGIC_ENGINE_ADAPTER_ID);
  assert.equal(observed.options.headers['x-adapter-token'], CONFIG.LOGIC_ENGINE_ADAPTER_TOKEN);
  assert.deepEqual(JSON.parse(observed.options.body), capture);
  assert.equal(observed.options.body.includes('raw'), false);
});

test('proxy rejects caller URLs, world IDs, raw text and malformed digests before upstream I/O', async () => {
  let calls = 0;
  const handler = createHostDigestProxyHandler({ env: CONFIG, fetchImpl: async () => { calls++; } });
  for (const body of [
    { ...capture, url: 'http://attacker.invalid' },
    { ...capture, world_id: 'attacker-world' },
    (() => { const { parent_version_id, ...missingParent } = capture; return missingParent; })(),
    { ...capture, parent_version_id: 'bad parent id ' },
    { ...capture, content: 'raw prompt content' },
    { ...capture, content_sha256: 'not-a-digest' },
    { ...capture, active: true, deleted: true },
  ]) {
    const response = responseRecorder();
    await handler(requestFor(body), response);
    assert.equal(response.statusCode, 400);
    assert.equal(response.payload.error.code, 'INVALID_HOST_VERSION_CAPTURE');
  }
  assert.equal(calls, 0);
});

test('capture proxy rejects a different Host session or unauthenticated account before upstream I/O', async () => {
  let calls = 0;
  const handler = createHostDigestProxyHandler({ env: CONFIG, fetchImpl: async () => { calls++; } });
  for (const request of [
    requestFor(capture, { sessionId: '44444444-4444-4444-8444-444444444444' }),
    requestFor(capture, { sessionHandle: 'another-user' }),
  ]) {
    const response = responseRecorder();
    await handler(request, response);
    assert.equal(response.statusCode, 403);
    assert.equal(response.payload.error.code, 'HOST_SESSION_SCOPE_REQUIRED');
  }
  assert.equal(calls, 0);
});

test('proxy rejects upstream URL credentials and paths from configuration', async () => {
  for (const value of [
    'http://user:pass@192.168.1.10:8787',
    'http://192.168.1.10:8787/anything',
    'file:///tmp/core',
  ]) {
    const response = responseRecorder();
    await createHostDigestProxyHandler({
      env: { ...CONFIG, LOGIC_ENGINE_CORE_URL: value },
      fetchImpl: async () => { throw Error('must not call upstream'); },
    })({ body: capture }, response);
    assert.equal(response.statusCode, 503);
  }
});

test('proxy maps upstream transport failures to a generic response without leaking details', async () => {
  const response = responseRecorder();
  await createHostDigestProxyHandler({
    env: CONFIG,
    fetchImpl: async () => { throw Error('private upstream secret and raw body'); },
  })({ body: capture }, response);
  assert.equal(response.statusCode, 502);
  assert.equal(response.payload.error.code, 'LOGIC_ENGINE_UNREACHABLE');
  assert.equal(JSON.stringify(response.payload).includes('private upstream secret'), false);
});


test('reconciliation proxy forwards a bounded digest-only snapshot to the Core reconciliation route', async () => {
  const snapshot = {
    conversation_id: HOST_CONVERSATION_ID,
    complete: false,
    versions: [{
      message_id: 'message-1',
      version_id: 'version-1',
      parent_version_id: null,
      content_sha256: 'b'.repeat(64),
      active: true,
      deleted: false,
    }],
  };
  let observed;
  const handler = createHostInventoryReconcileProxyHandler({
    env: CONFIG,
    fetchImpl: async (url, options) => {
      observed = { url: String(url), options };
      return {
        status: 409,
        json: async () => ({
          inventory_status: 'NON_READY',
          reconciliation: { status: 'non_ready', code: 'HOST_INVENTORY_NOT_AUTHORIZED' },
        }),
      };
    },
  });
  const response = responseRecorder();
  await handler(requestFor(snapshot), response);
  assert.equal(response.statusCode, 409);
  assert.equal(response.payload.inventory_status, 'NON_READY');
  assert.equal(observed.url, 'http://192.168.1.10:8787/v1/host-version-ledger/reconcile');
  assert.equal(observed.options.headers.authorization, 'Bearer ' + CONFIG.LOGIC_ENGINE_API_TOKEN);
  assert.equal(observed.options.headers['x-adapter-id'], CONFIG.LOGIC_ENGINE_ADAPTER_ID);
  assert.deepEqual(JSON.parse(observed.options.body), snapshot);
});

test('reconciliation proxy rejects raw text, caller world scope, oversized row sets and oversized bodies', async () => {
  let calls = 0;
  const handler = createHostInventoryReconcileProxyHandler({
    env: CONFIG,
    fetchImpl: async () => { calls++; throw Error('must not call upstream'); },
  });
  const valid = {
    conversation_id: HOST_CONVERSATION_ID,
    complete: false,
    versions: [{
      message_id: 'message-1',
      version_id: 'version-1',
      parent_version_id: null,
      content_sha256: 'b'.repeat(64),
      active: true,
      deleted: false,
    }],
  };
  const wrongSessionResponse = responseRecorder();
  await handler(requestFor(valid, { sessionId: '44444444-4444-4444-8444-444444444444' }), wrongSessionResponse);
  assert.equal(wrongSessionResponse.statusCode, 403);
  assert.equal(wrongSessionResponse.payload.error.code, 'HOST_SESSION_SCOPE_REQUIRED');
  for (const body of [
    { ...valid, world_id: 'attacker-world' },
    { ...valid, versions: [{ ...valid.versions[0], content: 'raw source text' }] },
  ]) {
    const response = responseRecorder();
    await handler(requestFor(body), response);
    assert.equal(response.statusCode, 400);
    assert.equal(response.payload.error.code, 'INVALID_HOST_INVENTORY_RECONCILIATION');
  }
  const tooMany = { ...valid, versions: Array.from({ length: 25001 }, (_, index) => ({
    ...valid.versions[0], message_id: 'message-' + index, version_id: 'version-' + index,
  })) };
  const countResponse = responseRecorder();
  await handler(requestFor(tooMany), countResponse);
  assert.equal(countResponse.statusCode, 413);
  assert.equal(countResponse.payload.error.code, 'HOST_INVENTORY_TOO_LARGE');

  const byteResponse = responseRecorder();
  await handler(requestFor({ ...valid, padding: 'x'.repeat(8 * 1024 * 1024) }), byteResponse);
  assert.equal(byteResponse.statusCode, 413);
  assert.equal(byteResponse.payload.error.code, 'HOST_INVENTORY_TOO_LARGE');
  assert.equal(calls, 0);
});
