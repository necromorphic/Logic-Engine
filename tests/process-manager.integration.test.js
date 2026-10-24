import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';

const worldInput = (worldId = 'world-a') => ({
  world_id: worldId,
  world_pack_id: 'test-pack',
  world_pack_version: '1',
  game_time: '2000-01-01T00:00:00.000Z',
});

const processInput = (overrides = {}) => ({
  process_id: 'journey-1',
  definition_version: '1',
  idempotency_key: 'create-journey-1',
  expected_revision: 0,
  milestones: [
    {
      milestone_id: 'depart',
      trigger_id: 'journey-depart',
      due_coordinate: 1000,
      prerequisites: [],
      read_set: [],
      write_set: [],
      event: { turn_id: 'journey-depart-event', event_type: 'process.depart', effects: [] },
    },
    {
      milestone_id: 'arrive',
      trigger_id: 'journey-arrive',
      due_coordinate: 2000,
      prerequisites: ['depart'],
      read_set: [],
      write_set: [],
      event: { turn_id: 'journey-arrive-event', event_type: 'process.arrive', effects: [] },
    },
  ],
  ...overrides,
});

function withDatabase(t, callback) {
  const directory = mkdtempSync(join(tmpdir(), 'logic-engine-process-'));
  const path = join(directory, 'engine.sqlite');
  let store = new SQLiteStore(path);
  let engine = new LogicEngine(store);
  t.after(() => {
    try { store.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });
  return callback({
    path,
    get store() { return store; },
    get engine() { return engine; },
    reopen() {
      store.close();
      store = new SQLiteStore(path);
      engine = new LogicEngine(store);
      return { store, engine };
    },
  });
}

test('process milestone checkpoint commits with its trigger segment and survives SQLite restart', (t) => withDatabase(t, ({ engine, store, reopen }) => {
  store.createWorld(worldInput());
  const created = engine.createProcess('world-a', processInput());
  assert.equal(created.process.status, 'scheduled');
  assert.equal(created.process.milestones.length, 2);

  const replay = engine.createProcess('world-a', processInput());
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.process.process_id, 'journey-1');

  const state = engine.getState('world-a');
  const firstAdvance = engine.startTimeAdvance('world-a', {
    idempotency_key: 'advance-to-departure',
    expected_revision: state.world_revision,
    to_coordinate: 1000,
  });
  assert.equal(firstAdvance.status, 'completed');
  let process = engine.getProcess('world-a', 'journey-1');
  assert.equal(process.status, 'running');
  assert.equal(process.progress.completed, 1);
  assert.equal(process.milestones.find((m) => m.milestone_id === 'depart').status, 'completed');
  assert.equal(process.milestones.find((m) => m.milestone_id === 'arrive').status, 'pending');

  ({ engine } = reopen());
  process = engine.getProcess('world-a', 'journey-1');
  assert.equal(process.status, 'running');
  assert.equal(process.progress.completed, 1);

  const resumedState = engine.getState('world-a');
  const secondAdvance = engine.startTimeAdvance('world-a', {
    idempotency_key: 'advance-to-arrival',
    expected_revision: resumedState.world_revision,
    to_coordinate: 2000,
  });
  assert.equal(secondAdvance.status, 'completed');
  process = engine.getProcess('world-a', 'journey-1');
  assert.equal(process.status, 'completed');
  assert.equal(process.progress.completed, 2);
  assert.equal(process.milestones.every((m) => m.status === 'completed'), true);

  const replayAdvance = engine.startTimeAdvance('world-a', {
    idempotency_key: 'advance-to-arrival',
    expected_revision: resumedState.world_revision,
    to_coordinate: 2000,
  });
  assert.equal(replayAdvance.status, 'completed');
  assert.throws(
    () => engine.startTimeAdvance('world-a', {
      idempotency_key: 'advance-to-arrival',
      expected_revision: resumedState.world_revision,
      to_coordinate: 3000,
    }),
    (error) => error.code === 'IDEMPOTENCY_CONFLICT',
  );
}));

test('cancelling a process atomically cancels pending milestone triggers', (t) => withDatabase(t, ({ engine, store }) => {
  store.createWorld(worldInput());
  const created = engine.createProcess('world-a', processInput());
  const cancelled = engine.transitionProcess('world-a', 'journey-1', {
    action: 'cancel',
    expected_version: created.process.version,
    idempotency_key: 'cancel-journey-1',
    reason: 'test_cancel',
  });
  assert.equal(cancelled.process.status, 'cancelled');
  assert.equal(engine.listTimeTriggers('world-a').every((trigger) => trigger.status === 'cancelled'), true);

  const state = engine.getState('world-a');
  engine.startTimeAdvance('world-a', {
    idempotency_key: 'advance-after-cancel',
    expected_revision: state.world_revision,
    to_coordinate: 2000,
  });
  const process = engine.getProcess('world-a', 'journey-1');
  assert.equal(process.status, 'cancelled');
  assert.equal(process.progress.completed, 0);
  assert.equal(process.milestones.every((m) => m.status === 'pending'), true);
}));

test('pause and resume rotate pending trigger identities when milestones remain in the future', (t) => withDatabase(t, ({ engine, store }) => {
  store.createWorld(worldInput());
  const definition = processInput();
  definition.milestones = definition.milestones.map((milestone, index) => ({
    ...milestone, due_coordinate: (index + 2) * 1000,
  }));
  const created = engine.createProcess('world-a', definition);
  const paused = engine.transitionProcess('world-a', 'journey-1', {
    action: 'pause',
    expected_version: created.process.version,
    idempotency_key: 'pause-journey-1',
  });
  assert.equal(paused.process.status, 'paused');

  const afterPause = engine.getState('world-a');
  engine.startTimeAdvance('world-a', {
    idempotency_key: 'advance-while-paused',
    expected_revision: afterPause.world_revision,
    to_coordinate: 1000,
  });
  const beforeResume = engine.getProcess('world-a', 'journey-1');
  const oldTriggerIds = beforeResume.milestones.map((milestone) => milestone.trigger_id);
  const resumed = engine.transitionProcess('world-a', 'journey-1', {
    action: 'resume',
    expected_version: beforeResume.version,
    idempotency_key: 'resume-journey-1',
  });
  assert.equal(resumed.process.status, 'scheduled');
  assert.equal(resumed.process.milestones.every((milestone) => !oldTriggerIds.includes(milestone.trigger_id)), true);

  const afterResume = engine.getState('world-a');
  engine.startTimeAdvance('world-a', {
    idempotency_key: 'advance-after-resume',
    expected_revision: afterResume.world_revision,
    to_coordinate: 2000,
  });
  assert.equal(engine.getProcess('world-a', 'journey-1').progress.completed, 1);
}));

test('rollback of a committed milestone moves process progress to needs_review and blocks resume', (t) => withDatabase(t, ({ engine, store }) => {
  store.createWorld(worldInput());
  engine.createProcess('world-a', processInput());
  const state = engine.getState('world-a');
  engine.startTimeAdvance('world-a', {
    idempotency_key: 'advance-for-rollback',
    expected_revision: state.world_revision,
    to_coordinate: 1000,
  });
  const process = engine.getProcess('world-a', 'journey-1');
  const eventId = process.milestones.find((milestone) => milestone.milestone_id === 'depart').completed_event_ids[0];
  assert.ok(eventId);

  engine.rollbackEvent('world-a', { root_event_id: eventId, idempotency_key: 'rollback-departure' });
  const afterRollback = engine.getProcess('world-a', 'journey-1');
  assert.equal(afterRollback.status, 'needs_review');
  assert.equal(afterRollback.milestones.find((milestone) => milestone.milestone_id === 'depart').status, 'needs_review');
  assert.throws(
    () => engine.transitionProcess('world-a', 'journey-1', {
      action: 'resume',
      expected_version: afterRollback.version,
      idempotency_key: 'resume-after-rollback',
    }),
    (error) => error.code === 'PROCESS_REQUIRES_RECONCILIATION',
  );
}));

test('process identities and milestones are isolated by world', (t) => withDatabase(t, ({ engine, store }) => {
  store.createWorld(worldInput('world-a'));
  store.createWorld(worldInput('world-b'));
  engine.createProcess('world-a', processInput());
  assert.throws(
    () => engine.getProcess('world-b', 'journey-1'),
    (error) => error.code === 'PROCESS_NOT_FOUND',
  );
  assert.equal(engine.listProcesses('world-b').length, 0);
}));

test('failure between canonical segment commit and process checkpoint rolls back the entire segment', (t) => withDatabase(t, ({ engine, store }) => {
  store.createWorld(worldInput());
  engine.createProcess('world-a', processInput());
  const before = engine.getState('world-a');
  const complete = engine.processStore.completeTrigger.bind(engine.processStore);
  engine.processStore.completeTrigger = () => {
    const error = new Error('injected checkpoint failure');
    error.code = 'INJECTED_PROCESS_CHECKPOINT_FAILURE';
    throw error;
  };
  const operation = engine.startTimeAdvance('world-a', {
    idempotency_key: 'advance-with-injected-failure',
    expected_revision: before.world_revision,
    to_coordinate: 1000,
  });
  engine.processStore.completeTrigger = complete;

  assert.equal(operation.status, 'needs_review');
  assert.equal(engine.getState('world-a').game_time_coordinate, 0);
  const process = engine.getProcess('world-a', 'journey-1');
  assert.equal(process.progress.completed, 0);
  assert.equal(process.milestones.find((milestone) => milestone.milestone_id === 'depart').status, 'pending');
}));

test('resume rejects a paused process whose milestone became overdue', (t) => withDatabase(t, ({ engine, store }) => {
  store.createWorld(worldInput());
  const created = engine.createProcess('world-a', processInput());
  const paused = engine.transitionProcess('world-a', 'journey-1', {
    action: 'pause',
    expected_version: created.process.version,
    idempotency_key: 'pause-overdue-journey',
  });
  const state = engine.getState('world-a');
  engine.startTimeAdvance('world-a', {
    idempotency_key: 'advance-past-paused-due',
    expected_revision: state.world_revision,
    to_coordinate: 1000,
  });
  const current = engine.getProcess('world-a', 'journey-1');
  assert.equal(current.status, 'paused');
  assert.throws(
    () => engine.transitionProcess('world-a', 'journey-1', {
      action: 'resume',
      expected_version: current.version,
      idempotency_key: 'resume-overdue-journey',
    }),
    (error) => error.code === 'PROCESS_RESUME_REQUIRES_REPLAN',
  );
  assert.equal(engine.getProcess('world-a', 'journey-1').status, 'paused');
  assert.ok(paused.process.version < current.version);
}));
