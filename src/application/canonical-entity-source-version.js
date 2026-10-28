const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = (value) => typeof value === 'string' && value === value.trim()
  && value.length > 0 && value.length <= 200
  && ![...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
const canonicalSourceVersion = (value) => typeof value === 'string'
  && /^core-entity-v1:[1-9][0-9]*$/.test(value)
  && Number.isSafeInteger(Number(value.slice('core-entity-v1:'.length)));

/** Opaque Core-issued token for one active canonical entity projection. */
export function canonicalEntitySourceVersion(entity) {
  if (!object(entity) || !canonicalSourceVersion(entity.source_version)) return null;
  return entity.source_version;
}

/**
 * Core-owned source-version validation for direct canonical_entity Memory
 * records. The token comes from Core's durable per-entity source-version counter,
 * atomically advanced with entity mutations and rollback. This factory is an
 * internal Provider callback, not a public API or production Memory→NPC switch.
 */
export function createCanonicalEntitySourceVersionValidator(engine) {
  if (typeof engine?.getCanonicalEntitySourceState !== 'function') {
    throw new TypeError('A trusted Core engine with canonical source-state readback is required');
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
        || !canonicalSourceVersion(input.source_version)
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

    let state;
    try {
      state = engine.getCanonicalEntitySourceState(worldId, sourceEntityId);
    } catch (error) {
      if (error?.code === 'WORLD_NOT_FOUND' || error?.code === 'ENTITY_NOT_FOUND') return false;
      throw new Error('CORE_SOURCE_SNAPSHOT_UNAVAILABLE');
    }

    try {
      if (!object(state)
        || state.world_id !== worldId
        || state.entity_id !== sourceEntityId
        || state.status !== 'active'
        || !Number.isSafeInteger(state.updated_revision)
        || state.updated_revision < 0
        || !Number.isSafeInteger(state.world_revision)
        || state.world_revision < 0
        || !Number.isSafeInteger(state.commit_sequence)
        || state.commit_sequence < 0
        || canonicalEntitySourceVersion(state) === null) return false;
      return sourceVersion === canonicalEntitySourceVersion(state);
    } catch {
      return false;
    }
  };
}
