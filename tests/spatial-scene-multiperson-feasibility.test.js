import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSpatialScene, moveEntityInSyntheticScene } from '../experiments/spatial-scene-lab/spatial-scene.js';

const entity = (id, position, forward = { x: 1, y: 0, z: 0 }) => ({
  id, position, forward, perception: { halfAngleRadians: Math.PI / 3, maxDistance: 12 },
});

function scene(overrides = {}) {
  return {
    worldId: 'synthetic-world',
    boundary: 'scene-1',
    lighting: 'clear',
    occluderInventoryComplete: true,
    entities: [
      entity('alice', { x: 0, y: 0, z: 0 }),
      entity('bob', { x: 8, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }),
      entity('cara', { x: 4, y: 7, z: 0 }, { x: 0, y: -1, z: 0 }),
    ],
    blockers: [],
    ...overrides,
  };
}

const pair = (result, observerId, targetId) =>
  result.visibility.find((item) => item.observerId === observerId && item.targetId === targetId);

test('multi-entity scene returns deterministic observer-relative visibility pairs', () => {
  const result = evaluateSpatialScene(scene());
  assert.equal(result.status, 'CONFIRMED');
  assert.equal(result.visibility.length, 6);
  assert.deepEqual(pair(result, 'alice', 'bob'), {
    observerId: 'alice', targetId: 'bob', status: 'CONFIRMED',
    visible: true, distance: 8, reason: 'CLEAR_LINE_OF_SIGHT',
  });
  assert.deepEqual(pair(result, 'alice', 'cara'), {
    observerId: 'alice', targetId: 'cara', status: 'CONFIRMED',
    visible: false, distance: Math.sqrt(65), reason: 'OUTSIDE_FIELD_OF_VIEW',
  });
  assert.deepEqual(evaluateSpatialScene(scene()), result);
});

test('3D height changes distance and can move a target outside perception range', () => {
  const elevated = scene({
    entities: [
      entity('observer', { x: 0, y: 0, z: 0 }),
      entity('roof-target', { x: 3, y: 4, z: 12 }),
    ],
  });
  const result = evaluateSpatialScene(elevated);
  assert.equal(pair(result, 'observer', 'roof-target').distance, 13);
  assert.equal(pair(result, 'observer', 'roof-target').reason, 'OUT_OF_RANGE');
});

test('a wall occludes line of sight even when both entities are in range', () => {
  const result = evaluateSpatialScene(scene({
    entities: [
      entity('alice', { x: 0, y: 0, z: 0 }),
      entity('bob', { x: 8, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }),
    ],
    blockers: [{
      id: 'wall',
      min: { x: 3, y: -1, z: -1 },
      max: { x: 4, y: 1, z: 2 },
    }],
  }));
  assert.equal(pair(result, 'alice', 'bob').visible, false);
  assert.equal(pair(result, 'alice', 'bob').reason, 'OCCLUDED');
});

test('movement creates a new synthetic boundary and recalculates visibility', () => {
  const initial = scene({
    entities: [
      entity('alice', { x: 0, y: 0, z: 0 }),
      entity('bob', { x: 8, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }),
    ],
    blockers: [{
      id: 'wall',
      min: { x: 3, y: -1, z: -1 },
      max: { x: 4, y: 1, z: 2 },
    }],
  });
  assert.equal(pair(evaluateSpatialScene(initial), 'alice', 'bob').reason, 'OCCLUDED');

  const moved = moveEntityInSyntheticScene(initial, 'alice', { x: 0, y: 4, z: 0 }, 'scene-2');
  assert.equal(moved.status, 'CONFIRMED');
  assert.equal(moved.evaluation.boundary, 'scene-2');
  assert.equal(pair(moved.evaluation, 'alice', 'bob').visible, true);
  assert.equal(initial.boundary, 'scene-1');
  assert.deepEqual(initial.entities[0].position, { x: 0, y: 0, z: 0 });
});

test('unknown lighting and incomplete occluder inventory fail closed', () => {
  const dark = evaluateSpatialScene(scene({ lighting: 'dark' }));
  assert.equal(dark.status, 'CONFIRMED');
  assert.equal(pair(dark, 'alice', 'bob').status, 'UNKNOWN');
  assert.equal(pair(dark, 'alice', 'bob').visible, null);

  const incomplete = evaluateSpatialScene(scene({ occluderInventoryComplete: false }));
  assert.equal(incomplete.status, 'UNKNOWN');
  assert.equal(incomplete.reason, 'INVALID_OR_INCOMPLETE_SCENE');
});

test('invalid positions, duplicate IDs and unknown movers are not guessed', () => {
  assert.equal(evaluateSpatialScene(scene({ entities: [entity('bad', { x: 1, y: 2 })] })).status, 'UNKNOWN');
  assert.equal(evaluateSpatialScene(scene({ entities: [
    entity('same', { x: 0, y: 0, z: 0 }), entity('same', { x: 1, y: 0, z: 0 }),
  ] })).status, 'UNKNOWN');
  assert.deepEqual(
    moveEntityInSyntheticScene(scene(), 'missing', { x: 1, y: 2, z: 3 }, 'scene-2'),
    { status: 'UNKNOWN', reason: 'ENTITY_NOT_FOUND' },
  );
});
