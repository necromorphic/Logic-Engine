import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSpatialTopology, findRoomRoute } from '../experiments/spatial-scene-lab/spatial-topology.js';
import { estimateSoundAudibility } from '../experiments/spatial-scene-lab/spatial-sound.js';
import { assessPredictionFreshness, diffSceneRevisions } from '../experiments/spatial-scene-lab/spatial-revisions.js';

const scene = (revision, doorState) => ({
  worldId: 'office-trace',
  revision,
  boundary: `turn-${revision}`,
  entities: [
    { id: 'speaker', position: { x: 2, y: 2, z: 1 }, soundLevelDb: 55 },
    { id: 'listener', position: { x: 12, y: 2, z: 1 }, hearingThresholdDb: 30 },
  ],
  rooms: [
    { id: 'office', name: 'Office', bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 3 } } },
    { id: 'hall', name: 'Hall', bounds: { min: { x: 10, y: 0, z: 0 }, max: { x: 20, y: 10, z: 3 } } },
  ],
  zones: [
    { id: 'office-zone', name: 'Office area', roomId: 'office', bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 3 } } },
    { id: 'hall-zone', name: 'Hall area', roomId: 'hall', bounds: { min: { x: 10, y: 0, z: 0 }, max: { x: 20, y: 10, z: 3 } } },
  ],
  doors: [{
    id: 'office-door',
    name: 'Office door',
    roomA: 'office',
    roomB: 'hall',
    state: doorState,
    soundAttenuationDb: { open: 5, closed: 35 },
  }],
});

test('scene trace: closing a door changes route and sound, and invalidates dependent prediction', () => {
  const before = scene(1, 'open');
  const after = scene(2, 'closed');

  assert.equal(evaluateSpatialTopology(before).status, 'CONFIRMED');
  assert.equal(findRoomRoute(before, 'office', 'hall').reachable, true);
  assert.equal(estimateSoundAudibility(before, 'speaker', 'listener').audible, true);

  assert.equal(findRoomRoute(after, 'office', 'hall').reachable, false);
  assert.equal(estimateSoundAudibility(after, 'speaker', 'listener').audible, false);

  const diff = diffSceneRevisions(before, after);
  assert.deepEqual(diff.changedDependencies, ['door:office-door']);
  const freshness = assessPredictionFreshness({
    id: 'route-and-sound-prediction',
    worldId: before.worldId,
    basedOnRevision: before.revision,
    dependencies: ['door:office-door', 'entity:speaker', 'entity:listener'],
  }, before, after);
  assert.equal(freshness.freshness, 'STALE');
  assert.deepEqual(freshness.affectedDependencies, ['door:office-door']);
});

test('scene trace: unchanged door preserves only predictions that do not depend on changed entities', () => {
  const before = scene(3, 'open');
  const after = scene(4, 'open');
  after.entities[1].position = { x: 13, y: 2, z: 1 };

  const freshness = assessPredictionFreshness({
    id: 'door-route-only',
    worldId: before.worldId,
    basedOnRevision: before.revision,
    dependencies: ['door:office-door'],
  }, before, after);
  assert.equal(freshness.freshness, 'FRESH_WITH_RESPECT_TO_DECLARED_DEPENDENCIES');
  assert.deepEqual(freshness.changedDependencies, ['entity:listener']);
});
