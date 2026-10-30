import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { ActorBindingService } from '../src/application/actor-bindings.js';
import { createApiServer } from '../src/api/server.js';

const TOKEN = 'test-token-long-enough-123456';
const ADMIN = 'admin-token-long-enough-123456';
const ADAPTER_A = 'adapter-a-token-long-enough-123456';
const ADAPTER_B = 'adapter-b-token-long-enough-123456';
const headers = { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' };
const json = (body) => JSON.stringify(body);

async function setup(t) {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  const server = createApiServer({
    engine, token: TOKEN, adminToken: ADMIN,
    adapterTokens: { 'adapter-a': ADAPTER_A, 'adapter-b': ADAPTER_B },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); store.close(); });
  engine.createWorld({ world_id: 'actor-world', world_pack_id: 'test.world', world_pack_version: '1', game_time: '2026-01-01T00:00:00Z' });
  engine.commitEvent('actor-world', {
    idempotency_key: 'seed-actor', turn_id: 'seed', event_type: 'action.completed', expected_revision: 0,
    effects: [
      { kind: 'entity.create', entity_id: 'npc-a', entity_type: 'character', attributes: { name: 'A' } },
      { kind: 'entity.create', entity_id: 'npc-dead', entity_type: 'character', attributes: { name: 'Dead' } },
    ],
  });
  engine.commitEvent('actor-world', {
    idempotency_key: 'destroy-actor', turn_id: 'destroy', event_type: 'action.completed', expected_revision: 1,
    effects: [{ kind: 'entity.upsert', entity_id: 'npc-dead', entity_type: 'character', status: 'destroyed', attributes: { name: 'Dead' } }],
  });
  return 'http://127.0.0.1:' + server.address().port;
}

test('actor bindings require admin setup and resolve only for the authenticated adapter', async (t) => {
  const base = await setup(t);
  const path = base + '/v1/worlds/actor-world/actor-bindings';
  const bindingBody = { adapter_id: 'adapter-a', entity_id: 'npc-a' };

  const deniedAdmin = await fetch(path, { method: 'POST', headers, body: json(bindingBody) });
  assert.equal(deniedAdmin.status, 403);
  assert.equal((await deniedAdmin.json()).error.code, 'ADMIN_REQUIRED');

  const created = await fetch(path, {
    method: 'POST', headers: { ...headers, 'x-admin-token': ADMIN }, body: json(bindingBody),
  });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).binding.active, true);

  const resolvePath = path + '/resolve';
  const resolved = await fetch(resolvePath, {
    method: 'POST',
    headers: { ...headers, 'x-adapter-id': 'adapter-a', 'x-adapter-token': ADAPTER_A },
    body: json({ entity_id: 'npc-a' }),
  });
  assert.equal(resolved.status, 200);
  const initialResolution = (await resolved.json()).resolution;
  assert.equal(initialResolution.actor.entity_id, 'npc-a');
  assert.equal(initialResolution.binding_generation, 1);

  const wrongAdapter = await fetch(resolvePath, {
    method: 'POST',
    headers: { ...headers, 'x-adapter-id': 'adapter-b', 'x-adapter-token': ADAPTER_B },
    body: json({ entity_id: 'npc-a' }),
  });
  assert.equal(wrongAdapter.status, 403);
  assert.equal((await wrongAdapter.json()).error.code, 'ACTOR_NOT_AUTHORIZED');

  const unknownActor = await fetch(resolvePath, {
    method: 'POST',
    headers: { ...headers, 'x-adapter-id': 'adapter-a', 'x-adapter-token': ADAPTER_A },
    body: json({ entity_id: 'npc-not-bound' }),
  });
  assert.equal(unknownActor.status, 403);
  assert.equal((await unknownActor.json()).error.code, 'ACTOR_NOT_AUTHORIZED');

  const invalidBody = await fetch(resolvePath, {
    method: 'POST',
    headers: { ...headers, 'x-adapter-id': 'adapter-a', 'x-adapter-token': ADAPTER_A },
    body: json({ entity_id: 'npc-a', adapter_id: 'adapter-b' }),
  });
  assert.equal(invalidBody.status, 400);
  assert.equal((await invalidBody.json()).error.code, 'INVALID_ACTOR_RESOLUTION');

  const revoked = await fetch(path + '/adapter-a/npc-a', {
    method: 'DELETE', headers: { ...headers, 'x-admin-token': ADMIN },
  });
  assert.equal(revoked.status, 200);
  assert.equal((await revoked.json()).binding.changed, true);

  const afterRevoke = await fetch(resolvePath, {
    method: 'POST',
    headers: { ...headers, 'x-adapter-id': 'adapter-a', 'x-adapter-token': ADAPTER_A },
    body: json({ entity_id: 'npc-a' }),
  });
  assert.equal(afterRevoke.status, 403);
  assert.equal((await afterRevoke.json()).error.code, 'ACTOR_NOT_AUTHORIZED');

  const rebound = await fetch(path, {
    method: 'POST', headers: { ...headers, 'x-admin-token': ADMIN }, body: json(bindingBody),
  });
  assert.equal(rebound.status, 201);
  const afterRebind = await fetch(resolvePath, {
    method: 'POST',
    headers: { ...headers, 'x-adapter-id': 'adapter-a', 'x-adapter-token': ADAPTER_A },
    body: json({ entity_id: 'npc-a' }),
  });
  assert.equal(afterRebind.status, 200);
  assert.equal((await afterRebind.json()).resolution.binding_generation, 3);
});


test('actor binding generation migration preserves existing active bindings', (t) => {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  t.after(() => store.close());
  engine.createWorld({
    world_id: 'actor-binding-migration-world',
    world_pack_id: 'test.world',
    world_pack_version: '1',
    game_time: '2026-01-01T00:00:00Z',
  });
  engine.commitEvent('actor-binding-migration-world', {
    idempotency_key: 'actor-binding-migration-seed',
    turn_id: 'actor-binding-migration-seed',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [{ kind: 'entity.create', entity_id: 'npc-existing', entity_type: 'character' }],
  });
  store.db.exec(`
    CREATE TABLE actor_bindings (
      world_id TEXT NOT NULL REFERENCES worlds(world_id),
      adapter_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(world_id, adapter_id, entity_id)
    );
  `);
  store.db.prepare(`
    INSERT INTO actor_bindings(world_id,adapter_id,entity_id,active,created_at,updated_at)
    VALUES(?,?,?,?,?,?)
  `).run('actor-binding-migration-world', 'adapter-a', 'npc-existing', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

  const bindings = new ActorBindingService(engine);
  assert.equal(bindings.resolve('actor-binding-migration-world', 'adapter-a', 'npc-existing').binding_generation, 1);
  bindings.revoke('actor-binding-migration-world', 'adapter-a', 'npc-existing');
  bindings.bind('actor-binding-migration-world', 'adapter-a', 'npc-existing');
  assert.equal(bindings.resolve('actor-binding-migration-world', 'adapter-a', 'npc-existing').binding_generation, 3);
});


test('actor bindings reject missing, destroyed, and cross-world entities', async (t) => {
  const base = await setup(t);
  const path = base + '/v1/worlds/actor-world/actor-bindings';
  const adminHeaders = { ...headers, 'x-admin-token': ADMIN };
  const missing = await fetch(path, { method: 'POST', headers: adminHeaders, body: json({ adapter_id: 'adapter-a', entity_id: 'missing' }) });
  assert.equal(missing.status, 409);
  assert.equal((await missing.json()).error.code, 'ACTOR_ENTITY_NOT_ELIGIBLE');

  const destroyed = await fetch(path, { method: 'POST', headers: adminHeaders, body: json({ adapter_id: 'adapter-a', entity_id: 'npc-dead' }) });
  assert.equal(destroyed.status, 409);
  assert.equal((await destroyed.json()).error.code, 'ACTOR_ENTITY_NOT_ELIGIBLE');

  const crossWorld = await fetch(base + '/v1/worlds/not-this-world/actor-bindings', {
    method: 'POST', headers: adminHeaders, body: json({ adapter_id: 'adapter-a', entity_id: 'npc-a' }),
  });
  assert.equal(crossWorld.status, 404);
  assert.equal((await crossWorld.json()).error.code, 'WORLD_NOT_FOUND');
});
