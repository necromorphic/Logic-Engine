import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { info, init } from '../server-plugin/index.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const prototypeRoot = path.resolve(here, '..');

test('SillyTavern server plugin mounts every Host API only under the Extension Gateway', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'logic-engine-host-plugin-'));
  const keys = [
    'LOGIC_ENGINE_CORE_URL', 'LOGIC_ENGINE_API_TOKEN', 'LOGIC_ENGINE_ADAPTER_ID',
    'LOGIC_ENGINE_ADAPTER_TOKEN', 'LOGIC_ENGINE_HOST_ACTOR_ENTITY_ID',
    'LOGIC_ENGINE_HOST_IDENTITY_DIR',
  ];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    LOGIC_ENGINE_CORE_URL: 'http://127.0.0.1:8787',
    LOGIC_ENGINE_API_TOKEN: 'core-api-token-long-enough',
    LOGIC_ENGINE_ADAPTER_ID: 'st-adapter',
    LOGIC_ENGINE_ADAPTER_TOKEN: 'adapter-token-long-enough',
    LOGIC_ENGINE_HOST_ACTOR_ENTITY_ID: 'actor-kiryu',
    LOGIC_ENGINE_HOST_IDENTITY_DIR: directory,
  });
  t.after(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    rmSync(directory, { recursive: true, force: true });
  });
  const routes = [];
  await init({
    get(route, handler) { routes.push({ method: 'GET', route, handler }); },
    post(route, ...handlers) { routes.push({ method: 'POST', route, handler: handlers.at(-1) }); },
  });
  assert.deepEqual(routes.map(({ method, route }) => method + ' ' + route), [
    'GET /health',
    'GET /session',
    'GET /identity',
    'GET /inventory',
    'POST /host-version-ledger/capture',
    'POST /host-version-ledger/reconcile',
    'POST /host-lifecycle/events',
    'GET /host-lifecycle/status',
    'POST /context',
  ]);
  for (const route of routes) assert.equal(typeof route.handler, 'function');
  assert.deepEqual(info, {
    id: 'logic-engine-extension-gateway',
    name: 'Logic Engine Host Adapter',
    description: 'Authenticated SillyTavern Extension Gateway for Logic Engine',
  });
});

test('bundled server-plugin helpers stay byte-identical to the reviewed prototype sources', async () => {
  for (const filename of [
    'st-source-inventory.mjs',
    'st-host-inventory-handler.mjs',
    'st-server-digest-proxy.mjs',
    'windows-vss-snapshot.mjs',
    'host-data-inventory.mjs',
    'fs-inventory.js',
    'st-host-lifecycle-receipt-store.mjs',
  ]) {
    const canonical = await readFile(path.join(prototypeRoot, filename), 'utf8');
    const bundled = await readFile(path.join(prototypeRoot, 'server-plugin', filename), 'utf8');
    assert.equal(bundled, canonical, filename + ' drifted from the reviewed prototype');
  }
});

test('server plugin session route supports ST default-user mode without session.handle', async () => {
  const routes = [];
  await init({
    get(route, handler) { routes.push({ method: 'GET', route, handler }); },
    post(route, handler) { routes.push({ method: 'POST', route, handler }); },
  });
  const sessionRoute = routes.find(route => route.route === '/session');
  const response = {
    statusCode: null,
    body: null,
    headers: {},
    set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    sendStatus(code) { this.statusCode = code; return this; },
  };
  const session = {};
  sessionRoute.handler({
    session,
    user: { profile: { handle: 'default-user' } },
  }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.host_session_identity, 'SIGNED_AUTHENTICATED_ST_SESSION');
  assert.equal(session.handle, undefined);
  assert.equal(session.logicEngineSessionHandle, 'default-user');
  assert.match(session.logicEngineSessionId, /^[0-9a-f-]{36}$/i);
});

test('pinned SillyTavern mounts server plugins after its authenticated user middleware', async t => {
  const hostRoot = process.env.SILLYTAVERN_DIR;
  if (!hostRoot) {
    t.skip('SILLYTAVERN_DIR is set by the pinned-source CI job');
    return;
  }
  const serverMain = await readFile(path.join(hostRoot, 'src', 'server-main.js'), 'utf8');
  const pluginLoader = await readFile(path.join(hostRoot, 'src', 'plugin-loader.js'), 'utf8');
  const authIndex = serverMain.indexOf('app.use(requireLoginMiddleware)');
  const pluginLoadIndex = serverMain.indexOf('loadPlugins(app, pluginsDirectory)');
  assert.notEqual(authIndex, -1, 'pinned ST auth middleware is present');
  assert.notEqual(pluginLoadIndex, -1, 'pinned ST server plugin loader is present');
  assert.ok(authIndex < pluginLoadIndex, 'server plugins must be mounted after requireLoginMiddleware');
  assert.match(pluginLoader, /app\.use\(`\/api\/plugins\/\$\{id\}`, router\)/,
    'pinned ST plugin loader must mount the router at /api/plugins/{id}');
  assert.match(pluginLoader, /const enableServerPlugins = !!getConfigValue\('enableServerPlugins', false, 'boolean'\)/,
    'server plugin installation must remain opt-in');
});
