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

function see(observer, target, scene) {
  const delta = {
    x: target.position.x - observer.position.x,
    y: target.position.y - observer.position.y,
    z: target.position.z - observer.position.z,
  };
  const distance = magnitude(delta);
  if (scene.lighting !== 'clear') {
    return { status: 'UNKNOWN', visible: null, distance, reason: 'LIGHTING_UNRESOLVED' };
  }
  if (distance > observer.perception.maxDistance) {
    return { status: 'CONFIRMED', visible: false, distance, reason: 'OUT_OF_RANGE' };
  }
  if (distance > 0) {
    const forwardLength = magnitude(observer.forward);
    const cosine = dot(delta, observer.forward) / (distance * forwardLength);
    if (cosine < Math.cos(observer.perception.halfAngleRadians)) {
      return { status: 'CONFIRMED', visible: false, distance, reason: 'OUTSIDE_FIELD_OF_VIEW' };
    }
  }
  if (scene.blockers.some((blocker) => segmentIntersectsAabb(observer.position, target.position, blocker))) {
    return { status: 'CONFIRMED', visible: false, distance, reason: 'OCCLUDED' };
  }
  return { status: 'CONFIRMED', visible: true, distance, reason: 'CLEAR_LINE_OF_SIGHT' };
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
  if (!scene.entities.some((entity) => entity.id === entityId)) {
    return { status: 'UNKNOWN', reason: 'ENTITY_NOT_FOUND' };
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
