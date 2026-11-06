import test from 'node:test';
import assert from 'node:assert/strict';
import { init } from '../server-plugin/index.mjs';

test('SillyTavern Gateway registers the complete Host inventory and lifecycle route surface', async () => {
  const registered = new Map();
  const router = {
    get(path, handler) {
      assert.equal(typeof handler, 'function', 'GET ' + path + ' must have a handler');
      registered.set('GET ' + path, handler);
    },
    post(path, handler) {
      assert.equal(typeof handler, 'function', 'POST ' + path + ' must have a handler');
      registered.set('POST ' + path, handler);
    },
  };

  await init(router);

  for (const route of [
    'GET /session',
    'GET /identity',
    'GET /inventory',
    'POST /host-lifecycle/events',
    'GET /host-lifecycle/status',
    'POST /host-version-ledger/capture',
    'POST /host-version-ledger/reconcile',
  ]) {
    assert.equal(typeof registered.get(route), 'function', 'missing Gateway route: ' + route);
  }
  assert.equal(registered.size, 7, 'the public Gateway surface must remain explicit and bounded');
});
