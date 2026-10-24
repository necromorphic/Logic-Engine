import test from 'node:test';
import assert from 'node:assert/strict';
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
