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
  if (!engine.listWorlds().some((world) => world.world_id === 'process-world')) {
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
    assert.equal(engine.getState('process-world').entities.foundation.attributes.milestone, 'foundation');
    assert.equal(engine.getState('process-world').entities.walls, undefined);

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
    assert.equal(engine.getState('process-world').entities.walls.attributes.milestone, 'walls');
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
  assert.equal(engine.getState('process-world').entities.foundation, undefined);
  assert.equal(engine.getState('process-world').entities.walls, undefined);
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
  assert.equal(engine.getState('process-world').entities.dependent, undefined);
  assert.equal(engine.getState('process-world').entities.independent.attributes.milestone, 'independent');
});
