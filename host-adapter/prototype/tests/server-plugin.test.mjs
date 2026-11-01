import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { info, init } from '../server-plugin/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const prototypeRoot = path.resolve(here, '..');

test('SillyTavern server plugin registers only private session and inventory routes', async () => {
  const routes = [];
  await init({
    get(route, handler) {
      routes.push({ route, handler });
    },
  });
  assert.deepEqual(routes.map(route => route.route), [
    '/host-version-ledger/capture',
    '/host-version-ledger/reconcile',
    '/session',
    '/inventory',
  ]);
  for (const route of routes) assert.equal(typeof route.handler, 'function');
  assert.deepEqual(info, {
    id: 'logic-engine-host',
    name: 'Logic Engine Host Adapter',
    description: 'Authenticated, fail-closed SillyTavern source inventory bridge',
  });
});

test('bundled server-plugin helpers stay byte-identical to the reviewed prototype sources', async () => {
  for (const filename of [
    'st-source-inventory.mjs',
    'st-host-inventory-handler.mjs',
    'st-server-digest-proxy.mjs',
  ]) {
    const canonical = await readFile(path.join(prototypeRoot, filename), 'utf8');
    const bundled = await readFile(path.join(prototypeRoot, 'server-plugin', filename), 'utf8');
    assert.equal(bundled, canonical, filename + ' drifted from the reviewed prototype');
  }
});

test('server plugin session route supports ST default-user mode without session.handle', async () => {
  const routes = [];
  await init({ get(route, handler) { routes.push({ route, handler }); } });
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
  const authIndex = serverMain.indexOf('app.use(requireLoginMiddleware)');
  const pluginLoadIndex = serverMain.indexOf('loadPlugins(app, pluginsDirectory)');
  assert.notEqual(authIndex, -1, 'pinned ST auth middleware is present');
  assert.notEqual(pluginLoadIndex, -1, 'pinned ST server plugin loader is present');
  assert.ok(authIndex < pluginLoadIndex, 'server plugins must be mounted after requireLoginMiddleware');
});
