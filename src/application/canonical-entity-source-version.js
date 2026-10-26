const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = (value) => typeof value === 'string' && value === value.trim()
  && value.length > 0 && value.length <= 200
  && ![...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
const canonicalDecimal = (value) => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value);

/**
 * Core-owned source-version validation for direct canonical_entity Memory
 * records. This factory returns a trusted Provider callback; it is not a public
 * API and does not authorize Host messages, derived summaries, or production
 * Memory→NPC wiring.
 *
 * Only status='active' is accepted until Core defines a broader source-status
 * contract. Unknown/custom statuses fail closed.
 */
export function createCanonicalEntitySourceVersionValidator(engine) {
  if (typeof engine?.getSnapshot !== 'function') {
    throw new TypeError('A trusted Core engine with getSnapshot is required');
  }

  return (input) => {
    let worldId;
    let sourceEntityId;
    let sourceVersion;
    try {
      if (!object(input)
        || input.source_kind !== 'canonical_entity'
        || !validId(input.world_id)
        || !validId(input.source_entity_id)
        || !canonicalDecimal(input.source_version)
        || !Array.isArray(input.lineage)
        || input.lineage.length !== 1) return false;

      const [lineage] = input.lineage;
      if (!object(lineage)
        || lineage.source_kind !== 'canonical_entity'
        || lineage.entity_id !== input.source_entity_id
        || lineage.source_version !== input.source_version) return false;

      worldId = input.world_id;
      sourceEntityId = input.source_entity_id;
      sourceVersion = input.source_version;
    } catch {
      return false;
    }

    let snapshot;
    try {
      snapshot = engine.getSnapshot(worldId, { entityIds: [sourceEntityId] });
    } catch (error) {
      if (error?.code === 'WORLD_NOT_FOUND' || error?.code === 'ENTITY_NOT_FOUND') return false;
      // Preserve Provider's distinction between a stale/denied source and an
      // unavailable Core authority. Do not convert outages into ordinary false.
      throw new Error('CORE_SOURCE_SNAPSHOT_UNAVAILABLE');
    }

    try {
      if (!object(snapshot)
        || snapshot.world_id !== worldId
        || !Number.isSafeInteger(snapshot.world_revision)
        || snapshot.world_revision < 0
        || !Number.isSafeInteger(snapshot.commit_sequence)
        || snapshot.commit_sequence < 0
        || !Array.isArray(snapshot.entities)
        || snapshot.entities.length !== 1) return false;

      const [entity] = snapshot.entities;
      if (!object(entity)
        || entity.entity_id !== sourceEntityId
        || entity.status !== 'active'
        || !Number.isSafeInteger(entity.updated_revision)
        || entity.updated_revision < 0) return false;

      // The version is the canonical decimal encoding of this exact entity's
      // current updated_revision, not the Provider record version or world cursor.
      return sourceVersion === String(entity.updated_revision);
    } catch {
      return false;
    }
  };
}
