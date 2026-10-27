/**
 * Disposable Spatial/Temporal feasibility spike.
 *
 * IMPORTANT:
 * - This file is test-only and uses a synthetic fixture convention:
 *   attributes.position = { x, y, z } in abstract logical units.
 * - That convention is NOT a production Core spatial source or schema.
 * - The tests validate read/replay/freshness mechanics only. They do not
 *   establish typed spatial provenance, movement semantics, or NPC knowledge.
 * - No production runtime, API, schema, event vocabulary, or persistence changes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';

function setup(worldId = 'spatial-spike-world') {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  engine.createWorld({
    world_id: worldId,
    world_pack_id: 'test.spatial-spike',
    world_pack_version: '1.0.0',
    game_time: '2005-12-29T10:00:00.000Z',
  });
  return { store, engine, worldId };
}

function commit(engine, worldId, eventId, effects, overrides = {}) {
  const state = engine.getState(worldId);
  return engine.commitEvent(worldId, {
    event_id: eventId,
    idempotency_key: 'key-' + eventId,
    turn_id: 'turn-' + eventId,
    event_type: 'action.completed',
    expected_revision: state.world_revision,
    time_advance_seconds: 0,
    effects,
    caused_by: [],
    depends_on: [],
    read_set: [],
    causal_links: [],
    ...overrides,
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

function parseFixturePosition(attributes) {
  if (!attributes || !Object.hasOwn(attributes, 'position')) {
    return { status: 'unknown' };
  }
  const p = attributes.position;
  if (!p || typeof p !== 'object' || Array.isArray(p)
    || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)
    || Object.keys(p).some((key) => !['x', 'y', 'z'].includes(key))) {
    return { status: 'unsupported' };
  }
  return { status: 'fixture-supported', position: { x: p.x, y: p.y, z: p.z } };
}

/**
 * Test-only derived projection. It deliberately consumes only committed
 * event effects and refuses if the before/after state markers differ.
 */
function rebuildFixtureProjection(worldId, readState, readEvents) {
  const before = readState(worldId);
  const events = readEvents(worldId, false);
  const after = readState(worldId);
  const beforeMarker = marker(before);
  const afterMarker = marker(after);

  if (JSON.stringify(beforeMarker) !== JSON.stringify(afterMarker)) {
    return { status: 'stale', before: beforeMarker, after: afterMarker, positions: {} };
  }

  const entities = new Map();
  let lastSequence = 0;
  for (const event of events) {
    if (event.validity !== 'valid' || !Number.isSafeInteger(event.commit_sequence)
      || event.commit_sequence <= lastSequence || event.commit_sequence > before.commit_sequence
      || !Array.isArray(event.effects)) {
      return { status: 'unsupported-history', marker: beforeMarker, positions: {} };
    }
    lastSequence = event.commit_sequence;
    for (const effect of event.effects) {
      if (effect.kind === 'entity.upsert' || effect.kind === 'entity.create') {
        entities.set(effect.entity_id, {
          entity_id: effect.entity_id,
          attributes: effect.attributes ?? {},
        });
      } else if (effect.kind === 'entity.delete') {
        entities.delete(effect.entity_id);
      } else if (effect.kind === 'entity.update') {
        const existing = entities.get(effect.entity_id);
        if (!existing) return { status: 'unsupported-history', marker: beforeMarker, positions: {} };
        const attributes = { ...existing.attributes, ...(effect.attributes ?? {}) };
        for (const key of effect.remove_attributes ?? []) delete attributes[key];
        entities.set(effect.entity_id, { ...existing, attributes });
      } else {
        return { status: 'unsupported-history', marker: beforeMarker, positions: {} };
      }
    }
  }

  const positions = {};
  for (const [entityId, entity] of entities) {
    positions[entityId] = parseFixturePosition(entity.attributes);
  }
  return { status: 'ok', marker: beforeMarker, positions };
}

function project(engine, worldId) {
  return rebuildFixtureProjection(
    worldId,
    (id) => engine.getState(id),
    (id, includeInvalid) => engine.getEvents(id, includeInvalid),
  );
}

test('committed fixture effects rebuild deterministically at the same composite cursor', (t) => {
  const { store, engine, worldId } = setup();
  t.after(() => store.close());

  commit(engine, worldId, 'position-seed', [{
    kind: 'entity.upsert',
    entity_id: 'npc-a',
    entity_type: 'character',
    attributes: { position: { x: 0, y: 2, z: 1 } },
  }]);
  commit(engine, worldId, 'position-change', [{
    kind: 'entity.upsert',
    entity_id: 'npc-a',
    entity_type: 'character',
    attributes: { position: { x: 5, y: 2, z: 1 } },
  }]);

  const first = project(engine, worldId);
  const second = project(engine, worldId);
  assert.equal(first.status, 'ok');
  assert.deepEqual(first, second);
  assert.deepEqual(first.positions['npc-a'], {
    status: 'fixture-supported',
    position: { x: 5, y: 2, z: 1 },
  });
  assert.equal(first.marker.world_revision, engine.getState(worldId).world_revision);
  assert.equal(first.marker.commit_sequence, engine.getState(worldId).commit_sequence);
});

test('rejected effects do not enter the committed projection', (t) => {
  const { store, engine, worldId } = setup();
  t.after(() => store.close());

  assert.throws(() => commit(engine, worldId, 'rejected-position', [{
    kind: 'entity.teleport',
    entity_id: 'npc-a',
    position: { x: 99, y: 99, z: 99 },
  }]));

  const result = project(engine, worldId);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.positions, {});
  assert.equal(engine.getEvents(worldId, false).some((event) => event.event_id === 'rejected-position'), false);
});

test('rollback removes a position supported only by the invalidated event', (t) => {
  const { store, engine, worldId } = setup();
  t.after(() => store.close());

  commit(engine, worldId, 'position-seed', [{
    kind: 'entity.upsert',
    entity_id: 'npc-a',
    entity_type: 'character',
    attributes: { position: { x: 0, y: 0, z: 0 } },
  }]);
  commit(engine, worldId, 'position-change', [{
    kind: 'entity.upsert',
    entity_id: 'npc-a',
    entity_type: 'character',
    attributes: { position: { x: 7, y: 0, z: 0 } },
  }]);

  assert.deepEqual(project(engine, worldId).positions['npc-a'].position, { x: 7, y: 0, z: 0 });
  const rollback = engine.rollbackEvent(worldId, {
    root_event_id: 'position-change',
    idempotency_key: 'rollback-position-change',
  });
  assert.equal(rollback.accepted, true);

  const rebuilt = project(engine, worldId);
  assert.equal(rebuilt.status, 'ok');
  assert.deepEqual(rebuilt.positions['npc-a'], {
    status: 'fixture-supported',
    position: { x: 0, y: 0, z: 0 },
  });
});

test('same entity ID in separate worlds remains isolated', (t) => {
  const a = setup('spatial-world-a');
  const b = setup('spatial-world-b');
  t.after(() => { a.store.close(); b.store.close(); });

  commit(a.engine, a.worldId, 'world-a-position', [{
    kind: 'entity.upsert',
    entity_id: 'shared-id',
    entity_type: 'object',
    attributes: { position: { x: 1, y: 0, z: 0 } },
  }]);
  commit(b.engine, b.worldId, 'world-b-position', [{
    kind: 'entity.upsert',
    entity_id: 'shared-id',
    entity_type: 'object',
    attributes: { position: { x: 9, y: 0, z: 0 } },
  }]);

  assert.deepEqual(project(a.engine, a.worldId).positions['shared-id'].position, { x: 1, y: 0, z: 0 });
  assert.deepEqual(project(b.engine, b.worldId).positions['shared-id'].position, { x: 9, y: 0, z: 0 });
});

test('missing and malformed fixture positions remain unknown or unsupported', (t) => {
  const { store, engine, worldId } = setup();
  t.after(() => store.close());

  commit(engine, worldId, 'position-unknown', [{
    kind: 'entity.upsert',
    entity_id: 'unknown-npc',
    entity_type: 'character',
    attributes: { name: 'No position supplied' },
  }]);
  commit(engine, worldId, 'position-malformed', [{
    kind: 'entity.upsert',
    entity_id: 'malformed-npc',
    entity_type: 'character',
    attributes: { position: { x: 1, y: 'north', z: 0 } },
  }]);

  const result = project(engine, worldId);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.positions['unknown-npc'], { status: 'unknown' });
  assert.deepEqual(result.positions['malformed-npc'], { status: 'unsupported' });
});

test('bracketed reads fail closed when the composite state marker changes', () => {
  const stateA = {
    world_id: 'race-world',
    world_revision: 1,
    commit_sequence: 1,
    game_time_coordinate: 0,
  };
  const stateB = { ...stateA, world_revision: 2, commit_sequence: 2 };
  let stateReads = 0;
  const result = rebuildFixtureProjection(
    'race-world',
    () => (++stateReads === 1 ? stateA : stateB),
    () => [],
  );
  assert.equal(result.status, 'stale');
  assert.deepEqual(result.positions, {});
});

test('equal game-time coordinates still use commit sequence ordering', (t) => {
  const { store, engine, worldId } = setup();
  t.after(() => store.close());

  commit(engine, worldId, 'same-time-first', [{
    kind: 'entity.upsert',
    entity_id: 'npc-a',
    entity_type: 'character',
    attributes: { position: { x: 1, y: 0, z: 0 } },
  }]);
  commit(engine, worldId, 'same-time-second', [{
    kind: 'entity.upsert',
    entity_id: 'npc-a',
    entity_type: 'character',
    attributes: { position: { x: 2, y: 0, z: 0 } },
  }]);

  const events = engine.getEvents(worldId, false);
  assert.equal(events[0].game_time_coordinate, events[1].game_time_coordinate);
  assert.ok(events[0].commit_sequence < events[1].commit_sequence);
  assert.deepEqual(project(engine, worldId).positions['npc-a'].position, { x: 2, y: 0, z: 0 });
});
