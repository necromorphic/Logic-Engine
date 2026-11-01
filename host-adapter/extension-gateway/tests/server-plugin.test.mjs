import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
  assert.equal(response.payload.code, 'HOST_IDENTITY_STORE_UNCONFIGURED');
});

test('Gateway source contains no direct SillyTavern endpoint mounting or Core URL supplied by the browser', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../server-plugin/index.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\/api\/logic-engine/);
  assert.doesNotMatch(source, /request\.body\.(?:core_url|upstream_url|api_token|adapter_token)/);
  assert.match(source, /id: 'logic-engine-extension-gateway'/);
});

test('deployed server-plugin helper bundle is byte-identical to reviewed prototype sources', async () => {
  const names = [
    'st-host-identity-store.mjs',
    'st-host-inventory-handler.mjs',
    'st-host-lifecycle-receipt-store.mjs',
    'st-server-digest-proxy.mjs',
    'st-source-inventory.mjs',
    'host-data-inventory.mjs',
    'fs-inventory.js',
    'windows-vss-snapshot.mjs',
    'filesystem-reconciliation.mjs',
  ];
  for (const name of names) {
    const bundled = await readFile(new URL('../server-plugin/' + name, import.meta.url), 'utf8');
    const prototype = await readFile(new URL('../../prototype/' + name, import.meta.url), 'utf8');
    assert.equal(bundled, prototype, 'server-plugin bundle drifted from prototype source: ' + name);
  }
});

test('Extension Gateway is a routing-only boundary; Host authentication and Core assertion stay in Host Adapter', async () => {
  const gateway = await readFile(new URL('../server-plugin/index.mjs', import.meta.url), 'utf8');
  const adapter = await readFile(new URL('../server-plugin/host-adapter.mjs', import.meta.url), 'utf8');

  assert.match(gateway, /createSillyTavernHostAdapter/);
  assert.doesNotMatch(gateway, /createHostRequestAuthenticationGate|createHostMemoryDispatchProxyHandler/);
  assert.doesNotMatch(gateway, /request\\.(?:user|session|body)|resolveConversationId|createHmac/);
  assert.match(gateway, /router\\.post\\('\\/dispatch', hostAdapter\\.dispatchMiddleware, hostAdapter\\.dispatch\\)/);

  assert.match(adapter, /createHostRequestAuthenticationGate/);
  assert.match(adapter, /createHostMemoryDispatchProxyHandler/);
  assert.match(adapter, /resolveConversationId/);
  assert.doesNotMatch(adapter, /router\\.(?:get|post)\\(/);
});

