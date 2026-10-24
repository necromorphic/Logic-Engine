import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';

function setup() {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  engine.createWorld({
    world_id: 'time-operation-world',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2005-12-29T10:00:00.000Z',
  });
  return { store, engine };
}

const trigger = (id, due, entityId, dependencies = []) => ({
  trigger_id: id,
  world_id: 'time-operation-world',
  due_coordinate: due,
  status: 'pending',
  dependencies,
  read_set: [],
  write_set: ['entity:' + entityId],
  payload: {
    event: {
      turn_id: 'trigger-turn-' + id,
      event_type: 'action.completed',
      effects: [{ kind: 'entity.upsert', entity_id: entityId, entity_type: 'object', attributes: { trigger_id: id } }],
    },
  },
});

test('time advance commits scheduled effects at due coordinates and reaches the requested target', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  const result = engine.startTimeAdvance('time-operation-world', {
    idempotency_key: 'advance-to-thirty-seconds',
    expected_revision: 0,
    to_coordinate: 30000,
    triggers: [trigger('at-ten', 10000, 'ten'), trigger('at-twenty', 20000, 'twenty')],
  });

  if (result.status !== 'completed') assert.fail('operation result: ' + JSON.stringify(result));
  assert.equal(result.status, 'completed');
  assert.equal(result.from_coordinate, 0);
  assert.equal(result.target_coordinate, 30000);
  assert.equal(result.confirmed_coordinate, 30000);
  assert.deepEqual(result.result.completed_trigger_ids, ['at-ten', 'at-twenty']);
  assert.equal(engine.getState('time-operation-world').game_time_coordinate, 30000);
  assert.deepEqual(
    engine.getEvents('time-operation-world').map((event) => [event.event_type, event.game_time_coordinate]),
    [
      ['time.advance', 10000],
      ['action.completed', 10000],
      ['time.advance', 20000],
      ['action.completed', 20000],
      ['time.advance', 30000],
    ],
  );
});

test('time advance idempotency replays the same operation after world revision changes', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  const request = {
    idempotency_key: 'repeatable-advance',
    expected_revision: 0,
    to_coordinate: 60000,
    triggers: [],
  };
  const first = engine.startTimeAdvance('time-operation-world', request);
  const replay = engine.startTimeAdvance('time-operation-world', request);

  assert.equal(first.operation_id, replay.operation_id);
  if (replay.status !== 'completed') assert.fail('replay result: ' + JSON.stringify(replay));
  assert.equal(replay.status, 'completed');
  assert.equal(engine.getState('time-operation-world').game_time_coordinate, 60000);
  assert.equal(engine.getEvents('time-operation-world').length, 1);
});

test('blocked due work creates an explicit blocked operation without advancing time', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  const result = engine.startTimeAdvance('time-operation-world', {
    idempotency_key: 'blocked-advance',
    expected_revision: 0,
    to_coordinate: 30000,
    triggers: [trigger('needs-missing', 10000, 'blocked', ['missing-trigger'])],
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.confirmed_coordinate, 0);
  assert.equal(result.plan.blocked[0].reason, 'missing_dependency');
  assert.equal(engine.getState('time-operation-world').game_time_coordinate, 0);
  assert.equal(engine.getEvents('time-operation-world').length, 0);
});

test('time advance rejects sub-second execution rather than rounding a due boundary', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  assert.throws(
    () => engine.startTimeAdvance('time-operation-world', {
      idempotency_key: 'subsecond-advance',
      expected_revision: 0,
      to_coordinate: 1500,
      triggers: [],
    }),
    (error) => error.code === 'TIME_ADVANCE_SUBSECOND_UNSUPPORTED',
  );
  assert.equal(engine.getState('time-operation-world').game_time_coordinate, 0);
});

test('recovery resumes after the last persisted segment checkpoint without replaying it', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-engine-time-advance-recovery-'));
  const path = join(directory, 'state.sqlite');
  let store = new SQLiteStore(path);
  let engine = new LogicEngine(store);
  engine.createWorld({
    world_id: 'recovery-world',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2005-12-29T10:00:00.000Z',
  });
  t.after(() => {
    store?.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const makeEvent = (index) => engine.prepareEvent({
    event_id: 'recovery-time-event-' + index,
    idempotency_key: 'recovery-time-key-' + index,
    turn_id: 'recovery-time-turn-' + index,
    event_type: 'time.advance',
    time_advance_seconds: 10,
    time_mode: 'explicit_skip',
    effects: [],
  });
  const segments = [1, 2].map((index) => ({
    coordinate: index * 10000,
    idempotency_key: 'recovery-segment-key-' + index,
    request_hash: 'recovery-segment-hash-' + index,
    events: [makeEvent(index)],
  }));
  store.createTimeAdvanceOperation({
    world_id: 'recovery-world',
    operation_id: 'recovery-operation',
    idempotency_key: 'recovery-operation-key',
    request_hash: 'recovery-operation-hash',
    from_coordinate: 0,
    target_coordinate: 20000,
    starting_world_revision: 0,
    status: 'running',
    segments,
    plan: { status: 'planned', completed_trigger_ids: [] },
  });

  store.commitSegment('recovery-world', segments[0].events, segments[0].idempotency_key,
    segments[0].request_hash, 0, 0);
  store.db.prepare(`UPDATE time_advance_operations SET next_segment_index=1,
    confirmed_coordinate=10000,current_world_revision=1 WHERE world_id=? AND operation_id=?`)
    .run('recovery-world', 'recovery-operation');
  store.close();

  store = new SQLiteStore(path);
  engine = new LogicEngine(store);
  const recovered = engine.resumeTimeAdvance('recovery-world', 'recovery-operation');
  assert.equal(recovered.status, 'completed');
  assert.equal(recovered.confirmed_coordinate, 20000);
  assert.equal(engine.getState('recovery-world').game_time_coordinate, 20000);
  assert.deepEqual(engine.getEvents('recovery-world').map((event) => event.event_id), [
    'recovery-time-event-1', 'recovery-time-event-2',
  ]);
  assert.equal(store.db.prepare('SELECT next_segment_index FROM time_advance_operations WHERE operation_id=?')
    .get('recovery-operation').next_segment_index, 2);
});


test('durable triggers are claimed and completed with their segment and cannot execute in a second operation', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  const registered = engine.registerTimeTrigger('time-operation-world', {
    trigger_id: 'durable-at-ten',
    due_coordinate: 10000,
    dependencies: [],
    read_set: [],
    write_set: ['entity:durable-ten'],
    processing_mode: 'exact',
    interrupt_after_coordinate: false,
    payload: {
      event: {
        turn_id: 'durable-trigger-turn',
        event_type: 'action.completed',
        effects: [{ kind: 'entity.upsert', entity_id: 'durable-ten', entity_type: 'object' }],
      },
    },
  });
  assert.equal(registered.status, 'pending');
  assert.equal(engine.getState('time-operation-world').world_revision, 1);

  const firstRequest = {
    idempotency_key: 'registry-advance-one',
    expected_revision: 1,
    to_coordinate: 10000,
  };
  const first = engine.startTimeAdvance('time-operation-world', firstRequest);
  assert.equal(first.status, 'completed');
  assert.deepEqual(first.result.completed_trigger_ids, ['durable-at-ten']);
  const afterFirst = engine.listTimeTriggers('time-operation-world').find((item) => item.trigger_id === 'durable-at-ten');
  assert.equal(afterFirst.status, 'completed');
  assert.equal(afterFirst.claimed_operation_id, null);
  assert.equal(afterFirst.completed_operation_id, first.operation_id);
  assert.equal(engine.getAudit('time-operation-world').some((entry) => entry.action === 'time.trigger.completed'
    && entry.target_id === 'durable-at-ten'), true);

  const replay = engine.startTimeAdvance('time-operation-world', firstRequest);
  assert.equal(replay.operation_id, first.operation_id);
  assert.equal(replay.status, 'completed');

  const second = engine.startTimeAdvance('time-operation-world', {
    idempotency_key: 'registry-advance-two',
    expected_revision: engine.getState('time-operation-world').world_revision,
    to_coordinate: 20000,
  });
  assert.equal(second.status, 'completed');
  assert.equal(engine.getEvents('time-operation-world').filter((item) => item.event_type === 'action.completed').length, 1);
  assert.equal(engine.getState('time-operation-world').game_time_coordinate, 20000);
});

test('failed durable trigger execution remains claimed for review and cannot be silently cancelled', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  engine.commitEvent('time-operation-world', {
    idempotency_key: 'existing-entity-key',
    turn_id: 'existing-entity-turn',
    event_type: 'action.completed',
    effects: [{ kind: 'entity.create', entity_id: 'occupied', entity_type: 'object' }],
  });
  const revision = engine.getState('time-operation-world').world_revision;
  engine.registerTimeTrigger('time-operation-world', {
    trigger_id: 'durable-failure',
    due_coordinate: 10000,
    dependencies: [],
    read_set: [],
    write_set: ['entity:occupied'],
    payload: {
      event: {
        turn_id: 'durable-failure-turn',
        event_type: 'action.completed',
        effects: [{ kind: 'entity.create', entity_id: 'occupied', entity_type: 'object' }],
      },
    },
  });

  const operation = engine.startTimeAdvance('time-operation-world', {
    idempotency_key: 'durable-failure-advance',
    expected_revision: revision + 1,
    to_coordinate: 10000,
  });
  assert.equal(operation.status, 'needs_review');
  assert.equal(engine.getState('time-operation-world').game_time_coordinate, 0);
  const trigger = engine.listTimeTriggers('time-operation-world').find((item) => item.trigger_id === 'durable-failure');
  assert.equal(trigger.status, 'pending');
  assert.equal(trigger.claimed_operation_id, operation.operation_id);
  assert.throws(
    () => engine.cancelTimeTrigger('time-operation-world', 'durable-failure'),
    (error) => error.code === 'TIME_TRIGGER_CLAIMED',
  );
});

test('durable trigger registration rejects deadlines at or before current time and cancellation is audited', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  assert.throws(
    () => engine.registerTimeTrigger('time-operation-world', {
      trigger_id: 'already-due',
      due_coordinate: 0,
      payload: { event: { turn_id: 'unused', event_type: 'action.completed', effects: [] } },
    }),
    (error) => error.code === 'TIME_TRIGGER_NOT_FUTURE',
  );
  const registered = engine.registerTimeTrigger('time-operation-world', {
    trigger_id: 'cancel-me',
    due_coordinate: 10000,
    payload: { event: { turn_id: 'cancel-turn', event_type: 'action.completed', effects: [] } },
  });
  const cancelled = engine.cancelTimeTrigger('time-operation-world', registered.trigger_id);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(engine.getAudit('time-operation-world').some((entry) => entry.action === 'time.trigger.cancelled'
    && entry.target_id === 'cancel-me'), true);
  assert.equal(engine.cancelTimeTrigger('time-operation-world', registered.trigger_id).status, 'cancelled');
});
