import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';

function setup() {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  engine.createWorld({
    world_id: 'segment-world',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2005-12-29T10:00:00.000Z',
  });
  return { store, engine };
}

function event(overrides = {}) {
  return {
    idempotency_key: 'segment-key-1',
    event_id: 'segment-event-1',
    turn_id: 'segment-turn-1',
    event_type: 'action.completed',
    expected_revision: 0,
    time_advance_seconds: 60,
    effects: [],
    caused_by: [],
    depends_on: [],
    read_set: [],
    ...overrides,
  };
}

test('outer SQLite transaction can atomically roll back multiple nested event commits', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  const first = event({
    idempotency_key: 'segment-key-1',
    event_id: 'segment-event-1',
    expected_revision: 0,
    time_advance_seconds: 60,
  });
  const second = event({
    idempotency_key: 'segment-key-2',
    event_id: 'segment-event-2',
    turn_id: 'segment-turn-2',
    expected_revision: 1,
    time_advance_seconds: 120,
  });

  assert.throws(() => store.tx(() => {
    const a = engine.commitEvent('segment-world', first);
    const b = engine.commitEvent('segment-world', second);
    assert.equal(a.world_revision, 1);
    assert.equal(b.world_revision, 2);
    throw new Error('simulate failure before segment confirmation');
  }), /simulate failure/);

  const afterRollback = engine.getState('segment-world');
  assert.equal(afterRollback.world_revision, 0);
  assert.equal(afterRollback.game_time, '2005-12-29T10:00:00.000Z');
  assert.equal(engine.getEvents('segment-world').length, 0);

  // Reusing the same keys after outer rollback must perform real commits,
  // proving that nested idempotency results were rolled back with the segment.
  const committedFirst = engine.commitEvent('segment-world', first);
  const committedSecond = engine.commitEvent('segment-world', second);
  assert.equal(committedFirst.idempotent_replay, false);
  assert.equal(committedSecond.idempotent_replay, false);
  assert.equal(committedSecond.world_revision, 2);
  assert.equal(committedSecond.game_time, '2005-12-29T10:03:00.000Z');
  assert.equal(engine.getEvents('segment-world').length, 2);
});

test('outer SQLite transaction publishes the complete segment with per-event history', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  const first = event({
    idempotency_key: 'success-segment-key-1',
    event_id: 'success-segment-event-1',
    turn_id: 'success-segment-turn-1',
    expected_revision: 0,
    time_advance_seconds: 60,
  });
  const second = event({
    idempotency_key: 'success-segment-key-2',
    event_id: 'success-segment-event-2',
    turn_id: 'success-segment-turn-2',
    expected_revision: 1,
    time_advance_seconds: 120,
  });

  const result = store.tx(() => ({
    first: engine.commitEvent('segment-world', first),
    second: engine.commitEvent('segment-world', second),
  }));

  assert.equal(result.first.world_revision, 1);
  assert.equal(result.second.world_revision, 2);
  assert.equal(engine.getState('segment-world').world_revision, 2);
  assert.equal(engine.getState('segment-world').game_time, '2005-12-29T10:03:00.000Z');
  assert.equal(engine.getEvents('segment-world').length, 2);

  const replayFirst = engine.commitEvent('segment-world', first);
  const replaySecond = engine.commitEvent('segment-world', second);
  assert.equal(replayFirst.idempotent_replay, true);
  assert.equal(replaySecond.idempotent_replay, true);
  assert.equal(engine.getEvents('segment-world').length, 2);
  assert.equal(engine.getState('segment-world').world_revision, 2);
});
