import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostDigestProxyHandler } from '../st-server-digest-proxy.mjs';

const CONFIG = {
  LOGIC_ENGINE_CORE_URL: 'https://logic-engine-pc.example:8787',
  LOGIC_ENGINE_API_TOKEN: 'core-api-token-long-enough',
  LOGIC_ENGINE_ADAPTER_ID: 'sillytavern-phone',
  LOGIC_ENGINE_ADAPTER_TOKEN: 'adapter-token-long-enough',
};
const capture = {
  conversation_id: 'chat-1',
  message_id: 'message-1',
  version_id: 'version-1',
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
  await handler({ body: capture }, response);
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
  await handler({ body: capture }, response);
  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.payload, { ok: true, inventory_status: 'NON_READY' });
  assert.equal(observed.url, 'https://logic-engine-pc.example:8787/v1/host-version-ledger/capture');
  assert.equal(observed.options.method, 'POST');
  assert.equal(observed.options.redirect, 'error');
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
    { ...capture, content: 'raw prompt content' },
    { ...capture, content_sha256: 'not-a-digest' },
    { ...capture, active: true, deleted: true },
  ]) {
    const response = responseRecorder();
    await handler({ body }, response);
    assert.equal(response.statusCode, 400);
    assert.equal(response.payload.error.code, 'INVALID_HOST_VERSION_CAPTURE');
  }
  assert.equal(calls, 0);
});

test('plaintext HTTP is permitted only for a loopback Core endpoint', async () => {
  let calls = 0;
  const local = responseRecorder();
  await createHostDigestProxyHandler({
    env: { ...CONFIG, LOGIC_ENGINE_CORE_URL: 'http://127.0.0.1:8787' },
    fetchImpl: async (url) => {
      calls++;
      assert.equal(String(url), 'http://127.0.0.1:8787/v1/host-version-ledger/capture');
      return { status: 200, ok: true };
    },
  })({ body: capture }, local);
  assert.equal(local.statusCode, 200);
  assert.equal(calls, 1);

  let remoteCalls = 0;
  const remote = responseRecorder();
  await createHostDigestProxyHandler({
    env: { ...CONFIG, LOGIC_ENGINE_CORE_URL: 'http://192.168.1.10:8787' },
    fetchImpl: async () => { remoteCalls++; throw Error('must not send credentials over HTTP'); },
  })({ body: capture }, remote);
  assert.equal(remote.statusCode, 503);
  assert.equal(remote.payload.error.code, 'LOGIC_ENGINE_PROXY_UNCONFIGURED');
  assert.equal(remoteCalls, 0);
});

test('proxy rejects upstream URL credentials and paths from configuration', async () => {
  for (const value of [
    'http://192.168.1.10:8787',
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


test('proxy hides upstream error bodies and rejects redirects without following them', async () => {
  const rejected = responseRecorder();
  await createHostDigestProxyHandler({
    env: CONFIG,
    fetchImpl: async (_url, options) => {
      assert.equal(options.redirect, 'error');
      return { ok: false, status: 403, json: async () => ({ message: 'private upstream diagnostics' }) };
    },
  })({ body: capture }, rejected);
  assert.equal(rejected.statusCode, 403);
  assert.deepEqual(rejected.payload, {
    error: { code: 'LOGIC_ENGINE_CAPTURE_REJECTED', message: 'Logic-Engine did not accept the digest capture.' },
  });
  assert.equal(JSON.stringify(rejected.payload).includes('private upstream diagnostics'), false);

  const redirectFailure = responseRecorder();
  await createHostDigestProxyHandler({
    env: CONFIG,
    fetchImpl: async (_url, options) => {
      assert.equal(options.redirect, 'error');
      throw Error('redirect target and private URL');
    },
  })({ body: capture }, redirectFailure);
  assert.equal(redirectFailure.statusCode, 502);
  assert.equal(redirectFailure.payload.error.code, 'LOGIC_ENGINE_UNREACHABLE');
  assert.equal(JSON.stringify(redirectFailure.payload).includes('private URL'), false);
});
