import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { createApiServer } from '../src/api/server.js';

const API = 'least-privilege-api-token-long-123456';
const INTERNAL = 'least-privilege-internal-token-long-123456';
const APPROVAL = 'least-privilege-approval-token-long-123456';
const ADMIN = 'least-privilege-admin-token-long-123456';
const ADAPTER = 'least-privilege-adapter-token-long-123456';
const JSON_HEADERS = { 'content-type': 'application/json' };
const bearer = { ...JSON_HEADERS, authorization: 'Bearer ' + API };
const admin = { ...bearer, 'x-admin-token': ADMIN };
const adapter = { ...bearer, 'x-adapter-id': 'adapter-a', 'x-adapter-token': ADAPTER };
const internal = { ...bearer, 'x-engine-internal-token': INTERNAL };
const approval = { ...bearer, 'x-approval-token': APPROVAL };
const json = (value) => JSON.stringify(value);

async function setup(t, { adminConfigured = true } = {}) {
  const store = new SQLiteStore(':memory:');
  const options = {
    engine: new LogicEngine(store),
    token: API,
    internalToken: INTERNAL,
    approvalToken: APPROVAL,
    adapterTokens: { 'adapter-a': ADAPTER },
  };
  if (adminConfigured) options.adminToken = ADMIN;
  const server = createApiServer(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); store.close(); });
  return 'http://127.0.0.1:' + server.address().port;
}

function worldBody(worldId) {
  return json({
    world_id: worldId,
    world_pack_id: 'least-privilege.test',
    world_pack_version: '1.0.0',
    game_time: '2026-01-01T00:00:00Z',
  });
}

async function createWorld(base, worldId, headers = bearer) {
  return fetch(base + '/v1/worlds', { method: 'POST', headers, body: worldBody(worldId) });
}

test('A: world creation requires bearer plus admin; denied requests do not create a world', async (t) => {
  const base = await setup(t);
  const worldId = 'world-create-admin-gated';

  for (const deniedHeaders of [bearer, adapter, internal, approval]) {
    const denied = await createWorld(base, worldId, deniedHeaders);
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).error.code, 'ADMIN_REQUIRED');
  }

  // The same ID succeeds with the required capability, proving denied attempts
  // above did not create it as a side effect.
  const allowed = await createWorld(base, worldId, admin);
  assert.equal(allowed.status, 201);
  assert.equal((await allowed.json()).world.world_id, worldId);

  const adminWithoutBearer = await createWorld(base, 'admin-without-bearer', {
    ...JSON_HEADERS,
    'x-admin-token': ADMIN,
  });
  assert.equal(adminWithoutBearer.status, 401);
  assert.equal((await adminWithoutBearer.json()).error.code, 'UNAUTHORIZED');
});

test('A: world creation fails closed when admin capability is not configured', async (t) => {
  const base = await setup(t, { adminConfigured: false });
  const denied = await createWorld(base, 'world-no-admin-config', admin);
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error.code, 'ADMIN_REQUIRED');
});

test('A: global registry audit is admin-only and denial does not disclose audit data', async (t) => {
  const base = await setup(t);
  const denied = await fetch(base + '/v1/mechanics/audit', { headers: bearer });
  assert.equal(denied.status, 403);
  const body = await denied.json();
  assert.equal(body.error.code, 'ADMIN_REQUIRED');
  assert.equal(Object.hasOwn(body, 'audit'), false);

  const allowed = await fetch(base + '/v1/mechanics/audit', { headers: admin });
  assert.equal(allowed.status, 200);
  assert.ok(Array.isArray((await allowed.json()).audit));
});

test('A: every global registry metadata route requires admin; credential classes do not substitute', async (t) => {
  const base = await setup(t);
  const routes = [
    '/v1/mechanic-templates',
    '/v1/mechanic-templates/not-present/1.0.0',
    '/v1/rule-modules',
    '/v1/rule-modules/not-present/1.0.0',
  ];

  for (const route of routes) {
    for (const deniedHeaders of [bearer, adapter, internal, approval]) {
      const denied = await fetch(base + route, { headers: deniedHeaders });
      assert.equal(denied.status, 403, route);
      assert.equal((await denied.json()).error.code, 'ADMIN_REQUIRED', route);
    }
  }

  // Root inventory is readable to admin. Versioned lookup reaches the normal
  // not-found result (404), proving authorization passed without exposing it
  // to bearer-only callers.
  assert.equal((await fetch(base + routes[0], { headers: admin })).status, 200);
  assert.equal((await fetch(base + routes[2], { headers: admin })).status, 200);
  const templateMissing = await fetch(base + routes[1], { headers: admin });
  assert.equal(templateMissing.status, 404);
  assert.equal((await templateMissing.json()).error.code, 'MECHANIC_TEMPLATE_NOT_FOUND');
  const moduleMissing = await fetch(base + routes[3], { headers: admin });
  assert.equal(moduleMissing.status, 404);
  assert.equal((await moduleMissing.json()).error.code, 'RULE_MODULE_NOT_FOUND');
});

test('A: admin capability alone cannot bypass the mandatory outer bearer gate', async (t) => {
  const base = await setup(t);
  for (const route of [
    '/v1/mechanics/audit',
    '/v1/mechanic-templates',
    '/v1/mechanic-templates/not-present/1.0.0',
    '/v1/rule-modules',
    '/v1/rule-modules/not-present/1.0.0',
  ]) {
    const denied = await fetch(base + route, { headers: { ...JSON_HEADERS, 'x-admin-token': ADMIN } });
    assert.equal(denied.status, 401, route);
    assert.equal((await denied.json()).error.code, 'UNAUTHORIZED', route);
  }
});
