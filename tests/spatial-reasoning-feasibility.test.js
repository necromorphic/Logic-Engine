import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';

// Research-only feasibility harness. It uses an in-memory Core and synthetic
// fixtures. It adds no runtime behavior and persists no data.
const FRAME = 'world-enu-logical-v1';
const UNITS = 'logical-unit';

function syntheticConfirmedPoint({ worldId, entityId, x, y, z, frame = FRAME, units = UNITS, boundary }) {
  // This helper creates TEST FIXTURES only. It does not validate real Core data.
  if (!worldId || !entityId || !boundary || frame !== FRAME || units !== UNITS) return null;
  if (![x, y, z].every(Number.isFinite)) return null;
  return { status: 'CONFIRMED', worldId, entityId, x, y, z, frame, units, boundary };
}

function pointDistance(a, b) {
  if (!a || !b || a.status !== 'CONFIRMED' || b.status !== 'CONFIRMED') return { status: 'UNKNOWN' };
  if (a.worldId !== b.worldId || a.frame !== b.frame || a.units !== b.units || a.boundary !== b.boundary) {
    return { status: 'UNSUPPORTED' };
  }
  const distance = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  return Number.isFinite(distance) ? { status: 'CONFIRMED', distance } : { status: 'UNKNOWN' };
}

function relativeDelta(a, b) {
  const distance = pointDistance(a, b);
  if (distance.status !== 'CONFIRMED') return distance;
  return {
    status: 'CONFIRMED',
    delta: { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z },
  };
}

function axisRelation(a, b, axis) {
  if (!['x', 'y', 'z'].includes(axis)) return { status: 'UNSUPPORTED' };
  const distance = pointDistance(a, b);
  if (distance.status !== 'CONFIRMED') return distance;
  const delta = b[axis] - a[axis];
  return {
    status: 'CONFIRMED',
    axis,
    relation: delta === 0 ? 'SAME' : delta > 0 ? 'GREATER' : 'LESS',
    delta,
  };
}

function nearest(point, candidates, { completeSet }) {
  if (!point || point.status !== 'CONFIRMED' || !Array.isArray(candidates) || !candidates.length) {
    return { status: 'UNKNOWN' };
  }
  const scored = candidates.map((candidate) => ({ candidate, result: pointDistance(point, candidate) }));
  if (scored.some(({ result }) => result.status !== 'CONFIRMED')) return { status: 'UNKNOWN' };
  const min = Math.min(...scored.map(({ result }) => result.distance));
  const ties = scored.filter(({ result }) => result.distance === min).map(({ candidate }) => candidate.entityId).sort();
  return { status: 'CONFIRMED', scope: completeSet ? 'complete' : 'bounded', distance: min, entityIds: ties };
}

function setup() {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  engine.createWorld({
    world_id: 'spatial-lab',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2005-12-29T10:00:00.000Z',
  });
  return { store, engine };
}

function commit(engine, worldId, eventId, effects) {
  const state = engine.getState(worldId);
  return engine.commitEvent(worldId, {
    event_id: eventId,
    idempotency_key: eventId,
    turn_id: eventId + '-turn',
    event_type: 'action.completed',
    expected_revision: state.world_revision,
    effects,
    caused_by: [],
    depends_on: [],
    read_set: [],
    causal_links: [],
  });
}

test('3D point distance is deterministic for confirmed same-boundary points', () => {
  const a = syntheticConfirmedPoint({ worldId: 'w', entityId: 'a', x: 0, y: 0, z: 0, boundary: 'c1' });
  const b = syntheticConfirmedPoint({ worldId: 'w', entityId: 'b', x: 3, y: 4, z: 12, boundary: 'c1' });
  assert.deepEqual(pointDistance(a, b), { status: 'CONFIRMED', distance: 13 });
});

test('cross-world and cross-boundary comparisons fail closed', () => {
  const a = syntheticConfirmedPoint({ worldId: 'w', entityId: 'a', x: 0, y: 0, z: 0, boundary: 'c1' });
  const otherWorld = syntheticConfirmedPoint({ worldId: 'other', entityId: 'b', x: 1, y: 0, z: 0, boundary: 'c1' });
  const otherBoundary = syntheticConfirmedPoint({ worldId: 'w', entityId: 'b', x: 1, y: 0, z: 0, boundary: 'c2' });
  assert.equal(pointDistance(a, otherWorld).status, 'UNSUPPORTED');
  assert.equal(pointDistance(a, otherBoundary).status, 'UNSUPPORTED');
});

test('missing axes and unsupported frame or units never become zero coordinates', () => {
  assert.equal(syntheticConfirmedPoint({ worldId: 'w', entityId: 'a', x: 0, y: 0, z: undefined, boundary: 'c1' }), null);
  assert.equal(syntheticConfirmedPoint({ worldId: 'w', entityId: 'a', x: 0, y: 0, z: NaN, boundary: 'c1' }), null);
  assert.equal(syntheticConfirmedPoint({ worldId: 'w', entityId: 'a', x: 0, y: 0, z: 0, frame: 'other-frame', boundary: 'c1' }), null);
  assert.equal(syntheticConfirmedPoint({ worldId: 'w', entityId: 'a', x: 0, y: 0, z: 0, units: 'meters', boundary: 'c1' }), null);
  assert.deepEqual(pointDistance(null, null), { status: 'UNKNOWN' });
});

test('relative delta and axis relation use the declared coordinate axes without guessing labels', () => {
  const a = syntheticConfirmedPoint({ worldId: 'w', entityId: 'a', x: 2, y: 5, z: 1, boundary: 'c1' });
  const b = syntheticConfirmedPoint({ worldId: 'w', entityId: 'b', x: 7, y: 3, z: 4, boundary: 'c1' });

  assert.deepEqual(relativeDelta(a, b), {
    status: 'CONFIRMED',
    delta: { x: 5, y: -2, z: 3 },
  });
  assert.deepEqual(axisRelation(a, b, 'x'), {
    status: 'CONFIRMED', axis: 'x', relation: 'GREATER', delta: 5,
  });
  assert.deepEqual(axisRelation(a, b, 'y'), {
    status: 'CONFIRMED', axis: 'y', relation: 'LESS', delta: -2,
  });
  assert.deepEqual(axisRelation(a, b, 'z'), {
    status: 'CONFIRMED', axis: 'z', relation: 'GREATER', delta: 3,
  });
  assert.equal(axisRelation(a, b, 'north').status, 'UNSUPPORTED');
});

test('relative delta and axis relation refuse cross-boundary or unknown positions', () => {
  const a = syntheticConfirmedPoint({ worldId: 'w', entityId: 'a', x: 0, y: 0, z: 0, boundary: 'c1' });
  const b = syntheticConfirmedPoint({ worldId: 'w', entityId: 'b', x: 1, y: 0, z: 0, boundary: 'c2' });

  assert.equal(relativeDelta(a, b).status, 'UNSUPPORTED');
  assert.equal(axisRelation(null, b, 'x').status, 'UNKNOWN');
});

test('nearest preserves ties and states when the candidate set is bounded', () => {
  const origin = syntheticConfirmedPoint({ worldId: 'w', entityId: 'origin', x: 0, y: 0, z: 0, boundary: 'c1' });
  const east = syntheticConfirmedPoint({ worldId: 'w', entityId: 'east', x: 1, y: 0, z: 0, boundary: 'c1' });
  const north = syntheticConfirmedPoint({ worldId: 'w', entityId: 'north', x: 0, y: 1, z: 0, boundary: 'c1' });
  assert.deepEqual(nearest(origin, [north, east], { completeSet: false }), {
    status: 'CONFIRMED', scope: 'bounded', distance: 1, entityIds: ['east', 'north'],
  });
});

test('Core preserves position-shaped generic attributes but does not provide spatial schema provenance', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  commit(engine, 'spatial-lab', 'seed-spatial-fixture', [
    { kind: 'entity.create', entity_id: 'point-shaped', entity_type: 'object', attributes: { position: { x: 1, y: 2, z: 3 } } },
    { kind: 'entity.create', entity_id: 'prose-only', entity_type: 'object', attributes: { location: 'north room' } },
  ]);

  const state = engine.getState('spatial-lab');
  const events = engine.getEvents('spatial-lab', false);
  const pointEntity = state.entities.find((entity) => entity.entity_id === 'point-shaped');
  const proseEntity = state.entities.find((entity) => entity.entity_id === 'prose-only');

  assert.deepEqual(pointEntity.attributes.position, { x: 1, y: 2, z: 3 });
  assert.equal(proseEntity.attributes.location, 'north room');
  assert.equal(Object.hasOwn(pointEntity, 'position_schema_id'), false);
  assert.equal(Object.hasOwn(pointEntity, 'position_frame'), false);
  assert.equal(Object.hasOwn(pointEntity, 'position_status'), false);
  assert.ok(events.some((event) => event.event_id === 'seed-spatial-fixture'));

  // Generic attributes are deliberately not promoted to confirmed positions.
  assert.deepEqual(pointDistance(null, null), { status: 'UNKNOWN' });
});


test('generic attributes accept malformed position-shaped data without a typed spatial gate', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  const result = commit(engine, 'spatial-lab', 'seed-untyped-position-shapes', [
    { kind: 'entity.create', entity_id: 'partial-point', entity_type: 'object', attributes: { position: { x: 1, y: 2 } } },
    { kind: 'entity.create', entity_id: 'text-point', entity_type: 'object', attributes: { position: { x: 'east', y: 2, z: 3 } } },
  ]);

  assert.equal(result.accepted, true);
  const state = engine.getState('spatial-lab');
  assert.deepEqual(state.entities.find((entity) => entity.entity_id === 'partial-point').attributes.position, { x: 1, y: 2 });
  assert.deepEqual(state.entities.find((entity) => entity.entity_id === 'text-point').attributes.position, { x: 'east', y: 2, z: 3 });

  // This test records the present generic-attribute behavior as a gap.
  // It is not permission to interpret either value as a spatial position.
});


test('segment commit also accepts malformed position-shaped generic attributes', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  const result = engine.commitSegment('spatial-lab', {
    idempotency_key: 'segment-untyped-position',
    expected_revision: 0,
    expected_commit_sequence: 0,
    events: [{
      event_id: 'segment-partial-position',
      idempotency_key: 'segment-partial-position-key',
      turn_id: 'segment-partial-position-turn',
      event_type: 'action.completed',
      time_advance_seconds: 0,
      effects: [{
        kind: 'entity.upsert',
        entity_id: 'segment-partial-point',
        entity_type: 'object',
        attributes: { position: { x: 1, y: 2 } },
      }],
      caused_by: [],
      depends_on: [],
      read_set: [],
      causal_links: [],
    }],
  });

  assert.equal(result.accepted, true);
  assert.deepEqual(
    engine.getState('spatial-lab').entities.find((entity) => entity.entity_id === 'segment-partial-point').attributes.position,
    { x: 1, y: 2 },
  );
  // This is a negative feasibility finding: segment acceptance has no typed
  // spatial validation gate. It does not authorize using the value as position.
});


test('entity.update can corrupt or remove a position-shaped attribute without typed spatial validation', (t) => {
  const { store, engine } = setup();
  t.after(() => store.close());

  const seeded = commit(engine, 'spatial-lab', 'seed-update-position', [
    { kind: 'entity.create', entity_id: 'update-point', entity_type: 'object', attributes: { position: { x: 1, y: 2, z: 3 } } },
  ]);
  assert.equal(seeded.accepted, true);

  const malformedUpdate = commit(engine, 'spatial-lab', 'update-malformed-position', [
    { kind: 'entity.update', entity_id: 'update-point', attributes: { position: { x: 'west', y: 2 } } },
  ]);
  assert.equal(malformedUpdate.accepted, true);
  assert.deepEqual(
    engine.getState('spatial-lab').entities.find((entity) => entity.entity_id === 'update-point').attributes.position,
    { x: 'west', y: 2 },
  );

  const removePosition = commit(engine, 'spatial-lab', 'remove-position-attribute', [
    { kind: 'entity.update', entity_id: 'update-point', remove_attributes: ['position'] },
  ]);
  assert.equal(removePosition.accepted, true);
  const finalEntity = engine.getState('spatial-lab').entities.find((entity) => entity.entity_id === 'update-point');
  assert.equal(Object.hasOwn(finalEntity.attributes, 'position'), false);

  // Characterization only: a spatial consumer must not infer CONFIRMED from
  // a generic attribute before, during, or after these accepted updates.
});
