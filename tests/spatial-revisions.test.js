import test from 'node:test';
import assert from 'node:assert/strict';
import { assessPredictionFreshness, diffSceneRevisions } from '../experiments/spatial-scene-lab/spatial-revisions.js';

const makeScene = (revision, overrides = {}) => ({
  worldId: 'revision-world',
  revision,
  boundary: `turn-${revision}`,
  entities: [
    { id: 'npc-a', position: { x: 1, y: 1, z: 0 } },
    { id: 'npc-b', position: { x: 2, y: 1, z: 0 } },
  ],
  rooms: [{ id: 'room-a', name: 'Office', bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 3 } } }],
  zones: [{ id: 'zone-a', name: 'Desk', roomId: 'room-a', bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 5, y: 5, z: 3 } } }],
  doors: [{ id: 'door-a', name: 'Office door', roomA: 'room-a', roomB: 'room-b', state: 'open' }],
  blockers: [],
  ...overrides,
});

test('diffs immutable snapshots and identifies changed entity and door dependencies', () => {
  const previous = makeScene(1);
  const current = makeScene(2, {
    entities: [
      { id: 'npc-a', position: { x: 3, y: 1, z: 0 } },
      { id: 'npc-b', position: { x: 2, y: 1, z: 0 } },
    ],
    doors: [{ id: 'door-a', name: 'Office door', roomA: 'room-a', roomB: 'room-b', state: 'closed' }],
  });
  const result = diffSceneRevisions(previous, current);
  assert.equal(result.status, 'CONFIRMED');
  assert.deepEqual(result.changedDependencies, ['door:door-a', 'entity:npc-a']);
  assert.deepEqual(previous.entities[0].position, { x: 1, y: 1, z: 0 });
});

test('marks prediction stale when a declared dependency changes', () => {
  const previous = makeScene(3);
  const current = makeScene(4, {
    doors: [{ id: 'door-a', name: 'Office door', roomA: 'room-a', roomB: 'room-b', state: 'closed' }],
  });
  const result = assessPredictionFreshness({
    id: 'route-prediction',
    worldId: previous.worldId,
    basedOnRevision: 3,
    dependencies: ['door:door-a', 'room:room-a'],
  }, previous, current);
  assert.equal(result.freshness, 'STALE');
  assert.deepEqual(result.affectedDependencies, ['door:door-a']);
});

test('keeps prediction reusable only relative to declared dependencies', () => {
  const previous = makeScene(5);
  const current = makeScene(6, {
    entities: [
      { id: 'npc-a', position: { x: 1, y: 1, z: 0 } },
      { id: 'npc-b', position: { x: 4, y: 1, z: 0 } },
    ],
  });
  const result = assessPredictionFreshness({
    id: 'door-only-check',
    worldId: previous.worldId,
    basedOnRevision: 5,
    dependencies: ['door:door-a'],
  }, previous, current);
  assert.equal(result.freshness, 'FRESH_WITH_RESPECT_TO_DECLARED_DEPENDENCIES');
  assert.deepEqual(result.changedDependencies, ['entity:npc-b']);
});

test('fails closed when prediction metadata or dependency list is missing', () => {
  const previous = makeScene(7);
  const current = makeScene(8);
  const result = assessPredictionFreshness({ id: 'missing-deps', worldId: previous.worldId, basedOnRevision: 7 }, previous, current);
  assert.equal(result.freshness, 'UNKNOWN');
});

test('fails closed when revision does not increase or world identity changes', () => {
  assert.equal(diffSceneRevisions(makeScene(2), makeScene(2)).reason, 'REVISION_MUST_INCREASE');
  assert.equal(diffSceneRevisions(makeScene(2), makeScene(3, { worldId: 'other-world' })).reason, 'WORLD_ID_MISMATCH');
});

test('detects added and removed objects as dependency changes', () => {
  const previous = makeScene(9);
  const current = makeScene(10, { zones: [] });
  const result = diffSceneRevisions(previous, current);
  assert.deepEqual(result.changedDependencies, ['zone:zone-a']);
});

test('detects obstacle changes and marks predictions depending on that obstacle stale', () => {
  const previous = makeScene(11, { blockers: [{ id: 'wall-a', min: { x: 3, y: 0, z: 0 }, max: { x: 4, y: 4, z: 3 } }] });
  const current = makeScene(12, { blockers: [{ id: 'wall-a', min: { x: 3, y: 0, z: 0 }, max: { x: 4, y: 5, z: 3 } }] });
  const diff = diffSceneRevisions(previous, current);
  assert.deepEqual(diff.changedDependencies, ['blocker:wall-a']);
  const freshness = assessPredictionFreshness({
    id: 'line-of-sight-prediction', worldId: previous.worldId, basedOnRevision: 11,
    dependencies: ['blocker:wall-a'],
  }, previous, current);
  assert.equal(freshness.freshness, 'STALE');
  assert.deepEqual(freshness.affectedDependencies, ['blocker:wall-a']);
});

test('fails closed when any revision collection contains duplicate or missing IDs', () => {
  const duplicateEntity = makeScene(13, {
    entities: [
      { id: 'npc-a', position: { x: 1, y: 1, z: 0 } },
      { id: 'npc-a', position: { x: 2, y: 1, z: 0 } },
    ],
  });
  assert.equal(diffSceneRevisions(makeScene(12), duplicateEntity).status, 'UNKNOWN');

  const missingBlockerId = makeScene(14, { blockers: [{ min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } }] });
  assert.equal(diffSceneRevisions(makeScene(13), missingBlockerId).status, 'UNKNOWN');
});


test('detects spatial body, motion, facing, and perception changes as entity dependencies', () => {
  const previous = makeScene(15, {
    entities: [{
      id: 'npc-a',
      position: { x: 1, y: 1, z: 0 },
      forward: { x: 1, y: 0, z: 0 },
      body: {
        minOffset: { x: -0.3, y: -0.3, z: 0 },
        maxOffset: { x: 0.3, y: 0.3, z: 1.8 },
      },
      motion: { velocity: { x: 1, y: 0, z: 0 }, maxSpeed: 2 },
      perception: { halfAngleRadians: Math.PI / 3, maxDistance: 10 },
    }, { id: 'npc-b', position: { x: 2, y: 1, z: 0 } }],
  });
  const current = makeScene(16, {
    entities: [{
      id: 'npc-a',
      position: { x: 1, y: 1, z: 0 },
      forward: { x: 0, y: 1, z: 0 },
      body: {
        minOffset: { x: -0.5, y: -0.3, z: 0 },
        maxOffset: { x: 0.5, y: 0.3, z: 1.8 },
      },
      motion: { velocity: { x: 0, y: 1, z: 0 }, maxSpeed: 2 },
      perception: { halfAngleRadians: Math.PI / 4, maxDistance: 8 },
    }, { id: 'npc-b', position: { x: 2, y: 1, z: 0 } }],
  });
  const diff = diffSceneRevisions(previous, current);
  assert.deepEqual(diff.changedDependencies, ['entity:npc-a']);
  const freshness = assessPredictionFreshness({
    id: 'movement-and-visibility-prediction',
    worldId: previous.worldId,
    basedOnRevision: previous.revision,
    dependencies: ['entity:npc-a'],
  }, previous, current);
  assert.equal(freshness.freshness, 'STALE');
  assert.deepEqual(freshness.affectedDependencies, ['entity:npc-a']);
});


test('each spatial dependency field independently invalidates the entity key', () => {
  const baseEntity = {
    id: 'npc-a',
    position: { x: 1, y: 1, z: 0 },
    forward: { x: 1, y: 0, z: 0 },
    body: {
      minOffset: { x: -0.3, y: -0.3, z: 0 },
      maxOffset: { x: 0.3, y: 0.3, z: 1.8 },
    },
    motion: { velocity: { x: 1, y: 0, z: 0 }, maxSpeed: 2 },
    perception: { halfAngleRadians: Math.PI / 3, maxDistance: 10 },
  };
  const variants = [
    ['body', { ...baseEntity, body: { ...baseEntity.body, maxOffset: { ...baseEntity.body.maxOffset, x: 0.4 } } }],
    ['motion velocity', { ...baseEntity, motion: { ...baseEntity.motion, velocity: { x: 0, y: 1, z: 0 } } }],
    ['motion limit', { ...baseEntity, motion: { ...baseEntity.motion, maxSpeed: 3 } }],
    ['facing', { ...baseEntity, forward: { x: 0, y: 1, z: 0 } }],
    ['perception range', { ...baseEntity, perception: { ...baseEntity.perception, maxDistance: 8 } }],
    ['perception angle', { ...baseEntity, perception: { ...baseEntity.perception, halfAngleRadians: Math.PI / 4 } }],
  ];

  for (const [field, changedEntity] of variants) {
    const previous = makeScene(17, {
      entities: [baseEntity, { id: 'npc-b', position: { x: 2, y: 1, z: 0 } }],
    });
    const current = makeScene(18, {
      entities: [changedEntity, { id: 'npc-b', position: { x: 2, y: 1, z: 0 } }],
    });
    assert.deepEqual(diffSceneRevisions(previous, current).changedDependencies, ['entity:npc-a'], field);
  }
});
