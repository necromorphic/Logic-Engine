// Research-only immutable scene revisions and prediction freshness checks.
// These helpers operate on synthetic fixtures. They are not connected to Core
// events, persistence, rollback, or any production world-state writer.

export const SPATIAL_REVISION_MODEL = 'synthetic-scene-revision-v1';

const hasUniqueIds = (items) => {
  const ids = new Set();
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)) return false;
    ids.add(item.id);
  }
  return true;
};

const validRevision = (scene) => scene &&
  typeof scene.worldId === 'string' && scene.worldId.length > 0 &&
  Number.isSafeInteger(scene.revision) && scene.revision >= 0 &&
  typeof scene.boundary === 'string' && scene.boundary.length > 0 &&
  Array.isArray(scene.entities) && hasUniqueIds(scene.entities) &&
  Array.isArray(scene.rooms) && hasUniqueIds(scene.rooms) &&
  Array.isArray(scene.zones) && hasUniqueIds(scene.zones) &&
  Array.isArray(scene.doors) && hasUniqueIds(scene.doors) &&
  Array.isArray(scene.blockers) && hasUniqueIds(scene.blockers);

function normalizedEntity(entity) {
  // Include every spatial/perception field used by the current synthetic scene
  // evaluators. If body, motion, facing, or perception changes, dependent
  // predictions must not remain fresh merely because position stayed the same.
  return {
    id: entity.id,
    position: entity.position ?? null,
    orientation: entity.orientation ?? null,
    forward: entity.forward ?? null,
    velocity: entity.velocity ?? null,
    motion: entity.motion ? {
      velocity: entity.motion.velocity ?? null,
      maxSpeed: entity.motion.maxSpeed ?? null,
      maxTurnRateRadiansPerSecond: entity.motion.maxTurnRateRadiansPerSecond ?? null,
    } : null,
    body: entity.body ?? null,
    perception: entity.perception ?? null,
    bounds: entity.bounds ?? null,
    soundLevelDb: entity.soundLevelDb ?? null,
    hearingThresholdDb: entity.hearingThresholdDb ?? null,
    maxSpeed: entity.maxSpeed ?? null,
    maxTurnRateRadiansPerSecond: entity.maxTurnRateRadiansPerSecond ?? null,
  };
}

function normalizeCollection(items, key, normalize = (item) => item) {
  return new Map(items.map((item) => [item[key], JSON.stringify(normalize(item))]));
}

function changedIds(beforeItems, afterItems, key, normalize) {
  const before = normalizeCollection(beforeItems, key, normalize);
  const after = normalizeCollection(afterItems, key, normalize);
  const ids = new Set([...before.keys(), ...after.keys()]);
  return [...ids].filter((id) => before.get(id) !== after.get(id)).sort();
}

/**
 * Compare two immutable synthetic snapshots and list changed dependency keys.
 * Callers must supply the complete old and new snapshots; this function does
 * not mutate either snapshot and does not infer causal dependencies.
 */
export function diffSceneRevisions(previous, current) {
  if (!validRevision(previous) || !validRevision(current)) {
    return { status: 'UNKNOWN', reason: 'REVISION_METADATA_OR_SNAPSHOT_INVALID', model: SPATIAL_REVISION_MODEL };
  }
  if (previous.worldId !== current.worldId) {
    return { status: 'UNKNOWN', reason: 'WORLD_ID_MISMATCH', model: SPATIAL_REVISION_MODEL };
  }
  if (current.revision <= previous.revision) {
    return { status: 'UNKNOWN', reason: 'REVISION_MUST_INCREASE', model: SPATIAL_REVISION_MODEL };
  }

  const changed = [
    ...changedIds(previous.entities, current.entities, 'id', normalizedEntity).map((id) => `entity:${id}`),
    ...changedIds(previous.rooms, current.rooms, 'id').map((id) => `room:${id}`),
    ...changedIds(previous.zones, current.zones, 'id').map((id) => `zone:${id}`),
    ...changedIds(previous.doors, current.doors, 'id').map((id) => `door:${id}`),
    ...changedIds(previous.blockers, current.blockers, 'id').map((id) => `blocker:${id}`),
  ].sort();

  return {
    status: 'CONFIRMED',
    model: SPATIAL_REVISION_MODEL,
    worldId: current.worldId,
    fromRevision: previous.revision,
    toRevision: current.revision,
    fromBoundary: previous.boundary,
    toBoundary: current.boundary,
    changedDependencies: changed,
  };
}

/**
 * Determine whether a prediction can still be reused after a scene revision.
 * A prediction must declare every dependency it used. This helper cannot prove
 * that declaration is complete; omitted dependencies remain a caller risk.
 */
export function assessPredictionFreshness(prediction, previous, current) {
  const diff = diffSceneRevisions(previous, current);
  if (diff.status !== 'CONFIRMED') return { ...diff, freshness: 'UNKNOWN' };
  if (!prediction || typeof prediction.id !== 'string' || !prediction.id ||
      prediction.worldId !== previous.worldId ||
      prediction.basedOnRevision !== previous.revision ||
      !Array.isArray(prediction.dependencies) ||
      prediction.dependencies.some((item) => typeof item !== 'string' || !item)) {
    return {
      status: 'UNKNOWN',
      freshness: 'UNKNOWN',
      reason: 'PREDICTION_METADATA_OR_DEPENDENCIES_INVALID',
      model: SPATIAL_REVISION_MODEL,
    };
  }

  const changed = new Set(diff.changedDependencies);
  const affected = [...new Set(prediction.dependencies.filter((dependency) => changed.has(dependency)))].sort();
  if (affected.length) {
    return {
      status: 'CONFIRMED',
      freshness: 'STALE',
      reason: 'DECLARED_DEPENDENCY_CHANGED',
      predictionId: prediction.id,
      fromRevision: previous.revision,
      toRevision: current.revision,
      affectedDependencies: affected,
      changedDependencies: diff.changedDependencies,
      model: SPATIAL_REVISION_MODEL,
    };
  }

  return {
    status: 'CONFIRMED',
    freshness: 'FRESH_WITH_RESPECT_TO_DECLARED_DEPENDENCIES',
    reason: 'NO_DECLARED_DEPENDENCY_CHANGED',
    predictionId: prediction.id,
    fromRevision: previous.revision,
    toRevision: current.revision,
    changedDependencies: diff.changedDependencies,
    model: SPATIAL_REVISION_MODEL,
  };
}
