// Research-only prototype. Never imported by production runtime.
// Coordinates, orientation, blockers and lighting are synthetic caller-supplied
// fixtures; this module does not read or certify canonical Core state.

export const SPATIAL_SCENE_MODEL = 'synthetic-scene-v1';

const finiteVector = (value) => value && ['x', 'y', 'z'].every((axis) => Number.isFinite(value[axis]));
const magnitude = (v) => Math.hypot(v.x, v.y, v.z);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

function validScene(scene) {
  if (!scene || typeof scene.worldId !== 'string' || !scene.worldId ||
      typeof scene.boundary !== 'string' || !scene.boundary ||
      !Array.isArray(scene.entities) || !Array.isArray(scene.blockers)) return false;
  if (scene.occluderInventoryComplete !== true) return false;
  if (!['clear', 'unknown', 'dark'].includes(scene.lighting)) return false;

  const ids = new Set();
  for (const entity of scene.entities) {
    if (!entity || typeof entity.id !== 'string' || !entity.id || ids.has(entity.id)) return false;
    ids.add(entity.id);
    if (!finiteVector(entity.position)) return false;
    if (!finiteVector(entity.forward) || magnitude(entity.forward) === 0) return false;
    if (entity.body !== undefined) {
      if (!entity.body || !finiteVector(entity.body.minOffset) || !finiteVector(entity.body.maxOffset)) return false;
      for (const axis of ['x', 'y', 'z']) if (entity.body.minOffset[axis] > entity.body.maxOffset[axis]) return false;
    }
    if (entity.motion !== undefined && (!entity.motion || !finiteVector(entity.motion.velocity))) return false;
    if (!entity.perception ||
        !Number.isFinite(entity.perception.halfAngleRadians) ||
        entity.perception.halfAngleRadians < 0 ||
        entity.perception.halfAngleRadians > Math.PI ||
        !Number.isFinite(entity.perception.maxDistance) ||
        entity.perception.maxDistance < 0) return false;
  }
  for (const blocker of scene.blockers) {
    if (!blocker || typeof blocker.id !== 'string' ||
        !finiteVector(blocker.min) || !finiteVector(blocker.max)) return false;
    for (const axis of ['x', 'y', 'z']) if (blocker.min[axis] > blocker.max[axis]) return false;
  }
  return true;
}

function segmentIntersectsAabb(start, end, box) {
  let tMin = 0;
  let tMax = 1;
  for (const axis of ['x', 'y', 'z']) {
    const direction = end[axis] - start[axis];
    if (direction === 0) {
      if (start[axis] < box.min[axis] || start[axis] > box.max[axis]) return false;
      continue;
    }
    let a = (box.min[axis] - start[axis]) / direction;
    let b = (box.max[axis] - start[axis]) / direction;
    if (a > b) [a, b] = [b, a];
    tMin = Math.max(tMin, a);
    tMax = Math.min(tMax, b);
    if (tMin > tMax) return false;
  }
  return tMax >= 0 && tMin <= 1;
}

function pointVisibility(observer, point, scene) {
  const delta = {
    x: point.x - observer.position.x,
    y: point.y - observer.position.y,
    z: point.z - observer.position.z,
  };
  const distance = magnitude(delta);
  if (distance > observer.perception.maxDistance) {
    return { visible: false, distance, reason: 'OUT_OF_RANGE' };
  }
  if (distance > 0) {
    const forwardLength = magnitude(observer.forward);
    const cosine = dot(delta, observer.forward) / (distance * forwardLength);
    if (cosine < Math.cos(observer.perception.halfAngleRadians)) {
      return { visible: false, distance, reason: 'OUTSIDE_FIELD_OF_VIEW' };
    }
  }
  if (scene.blockers.some((blocker) => segmentIntersectsAabb(observer.position, point, blocker))) {
    return { visible: false, distance, reason: 'OCCLUDED' };
  }
  return { visible: true, distance, reason: 'CLEAR_LINE_OF_SIGHT' };
}

function bodySamples(target) {
  if (!target.body) return [target.position];
  const min = target.body.minOffset;
  const max = target.body.maxOffset;
  const middle = {
    x: (min.x + max.x) / 2,
    y: (min.y + max.y) / 2,
    z: (min.z + max.z) / 2,
  };
  const offsets = [
    middle,
    { x: min.x, y: min.y, z: min.z },
    { x: min.x, y: min.y, z: max.z },
    { x: min.x, y: max.y, z: min.z },
    { x: min.x, y: max.y, z: max.z },
    { x: max.x, y: min.y, z: min.z },
    { x: max.x, y: min.y, z: max.z },
    { x: max.x, y: max.y, z: min.z },
    { x: max.x, y: max.y, z: max.z },
  ];
  return offsets.map((offset) => ({
    x: target.position.x + offset.x,
    y: target.position.y + offset.y,
    z: target.position.z + offset.z,
  }));
}

function see(observer, target, scene) {
  const originDistance = magnitude({
    x: target.position.x - observer.position.x,
    y: target.position.y - observer.position.y,
    z: target.position.z - observer.position.z,
  });
  if (scene.lighting !== 'clear') {
    return { status: 'UNKNOWN', visible: null, distance: originDistance, reason: 'LIGHTING_UNRESOLVED' };
  }

  const results = bodySamples(target).map((point) => pointVisibility(observer, point, scene));
  const visibleCount = results.filter((result) => result.visible).length;
  if (!target.body) {
    const result = results[0];
    return { status: 'CONFIRMED', ...result };
  }

  if (visibleCount === results.length) {
    return {
      status: 'CONFIRMED', visible: true, distance: originDistance,
      reason: 'CLEAR_LINE_OF_SIGHT', visibilityExtent: 'FULL',
      visibleSampleCount: visibleCount, sampleCount: results.length,
    };
  }
  if (visibleCount > 0) {
    return {
      status: 'CONFIRMED', visible: true, distance: originDistance,
      reason: 'PARTIAL_LINE_OF_SIGHT', visibilityExtent: 'PARTIAL',
      visibleSampleCount: visibleCount, sampleCount: results.length,
    };
  }
  const reasons = results.map((result) => result.reason);
  const reason = reasons.includes('OCCLUDED') ? 'OCCLUDED'
    : reasons.every((item) => item === 'OUT_OF_RANGE') ? 'OUT_OF_RANGE'
      : 'OUTSIDE_FIELD_OF_VIEW';
  return {
    status: 'CONFIRMED', visible: false, distance: originDistance, reason,
    visibilityExtent: 'NONE', visibleSampleCount: 0, sampleCount: results.length,
  };
}

/**
 * Evaluate a fully synthetic, single-boundary scene.
 * Visibility means only that the target origin passes this simplified geometry
 * model; it does not imply gaze, attention, noticing, knowledge or memory.
 */
export function evaluateSpatialScene(scene) {
  if (!validScene(scene)) {
    return { status: 'UNKNOWN', reason: 'INVALID_OR_INCOMPLETE_SCENE', model: SPATIAL_SCENE_MODEL };
  }

  const visibility = [];
  for (const observer of scene.entities) {
    for (const target of scene.entities) {
      if (observer.id === target.id) continue;
      const result = see(observer, target, scene);
      visibility.push({
        observerId: observer.id,
        targetId: target.id,
        ...result,
      });
    }
  }
  visibility.sort((a, b) =>
    a.observerId.localeCompare(b.observerId) || a.targetId.localeCompare(b.targetId));

  return {
    status: 'CONFIRMED',
    model: SPATIAL_SCENE_MODEL,
    worldId: scene.worldId,
    boundary: scene.boundary,
    visibility,
  };
}

/**
 * Synthetic-only movement between caller-declared scene snapshots.
 * The caller supplies a new boundary label and is responsible for declaring
 * all unchanged entities/blockers as valid at that new synthetic boundary.
 */
export function moveEntityInSyntheticScene(scene, entityId, nextPosition, nextBoundary) {
  if (!validScene(scene) || !finiteVector(nextPosition) ||
      typeof nextBoundary !== 'string' || !nextBoundary || nextBoundary === scene.boundary) {
    return { status: 'UNKNOWN', reason: 'INVALID_MOVE_OR_BOUNDARY' };
  }
  const movingEntity = scene.entities.find((entity) => entity.id === entityId);
  if (!movingEntity) {
    return { status: 'UNKNOWN', reason: 'ENTITY_NOT_FOUND' };
  }
  if (scene.blockers.some((blocker) => segmentIntersectsAabb(movingEntity.position, nextPosition, blocker))) {
    return { status: 'BLOCKED', reason: 'PATH_INTERSECTS_BLOCKER' };
  }
  const nextScene = {
    ...scene,
    boundary: nextBoundary,
    entities: scene.entities.map((entity) => entity.id === entityId
      ? { ...entity, position: { ...nextPosition } }
      : { ...entity, position: { ...entity.position }, forward: { ...entity.forward },
          perception: { ...entity.perception } }),
    blockers: scene.blockers.map((blocker) => ({
      ...blocker, min: { ...blocker.min }, max: { ...blocker.max },
    })),
  };
  const evaluated = evaluateSpatialScene(nextScene);
  return evaluated.status === 'CONFIRMED'
    ? { status: 'CONFIRMED', scene: nextScene, evaluation: evaluated }
    : evaluated;
}


/**
 * Predict a synthetic scene under constant-velocity motion only.
 * Every entity must explicitly provide motion.velocity (zero for stationary
 * entities). This is straight-line extrapolation, not collision/physics solving.
 */
export function predictSceneAtHorizon(scene, horizonSeconds, nextBoundary) {
  if (!validScene(scene) || !Number.isFinite(horizonSeconds) ||
      horizonSeconds < 0 || horizonSeconds > 60 ||
      typeof nextBoundary !== 'string' || !nextBoundary || nextBoundary === scene.boundary) {
    return { status: 'UNKNOWN', reason: 'INVALID_PREDICTION_REQUEST' };
  }
  if (scene.entities.some((entity) => !entity.motion || !finiteVector(entity.motion.velocity))) {
    return { status: 'UNKNOWN', reason: 'MOTION_DATA_INCOMPLETE' };
  }

  const predictedScene = {
    ...scene,
    boundary: nextBoundary,
    entities: scene.entities.map((entity) => ({
      ...entity,
      position: {
        x: entity.position.x + entity.motion.velocity.x * horizonSeconds,
        y: entity.position.y + entity.motion.velocity.y * horizonSeconds,
        z: entity.position.z + entity.motion.velocity.z * horizonSeconds,
      },
      forward: { ...entity.forward },
      perception: { ...entity.perception },
      body: entity.body ? {
        minOffset: { ...entity.body.minOffset },
        maxOffset: { ...entity.body.maxOffset },
      } : undefined,
      motion: { velocity: { ...entity.motion.velocity } },
    })),
    blockers: scene.blockers.map((blocker) => ({
      ...blocker, min: { ...blocker.min }, max: { ...blocker.max },
    })),
  };
  const evaluation = evaluateSpatialScene(predictedScene);
  if (evaluation.status !== 'CONFIRMED') return evaluation;
  return {
    status: 'CONFIRMED',
    model: SPATIAL_SCENE_MODEL,
    horizonSeconds,
    assumption: 'CONSTANT_VELOCITY_NO_COLLISION_RESPONSE',
    scene: predictedScene,
    evaluation,
  };
}
