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

// Synthetic observer geometry helpers. These are isolated algorithm tests,
// not production NPC perception or Memory → NPC integration.
function syntheticLineIntersectsAabb(start, end, box) {
  let tMin = 0;
  let tMax = 1;
  for (const axis of ['x', 'y', 'z']) {
    const direction = end[axis] - start[axis];
    if (direction === 0) {
      if (start[axis] < box.min[axis] || start[axis] > box.max[axis]) return false;
      continue;
    }
    let t1 = (box.min[axis] - start[axis]) / direction;
    let t2 = (box.max[axis] - start[axis]) / direction;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }
  return tMax >= 0 && tMin <= 1;
}

function syntheticVisibility({ observer, target, forward, halfAngleRadians, maxDistance, blockers, lighting, observedBoundary, currentBoundary }) {
  if (!observer || !target || observer.status !== 'CONFIRMED' || target.status !== 'CONFIRMED') {
    return { status: 'UNKNOWN', visible: null, reason: 'POSITION_UNCONFIRMED' };
  }
  const comparable = pointDistance(observer, target);
  if (comparable.status !== 'CONFIRMED') return { status: comparable.status, visible: null };
  if (observedBoundary !== currentBoundary) return { status: 'STALE', visible: null };
  if (lighting !== 'clear') return { status: 'UNKNOWN', visible: null, reason: 'LIGHTING_UNRESOLVED' };

  const v = { x: target.x - observer.x, y: target.y - observer.y, z: target.z - observer.z };
  const d = Math.hypot(v.x, v.y, v.z);
  const f = Math.hypot(forward.x, forward.y, forward.z);
  if (!Number.isFinite(f) || f === 0) return { status: 'UNKNOWN', visible: null, reason: 'ORIENTATION_INVALID' };
  if (d > maxDistance) return { status: 'CONFIRMED', visible: false, reason: 'OUT_OF_RANGE' };
  if (d > 0) {
    const cosine = (v.x * forward.x + v.y * forward.y + v.z * forward.z) / (d * f);
    if (cosine < Math.cos(halfAngleRadians)) return { status: 'CONFIRMED', visible: false, reason: 'OUTSIDE_FIELD_OF_VIEW' };
  }
  const start = { x: observer.x, y: observer.y, z: observer.z };
  const end = { x: target.x, y: target.y, z: target.z };
  if (blockers.some((box) => syntheticLineIntersectsAabb(start, end, box))) {
    return { status: 'CONFIRMED', visible: false, reason: 'OCCLUDED' };
  }
  return { status: 'CONFIRMED', visible: true, reason: 'CLEAR_LINE_OF_SIGHT' };
}

test('synthetic 3D line-of-sight checks an explicit blocker between two points', () => {
  const start = { x: 0, y: 0, z: 0 };
  const end = { x: 10, y: 0, z: 0 };
  assert.equal(syntheticLineIntersectsAabb(start, end, {
    min: { x: 4, y: -1, z: -1 }, max: { x: 5, y: 1, z: 1 },
  }), true);
  assert.equal(syntheticLineIntersectsAabb(start, end, {
    min: { x: 4, y: 2, z: -1 }, max: { x: 5, y: 3, z: 1 },
  }), false);
  assert.equal(syntheticLineIntersectsAabb(start, end, {
    min: { x: 11, y: -1, z: -1 }, max: { x: 12, y: 1, z: 1 },
  }), false);
});

test('synthetic visibility distinguishes field of view, range, blockers, lighting, and stale boundaries', () => {
  const observer = syntheticConfirmedPoint({ worldId: 'w', entityId: 'observer', x: 0, y: 0, z: 0, boundary: 'c1' });
  const target = syntheticConfirmedPoint({ worldId: 'w', entityId: 'target', x: 10, y: 0, z: 0, boundary: 'c1' });
  const common = {
    observer, target, forward: { x: 1, y: 0, z: 0 }, halfAngleRadians: Math.PI / 6,
    maxDistance: 12, blockers: [], lighting: 'clear',
    observedBoundary: 'c1', currentBoundary: 'c1',
  };
  assert.deepEqual(syntheticVisibility(common), {
    status: 'CONFIRMED', visible: true, reason: 'CLEAR_LINE_OF_SIGHT',
  });
  assert.deepEqual(syntheticVisibility({ ...common, forward: { x: -1, y: 0, z: 0 } }), {
    status: 'CONFIRMED', visible: false, reason: 'OUTSIDE_FIELD_OF_VIEW',
  });
  assert.deepEqual(syntheticVisibility({ ...common, maxDistance: 5 }), {
    status: 'CONFIRMED', visible: false, reason: 'OUT_OF_RANGE',
  });
  assert.deepEqual(syntheticVisibility({ ...common, blockers: [{
    min: { x: 4, y: -1, z: -1 }, max: { x: 5, y: 1, z: 1 },
  }] }), {
    status: 'CONFIRMED', visible: false, reason: 'OCCLUDED',
  });
  assert.deepEqual(syntheticVisibility({ ...common, lighting: 'unknown' }), {
    status: 'UNKNOWN', visible: null, reason: 'LIGHTING_UNRESOLVED',
  });
  assert.deepEqual(syntheticVisibility({ ...common, currentBoundary: 'c2' }), {
    status: 'STALE', visible: null,
  });
});

test('synthetic perception never promotes visibility into NPC knowledge or Memory permission', () => {
  const observer = syntheticConfirmedPoint({ worldId: 'w', entityId: 'observer', x: 0, y: 0, z: 0, boundary: 'c1' });
  const target = syntheticConfirmedPoint({ worldId: 'w', entityId: 'target', x: 1, y: 0, z: 0, boundary: 'c1' });
  const result = syntheticVisibility({
    observer, target, forward: { x: 1, y: 0, z: 0 }, halfAngleRadians: Math.PI / 4,
    maxDistance: 5, blockers: [], lighting: 'clear', observedBoundary: 'c1', currentBoundary: 'c1',
  });
  assert.equal(result.visible, true);
  assert.equal(Object.hasOwn(result, 'npc_knows'), false);
  assert.equal(Object.hasOwn(result, 'memory_permission'), false);
});
