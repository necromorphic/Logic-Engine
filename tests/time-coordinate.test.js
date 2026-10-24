import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';

function setup() {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  engine.createWorld({
    world_id: 'coordinate-world',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2005-12-29T10:00:00.123Z',
  });
  return { store, engine };
}

const command = (overrides = {}) => ({
  idempotency_key: 'coordinate-key',
  turn_id: 'coordinate-turn',
  event_type: 'action.completed',
  expected_revision: 0,
  effects: [],
  caused_by: [],
  depends_on: [],
  read_set: [],
  ...overrides,
});

test('new worlds start at coordinate zero and commits advance canonical time in milliseconds', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  const before = engine.getState('coordinate-world');
  assert.equal(before.initial_game_time_coordinate, 0);
  assert.equal(before.game_time_coordinate, 0);
  assert.equal(before.game_time, '2005-12-29T10:00:00.123Z');

  const committed = engine.commitEvent('coordinate-world', command({ time_advance_seconds: 300 }));
  assert.equal(committed.game_time_coordinate, 300000);
  assert.equal(committed.game_time, '2005-12-29T10:05:00.123Z');

  const state = engine.getState('coordinate-world');
  assert.equal(state.game_time_coordinate, 300000);
  const event = engine.getEvents('coordinate-world')[0];
  assert.equal(event.game_time_coordinate, 300000);
  assert.equal(event.time_advance_seconds, 300);
  assert.equal(event.time_advance_ms, 300000);

  const audit = engine.getAudit('coordinate-world').find((entry) => entry.action === 'event.committed');
  assert.equal(audit.payload.game_time_coordinate, 300000);
  assert.equal(audit.payload.time_advance_ms, 300000);
});

test('idempotent replay does not advance the canonical coordinate twice', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  const request = command({ time_advance_seconds: 60 });
  const first = engine.commitEvent('coordinate-world', request);
  const replay = engine.commitEvent('coordinate-world', request);

  assert.equal(first.game_time_coordinate, 60000);
  assert.equal(replay.game_time_coordinate, 60000);
  assert.equal(replay.idempotent_replay, true);
  assert.equal(engine.getState('coordinate-world').game_time_coordinate, 60000);
  assert.equal(engine.getEvents('coordinate-world').length, 1);
});

test('coordinate overflow rejects the commit without event, revision, or time mutation', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  store.db.prepare('UPDATE worlds SET game_time_coordinate=? WHERE world_id=?')
    .run(Number.MAX_SAFE_INTEGER - 500, 'coordinate-world');

  assert.throws(
    () => engine.commitEvent('coordinate-world', command({ time_advance_seconds: 1 })),
    (error) => error.code === 'TIME_COORDINATE_OVERFLOW',
  );
  assert.equal(engine.getState('coordinate-world').world_revision, 0);
  assert.equal(engine.getState('coordinate-world').game_time_coordinate, Number.MAX_SAFE_INTEGER - 500);
  assert.equal(engine.getEvents('coordinate-world', true).length, 0);
  assert.equal(engine.getAudit('coordinate-world').length, 1);
});


test('rollback restores effects but never rewinds the canonical time coordinate', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  engine.commitEvent('coordinate-world', command({
    event_id: 'coordinate-rollback-root',
    idempotency_key: 'coordinate-rollback-root-key',
    time_advance_seconds: 60,
    effects: [{ kind: 'entity.upsert', entity_id: 'rollback-target', entity_type: 'object' }],
  }));
  const beforeRollback = engine.getState('coordinate-world');
  const result = engine.rollbackEvent('coordinate-world', {
    root_event_id: 'coordinate-rollback-root',
    idempotency_key: 'coordinate-rollback-key',
  });
  const afterRollback = engine.getState('coordinate-world');

  assert.equal(result.accepted, true);
  assert.equal(afterRollback.game_time_coordinate, beforeRollback.game_time_coordinate);
  assert.equal(afterRollback.game_time, beforeRollback.game_time);
  assert.equal(afterRollback.world_revision, beforeRollback.world_revision + 1);
  assert.equal(afterRollback.entities.length, 0);
});
