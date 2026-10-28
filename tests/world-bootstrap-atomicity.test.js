import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';

function newStore() {
  const store = new SQLiteStore(':memory:');
  return { store, engine: new LogicEngine(store) };
}

function createWorld(engine, worldId) {
  return engine.createWorld({
    world_id: worldId,
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2005-12-29T10:00:00Z',
  });
}

function seedEvent(engine, worldId, eventId, expectedRevision) {
  return engine.commitEvent(worldId, {
    event_id: eventId,
    idempotency_key: eventId,
    turn_id: 'bootstrap-' + eventId,
    event_type: 'action.completed',
    expected_revision: expectedRevision,
    effects: [{
      kind: 'entity.upsert',
      entity_id: 'entity-' + eventId,
      entity_type: 'object',
      attributes: { bootstrap: true },
    }],
    caused_by: [],
    depends_on: [],
    read_set: [],
  });
}

test('world bootstrap rolls back world, audit, and committed events as one unit', (t) => {
  const { store, engine } = newStore();
  t.after(() => store.close());

  assert.throws(() => store.tx(() => {
    createWorld(engine, 'bootstrap-rollback-world');
    seedEvent(engine, 'bootstrap-rollback-world', 'bootstrap-event-1', 0);
    seedEvent(engine, 'bootstrap-rollback-world', 'bootstrap-event-2', 1);
    throw new Error('simulated bootstrap failure');
  }), /simulated bootstrap failure/);

  assert.equal(store.world('bootstrap-rollback-world'), undefined);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM audit_entries WHERE world_id=?')
    .get('bootstrap-rollback-world').count, 0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM world_events WHERE world_id=?')
    .get('bootstrap-rollback-world').count, 0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM entities WHERE world_id=?')
    .get('bootstrap-rollback-world').count, 0);
});

test('world bootstrap commits world, audit, events, and projections together', (t) => {
  const { store, engine } = newStore();
  t.after(() => store.close());

  store.tx(() => {
    createWorld(engine, 'bootstrap-success-world');
    seedEvent(engine, 'bootstrap-success-world', 'bootstrap-event-1', 0);
    seedEvent(engine, 'bootstrap-success-world', 'bootstrap-event-2', 1);
  });

  assert.ok(store.world('bootstrap-success-world'));
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM audit_entries WHERE world_id=?')
    .get('bootstrap-success-world').count, 3);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM world_events WHERE world_id=? AND validity=?')
    .get('bootstrap-success-world', 'valid').count, 2);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM entities WHERE world_id=?')
    .get('bootstrap-success-world').count, 2);
  assert.equal(engine.getState('bootstrap-success-world').world_revision, 2);
});
