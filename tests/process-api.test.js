import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { createApiServer } from '../src/api/server.js';

const TOKEN = 'process-api-token-long-enough-123456';
const INTERNAL = 'process-api-internal-token-long-enough-123456';
const ADAPTER = 'process-api-adapter-token-long-enough-123456';
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
  engine.createWorld({
    world_id: 'process-api-world',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2005-12-29T10:00:00.000Z',
  });
  const server = createApiServer({
    engine,
    token: TOKEN,
    internalToken: INTERNAL,
    adapterTokens: { 'adapter-a': ADAPTER },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); store.close(); });
  return 'http://127.0.0.1:' + server.address().port;
}

test('process lifecycle routes require the internal credential and use the Core lifecycle', async (t) => {
  const base = await setup(t);
  const denied = await fetch(base + '/v1/worlds/process-api-world/processes', { headers });
  assert.equal(denied.status, 403);

  const created = await fetch(base + '/v1/worlds/process-api-world/processes', {
    method: 'POST',
    headers: { ...headers, 'x-engine-internal-token': INTERNAL },
    body: json({
      process_id: 'api-process',
      idempotency_key: 'create-api-process',
      expected_revision: 0,
      milestones: [{
        milestone_id: 'finish',
        due_coordinate: 10000,
        dependencies: [],
        event: { turn_id: 'api-process-turn', event_type: 'action.completed', effects: [] },
      }],
    }),
  });
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.equal(createdBody.process.status, 'scheduled');

  const fetched = await fetch(base + '/v1/worlds/process-api-world/processes/api-process', {
    headers: { ...headers, 'x-engine-internal-token': INTERNAL },
  });
  assert.equal(fetched.status, 200);
  assert.equal((await fetched.json()).process.process_id, 'api-process');

  const list = await fetch(base + '/v1/worlds/process-api-world/processes', {
    headers: { ...headers, 'x-engine-internal-token': INTERNAL },
  });
  assert.equal(list.status, 200);
  assert.deepEqual((await list.json()).processes.map((process) => process.process_id), ['api-process']);
});
