import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogicEngineHealthHandler } from '../diagnostic-health-proxy.mjs';

function responseRecorder() {
  return { statusCode: null, payload: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
}

test('health probe fails closed when no server-side target is configured', async () => {
  let called = false;
  const response = responseRecorder();
  await createLogicEngineHealthHandler({ env: {}, fetchImpl: async () => { called = true; } })({}, response);
  assert.equal(response.statusCode, 503);
  assert.equal(response.payload.error.code, 'LOGIC_ENGINE_PROXY_UNCONFIGURED');
  assert.equal(called, false);
});

test('health probe contacts only configured root health endpoint and returns minimal status', async () => {
  let observed;
  const response = responseRecorder();
  await createLogicEngineHealthHandler({
    env: { LOGIC_ENGINE_CORE_URL: 'http://127.0.0.1:8787/' },
    fetchImpl: async (url, options) => {
      observed = { url: String(url), options };
      return { ok: true, status: 200, json: async () => ({ ok: true, service: 'logic-engine', protocol_version: 'v1' }) };
    },
  })({}, response);
  assert.equal(response.statusCode, 200);
  assert.equal(observed.url, 'http://127.0.0.1:8787/health');
  assert.equal(observed.options.method, 'GET');
  assert.deepEqual(observed.options.headers, { accept: 'application/json' });
  assert.equal('authorization' in observed.options.headers, false);
  assert.deepEqual(response.payload, { status: 'reachable', service: 'logic-engine', protocol_version: 'v1', adapter_authorized: 'not_checked', protected_memory_route: 'not_exposed' });
  assert.equal(JSON.stringify(response.payload).includes('127.0.0.1'), false);
});

test('health probe rejects configured URL credentials, paths, query strings and non-HTTP protocols', async () => {
  for (const value of ['http://user:pass@127.0.0.1:8787', 'http://127.0.0.1:8787/unexpected', 'http://127.0.0.1:8787?token=secret', 'file:///tmp/engine']) {
    let called = false;
    const response = responseRecorder();
    await createLogicEngineHealthHandler({ env: { LOGIC_ENGINE_CORE_URL: value }, fetchImpl: async () => { called = true; } })({}, response);
    assert.equal(response.statusCode, 503);
    assert.equal(response.payload.error.code, 'LOGIC_ENGINE_PROXY_UNCONFIGURED');
    assert.equal(called, false);
  }
});

test('health probe does not treat non-OK or unrecognized upstream responses as healthy', async () => {
  for (const upstream of [
    { ok: false, status: 500, json: async () => ({ ok: true, service: 'logic-engine' }) },
    { ok: true, status: 200, json: async () => ({ ok: true, service: 'other-service' }) },
    { ok: true, status: 200, json: async () => { throw Error('bad json'); } },
  ]) {
    const response = responseRecorder();
    await createLogicEngineHealthHandler({ env: { LOGIC_ENGINE_CORE_URL: 'http://127.0.0.1:8787' }, fetchImpl: async () => upstream })({}, response);
    assert.equal(response.statusCode, 502);
    assert.equal(response.payload.error.code, 'LOGIC_ENGINE_UNHEALTHY');
  }
});

test('health probe hides transport errors and does not leak target details', async () => {
  const response = responseRecorder();
  await createLogicEngineHealthHandler({
    env: { LOGIC_ENGINE_CORE_URL: 'http://127.0.0.1:8787' },
    fetchImpl: async () => { throw Error('private target and credential details'); },
  })({}, response);
  assert.equal(response.statusCode, 503);
  assert.equal(response.payload.error.code, 'LOGIC_ENGINE_UNREACHABLE');
  assert.equal(JSON.stringify(response.payload).includes('private target'), false);
});
