import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';

function setup(path = ':memory:') {
  const store = new SQLiteStore(path);
  const engine = new LogicEngine(store);
  if (!store.world('process-world')) {
    engine.createWorld({
      world_id: 'process-world',
      world_pack_id: 'test.world',
      world_pack_version: '1.0.0',
      game_time: '2005-12-29T10:00:00.000Z',
    });
  }
  return { store, engine };
}

const milestone = (id, due, entityId, overrides = {}) => ({
  milestone_id: id,
  due_coordinate: due,
  dependencies: [],
  read_set: [],
  write_set: ['entity:' + entityId],
  event: {
    turn_id: 'process-turn-' + id,
    event_type: 'action.completed',
    effects: [{ kind: 'entity.upsert', entity_id: entityId, entity_type: 'object', attributes: { milestone: id } }],
  },
  ...overrides,
});

function createTwoMilestoneProcess(engine, overrides = {}) {
  return engine.createProcess('process-world', {
    process_id: 'build-out',
    idempotency_key: 'create-build-out',
    expected_revision: engine.getState('process-world').world_revision,
    source_event_ids: [],
    milestones: [
      milestone('foundation', 10000, 'foundation', { interrupt_after_coordinate: true, ...(overrides.first ?? {}) }),
      milestone('walls', 20000, 'walls', { dependencies: ['foundation'], ...(overrides.second ?? {}) }),
    ],
  });
}

test('process milestone and time segment checkpoint survive SQLite restart and resume independently', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-engine-process-'));
  const path = join(directory, 'engine.sqlite');
  let { store, engine } = setup(path);
  let operation;
  try {
    const created = createTwoMilestoneProcess(engine);
    assert.equal(created.status, 'scheduled');
    assert.equal(created.milestones.length, 2);
    const firstRevision = engine.getState('process-world').world_revision;
    operation = engine.startTimeAdvance('process-world', {
      idempotency_key: 'advance-to-first-milestone',
      expected_revision: firstRevision,
      to_coordinate: 20000,
    });
    assert.equal(operation.status, 'interrupted');
    assert.equal(operation.confirmed_coordinate, 10000);
    let process = engine.getProcess('process-world', 'build-out');
    assert.equal(process.status, 'running');
    assert.deepEqual(process.milestones.map((item) => item.status), ['completed', 'pending']);
    assert.equal(engine.getState('process-world').entities.find((entity) => entity.entity_id === 'foundation').attributes.milestone, 'foundation');
    assert.equal(engine.getState('process-world').entities.some((entity) => entity.entity_id === 'walls'), false);

    store.close();
    ({ store, engine } = setup(path));
    process = engine.getProcess('process-world', 'build-out');
    assert.equal(process.status, 'running');
    assert.deepEqual(process.milestones.map((item) => item.status), ['completed', 'pending']);

    const resumed = engine.startTimeAdvance('process-world', {
      idempotency_key: 'advance-to-second-milestone',
      expected_revision: engine.getState('process-world').world_revision,
      to_coordinate: 20000,
    });
    assert.equal(resumed.status, 'completed');
    process = engine.getProcess('process-world', 'build-out');
    assert.equal(process.status, 'completed');
    assert.deepEqual(process.milestones.map((item) => item.status), ['completed', 'completed']);
    assert.equal(engine.getState('process-world').entities.find((entity) => entity.entity_id === 'walls').attributes.milestone, 'walls');
    assert.equal(engine.getEvents('process-world').filter((event) => event.event_type === 'action.completed').length, 2);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('process creation and lifecycle commands are idempotent and reject changed payloads', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  const created = createTwoMilestoneProcess(engine);
  const replay = engine.createProcess('process-world', {
    process_id: 'build-out',
    idempotency_key: 'create-build-out',
    expected_revision: 0,
    source_event_ids: [],
    milestones: [
      milestone('foundation', 10000, 'foundation', { interrupt_after_coordinate: true }),
      milestone('walls', 20000, 'walls', { dependencies: ['foundation'] }),
    ],
  });
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.process_id, created.process_id);

  const revision = engine.getState('process-world').world_revision;
  const cancelled = engine.cancelProcess('process-world', 'build-out', {
    idempotency_key: 'cancel-build-out',
    expected_revision: revision,
  });
  assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual(cancelled.milestones.map((item) => item.status), ['cancelled', 'cancelled']);
  assert.equal(engine.cancelProcess('process-world', 'build-out', {
    idempotency_key: 'cancel-build-out',
    expected_revision: revision,
  }).idempotent_replay, true);
  assert.throws(() => engine.cancelProcess('process-world', 'build-out', {
    idempotency_key: 'cancel-build-out',
    expected_revision: revision + 1,
  }), (error) => error.code === 'IDEMPOTENCY_CONFLICT');
  const afterCancel = engine.startTimeAdvance('process-world', {
    idempotency_key: 'advance-cancelled-process',
    expected_revision: engine.getState('process-world').world_revision,
    to_coordinate: 20000,
  });
  assert.equal(afterCancel.status, 'completed');
  assert.equal(engine.getState('process-world').entities.some((entity) => entity.entity_id === 'foundation'), false);
  assert.equal(engine.getState('process-world').entities.some((entity) => entity.entity_id === 'walls'), false);
});

test('paused process can be resumed with new durable trigger identities', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  engine.createProcess('process-world', {
    process_id: 'paused-process',
    idempotency_key: 'create-paused',
    expected_revision: 0,
    milestones: [milestone('stage-one', 10000, 'stage-one')],
  });
  const beforePause = engine.getState('process-world').world_revision;
  const paused = engine.pauseProcess('process-world', 'paused-process', {
    idempotency_key: 'pause-process',
    expected_revision: beforePause,
  });
  assert.equal(paused.status, 'paused');
  const oldTrigger = paused.milestones[0].trigger_id;
  const beforeResume = engine.getState('process-world').world_revision;
  const resumed = engine.resumeProcess('process-world', 'paused-process', {
    idempotency_key: 'resume-process',
    expected_revision: beforeResume,
  });
  assert.equal(resumed.status, 'scheduled');
  assert.notEqual(resumed.milestones[0].trigger_id, oldTrigger);
  const advanced = engine.startTimeAdvance('process-world', {
    idempotency_key: 'advance-resumed-process',
    expected_revision: engine.getState('process-world').world_revision,
    to_coordinate: 10000,
  });
  assert.equal(advanced.status, 'completed');
  assert.equal(engine.getProcess('process-world', 'paused-process').status, 'completed');
});

test('rollback sends causally affected milestones to review and preserves independent progress', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  engine.commitEvent('process-world', {
    idempotency_key: 'root-event-key',
    event_id: 'root-event',
    turn_id: 'root-turn',
    event_type: 'action.completed',
    expected_revision: engine.getState('process-world').world_revision,
    effects: [],
  });
  engine.createProcess('process-world', {
    process_id: 'causal-process',
    idempotency_key: 'create-causal',
    expected_revision: engine.getState('process-world').world_revision,
    source_event_ids: [],
    milestones: [
      milestone('dependent', 10000, 'dependent', { source_event_ids: ['root-event'] }),
      milestone('independent', 20000, 'independent'),
    ],
  });
  const advanced = engine.startTimeAdvance('process-world', {
    idempotency_key: 'advance-causal-process',
    expected_revision: engine.getState('process-world').world_revision,
    to_coordinate: 20000,
  });
  assert.equal(advanced.status, 'completed');
  assert.equal(engine.getProcess('process-world', 'causal-process').status, 'completed');

  const rollback = engine.rollbackEvent('process-world', {
    root_event_id: 'root-event',
    idempotency_key: 'rollback-root-event',
  });
  assert.equal(rollback.rollback_outcome, 'resolved');
  const process = engine.getProcess('process-world', 'causal-process');
  assert.equal(process.status, 'needs_review');
  assert.equal(process.milestones.find((item) => item.milestone_id === 'dependent').status, 'needs_review');
  assert.equal(process.milestones.find((item) => item.milestone_id === 'independent').status, 'completed');
  assert.equal(engine.getState('process-world').entities.some((entity) => entity.entity_id === 'dependent'), false);
  assert.equal(engine.getState('process-world').entities.find((entity) => entity.entity_id === 'independent').attributes.milestone, 'independent');
});

test('process completion does not publish mechanic recalculation, NPC knowledge, or player delivery', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  engine.createProcess('process-world', {
    process_id: 'boundary-process',
    idempotency_key: 'create-boundary-process',
    expected_revision: engine.getState('process-world').world_revision,
    milestones: [milestone('write-entity', 10000, 'boundary-entity')],
  });
  const result = engine.startTimeAdvance('process-world', {
    idempotency_key: 'advance-boundary-process',
    expected_revision: engine.getState('process-world').world_revision,
    to_coordinate: 10000,
  });
  assert.equal(result.status, 'completed');
  assert.equal(engine.getProcess('process-world', 'boundary-process').status, 'completed');
  const events = engine.getEvents('process-world');
  assert.equal(events.some((event) => event.effects.some((effect) => effect.kind.startsWith('mechanic.instance.'))), false);
  const tables = store.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name.toLowerCase());
  assert.equal(tables.some((name) => name.includes('knowledge') || name.includes('delivery') || name.includes('narration')), false);
});

test('failed milestone segment is atomic, enters review, and can be explicitly cancelled', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  engine.createProcess('process-world', {
    process_id: 'failed-process',
    idempotency_key: 'create-failed-process',
    expected_revision: engine.getState('process-world').world_revision,
    milestones: [milestone('will-fail', 10000, 'never-created')],
  });
  const originalCommitSegment = store.commitSegment;
  store.commitSegment = () => { throw new Error('injected segment failure'); };
  let result;
  try {
    result = engine.startTimeAdvance('process-world', {
      idempotency_key: 'advance-failed-process',
      expected_revision: engine.getState('process-world').world_revision,
      to_coordinate: 10000,
    });
  } finally {
    store.commitSegment = originalCommitSegment;
  }
  assert.equal(result.status, 'needs_review');
  assert.equal(engine.getState('process-world').game_time_coordinate, 0);
  assert.equal(engine.getState('process-world').entities.length, 0);
  let process = engine.getProcess('process-world', 'failed-process');
  assert.equal(process.status, 'needs_review');
  assert.equal(process.milestones[0].status, 'needs_review');

  const cancelled = engine.cancelProcess('process-world', 'failed-process', {
    idempotency_key: 'cancel-failed-process',
    expected_revision: engine.getState('process-world').world_revision,
  });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.milestones[0].status, 'cancelled');
});

test('processes are isolated by world and cross-world causal references are rejected', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  engine.createWorld({
    world_id: 'process-world-b',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2005-12-29T10:00:00.000Z',
  });
  engine.createProcess('process-world', {
    process_id: 'shared-process',
    idempotency_key: 'shared-create',
    expected_revision: engine.getState('process-world').world_revision,
    milestones: [milestone('stage', 10000, 'world-a-entity')],
  });
  engine.createProcess('process-world-b', {
    process_id: 'shared-process',
    idempotency_key: 'shared-create',
    expected_revision: engine.getState('process-world-b').world_revision,
    milestones: [milestone('stage', 10000, 'world-b-entity')],
  });
  const result = engine.startTimeAdvance('process-world', {
    idempotency_key: 'advance-only-world-a',
    expected_revision: engine.getState('process-world').world_revision,
    to_coordinate: 10000,
  });
  assert.equal(result.status, 'completed');
  assert.equal(engine.getProcess('process-world', 'shared-process').status, 'completed');
  assert.equal(engine.getProcess('process-world-b', 'shared-process').status, 'scheduled');
  assert.equal(engine.getState('process-world').entities.some((entity) => entity.entity_id === 'world-a-entity'), true);
  assert.equal(engine.getState('process-world-b').entities.some((entity) => entity.entity_id === 'world-b-entity'), false);

  engine.commitEvent('process-world-b', {
    idempotency_key: 'world-b-root-key',
    event_id: 'world-b-root',
    turn_id: 'world-b-root-turn',
    event_type: 'action.completed',
    expected_revision: engine.getState('process-world-b').world_revision,
    effects: [],
  });
  assert.throws(() => engine.createProcess('process-world', {
    process_id: 'bad-cross-world-source',
    idempotency_key: 'bad-cross-world-source-key',
    expected_revision: engine.getState('process-world').world_revision,
    milestones: [milestone('stage', 20000, 'bad-entity', { source_event_ids: ['world-b-root'] })],
  }), (error) => error.code === 'PROCESS_SOURCE_EVENT_NOT_VALID');
});

test('stale process creation and unresolved same-coordinate conflicts fail closed', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  engine.commitEvent('process-world', {
    idempotency_key: 'advance-revision-key',
    event_id: 'advance-revision-event',
    turn_id: 'advance-revision-turn',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [],
  });
  assert.throws(() => engine.createProcess('process-world', {
    process_id: 'stale-process',
    idempotency_key: 'stale-process-key',
    expected_revision: 0,
    milestones: [milestone('stage', 10000, 'stale-entity')],
  }), (error) => error.code === 'REVISION_CONFLICT');
  assert.equal(engine.listProcesses('process-world').length, 0);
  assert.equal(engine.listTimeTriggers('process-world').length, 0);

  engine.createProcess('process-world', {
    process_id: 'conflicting-process',
    idempotency_key: 'conflicting-process-key',
    expected_revision: engine.getState('process-world').world_revision,
    milestones: [
      milestone('writer-a', 10000, 'same-entity'),
      milestone('writer-b', 10000, 'same-entity'),
    ],
  });
  const before = engine.getState('process-world');
  const result = engine.startTimeAdvance('process-world', {
    idempotency_key: 'advance-conflicting-process',
    expected_revision: before.world_revision,
    to_coordinate: 10000,
  });
  assert.equal(result.status, 'blocked');
  assert.equal(engine.getState('process-world').game_time_coordinate, 0);
  assert.deepEqual(engine.getProcess('process-world', 'conflicting-process').milestones.map((item) => item.status), ['pending', 'pending']);
});
