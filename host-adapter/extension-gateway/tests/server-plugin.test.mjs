import test from 'node:test';
import assert from 'node:assert/strict';
import { info, init } from '../server-plugin/index.mjs';

function responseRecorder() {
  return {
    statusCode: null,
    payload: null,
    headers: {},
    set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

test('Extension Gateway owns every public Host route under one server-plugin namespace', async () => {
  const routes = [];
  await init({
    get(route, handler) { routes.push({ method: 'GET', route, handler }); },
    post(route, handler) { routes.push({ method: 'POST', route, handler }); },
  });
  assert.deepEqual(routes.map(({ method, route }) => method + ' ' + route), [
    'GET /session',
    'GET /identity',
    'GET /inventory',
    'POST /host-lifecycle/events',
    'GET /host-lifecycle/status',
    'POST /dispatch',
    'POST /host-version-ledger/capture',
    'POST /host-version-ledger/reconcile',
  ]);
  assert.equal(info.id, 'logic-engine-extension-gateway');
  assert.ok(routes.every(route => typeof route.handler === 'function'));
});

test('Core dispatch endpoint fails closed until the authenticated Core contract is installed', async () => {
  const routes = [];
  await init({
    get(route, handler) { routes.push({ method: 'GET', route, handler }); },
    post(route, handler) { routes.push({ method: 'POST', route, handler }); },
  });
  const dispatch = routes.find(route => route.route === '/dispatch').handler;
  const response = responseRecorder();
  dispatch({ body: { conversation_id: 'attacker-selected' } }, response);
  assert.equal(response.statusCode, 503);
  assert.equal(response.payload.code, 'CORE_HOST_DISPATCH_NOT_CONFIGURED');
});

test('Gateway source contains no direct SillyTavern endpoint mounting or Core URL supplied by the browser', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../server-plugin/index.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\/api\/logic-engine/);
  assert.doesNotMatch(source, /request\.body\.(?:core_url|upstream_url|api_token|adapter_token)/);
  assert.match(source, /id: 'logic-engine-extension-gateway'/);
});
