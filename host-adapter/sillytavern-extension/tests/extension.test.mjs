import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  CONNECTION_STATES,
  GatewayCheckError,
  describeGatewayFailure,
  describeGatewayResult,
  fetchGatewaySession,
} from '../bridge-core.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const session = {
  host_session_id: '2e6b0a80-4e73-4c66-aaf3-7a6e62c7f401',
  host_session_identity: 'SIGNED_AUTHENTICATED_ST_SESSION',
  host_user_handle: 'default-user',
};

test('Gateway client uses only the same-origin ST plugin route with cookie session', async () => {
  let called;
  const result = await fetchGatewaySession(async (url, options) => {
    called = { url, options };
    return { ok: true, status: 200, json: async () => session };
  });
  assert.deepEqual(result, session);
  assert.equal(called.url, '/api/plugins/logic-engine-extension-gateway/session');
  assert.equal(called.options.method, 'GET');
  assert.equal(called.options.credentials, 'same-origin');
  assert.equal(called.options.cache, 'no-store');
  assert.equal(called.options.redirect, 'error');
  assert.deepEqual(called.options.headers, { accept: 'application/json' });
});

test('Gateway client rejects unauthenticated ST sessions and HTTP errors', async () => {
  await assert.rejects(
    fetchGatewaySession(async () => ({ ok: false, status: 403 })),
    error => error.kind === 'error' && /аутентифицированной сессии/.test(error.message),
  );
  await assert.rejects(
    fetchGatewaySession(async () => ({ ok: false, status: 503 })),
    error => error.kind === 'error' && /HTTP 503/.test(error.message),
  );
});

test('Gateway client validates the server-generated signed session envelope', async () => {
  for (const body of [
    {},
    { ...session, host_session_id: 'attacker-selected' },
    { ...session, host_session_identity: 'CLIENT_ASSERTION' },
    { ...session, host_user_handle: '' },
  ]) {
    await assert.rejects(
      fetchGatewaySession(async () => ({ ok: true, status: 200, json: async () => body })),
      error => error.kind === 'error',
    );
  }
});

test('Gateway connection and timeout failures are distinguished', async () => {
  await assert.rejects(
    fetchGatewaySession(async () => { throw new TypeError('Failed to fetch'); }),
    error => error.kind === 'unavailable' && /недоступен/.test(error.message),
  );
  await assert.rejects(
    fetchGatewaySession(async () => { throw new DOMException('timeout', 'TimeoutError'); }),
    error => error.kind === 'unavailable' && /2,5/.test(error.message),
  );
});

test('Gateway request can be cancelled when the extension disables', async () => {
  const controller = new AbortController();
  let receivedSignal;
  const request = fetchGatewaySession(async (_url, options) => {
    receivedSignal = options.signal;
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  }, controller.signal);
  controller.abort();
  assert.ok(receivedSignal?.aborted);
  await assert.rejects(request, /aborted/);
});

test('status mapping never claims Core or Memory readiness', () => {
  const connected = describeGatewayResult(session);
  assert.equal(connected.state, CONNECTION_STATES.connected);
  assert.match(connected.text, /NON_READY/);
  const unavailable = describeGatewayFailure(new GatewayCheckError('unavailable', 'Extension Gateway недоступен'));
  assert.equal(unavailable.state, CONNECTION_STATES.unavailable);
  const failure = describeGatewayFailure(new GatewayCheckError('error', 'session denied'));
  assert.equal(failure.state, CONNECTION_STATES.error);
});

test('extension manifest and UI use the supported ST extension lifecycle', async () => {
  const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
  const js = await readFile(resolve(root, 'index.js'), 'utf8');
  const html = await readFile(resolve(root, 'settings.html'), 'utf8');
  assert.equal(manifest.js, 'index.js');
  assert.equal(manifest.hooks.activate, 'init');
  assert.equal(manifest.hooks.disable, 'cleanup');
  assert.match(js, /renderExtensionTemplateAsync/);
  assert.match(js, /fetchGatewaySession/);
  assert.match(js, /new AbortController\(\)/);
  assert.match(js, /export function cleanup\(\)/);
  assert.match(html, /logic_engine_check/);
  assert.match(html, /api\/plugins\/logic-engine-extension-gateway/);
  assert.doesNotMatch(js, /LOGIC_ENGINE_CORE_URL|host-version-ledger|logicEngineHostLifecycle/);
  assert.doesNotMatch(html, /127\.0\.0\.1:8787|Core credentials/);
});
