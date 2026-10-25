import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { createApiServer } from '../src/api/server.js';

const TOKEN = 'process-api-test-token-123456789';
const INTERNAL = 'process-api-internal-token-123456789';
const ADMIN = 'process-api-admin-token-123456789';
const headers = { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' };
const internalHeaders = { ...headers, 'x-engine-internal-token': INTERNAL };
const json = (body) => JSON.stringify(body);

async function setup(t) {
  const store = new SQLiteStore(':memory:');
  const server = createApiServer({ engine: new LogicEngine(store), token: TOKEN, internalToken: INTERNAL, adminToken: ADMIN });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); store.close(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const created = await fetch(base + '/v1/worlds', {
    method: 'POST',
    headers: { ...headers, 'x-admin-token': ADMIN },
    body: json({
      world_id: 'process-api-world',
      world_pack_id: 'test.world',
      world_pack_version: '1.0.0',
      game_time: '2026-01-01T00:00:00.000Z',
    }),
  });
  assert.equal(created.status, 201);
  return base;
}

const createRequest = () => ({
  process_id: 'api-process',
  definition_version: '1',
  expected_revision: 0,
  idempotency_key: 'create-api-process',
  milestones: [{
    milestone_id: 'finish',
    trigger_id: 'api-process-finish',
    due_coordinate: 10000,
    prerequisites: [],
    read_set: [],
    write_set: [],
    event: { turn_id: 'api-process-finish-event', event_type: 'process.test.finish', effects: [] },
  }],
});

test('process API is internal-only and exposes durable create/read/lifecycle operations', async (t) => {
  const base = await setup(t);
  const path = base + '/v1/worlds/process-api-world/processes';

  const denied = await fetch(path, { method: 'POST', headers, body: json(createRequest()) });
  assert.equal(denied.status, 403);

  const createdResponse = await fetch(path, { method: 'POST', headers: internalHeaders, body: json(createRequest()) });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.process.status, 'scheduled');
  assert.equal(created.process.progress.total, 1);

  const replay = await fetch(path, { method: 'POST', headers: internalHeaders, body: json(createRequest()) });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).idempotent_replay, true);

  const listed = await fetch(path, { headers: internalHeaders });
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).processes.length, 1);

  const fetched = await fetch(path + '/api-process', { headers: internalHeaders });
  assert.equal(fetched.status, 200);
  assert.equal((await fetched.json()).process.process_id, 'api-process');

  const directTriggerCancel = await fetch(base + '/v1/worlds/process-api-world/time-triggers/api-process-finish/cancel', {
    method: 'POST', headers: internalHeaders, body: json({ reason: 'should_be_owned_by_process' }),
  });
  assert.equal(directTriggerCancel.status, 409);

  const pausedResponse = await fetch(path + '/api-process/pause', {
    method: 'POST', headers: internalHeaders,
    body: json({ expected_version: created.process.version, idempotency_key: 'pause-api-process' }),
  });
  assert.equal(pausedResponse.status, 200);
  const paused = (await pausedResponse.json()).process;
  assert.equal(paused.status, 'paused');

  const resumedResponse = await fetch(path + '/api-process/resume', {
    method: 'POST', headers: internalHeaders,
    body: json({ expected_version: paused.version, idempotency_key: 'resume-api-process' }),
  });
  assert.equal(resumedResponse.status, 200);
  const resumed = (await resumedResponse.json()).process;
  assert.equal(resumed.status, 'scheduled');
  assert.notEqual(resumed.milestones[0].trigger_id, 'api-process-finish');

  const cancelledResponse = await fetch(path + '/api-process/cancel', {
    method: 'POST', headers: internalHeaders,
    body: json({ expected_version: resumed.version, idempotency_key: 'cancel-api-process' }),
  });
  assert.equal(cancelledResponse.status, 200);
  const cancelled = (await cancelledResponse.json()).process;
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.milestones[0].status, 'cancelled');
});
