import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLanguageModelSceneContext, evaluateSpatialTopology } from '../experiments/spatial-scene-lab/spatial-topology.js';
import { estimateSoundAudibility } from '../experiments/spatial-scene-lab/spatial-sound.js';
import { detectSimultaneousTrajectoryCollisions, evaluateSpatialScene, moveEntityInSyntheticScene, predictSceneAtHorizon } from '../experiments/spatial-scene-lab/spatial-scene.js';

const makeScene = (doorState) => ({
  worldId: 'multi-npc-doorway',
  boundary: 'synthetic-turn-1',
  entities: [
    { id: 'speaker', position: { x: 2, y: 2, z: 1 }, soundLevelDb: 55 },
    { id: 'listener-behind-door', position: { x: 12, y: 2, z: 1 }, hearingThresholdDb: 30 },
    { id: 'unlocated-npc', position: { x: 40, y: 2, z: 1 } },
  ],
  rooms: [
    { id: 'office', name: 'Office', bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 3 } } },
    { id: 'hall', name: 'Hall', bounds: { min: { x: 10.1, y: 0, z: 0 }, max: { x: 20, y: 10, z: 3 } } },
  ],
  zones: [
    { id: 'office-zone', name: 'Office area', roomId: 'office', bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 3 } } },
    { id: 'hall-zone', name: 'Hall area', roomId: 'hall', bounds: { min: { x: 10.1, y: 0, z: 0 }, max: { x: 20, y: 10, z: 3 } } },
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

test('multi-NPC scene: a closed door blocks the route and the sound estimate stays below threshold', () => {
  const scene = makeScene('closed');
  const topology = evaluateSpatialTopology(scene);
  assert.equal(topology.status, 'CONFIRMED');

  const context = buildLanguageModelSceneContext(scene, 'speaker');
  assert.equal(context.status, 'CONFIRMED');
  assert.match(context.text, /Entity listener-behind-door: Hall \/ Hall area/);
  assert.match(context.text, /Do not infer visibility, hearing, noticing/);

  const sound = estimateSoundAudibility(scene, 'speaker', 'listener-behind-door');
  assert.equal(sound.status, 'CONFIRMED');
  assert.equal(sound.audible, false);
  assert.equal(sound.reason, 'ALL_POSSIBLE_ROUTES_BELOW_THRESHOLD_OR_BLOCKED');
});

test('multi-NPC scene: an open doorway may make sound audible but does not assert actual hearing', () => {
  const scene = makeScene('open');
  const sound = estimateSoundAudibility(scene, 'speaker', 'listener-behind-door');
  assert.equal(sound.status, 'CONFIRMED');
  assert.equal(sound.audible, true);
  assert.equal(sound.reason, 'KNOWN_ROUTE_ABOVE_THRESHOLD');

  const context = buildLanguageModelSceneContext(scene, 'speaker');
  assert.doesNotMatch(context.text, /listener-behind-door heard the sound/i);
  assert.match(context.text, /Do not infer visibility, hearing, noticing/);
});

test('multi-NPC scene: an entity outside declared rooms remains explicitly unknown in model context', () => {
  const scene = makeScene('open');
  const topology = evaluateSpatialTopology(scene);
  const location = topology.locations.find((item) => item.entityId === 'unlocated-npc');
  assert.equal(location.status, 'UNKNOWN');
  assert.equal(location.reason, 'POSITION_OUTSIDE_DECLARED_ROOMS');

  const context = buildLanguageModelSceneContext(scene, 'speaker');
  assert.equal(context.status, 'CONFIRMED');
  assert.match(context.text, /Entity unlocated-npc: location UNKNOWN \(POSITION_OUTSIDE_DECLARED_ROOMS\)/);
});


const sceneEntity = (id, position, forward = { x: 1, y: 0, z: 0 }) => ({
  id, position, forward,
  perception: { halfAngleRadians: Math.PI / 3, maxDistance: 12 },
});

const visibilityScene = (boundary = 'visibility-1') => ({
  worldId: 'multi-npc-visibility',
  boundary,
  lighting: 'clear',
  occluderInventoryComplete: true,
  entities: [
    sceneEntity('observer', { x: 0, y: 0, z: 0 }),
    sceneEntity('runner', { x: 8, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }),
    sceneEntity('ally', { x: 0, y: 5, z: 0 }),
  ],
  blockers: [{
    id: 'wall',
    min: { x: 3, y: -1, z: -1 },
    max: { x: 4, y: 1, z: 2 },
  }],
});

const visibilityPair = (result, observerId, targetId) =>
  result.visibility.find((item) => item.observerId === observerId && item.targetId === targetId);

test('multi-NPC trace: wall blocks visibility until the runner moves to a new boundary', () => {
  const before = visibilityScene();
  const first = evaluateSpatialScene(before);
  assert.equal(first.status, 'CONFIRMED');
  assert.equal(visibilityPair(first, 'observer', 'runner').visible, false);
  assert.equal(visibilityPair(first, 'observer', 'runner').reason, 'OCCLUDED');

  const moved = moveEntityInSyntheticScene(before, 'runner', { x: 8, y: 4, z: 0 }, 'visibility-2');
  assert.equal(moved.status, 'CONFIRMED');
  assert.equal(moved.scene.boundary, 'visibility-2');
  assert.equal(visibilityPair(moved.evaluation, 'observer', 'runner').visible, true);
  assert.equal(visibilityPair(moved.evaluation, 'observer', 'runner').reason, 'CLEAR_LINE_OF_SIGHT');

  // The evaluator reports geometry only; it cannot claim that the observer noticed the runner.
  assert.equal(before.boundary, 'visibility-1');
  assert.deepEqual(before.entities.find((item) => item.id === 'runner').position, { x: 8, y: 0, z: 0 });
});

test('multi-NPC trace: movement through a wall is rejected and leaves the scene unchanged', () => {
  const before = visibilityScene();
  const moved = moveEntityInSyntheticScene(before, 'runner', { x: 0, y: 0, z: 0 }, 'blocked-move');
  assert.deepEqual(moved, { status: 'BLOCKED', reason: 'BODY_PATH_INTERSECTS_BLOCKER' });
  assert.equal(before.boundary, 'visibility-1');
  assert.deepEqual(before.entities.find((item) => item.id === 'runner').position, { x: 8, y: 0, z: 0 });
});

test('multi-NPC visibility remains UNKNOWN when lighting or blocker inventory is unresolved', () => {
  const dark = evaluateSpatialScene({ ...visibilityScene(), lighting: 'unknown' });
  assert.equal(dark.status, 'CONFIRMED');
  assert.equal(visibilityPair(dark, 'observer', 'runner').status, 'UNKNOWN');
  assert.equal(visibilityPair(dark, 'observer', 'runner').visible, null);

  const incomplete = evaluateSpatialScene({ ...visibilityScene(), occluderInventoryComplete: false });
  assert.equal(incomplete.status, 'UNKNOWN');
  assert.equal(incomplete.reason, 'INVALID_OR_INCOMPLETE_SCENE');
});


test('multi-NPC temporal trace: approaching NPCs may collide, separating NPCs do not collide in the same horizon', () => {
  const temporalScene = (velocityA, velocityB) => ({
    worldId: 'multi-npc-temporal', boundary: 'time-0', lighting: 'clear',
    occluderInventoryComplete: true, blockers: [],
    entities: [
      { ...sceneEntity('npc-a', { x: 2, y: 0, z: 0 }), motion: { velocity: { x: velocityA, y: 0, z: 0 } } },
      { ...sceneEntity('npc-b', { x: 8, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }), motion: { velocity: { x: velocityB, y: 0, z: 0 } } },
    ],
  });

  const approaching = temporalScene(1, -1);
  const prediction = predictSceneAtHorizon(approaching, 4, 'time-4');
  assert.equal(prediction.status, 'CONFIRMED');
  assert.equal(prediction.scene.entities.find((item) => item.id === 'npc-a').position.x, 6);
  assert.equal(prediction.scene.entities.find((item) => item.id === 'npc-b').position.x, 4);
  const approachingCollisions = detectSimultaneousTrajectoryCollisions(approaching, 4);
  assert.equal(approachingCollisions.status, 'CONFIRMED');
  assert.equal(approachingCollisions.collisions.length, 1);
  assert.equal(approachingCollisions.collisions[0].status, 'POSSIBLE');
  assert.equal(approachingCollisions.collisions[0].timeStartSeconds, 3);

  const separating = temporalScene(-1, 1);
  const separatingCollisions = detectSimultaneousTrajectoryCollisions(separating, 4);
  assert.equal(separatingCollisions.status, 'CONFIRMED');
  assert.deepEqual(separatingCollisions.collisions, []);
});

test('multi-NPC visibility labels sampled body coverage without claiming continuous full-body visibility', () => {
  const scene = visibilityScene();
  scene.blockers = [];
  scene.entities.find((item) => item.id === 'runner').body = {
    minOffset: { x: -0.3, y: -0.5, z: -0.5 },
    maxOffset: { x: 0.3, y: 0.5, z: 0.5 },
  };
  const result = evaluateSpatialScene(scene);
  const visibility = visibilityPair(result, 'observer', 'runner');
  assert.equal(visibility.visible, true);
  assert.equal(visibility.visibilityExtent, 'SAMPLED_ALL');
  assert.equal(visibility.sampleCount, 9);
});

test('multi-NPC visibility fails closed when blocker IDs are duplicated', () => {
  const scene = visibilityScene();
  scene.blockers.push({ ...scene.blockers[0] });
  const result = evaluateSpatialScene(scene);
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.reason, 'INVALID_OR_INCOMPLETE_SCENE');
});
