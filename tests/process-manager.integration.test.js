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
  const cancelReplay = engine.transitionProcess('world-a', 'journey-1', {
    action: 'cancel',
    expected_version: created.process.version,
    idempotency_key: 'cancel-journey-1',
    reason: 'test_cancel',
  });
  assert.equal(cancelReplay.idempotent_replay, true);
  assert.equal(cancelReplay.process.status, 'cancelled');

  const state = engine.getState('world-a');
  engine.startTimeAdvance('world-a', {
    idempotency_key: 'advance-after-cancel',
    expected_revision: state.world_revision,
    to_coordinate: 2000,
  });
  const process = engine.getProcess('world-a', 'journey-1');
  assert.equal(process.status, 'cancelled');
  assert.equal(process.progress.completed, 0);
  assert.equal(process.milestones.every((m) => m.status === 'cancelled'), true);
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
  const pauseReplay = engine.transitionProcess('world-a', 'journey-1', {
    action: 'pause',
    expected_version: created.process.version,
    idempotency_key: 'pause-journey-1',
  });
  assert.equal(pauseReplay.idempotent_replay, true);
  assert.equal(pauseReplay.process.status, 'paused');
  assert.throws(
    () => engine.transitionProcess('world-a', 'journey-1', {
      action: 'cancel',
      expected_version: created.process.version,
      idempotency_key: 'pause-journey-1',
    }),
    (error) => error.code === 'IDEMPOTENCY_CONFLICT',
  );

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
  const resumeReplay = engine.transitionProcess('world-a', 'journey-1', {
    action: 'resume',
    expected_version: beforeResume.version,
    idempotency_key: 'resume-journey-1',
  });
  assert.equal(resumeReplay.idempotent_replay, true);
  assert.equal(resumeReplay.process.status, 'scheduled');

  const afterResume = engine.getState('world-a');
  engine.startTimeAdvance('world-a', {
    idempotency_key: 'advance-after-resume',
    expected_revision: afterResume.world_revision,
    to_coordinate: 2000,
  });
  assert.equal(engine.getProcess('world-a', 'journey-1').progress.completed, 1);
}));

test('rollback invalidates the transitive completed prerequisite chain and survives restart', (t) => withDatabase(t, ({ engine, store, reopen }) => {
  store.createWorld(worldInput());
  const definition = processInput();
  definition.milestones.push({
    milestone_id: 'inspect',
    trigger_id: 'journey-inspect',
    due_coordinate: 3000,
    prerequisites: ['arrive'],
    read_set: [],
    write_set: [],
    event: { turn_id: 'journey-inspect-event', event_type: 'process.inspect', effects: [] },
  });
  engine.createProcess('world-a', definition);
  let state = engine.getState('world-a');
  const completed = engine.startTimeAdvance('world-a', {
    idempotency_key: 'advance-complete-chain-for-rollback',
    expected_revision: state.world_revision,
    to_coordinate: 3000,
  });
  assert.equal(completed.status, 'completed');

  let process = engine.getProcess('world-a', 'journey-1');
  assert.equal(process.progress.completed, 3);
  const sourceEventId = process.milestones.find((milestone) => milestone.milestone_id === 'depart').completed_event_ids[0];
  assert.ok(sourceEventId);

  const rollback = engine.rollbackEvent('world-a', {
    root_event_id: sourceEventId,
    idempotency_key: 'rollback-source-for-chain',
  });
  assert.equal(rollback.accepted, true);
  assert.equal(rollback.rollback_outcome, 'resolved');
  assert.equal(rollback.invalidated_event_ids.includes(sourceEventId), true);
  process = engine.getProcess('world-a', 'journey-1');
  assert.equal(process.status, 'needs_review');
  assert.equal(process.progress.completed, 0);
  assert.deepEqual(process.progress.blocked_milestone_ids.sort(), ['arrive', 'depart', 'inspect']);
  assert.equal(process.milestones.every((milestone) => milestone.status === 'needs_review'), true);
  assert.throws(
    () => engine.transitionProcess('world-a', 'journey-1', {
      action: 'resume',
      expected_version: process.version,
      idempotency_key: 'resume-after-chain-rollback',
    }),
    (error) => error.code === 'PROCESS_REQUIRES_RECONCILIATION',
  );
  const audit = engine.getAudit('world-a');
  const rollbackAudit = audit.filter((entry) => entry.action === 'process.rollback.needs_review'
    && entry.target_id === 'journey-1');
  assert.equal(rollbackAudit.length, 1);
  assert.deepEqual(rollbackAudit[0].payload.affected_milestone_ids.slice().sort(), ['arrive', 'depart', 'inspect']);
  assert.equal(rollbackAudit[0].world_revision, engine.getState('world-a').world_revision);

  ({ engine } = reopen());
  process = engine.getProcess('world-a', 'journey-1');
  assert.equal(process.status, 'needs_review');
  assert.equal(process.progress.completed, 0);
  assert.equal(process.milestones.every((milestone) => milestone.status === 'needs_review'), true);
  const auditAfterRestart = engine.getAudit('world-a').filter((entry) => entry.action === 'process.rollback.needs_review'
    && entry.target_id === 'journey-1');
  assert.equal(auditAfterRestart.length, 1);
  assert.deepEqual(auditAfterRestart[0].payload.affected_milestone_ids.slice().sort(), ['arrive', 'depart', 'inspect']);
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

test('checkpoint failure stays terminal and same-key retry after SQLite restart leaves no residue', (t) => withDatabase(t, ({ engine, store, reopen }) => {
  store.createWorld(worldInput());
  engine.createProcess('world-a', processInput());
  const beforeState = engine.getState('world-a');
  const beforeProcess = engine.getProcess('world-a', 'journey-1');
  const beforeTriggers = engine.listTimeTriggers('world-a');
  const beforeAudit = engine.getAudit('world-a');
  const beforeEventCount = store.db.prepare('SELECT COUNT(*) AS count FROM world_events WHERE world_id=?').get('world-a').count;

  const complete = engine.processStore.completeTrigger.bind(engine.processStore);
  engine.processStore.completeTrigger = () => { throw new Error('injected checkpoint failure'); };
  const request = {
    idempotency_key: 'advance-checkpoint-failure-replay',
    expected_revision: beforeState.world_revision,
    to_coordinate: 1000,
  };
  const failed = engine.startTimeAdvance('world-a', request);
  engine.processStore.completeTrigger = complete;

  assert.equal(failed.status, 'needs_review');
  const operationBeforeRestart = store.getTimeAdvanceOperationByKey('world-a', request.idempotency_key);
  assert.equal(operationBeforeRestart.status, 'needs_review');
  assert.equal(engine.getState('world-a').game_time_coordinate, beforeState.game_time_coordinate);
  assert.equal(engine.getState('world-a').world_revision, beforeState.world_revision);
  assert.equal(store.currentCommitSequence('world-a'), 0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM world_events WHERE world_id=?').get('world-a').count, beforeEventCount);
  assert.deepEqual(engine.getProcess('world-a', 'journey-1'), beforeProcess);
  const triggersAfterFailure = engine.listTimeTriggers('world-a');
  assert.equal(triggersAfterFailure.length, beforeTriggers.length);
  assert.equal(triggersAfterFailure.every((trigger, index) =>
    trigger.status === beforeTriggers[index].status
      && trigger.completed_operation_id === beforeTriggers[index].completed_operation_id), true);
  assert.deepEqual(engine.getAudit('world-a'), beforeAudit);

  ({ engine, store } = reopen());
  const persistedOperation = store.getTimeAdvanceOperationByKey('world-a', request.idempotency_key);
  assert.equal(persistedOperation.status, 'needs_review');
  const stateAfterRestart = engine.getState('world-a');
  const processAfterRestart = engine.getProcess('world-a', 'journey-1');
  const triggersAfterRestart = engine.listTimeTriggers('world-a');
  const auditAfterRestart = engine.getAudit('world-a');
  const eventCountAfterRestart = store.db.prepare('SELECT COUNT(*) AS count FROM world_events WHERE world_id=?').get('world-a').count;

  const replay = engine.startTimeAdvance('world-a', request);
  assert.equal(replay.status, 'needs_review');
  assert.deepEqual(replay, persistedOperation);
  assert.deepEqual(engine.getState('world-a'), stateAfterRestart);
  assert.deepEqual(engine.getProcess('world-a', 'journey-1'), processAfterRestart);
  assert.deepEqual(engine.listTimeTriggers('world-a'), triggersAfterRestart);
  assert.deepEqual(engine.getAudit('world-a'), auditAfterRestart);
  assert.equal(store.currentCommitSequence('world-a'), 0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM world_events WHERE world_id=?').get('world-a').count, eventCountAfterRestart);
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
  assert.deepEqual(
    engine.getProcess('world-a', 'journey-1').milestones.map((milestone) => [milestone.milestone_id, milestone.due_coordinate]),
    paused.process.milestones.map((milestone) => [milestone.milestone_id, milestone.due_coordinate]),
  );
  assert.equal(paused.process.version, current.version);
}));

test('interrupted time advance resumes a running process after SQLite close and reopen', (t) => withDatabase(t, ({ engine, store, reopen }) => {
  store.createWorld(worldInput());
  const definition = processInput();
  definition.milestones[0].interrupt_after_coordinate = true;
  engine.createProcess('world-a', definition);

  const before = engine.getState('world-a');
  const interrupted = engine.startTimeAdvance('world-a', {
    idempotency_key: 'advance-interrupted-process',
    expected_revision: before.world_revision,
    to_coordinate: 2000,
  });
  assert.equal(interrupted.status, 'interrupted');
  assert.equal(interrupted.confirmed_coordinate, 1000);
  let process = engine.getProcess('world-a', 'journey-1');
  assert.equal(process.status, 'running');
  assert.equal(process.progress.completed, 1);
  assert.equal(process.milestones.find((milestone) => milestone.milestone_id === 'arrive').status, 'pending');

  ({ engine } = reopen());
  process = engine.getProcess('world-a', 'journey-1');
  assert.equal(process.status, 'running');
  const afterRestart = engine.getState('world-a');
  const resumed = engine.startTimeAdvance('world-a', {
    idempotency_key: 'advance-resumed-process',
    expected_revision: afterRestart.world_revision,
    to_coordinate: 2000,
  });
  assert.equal(resumed.status, 'completed');
  process = engine.getProcess('world-a', 'journey-1');
  assert.equal(process.status, 'completed');
  assert.equal(process.progress.completed, 2);
}));

test('process creation rejects underdeclared event reads and writes before storing triggers', (t) => withDatabase(t, ({ engine, store }) => {
  store.createWorld(worldInput());
  const underdeclaredWrite = processInput();
  underdeclaredWrite.milestones = [{
    milestone_id: 'write',
    trigger_id: 'underdeclared-write',
    due_coordinate: 1000,
    prerequisites: [],
    read_set: [],
    write_set: [],
    event: {
      turn_id: 'underdeclared-write-event',
      event_type: 'process.write',
      effects: [{ kind: 'entity.upsert', entity_id: 'target', entity_type: 'object', attributes: { changed: true } }],
    },
  }];
  assert.throws(
    () => engine.createProcess('world-a', underdeclaredWrite),
    (error) => error.code === 'PROCESS_WRITE_SET_UNDERDECLARED',
  );
  assert.equal(engine.listTimeTriggers('world-a').length, 0);
  assert.equal(engine.listProcesses('world-a').length, 0);

  const underdeclaredRead = processInput();
  underdeclaredRead.milestones = [{
    milestone_id: 'read',
    trigger_id: 'underdeclared-read',
    due_coordinate: 1000,
    prerequisites: [],
    read_set: [],
    write_set: [],
    event: {
      turn_id: 'underdeclared-read-event',
      event_type: 'process.read',
      read_set: ['entity:guard'],
      effects: [],
    },
  }];
  assert.throws(
    () => engine.createProcess('world-a', underdeclaredRead),
    (error) => error.code === 'PROCESS_READ_SET_UNDERDECLARED',
  );
  assert.equal(engine.listTimeTriggers('world-a').length, 0);
  assert.equal(engine.listProcesses('world-a').length, 0);
  assert.equal(engine.getState('world-a').world_revision, 0);
}));


test('stale canonical revision rejects process creation without trigger, process, or audit side effects', (t) => withDatabase(t, ({ engine, store }) => {
  store.createWorld(worldInput());
  const before = engine.getState('world-a');
  assert.equal(before.world_revision, 0);
  assert.throws(
    () => engine.createProcess('world-a', processInput({
      idempotency_key: 'create-with-stale-revision',
      expected_revision: before.world_revision + 1,
    })),
    (error) => error.code === 'REVISION_CONFLICT',
  );
  assert.equal(engine.getState('world-a').world_revision, before.world_revision);
  assert.equal(engine.listProcesses('world-a').length, 0);
  assert.equal(engine.listTimeTriggers('world-a').length, 0);
  assert.equal(engine.getAudit('world-a').some((entry) => entry.action === 'process.created'), false);
}));

test('competing lifecycle commands against one checkpoint allow only one transition and audit it once', (t) => withDatabase(t, ({ engine, store }) => {
  store.createWorld(worldInput());
  const created = engine.createProcess('world-a', processInput());
  const first = engine.transitionProcess('world-a', 'journey-1', {
    action: 'pause',
    expected_version: created.process.version,
    idempotency_key: 'competing-pause',
  });
  assert.equal(first.process.status, 'paused');
  assert.equal(first.process.version, created.process.version + 1);

  assert.throws(
    () => engine.transitionProcess('world-a', 'journey-1', {
      action: 'cancel',
      expected_version: created.process.version,
      idempotency_key: 'competing-cancel',
    }),
    (error) => error.code === 'PROCESS_VERSION_CONFLICT',
  );
  const after = engine.getProcess('world-a', 'journey-1');
  assert.equal(after.status, 'paused');
  assert.equal(after.version, first.process.version);
  const audit = engine.getAudit('world-a');
  assert.equal(audit.filter((entry) => entry.action === 'process.lifecycle.transitioned'
    && entry.target_id === 'journey-1').length, 1);
  assert.equal(audit.some((entry) => entry.action === 'process.lifecycle.transitioned'
    && entry.target_id === 'journey-1' && entry.payload.to === 'cancelled'), false);
}));


test('stale Core revision rejects process creation without partial checkpoints or audit', (t) => withDatabase(t, ({ engine, store }) => {
  store.createWorld(worldInput());
  const created = engine.createProcess('world-a', processInput());
  const beforeState = engine.getState('world-a');
  const beforeTriggers = engine.listTimeTriggers('world-a');
  const beforeAudit = engine.getAudit('world-a');

  const staleDefinition = processInput({
    process_id: 'journey-stale',
    idempotency_key: 'create-journey-stale',
    expected_revision: 0,
  });
  assert.throws(
    () => engine.createProcess('world-a', staleDefinition),
    (error) => error.code === 'REVISION_CONFLICT',
  );
  assert.equal(engine.getState('world-a').world_revision, beforeState.world_revision);
  assert.deepEqual(engine.listProcesses('world-a').map((process) => process.process_id), [created.process.process_id]);
  assert.deepEqual(engine.listTimeTriggers('world-a'), beforeTriggers);
  assert.deepEqual(engine.getAudit('world-a'), beforeAudit);
}));

test('competing lifecycle checkpoints reject stale version and keep process, triggers and audit consistent', (t) => withDatabase(t, ({ engine, store }) => {
  store.createWorld(worldInput());
  const created = engine.createProcess('world-a', processInput());
  const beforeVersion = created.process.version;
  const paused = engine.transitionProcess('world-a', 'journey-1', {
    action: 'pause',
    expected_version: beforeVersion,
    idempotency_key: 'competing-pause',
  });
  assert.equal(paused.process.status, 'paused');
  const revisionAfterWinner = engine.getState('world-a').world_revision;
  const auditAfterWinner = engine.getAudit('world-a');

  assert.throws(
    () => engine.transitionProcess('world-a', 'journey-1', {
      action: 'cancel',
      expected_version: beforeVersion,
      idempotency_key: 'competing-cancel-stale-version',
    }),
    (error) => error.code === 'PROCESS_VERSION_CONFLICT',
  );
  const process = engine.getProcess('world-a', 'journey-1');
  assert.equal(process.status, 'paused');
  assert.equal(process.version, paused.process.version);
  assert.equal(engine.getState('world-a').world_revision, revisionAfterWinner);
  assert.deepEqual(engine.getAudit('world-a'), auditAfterWinner);
  assert.equal(engine.listTimeTriggers('world-a').every((trigger) => trigger.status === 'cancelled'), true);
}));


test('paused lifecycle state and trigger cancellation survive restart before resume', (t) => withDatabase(t, ({ engine, store, reopen }) => {
  store.createWorld(worldInput());
  const definition = processInput();
  definition.milestones = definition.milestones.map((milestone, index) => ({
    ...milestone,
    due_coordinate: (index + 2) * 1000,
  }));
  const created = engine.createProcess('world-a', definition);
  const originalDueCoordinates = created.process.milestones.map((milestone) => [
    milestone.milestone_id, milestone.due_coordinate,
  ]);
  const originalTriggerIds = created.process.milestones.map((milestone) => milestone.trigger_id);

  const paused = engine.transitionProcess('world-a', 'journey-1', {
    action: 'pause',
    expected_version: created.process.version,
    idempotency_key: 'pause-before-restart',
  });
  assert.equal(paused.process.status, 'paused');
  assert.equal(engine.listTimeTriggers('world-a').every((trigger) => trigger.status === 'cancelled'), true);

  ({ engine } = reopen());
  let process = engine.getProcess('world-a', 'journey-1');
  assert.equal(process.status, 'paused');
  assert.deepEqual(process.milestones.map((milestone) => [
    milestone.milestone_id, milestone.due_coordinate,
  ]), originalDueCoordinates);
  assert.deepEqual(process.milestones.map((milestone) => milestone.trigger_id), originalTriggerIds);
  assert.equal(engine.listTimeTriggers('world-a').every((trigger) => trigger.status === 'cancelled'), true);

  const resumed = engine.transitionProcess('world-a', 'journey-1', {
    action: 'resume',
    expected_version: process.version,
    idempotency_key: 'resume-after-restart',
  });
  assert.equal(resumed.process.status, 'scheduled');
  assert.deepEqual(resumed.process.milestones.map((milestone) => [
    milestone.milestone_id, milestone.due_coordinate,
  ]), originalDueCoordinates);
  assert.equal(resumed.process.milestones.every((milestone) => !originalTriggerIds.includes(milestone.trigger_id)), true);

  ({ engine } = reopen());
  process = engine.getProcess('world-a', 'journey-1');
  assert.equal(process.status, 'scheduled');
  assert.deepEqual(process.milestones.map((milestone) => [
    milestone.milestone_id, milestone.due_coordinate,
  ]), originalDueCoordinates);
  assert.equal(process.milestones.every((milestone) => milestone.status === 'pending'), true);

  const state = engine.getState('world-a');
  const advance = engine.startTimeAdvance('world-a', {
    idempotency_key: 'advance-after-pause-restart-resume',
    expected_revision: state.world_revision,
    to_coordinate: 2000,
  });
  assert.equal(advance.status, 'completed');
  process = engine.getProcess('world-a', 'journey-1');
  assert.equal(process.progress.completed, 1);
  assert.equal(process.milestones.find((milestone) => milestone.milestone_id === 'depart').status, 'completed');
}));
