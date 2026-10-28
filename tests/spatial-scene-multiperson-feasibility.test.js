import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSimultaneousTrajectoryCollisions, evaluateSpatialScene, moveEntityInSyntheticScene, predictSceneAtHorizon } from '../experiments/spatial-scene-lab/spatial-scene.js';

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


test('body-volume sampling distinguishes partial visibility from total occlusion', () => {
  const entities = [
    entity('observer', { x: 0, y: 0, z: 0 }),
    {
      ...entity('target', { x: 8, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }),
      body: { minOffset: { x: -0.5, y: -0.5, z: 0 }, maxOffset: { x: 0.5, y: 0.5, z: 2 } },
    },
  ];
  const partial = evaluateSpatialScene(scene({
    entities,
    blockers: [{
      id: 'low-cover',
      min: { x: 3, y: -2, z: -1 },
      max: { x: 4, y: 2, z: 0.6 },
    }],
  }));
  const visible = pair(partial, 'observer', 'target');
  assert.equal(visible.visible, true);
  assert.equal(visible.visibilityExtent, 'PARTIAL');
  assert.ok(visible.visibleSampleCount > 0);
  assert.ok(visible.visibleSampleCount < visible.sampleCount);

  const hidden = evaluateSpatialScene(scene({
    entities,
    blockers: [{
      id: 'full-wall',
      min: { x: 3, y: -2, z: -1 },
      max: { x: 4, y: 2, z: 3 },
    }],
  }));
  assert.equal(pair(hidden, 'observer', 'target').visibilityExtent, 'NONE');
  assert.equal(pair(hidden, 'observer', 'target').visible, false);
});

test('movement rejects a path through a blocker without mutating the source scene', () => {
  const initial = scene({
    entities: [entity('alice', { x: 0, y: 0, z: 0 }), entity('bob', { x: 8, y: 0, z: 0 })],
    blockers: [{
      id: 'wall',
      min: { x: 3, y: -1, z: -1 },
      max: { x: 4, y: 1, z: 2 },
    }],
  });
  const moved = moveEntityInSyntheticScene(initial, 'alice', { x: 8, y: 0, z: 0 }, 'scene-2');
  assert.deepEqual(moved, { status: 'BLOCKED', reason: 'BODY_PATH_INTERSECTS_BLOCKER' });
  assert.deepEqual(initial.entities[0].position, { x: 0, y: 0, z: 0 });
});

test('constant-velocity prediction projects multiple entities to a new boundary', () => {
  const initial = scene({
    entities: [
      { ...entity('alice', { x: 0, y: 0, z: 0 }), motion: { velocity: { x: 1, y: 0, z: 0 } } },
      { ...entity('bob', { x: 8, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }), motion: { velocity: { x: -2, y: 0, z: 0 } } },
    ],
  });
  const prediction = predictSceneAtHorizon(initial, 2, 'scene-3');
  assert.equal(prediction.status, 'CONFIRMED');
  assert.equal(prediction.assumption, 'CONSTANT_VELOCITY_NO_COLLISION_RESPONSE');
  assert.deepEqual(prediction.scene.entities.map((item) => item.position), [
    { x: 2, y: 0, z: 0 }, { x: 4, y: 0, z: 0 },
  ]);
  assert.equal(initial.boundary, 'scene-1');
  assert.deepEqual(initial.entities[0].position, { x: 0, y: 0, z: 0 });
});

test('prediction fails closed when any entity has no explicit velocity', () => {
  assert.deepEqual(
    predictSceneAtHorizon(scene(), 1, 'scene-2'),
    { status: 'UNKNOWN', reason: 'MOTION_DATA_INCOMPLETE' },
  );
  assert.deepEqual(
    predictSceneAtHorizon(scene(), 61, 'scene-2'),
    { status: 'UNKNOWN', reason: 'INVALID_PREDICTION_REQUEST' },
  );
});


test('body extents prevent a character from clipping through a wall', () => {
  const initial = scene({
    entities: [
      { ...entity('alice', { x: 0, y: 0, z: 0 }), body: {
        minOffset: { x: -0.75, y: -0.5, z: 0 }, maxOffset: { x: 0.75, y: 0.5, z: 1.8 },
      } },
      entity('bob', { x: 8, y: 4, z: 0 }),
    ],
    blockers: [{
      id: 'narrow-wall',
      min: { x: 3, y: -0.2, z: -1 },
      max: { x: 3.2, y: 0.2, z: 2 },
    }],
  });
  const moved = moveEntityInSyntheticScene(initial, 'alice', { x: 6, y: 0, z: 0 }, 'scene-2');
  assert.deepEqual(moved, { status: 'BLOCKED', reason: 'BODY_PATH_INTERSECTS_BLOCKER' });
  assert.deepEqual(initial.entities[0].position, { x: 0, y: 0, z: 0 });
});

test('body-volume movement rejects overlap with another entity', () => {
  const initial = scene({
    entities: [
      { ...entity('alice', { x: 0, y: 0, z: 0 }), body: {
        minOffset: { x: -0.5, y: -0.5, z: 0 }, maxOffset: { x: 0.5, y: 0.5, z: 1.8 },
      } },
      { ...entity('bob', { x: 4, y: 0, z: 0 }), body: {
        minOffset: { x: -0.5, y: -0.5, z: 0 }, maxOffset: { x: 0.5, y: 0.5, z: 1.8 },
      } },
    ],
  });
  const moved = moveEntityInSyntheticScene(initial, 'alice', { x: 3.5, y: 0, z: 0 }, 'scene-2');
  assert.deepEqual(moved, { status: 'BLOCKED', reason: 'BODY_PATH_INTERSECTS_ENTITY' });
});

test('explicit speed and turn-rate limits reject physically unsupported movement', () => {
  const initial = scene({
    entities: [
      { ...entity('alice', { x: 0, y: 0, z: 0 }), motion: {
        velocity: { x: 1, y: 0, z: 0 },
        maxSpeed: 2,
        maxTurnRateRadiansPerSecond: Math.PI / 4,
      } },
      entity('bob', { x: 8, y: 5, z: 0 }),
    ],
  });
  assert.deepEqual(
    moveEntityInSyntheticScene(initial, 'alice', { x: 5, y: 0, z: 0 }, 'scene-fast', { durationSeconds: 1 }),
    { status: 'BLOCKED', reason: 'MAX_SPEED_EXCEEDED' },
  );
  assert.deepEqual(
    moveEntityInSyntheticScene(initial, 'alice', { x: 1, y: 0, z: 0 }, 'scene-turn', {
      durationSeconds: 1, nextForward: { x: 0, y: 1, z: 0 },
    }),
    { status: 'BLOCKED', reason: 'MAX_TURN_RATE_EXCEEDED' },
  );
  assert.deepEqual(
    moveEntityInSyntheticScene(initial, 'alice', { x: 1, y: 0, z: 0 }, 'scene-no-duration'),
    { status: 'UNKNOWN', reason: 'DURATION_REQUIRED_FOR_SPEED_LIMIT' },
  );
});

test('multi-person trace records visibility loss and rediscovery with explicit reasons', () => {
  const initial = scene({
    entities: [
      entity('observer', { x: 0, y: 0, z: 0 }),
      entity('runner', { x: 8, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }),
      entity('ally', { x: 0, y: 5, z: 0 }),
    ],
    blockers: [{
      id: 'pillar',
      min: { x: 3, y: -1, z: -1 },
      max: { x: 4, y: 1, z: 2 },
    }],
  });
  const first = evaluateSpatialScene(initial);
  assert.equal(pair(first, 'observer', 'runner').reason, 'OCCLUDED');

  const runnerMoves = moveEntityInSyntheticScene(initial, 'runner', { x: 8, y: 4, z: 0 }, 'scene-runner-moved');
  assert.equal(runnerMoves.status, 'CONFIRMED');
  assert.equal(pair(runnerMoves.evaluation, 'observer', 'runner').visible, true);
  assert.equal(pair(runnerMoves.evaluation, 'observer', 'runner').reason, 'CLEAR_LINE_OF_SIGHT');

  const observerMoves = moveEntityInSyntheticScene(runnerMoves.scene, 'observer', { x: 0, y: 4, z: 0 }, 'scene-observer-moved');
  assert.equal(observerMoves.status, 'CONFIRMED');
  assert.equal(observerMoves.evaluation.boundary, 'scene-observer-moved');
  assert.equal(pair(observerMoves.evaluation, 'observer', 'runner').visible, true);
  assert.equal(initial.boundary, 'scene-1');
});


test('synchronized trajectory sweep detects collision at matching times', () => {
  const initial = scene({
    entities: [
      { ...entity('alice', { x: 0, y: 0, z: 0 }), motion: { velocity: { x: 2, y: 0, z: 0 } } },
      { ...entity('bob', { x: 4, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }), motion: { velocity: { x: -2, y: 0, z: 0 } } },
      { ...entity('cara', { x: 0, y: 8, z: 0 }), motion: { velocity: { x: 0, y: 0, z: 0 } } },
    ],
  });
  const report = detectSimultaneousTrajectoryCollisions(initial, 2);
  assert.equal(report.status, 'CONFIRMED');
  assert.equal(report.assumption, 'CONSTANT_VELOCITY_SYNCHRONIZED_AABB_SWEEP');
  assert.deepEqual(report.collisions, [{
    entityA: 'alice', entityB: 'bob', status: 'POSSIBLE',
    reason: 'SYNCHRONIZED_SWEPT_AABB_OVERLAP',
    timeStartSeconds: 1, timeEndSeconds: 1, horizonSeconds: 2,
  }]);
  assert.equal(initial.entities[0].position.x, 0);
});

test('collision interval includes declared body extents', () => {
  const initial = scene({
    entities: [
      { ...entity('alice', { x: 0, y: 0, z: 0 }), body: {
        minOffset: { x: -0.5, y: -0.5, z: -0.5 }, maxOffset: { x: 0.5, y: 0.5, z: 0.5 },
      }, motion: { velocity: { x: 2, y: 0, z: 0 } } },
      { ...entity('bob', { x: 4, y: 0, z: 0 }), body: {
        minOffset: { x: -0.5, y: -0.5, z: -0.5 }, maxOffset: { x: 0.5, y: 0.5, z: 0.5 },
      }, motion: { velocity: { x: 0, y: 0, z: 0 } } },
    ],
  });
  const report = detectSimultaneousTrajectoryCollisions(initial, 3);
  assert.equal(report.collisions.length, 1);
  assert.equal(report.collisions[0].timeStartSeconds, 1.5);
  assert.equal(report.collisions[0].timeEndSeconds, 2.5);
});

test('crossing geometric paths at different times are not reported as synchronized collision', () => {
  const initial = scene({
    entities: [
      { ...entity('horizontal', { x: 0, y: 0, z: 0 }), motion: { velocity: { x: 1, y: 0, z: 0 } } },
      { ...entity('vertical', { x: 1, y: -2, z: 0 }), motion: { velocity: { x: 0, y: 1, z: 0 } } },
    ],
  });
  const report = detectSimultaneousTrajectoryCollisions(initial, 3);
  assert.equal(report.status, 'CONFIRMED');
  assert.deepEqual(report.collisions, []);
});

test('collision reports are ordered by earliest estimated contact time', () => {
  const initial = scene({
    entities: [
      { ...entity('alice', { x: 0, y: 0, z: 0 }), motion: { velocity: { x: 1, y: 0, z: 0 } } },
      { ...entity('bob', { x: 5, y: 0, z: 0 }), motion: { velocity: { x: 0, y: 0, z: 0 } } },
      { ...entity('cara', { x: 10, y: 0, z: 0 }), motion: { velocity: { x: -2, y: 0, z: 0 } } },
    ],
  });
  const report = detectSimultaneousTrajectoryCollisions(initial, 6);
  assert.deepEqual(report.collisions.map(({ entityA, entityB }) => [entityA, entityB]), [
    ['bob', 'cara'],
    ['alice', 'cara'],
    ['alice', 'bob'],
  ]);
  assert.ok(report.collisions[0].timeStartSeconds < report.collisions[1].timeStartSeconds);
  assert.ok(report.collisions[1].timeStartSeconds < report.collisions[2].timeStartSeconds);
});

test('trajectory collision prediction fails closed without explicit motion for every entity', () => {
  assert.deepEqual(
    detectSimultaneousTrajectoryCollisions(scene(), 2),
    { status: 'UNKNOWN', reason: 'MOTION_DATA_INCOMPLETE' },
  );
  assert.deepEqual(
    detectSimultaneousTrajectoryCollisions(scene(), 61),
    { status: 'UNKNOWN', reason: 'INVALID_COLLISION_PREDICTION_REQUEST' },
  );
});
