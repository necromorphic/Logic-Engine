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
    if (entity.motion !== undefined) {
      if (!entity.motion || !finiteVector(entity.motion.velocity)) return false;
      if (entity.motion.maxSpeed !== undefined &&
          (!Number.isFinite(entity.motion.maxSpeed) || entity.motion.maxSpeed < 0)) return false;
      if (entity.motion.maxTurnRateRadiansPerSecond !== undefined &&
          (!Number.isFinite(entity.motion.maxTurnRateRadiansPerSecond) ||
           entity.motion.maxTurnRateRadiansPerSecond < 0)) return false;
    }
    if (!entity.perception ||
        !Number.isFinite(entity.perception.halfAngleRadians) ||
        entity.perception.halfAngleRadians < 0 ||
        entity.perception.halfAngleRadians > Math.PI ||
        !Number.isFinite(entity.perception.maxDistance) ||
        entity.perception.maxDistance < 0) return false;
  }
  const blockerIds = new Set();
  for (const blocker of scene.blockers) {
    if (!blocker || typeof blocker.id !== 'string' || !blocker.id || blockerIds.has(blocker.id) ||
        !finiteVector(blocker.min) || !finiteVector(blocker.max)) return false;
    blockerIds.add(blocker.id);
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

function segmentAabbIntersectionInterval(start, end, box) {
  let tMin = 0;
  let tMax = 1;
  for (const axis of ['x', 'y', 'z']) {
    const direction = end[axis] - start[axis];
    if (direction === 0) {
      if (start[axis] < box.min[axis] || start[axis] > box.max[axis]) return null;
      continue;
    }
    let a = (box.min[axis] - start[axis]) / direction;
    let b = (box.max[axis] - start[axis]) / direction;
    if (a > b) [a, b] = [b, a];
    tMin = Math.max(tMin, a);
    tMax = Math.min(tMax, b);
    if (tMin > tMax) return null;
  }
  if (tMax < 0 || tMin > 1) return null;
  return { enter: Math.max(0, tMin), exit: Math.min(1, tMax) };
}

function bodyOffsets(entity) {
  return entity.body ?? {
    minOffset: { x: 0, y: 0, z: 0 },
    maxOffset: { x: 0, y: 0, z: 0 },
  };
}

// Minkowski expansion converts a moving axis-aligned body into a moving origin
// tested against an expanded blocker. Conservative for this AABB-only model.
function sweptBodyIntersectsAabb(start, end, body, box) {
  const expanded = {
    min: {
      x: box.min.x - body.maxOffset.x,
      y: box.min.y - body.maxOffset.y,
      z: box.min.z - body.maxOffset.z,
    },
    max: {
      x: box.max.x - body.minOffset.x,
      y: box.max.y - body.minOffset.y,
      z: box.max.z - body.minOffset.z,
    },
  };
  return segmentIntersectsAabb(start, end, expanded);
}

function bodyIntersectsBodyPath(start, end, movingBody, other) {
  const otherBody = bodyOffsets(other);
  const relativeBox = {
    min: {
      x: other.position.x + otherBody.minOffset.x - movingBody.maxOffset.x,
      y: other.position.y + otherBody.minOffset.y - movingBody.maxOffset.y,
      z: other.position.z + otherBody.minOffset.z - movingBody.maxOffset.z,
    },
    max: {
      x: other.position.x + otherBody.maxOffset.x - movingBody.minOffset.x,
      y: other.position.y + otherBody.maxOffset.y - movingBody.minOffset.y,
      z: other.position.z + otherBody.maxOffset.z - movingBody.minOffset.z,
    },
  };
  return segmentIntersectsAabb(start, end, relativeBox);
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

// These nine sample rays are an approximation. They cannot prove that every
// point on the target body is visible or hidden; result labels say "SAMPLED"
// to avoid implying continuous geometric coverage.
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
      reason: 'CLEAR_LINE_OF_SIGHT', visibilityExtent: 'SAMPLED_ALL',
      visibleSampleCount: visibleCount, sampleCount: results.length,
    };
  }
  if (visibleCount > 0) {
    return {
      status: 'CONFIRMED', visible: true, distance: originDistance,
      reason: 'PARTIAL_LINE_OF_SIGHT', visibilityExtent: 'SAMPLED_PARTIAL',
      visibleSampleCount: visibleCount, sampleCount: results.length,
    };
  }
  const reasons = results.map((result) => result.reason);
  const reason = reasons.includes('OCCLUDED') ? 'OCCLUDED'
    : reasons.every((item) => item === 'OUT_OF_RANGE') ? 'OUT_OF_RANGE'
      : 'OUTSIDE_FIELD_OF_VIEW';
  return {
    status: 'CONFIRMED', visible: false, distance: originDistance, reason,
    visibilityExtent: 'SAMPLED_NONE', visibleSampleCount: 0, sampleCount: results.length,
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
export function moveEntityInSyntheticScene(scene, entityId, nextPosition, nextBoundary, options = {}) {
  if (!validScene(scene) || !finiteVector(nextPosition) ||
      typeof nextBoundary !== 'string' || !nextBoundary || nextBoundary === scene.boundary ||
      !options || typeof options !== 'object') {
    return { status: 'UNKNOWN', reason: 'INVALID_MOVE_OR_BOUNDARY' };
  }
  const movingEntity = scene.entities.find((entity) => entity.id === entityId);
  if (!movingEntity) return { status: 'UNKNOWN', reason: 'ENTITY_NOT_FOUND' };

  const distance = magnitude({
    x: nextPosition.x - movingEntity.position.x,
    y: nextPosition.y - movingEntity.position.y,
    z: nextPosition.z - movingEntity.position.z,
  });
  const duration = options.durationSeconds;
  if (movingEntity.motion?.maxSpeed !== undefined) {
    if (!Number.isFinite(duration) || duration <= 0) {
      return { status: 'UNKNOWN', reason: 'DURATION_REQUIRED_FOR_SPEED_LIMIT' };
    }
    if (distance / duration > movingEntity.motion.maxSpeed) {
      return { status: 'BLOCKED', reason: 'MAX_SPEED_EXCEEDED' };
    }
  } else if (duration !== undefined && (!Number.isFinite(duration) || duration <= 0)) {
    return { status: 'UNKNOWN', reason: 'INVALID_DURATION' };
  }

  let nextForward = movingEntity.forward;
  if (options.nextForward !== undefined) {
    if (!finiteVector(options.nextForward) || magnitude(options.nextForward) === 0) {
      return { status: 'UNKNOWN', reason: 'INVALID_NEXT_FORWARD' };
    }
    const turnLimit = movingEntity.motion?.maxTurnRateRadiansPerSecond;
    if (turnLimit !== undefined) {
      if (!Number.isFinite(duration) || duration <= 0) {
        return { status: 'UNKNOWN', reason: 'DURATION_REQUIRED_FOR_TURN_LIMIT' };
      }
      const cosine = Math.max(-1, Math.min(1,
        dot(movingEntity.forward, options.nextForward) /
        (magnitude(movingEntity.forward) * magnitude(options.nextForward))));
      if (Math.acos(cosine) > turnLimit * duration + 1e-12) {
        return { status: 'BLOCKED', reason: 'MAX_TURN_RATE_EXCEEDED' };
      }
    }
    nextForward = { ...options.nextForward };
  }

  const movingBody = bodyOffsets(movingEntity);
  if (scene.blockers.some((blocker) =>
    sweptBodyIntersectsAabb(movingEntity.position, nextPosition, movingBody, blocker))) {
    return { status: 'BLOCKED', reason: 'BODY_PATH_INTERSECTS_BLOCKER' };
  }
  if (scene.entities.some((other) => other.id !== entityId &&
      bodyIntersectsBodyPath(movingEntity.position, nextPosition, movingBody, other))) {
    return { status: 'BLOCKED', reason: 'BODY_PATH_INTERSECTS_ENTITY' };
  }
  const nextScene = {
    ...scene,
    boundary: nextBoundary,
    entities: scene.entities.map((entity) => entity.id === entityId
      ? { ...entity, position: { ...nextPosition }, forward: { ...nextForward } }
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
 * Detect synchronized swept-body collisions over a bounded synthetic horizon.
 * Unlike comparing geometric path segments alone, this checks relative motion
 * at matching times, so two paths crossing at different times are not a collision.
 * It reports possible AABB overlap, not a physics response or production fact.
 */
export function detectSimultaneousTrajectoryCollisions(scene, horizonSeconds) {
  if (!validScene(scene) || !Number.isFinite(horizonSeconds) ||
      horizonSeconds < 0 || horizonSeconds > 60) {
    return { status: 'UNKNOWN', reason: 'INVALID_COLLISION_PREDICTION_REQUEST' };
  }
  if (scene.entities.some((entity) => !entity.motion || !finiteVector(entity.motion.velocity))) {
    return { status: 'UNKNOWN', reason: 'MOTION_DATA_INCOMPLETE' };
  }

  const collisions = [];
  for (let i = 0; i < scene.entities.length; i += 1) {
    for (let j = i + 1; j < scene.entities.length; j += 1) {
      const a = scene.entities[i];
      const b = scene.entities[j];
      const aBody = bodyOffsets(a);
      const bBody = bodyOffsets(b);
      const relativeStart = {
        x: a.position.x - b.position.x,
        y: a.position.y - b.position.y,
        z: a.position.z - b.position.z,
      };
      const relativeEnd = {
        x: relativeStart.x + (a.motion.velocity.x - b.motion.velocity.x) * horizonSeconds,
        y: relativeStart.y + (a.motion.velocity.y - b.motion.velocity.y) * horizonSeconds,
        z: relativeStart.z + (a.motion.velocity.z - b.motion.velocity.z) * horizonSeconds,
      };
      const combined = {
        min: {
          x: bBody.minOffset.x - aBody.maxOffset.x,
          y: bBody.minOffset.y - aBody.maxOffset.y,
          z: bBody.minOffset.z - aBody.maxOffset.z,
        },
        max: {
          x: bBody.maxOffset.x - aBody.minOffset.x,
          y: bBody.maxOffset.y - aBody.minOffset.y,
          z: bBody.maxOffset.z - aBody.minOffset.z,
        },
      };
      const overlapInterval = segmentAabbIntersectionInterval(relativeStart, relativeEnd, combined);
      if (overlapInterval) {
        collisions.push({
          entityA: a.id,
          entityB: b.id,
          status: 'POSSIBLE',
          reason: 'SYNCHRONIZED_SWEPT_AABB_OVERLAP',
          timeStartSeconds: overlapInterval.enter * horizonSeconds,
          timeEndSeconds: overlapInterval.exit * horizonSeconds,
          horizonSeconds,
        });
      }
    }
  }
  collisions.sort((a, b) =>
    a.timeStartSeconds - b.timeStartSeconds ||
    a.entityA.localeCompare(b.entityA) ||
    a.entityB.localeCompare(b.entityB));

  return {
    status: 'CONFIRMED',
    model: SPATIAL_SCENE_MODEL,
    horizonSeconds,
    assumption: 'CONSTANT_VELOCITY_SYNCHRONIZED_AABB_SWEEP',
    collisions,
  };
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
      motion: { ...entity.motion, velocity: { ...entity.motion.velocity } },
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
