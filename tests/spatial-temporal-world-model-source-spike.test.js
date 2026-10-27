import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';

function setup(t, worldId = 'spatial-world') {
  const directory = mkdtempSync(join(tmpdir(), 'logic-engine-spatial-source-'));
  const databasePath = join(directory, 'world.sqlite');
  let store = new SQLiteStore(databasePath);
  let engine = new LogicEngine(store);
  engine.createWorld({
    world_id: worldId,
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2005-12-29T10:00:00.000Z',
  });
  t.after(() => {
    try { store.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    databasePath,
    get store() { return store; },
    get engine() { return engine; },
    reopen() {
      store.close();
      store = new SQLiteStore(databasePath);
      engine = new LogicEngine(store);
      return engine;
    },
  };
}

function commit(engine, worldId, eventId, effects = []) {
  const state = engine.getState(worldId);
  return engine.commitEvent(worldId, {
    event_id: eventId,
    idempotency_key: 'key-' + eventId,
    turn_id: 'turn-' + eventId,
    event_type: 'action.completed',
    expected_revision: state.world_revision,
    effects,
    caused_by: [],
    depends_on: [],
    read_set: [],
    causal_links: [],
  });
}

function marker(state) {
  return {
    world_id: state.world_id,
    world_revision: state.world_revision,
    commit_sequence: state.commit_sequence,
    game_time_coordinate: state.game_time_coordinate,
  };
}

// Test-only reader: intentionally uses only the existing Core application methods.
function readStableSource(engine, worldId) {
  const before = engine.getState(worldId);
  const events = engine.getEvents(worldId, false);
  const after = engine.getState(worldId);
  assert.deepEqual(marker(after), marker(before), 'SPATIAL_SOURCE_STALE');
  let priorSequence = 0;
  for (const event of events) {
    assert.equal(event.validity, 'valid');
    assert.ok(Number.isSafeInteger(event.commit_sequence)
      && event.commit_sequence > priorSequence
      && event.commit_sequence <= after.commit_sequence,
    'valid events must have a unique, strictly increasing Core commit sequence no greater than the snapshot cursor');
    priorSequence = event.commit_sequence;
  }
  return { marker: marker(after), state: after, events };
}

function replayEvidence(source) {
  // No spatial interpretation is implied: this is only a deterministic source-order oracle.
  return source.events.map((event) => ({
    event_id: event.event_id,
    commit_sequence: event.commit_sequence,
    game_time_coordinate: event.game_time_coordinate,
    effects: event.effects,
  }));
}

function assertCurrent(engine, worldId, source) {
  assert.deepEqual(marker(engine.getState(worldId)), source.marker, 'SPATIAL_PROJECTION_STALE');
}

test('existing Core source methods provide stable, ordered, world-scoped committed input', (t) => {
  const s = setup(t, 'world-a');
  s.engine.createWorld({
    world_id: 'world-b',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2005-12-29T10:00:00.000Z',
  });
  commit(s.engine, 'world-a', 'a-first', [
    { kind: 'entity.upsert', entity_id: 'shared-id', entity_type: 'object', attributes: { note: 'world-a only' } },
  ]);
  commit(s.engine, 'world-a', 'a-second', [
    { kind: 'entity.upsert', entity_id: 'a-only', entity_type: 'object' },
  ]);
  commit(s.engine, 'world-b', 'b-first', [
    { kind: 'entity.upsert', entity_id: 'shared-id', entity_type: 'object', attributes: { note: 'world-b only' } },
  ]);

  const a = readStableSource(s.engine, 'world-a');
  const b = readStableSource(s.engine, 'world-b');
  assert.deepEqual(a.events.map((event) => event.event_id), ['a-first', 'a-second']);
  assert.deepEqual(b.events.map((event) => event.event_id), ['b-first']);
  assert.equal(a.marker.world_id, 'world-a');
  assert.equal(b.marker.world_id, 'world-b');
  assert.equal(a.marker.game_time_coordinate, b.marker.game_time_coordinate);
  assert.ok(a.events[0].commit_sequence < a.events[1].commit_sequence);
});

test('a Core mutation between state and event reads rejects the entire source batch', (t) => {
  const s = setup(t);
  commit(s.engine, 'spatial-world', 'initial-event');
  const originalGetEvents = s.engine.getEvents.bind(s.engine);
  let mutated = false;
  s.engine.getEvents = (worldId, includeInvalid = false) => {
    const result = originalGetEvents(worldId, includeInvalid);
    if (!mutated) {
      mutated = true;
      commit(s.engine, worldId, 'concurrent-event');
    }
    return result;
  };

  assert.throws(() => readStableSource(s.engine, 'spatial-world'), /SPATIAL_SOURCE_STALE/);
  s.engine.getEvents = originalGetEvents;
  assert.deepEqual(readStableSource(s.engine, 'spatial-world').events.map((event) => event.event_id),
    ['initial-event', 'concurrent-event']);
});

test('rollback invalidates a built source even when commit sequence and game time do not advance', (t) => {
  const s = setup(t);
  commit(s.engine, 'spatial-world', 'rollback-root', [
    { kind: 'entity.upsert', entity_id: 'target', entity_type: 'object' },
  ]);
  const before = readStableSource(s.engine, 'spatial-world');
  const rollback = s.engine.rollbackEvent('spatial-world', {
    root_event_id: 'rollback-root',
    idempotency_key: 'spatial-rollback',
  });
  const after = readStableSource(s.engine, 'spatial-world');

  assert.ok(rollback.invalidated_event_ids.includes('rollback-root'));
  assert.equal(after.marker.commit_sequence, before.marker.commit_sequence);
  assert.equal(after.marker.game_time_coordinate, before.marker.game_time_coordinate);
  assert.ok(after.marker.world_revision > before.marker.world_revision);
  assert.notDeepEqual(after.marker, before.marker);
  assert.throws(() => assertCurrent(s.engine, 'spatial-world', before), /SPATIAL_PROJECTION_STALE/);
  assert.deepEqual(after.events, []);
});

test('in-memory replay is deterministic and writes nothing to canonical Core state', (t) => {
  const s = setup(t);
  commit(s.engine, 'spatial-world', 'same-time-a', [
    { kind: 'entity.upsert', entity_id: 'a', entity_type: 'object', attributes: { location: null } },
  ]);
  commit(s.engine, 'spatial-world', 'same-time-b', [
    { kind: 'entity.upsert', entity_id: 'b', entity_type: 'object' },
  ]);
  const before = s.engine.getState('spatial-world');
  const source1 = readStableSource(s.engine, 'spatial-world');
  const projection1 = replayEvidence(source1);
  const source2 = readStableSource(s.engine, 'spatial-world');
  const projection2 = replayEvidence(source2);

  assert.deepEqual(projection2, projection1);
  assert.deepEqual(projection1.map((event) => event.event_id), ['same-time-a', 'same-time-b']);
  assert.equal(projection1[0].game_time_coordinate, projection1[1].game_time_coordinate);
  assert.deepEqual(s.engine.getState('spatial-world'), before);
  // Missing or null spatial evidence remains unresolved; this spike does not infer coordinates.
  assert.equal(source1.state.entities.find((entity) => entity.entity_id === 'a').attributes.location, null);
});

test('restart discards the derived view and reconstructs the same evidence from Core', (t) => {
  const s = setup(t);
  commit(s.engine, 'spatial-world', 'restart-a', [
    { kind: 'entity.upsert', entity_id: 'a', entity_type: 'object' },
  ]);
  commit(s.engine, 'spatial-world', 'restart-b', [
    { kind: 'entity.upsert', entity_id: 'b', entity_type: 'object' },
  ]);
  const before = replayEvidence(readStableSource(s.engine, 'spatial-world'));
  const reopened = s.reopen();
  const afterSource = readStableSource(reopened, 'spatial-world');
  assert.deepEqual(replayEvidence(afterSource), before);
  assert.deepEqual(afterSource.events.map((event) => event.event_id), ['restart-a', 'restart-b']);
});
