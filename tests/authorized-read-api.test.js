import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { createApiServer } from '../src/api/server.js';

const TOKEN = 'api-token-for-authorized-read-tests';
const ADMIN = 'admin-token-for-authorized-read-tests';
const ADAPTER = 'adapter-token-for-authorized-read-tests';
const headers = {
  authorization: 'Bearer ' + TOKEN,
  'content-type': 'application/json',
  'x-adapter-id': 'adapter-a',
  'x-adapter-token': ADAPTER,
};
const json = (body) => JSON.stringify(body);

async function setup(t) {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  const server = createApiServer({
    engine,
    token: TOKEN,
    adminToken: ADMIN,
    adapterTokens: { 'adapter-a': ADAPTER },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); store.close(); });

  engine.createWorld({
    world_id: 'authorized-read-world',
    world_pack_id: 'test.world',
    world_pack_version: '1',
    game_time: '2026-01-01T00:00:00Z',
  });
  engine.commitEvent('authorized-read-world', {
    idempotency_key: 'seed-authorized-read',
    turn_id: 'seed-authorized-read',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [
      { kind: 'entity.create', entity_id: 'actor-a', entity_type: 'character', attributes: { name: 'Actor', secret: 'must-not-leak' } },
      { kind: 'entity.create', entity_id: 'other-a', entity_type: 'character', attributes: { name: 'Other', secret: 'also-private' } },
    ],
  });
  const bindingPath = 'http://127.0.0.1:' + server.address().port + '/v1/worlds/authorized-read-world/actor-bindings';
  const bound = await fetch(bindingPath, {
    method: 'POST',
    headers: { authorization: headers.authorization, 'content-type': 'application/json', 'x-admin-token': ADMIN },
    body: json({ adapter_id: 'adapter-a', entity_id: 'actor-a' }),
  });
  assert.equal(bound.status, 201);
  return 'http://127.0.0.1:' + server.address().port;
}

test('authorized-read API exposes only the bound actor identity and never arbitrary attributes', async (t) => {
  const base = await setup(t);
  const response = await fetch(base + '/v1/worlds/authorized-read-world/authorized-read', {
    method: 'POST',
    headers,
    body: json({
      actor_entity_id: 'actor-a',
      purpose: 'npc_decision',
      fields: ['entity_id', 'entity_type', 'status', 'attributes.name', 'attributes.secret'],
    }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.read.entities, [{ entity_id: 'actor-a', entity_type: 'character', status: 'active' }]);
  assert.equal(JSON.stringify(body).includes('must-not-leak'), false);
  assert.equal(JSON.stringify(body).includes('Actor'), false);
  assert.equal(Number.isSafeInteger(body.read.world_revision), true);
  assert.equal(Number.isSafeInteger(body.read.commit_sequence), true);
});

test('authorized-read API cannot use a different or unbound actor to read another entity', async (t) => {
  const base = await setup(t);
  const response = await fetch(base + '/v1/worlds/authorized-read-world/authorized-read', {
    method: 'POST',
    headers,
    body: json({
      actor_entity_id: 'other-a',
      purpose: 'npc_decision',
      fields: ['entity_id', 'entity_type', 'status'],
    }),
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'ACTOR_NOT_AUTHORIZED');
});

test('authorized-read API requires adapter credentials and rejects unknown fields', async (t) => {
  const base = await setup(t);
  const noAdapter = await fetch(base + '/v1/worlds/authorized-read-world/authorized-read', {
    method: 'POST',
    headers: { authorization: headers.authorization, 'content-type': 'application/json' },
    body: json({ actor_entity_id: 'actor-a', purpose: 'npc_decision', fields: ['entity_id'] }),
  });
  assert.equal(noAdapter.status, 403);
  assert.equal((await noAdapter.json()).error.code, 'ADAPTER_REQUIRED');

  for (const action of ['state', 'events', 'audit']) {
    const rawRead = await fetch(base + '/v1/worlds/authorized-read-world/' + action, { headers });
    assert.equal(rawRead.status, 403, action + ' must not bypass the authorized-read boundary');
    assert.equal((await rawRead.json()).error.code, 'AUTHORIZED_READ_REQUIRED');
  }

  const extraField = await fetch(base + '/v1/worlds/authorized-read-world/authorized-read', {
    method: 'POST',
    headers,
    body: json({ actor_entity_id: 'actor-a', purpose: 'npc_decision', fields: ['entity_id'], visibility: 'public' }),
  });
  assert.equal(extraField.status, 400);
  assert.equal((await extraField.json()).error.code, 'INVALID_AUTHORIZED_READ');
});
