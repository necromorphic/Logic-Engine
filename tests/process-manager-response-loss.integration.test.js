import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';

const worldInput = () => ({
  world_id: 'world-a',
  world_pack_id: 'test-pack',
  world_pack_version: '1',
  game_time: '2000-01-01T00:00:00.000Z',
});

const processInput = () => ({
  process_id: 'journey-1',
  definition_version: '1',
  idempotency_key: 'create-journey-1',
  expected_revision: 0,
  milestones: [{
    milestone_id: 'depart',
    trigger_id: 'journey-depart',
    due_coordinate: 1000,
    prerequisites: [],
    read_set: [],
    write_set: [],
    event: { turn_id: 'journey-depart-event', event_type: 'process.depart', effects: [] },
  }],
});

test('successful segment commit is not duplicated when response is lost and same key is retried after restart', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-engine-response-loss-'));
  const path = join(directory, 'engine.sqlite');
  let store = new SQLiteStore(path);
  let engine = new LogicEngine(store);
  t.after(() => {
    try { store.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });

  store.createWorld(worldInput());
  engine.createProcess('world-a', processInput());
  const before = engine.getState('world-a');
  const request = {
    idempotency_key: 'advance-response-lost',
    expected_revision: before.world_revision,
    to_coordinate: 1000,
  };

  // The operation commits successfully, but the caller is assumed not to receive its response.
  const committed = engine.startTimeAdvance('world-a', request);
  assert.equal(committed.status, 'completed');
  const persistedOperation = store.getTimeAdvanceOperationByKey('world-a', request.idempotency_key);
  assert.equal(persistedOperation.status, 'completed');

  const stateAfterCommit = engine.getState('world-a');
  const processAfterCommit = engine.getProcess('world-a', 'journey-1');
  const triggersAfterCommit = engine.listTimeTriggers('world-a');
  const auditAfterCommit = engine.getAudit('world-a');
  const eventCountAfterCommit = store.db.prepare(
    'SELECT COUNT(*) AS count FROM world_events WHERE world_id=?',
  ).get('world-a').count;
  const commitSequenceAfterCommit = store.currentCommitSequence('world-a');
  assert.equal(stateAfterCommit.game_time_coordinate, 1000);
  assert.equal(processAfterCommit.progress.completed, 1);
  assert.ok(eventCountAfterCommit > 0);

  // Simulate process restart before the caller retries the identical request.
  store.close();
  store = new SQLiteStore(path);
  engine = new LogicEngine(store);
  const replay = engine.startTimeAdvance('world-a', request);

  assert.equal(replay.status, 'completed');
  assert.deepEqual(replay, persistedOperation);
  assert.deepEqual(engine.getState('world-a'), stateAfterCommit);
  assert.deepEqual(engine.getProcess('world-a', 'journey-1'), processAfterCommit);
  assert.deepEqual(engine.listTimeTriggers('world-a'), triggersAfterCommit);
  assert.deepEqual(engine.getAudit('world-a'), auditAfterCommit);
  assert.equal(store.currentCommitSequence('world-a'), commitSequenceAfterCommit);
  assert.equal(store.db.prepare(
    'SELECT COUNT(*) AS count FROM world_events WHERE world_id=?',
  ).get('world-a').count, eventCountAfterCommit);

  assert.throws(
    () => engine.startTimeAdvance('world-a', {
      ...request,
      to_coordinate: 2000,
    }),
    (error) => error.code === 'IDEMPOTENCY_CONFLICT',
  );
});
