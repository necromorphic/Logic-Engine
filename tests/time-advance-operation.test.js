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
  engine.registerTimeTrigger('time-operation-world', trigger('at-ten', 10000, 'ten'));
  engine.registerTimeTrigger('time-operation-world', trigger('at-twenty', 20000, 'twenty'));
  const result = engine.startTimeAdvance('time-operation-world', {
    idempotency_key: 'advance-to-thirty-seconds',
    expected_revision: 0,
    to_coordinate: 30000,
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
  engine.registerTimeTrigger('time-operation-world', trigger('needs-missing', 10000, 'blocked', ['missing-trigger']));
  const result = engine.startTimeAdvance('time-operation-world', {
    idempotency_key: 'blocked-advance',
    expected_revision: 0,
    to_coordinate: 30000,
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
    }),
    (error) => error.code === 'TIME_ADVANCE_SUBSECOND_UNSUPPORTED',
  );
  assert.equal(engine.getState('time-operation-world').game_time_coordinate, 0);
});

test('completed triggers are durable and cannot be replayed by a different advance operation', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  engine.registerTimeTrigger('time-operation-world', trigger('one-shot', 10000, 'one-shot-entity'));
  const first = engine.startTimeAdvance('time-operation-world', {
    idempotency_key: 'one-shot-first-advance', expected_revision: 0, to_coordinate: 20000,
  });
  assert.equal(first.status, 'completed');
  assert.deepEqual(first.result.completed_trigger_ids, ['one-shot']);
  const registered = engine.listTimeTriggers('time-operation-world');
  assert.equal(registered[0].status, 'completed');
  assert.equal(registered[0].completed_by_operation_id, first.operation_id);
  assert.equal(registered[0].completed_coordinate, 10000);

  const second = engine.startTimeAdvance('time-operation-world', {
    idempotency_key: 'one-shot-second-advance', expected_revision: engine.getState('time-operation-world').world_revision, to_coordinate: 30000,
  });
  assert.equal(second.status, 'completed');
  assert.deepEqual(second.result.completed_trigger_ids, []);
  assert.equal(engine.getEvents('time-operation-world').filter((event) => event.event_type === 'action.completed').length, 1);
  assert.equal(engine.getState('time-operation-world').game_time_coordinate, 30000);
});

test('trigger definitions are immutable and cancellation is terminal', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  const original = trigger('immutable-trigger', 10000, 'immutable-entity');
  engine.registerTimeTrigger('time-operation-world', original);
  assert.equal(engine.registerTimeTrigger('time-operation-world', original).idempotent_replay, true);
  assert.throws(
    () => engine.registerTimeTrigger('time-operation-world', trigger('immutable-trigger', 20000, 'immutable-entity')),
    (error) => error.code === 'TIME_TRIGGER_IMMUTABLE',
  );
  const cancelled = engine.cancelTimeTrigger('time-operation-world', 'immutable-trigger', 'author removed it');
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.cancellation_reason, 'author removed it');
  assert.equal(engine.cancelTimeTrigger('time-operation-world', 'immutable-trigger').status, 'cancelled');
  assert.throws(
    () => engine.startTimeAdvance('time-operation-world', { idempotency_key: 'cancelled-trigger-advance', expected_revision: 0, to_coordinate: 20000, triggers: [original] }),
    (error) => error.code === 'UNSUPPORTED_TIME_ADVANCE_FIELD',
  );
});

test('trigger registration cannot insert work into an active advance interval', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());
  store.createTimeAdvanceOperation({
    world_id: 'time-operation-world',
    operation_id: 'active-advance',
    idempotency_key: 'active-advance-key',
    request_hash: 'active-advance-hash',
    from_coordinate: 0,
    target_coordinate: 30000,
    starting_world_revision: 0,
    status: 'running',
    segments: [{ coordinate: 30000, idempotency_key: 'active-segment-key', request_hash: 'active-segment-hash', events: [engine.prepareEvent({
      event_id: 'active-segment-event', idempotency_key: 'active-segment-event-key', turn_id: 'active-segment-turn',
      event_type: 'time.advance', time_advance_seconds: 30, time_mode: 'explicit_skip', effects: [],
    })] }],
    plan: { status: 'planned', completed_trigger_ids: [] },
  });
  assert.throws(
    () => engine.registerTimeTrigger('time-operation-world', trigger('late-trigger', 20000, 'late-entity')),
    (error) => error.code === 'TIME_TRIGGER_OVERLAPS_ACTIVE_ADVANCE',
  );
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
