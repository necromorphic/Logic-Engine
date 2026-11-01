import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { info, init } from '../server-plugin/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, '..', 'server-plugin');

test('Extension Gateway server plugin registers one namespaced ingress and no direct Core proxy routes', async () => {
  const routes = [];
  const middleware = [];
  await init({
    use(handler) { middleware.push(handler); },
    get(route, handler) { routes.push({ method: 'GET', route, handler }); },
    post(route, handler) { routes.push({ method: 'POST', route, handler }); },
  });
  assert.deepEqual(routes.map(({ method, route }) => method + ' ' + route), [
    'GET /session',
    'GET /identity',
    'GET /inventory',
    'POST /context',
  ]);
  assert.equal(middleware.length, 1);
  assert.ok(routes.every(route => typeof route.handler === 'function'));
  assert.deepEqual(info, {
    id: 'logic-engine-extension-gateway',
    name: 'Logic-Engine Extension Gateway',
    description: 'Authenticated SillyTavern ingress for the Logic-Engine Host adapter',
  });
});

test('Gateway context route fails closed until authenticated Core assertion transport exists', async () => {
  const routes = [];
  await init({
    use() {},
    get(route, handler) { routes.push({ method: 'GET', route, handler }); },
    post(route, handler) { routes.push({ method: 'POST', route, handler }); },
  });
  const route = routes.find(item => item.route === '/context');
  const response = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  route.handler({}, response);
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, {
    status: 'NON_READY',
    code: 'HOST_IDENTITY_STORE_NOT_CONFIGURED',
  });
});

test('bundled plugin dependencies resolve locally and do not escape the plugin package', async () => {
  for (const filename of [
    'host-data-inventory.mjs',
    'st-source-inventory.mjs',
    'fs-inventory.js',
    'windows-vss-snapshot.mjs',
    'st-host-inventory-handler.mjs',
    'st-host-identity-store.mjs',
    'host-context-transport.mjs',
  ]) {
    const bundled = await readFile(path.join(pluginRoot, filename), 'utf8');
    const canonical = await readFile(path.join(here, '..', filename), 'utf8');
    assert.equal(bundled, canonical, filename + ' drifted from the reviewed prototype');
  }
  const packageContent = await readFile(path.join(pluginRoot, 'package.json'), 'utf8');
  assert.ok(packageContent.length > 0);
  const packageJson = JSON.parse(await readFile(path.join(pluginRoot, 'package.json'), 'utf8'));
  assert.equal(packageJson.type, 'module');
  assert.equal(packageJson.main, 'index.mjs');
});

test('pinned SillyTavern loads plugins after authenticated middleware and mounts the Gateway namespace', async t => {
  const hostRoot = process.env.SILLYTAVERN_DIR;
  if (!hostRoot) {
    t.skip('SILLYTAVERN_DIR is set by the pinned-source CI job');
    return;
  }
  const serverMain = await readFile(path.join(hostRoot, 'src', 'server-main.js'), 'utf8');
  const pluginLoader = await readFile(path.join(hostRoot, 'src', 'plugin-loader.js'), 'utf8');
  const authIndex = serverMain.indexOf('app.use(requireLoginMiddleware)');
  const pluginLoadIndex = serverMain.indexOf('loadPlugins(app, pluginsDirectory)');
  assert.notEqual(authIndex, -1);
  assert.notEqual(pluginLoadIndex, -1);
  assert.ok(authIndex < pluginLoadIndex);
  assert.ok(pluginLoader.includes("app.use(`/api/plugins/${id}`, router)"));
});
