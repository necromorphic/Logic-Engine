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
