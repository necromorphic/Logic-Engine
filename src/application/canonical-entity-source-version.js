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
 * records. The opaque token comes from Core's durable per-entity source-version
 * counter, not from updated_revision or a world snapshot cursor. This factory
 * returns a trusted Provider callback; it is not a public API and does not
 * authorize Host messages, derived summaries, or production Memory→NPC wiring.
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

    let snapshot;
    try {
      snapshot = engine.getSnapshot(worldId, { entityIds: [sourceEntityId], includeSourceVersions: true });
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
        || canonicalEntitySourceVersion(entity) === null) return false;

      // Compare against the current Core-owned token for this exact entity.
      // The token survives ordinary projection rebuilds and advances on rollback
      // when the canonical projection changes; it is not a world cursor.
      return sourceVersion === canonicalEntitySourceVersion(entity);
    } catch {
      return false;
    }
  };
}

 
/**
 * Complete-inventory attestation for the direct canonical-entity source slice.
 * Reads every Core entity through snapshot-pinned pages, then verifies that each
 * Provider record is backed by an active entity with the exact current token.
 * Any unavailable, stale, partial, malformed, or unverifiable inventory fails
 * closed. This callback does not enable Memory→NPC traffic by itself.
 */
export function createCanonicalEntityInventoryValidator(engine) {
  if (typeof engine?.getCanonicalEntityInventory !== 'function') {
    throw new TypeError('A trusted Core engine with getCanonicalEntityInventory is required');
  }

  return async (worldId, records) => {
    if (!validId(worldId) || !Array.isArray(records)) return false;
    const inventory = new Map();
    let cursor = null;
    let marker = null;
    let previousEntityId = null;
    let pageCount = 0;

    try {
      do {
        const page = engine.getCanonicalEntityInventory(worldId, {
          limit: 200,
          ...(cursor ? { cursor } : {}),
        });
        pageCount += 1;
        if (!object(page)
          || page.world_id !== worldId
          || !Number.isSafeInteger(page.world_revision)
          || page.world_revision < 0
          || !Number.isSafeInteger(page.commit_sequence)
          || page.commit_sequence < 0
          || !Array.isArray(page.entities)
          || typeof page.complete !== 'boolean') return false;

        const currentMarker = {
          world_revision: page.world_revision,
          commit_sequence: page.commit_sequence,
        };
        if (marker && (marker.world_revision !== currentMarker.world_revision
          || marker.commit_sequence !== currentMarker.commit_sequence)) return false;
        marker = currentMarker;

        for (const entity of page.entities) {
          if (!object(entity) || !validId(entity.entity_id)
            || !['active', 'destroyed'].includes(entity.status)
            || (entity.source_version !== null && !canonicalSourceVersion(entity.source_version))
            || inventory.has(entity.entity_id)
            || (previousEntityId !== null && entity.entity_id <= previousEntityId)) return false;
          inventory.set(entity.entity_id, entity);
          previousEntityId = entity.entity_id;
        }

        if (page.complete) {
          if (page.next_cursor !== null) return false;
          cursor = null;
        } else {
          if (!page.next_cursor || typeof page.next_cursor !== 'object'
            || page.entities.length === 0
            || page.next_cursor.after_entity_id !== previousEntityId
            || page.next_cursor.world_revision !== page.world_revision
            || page.next_cursor.commit_sequence !== page.commit_sequence) return false;
          cursor = page.next_cursor;
        }
        if (pageCount > 100000) return false;
      } while (cursor);

      for (const record of records) {
        if (!object(record)
          || record.world_id !== worldId
          || record.source_kind !== 'canonical_entity'
          || !validId(record.source_entity_id)
          || !canonicalSourceVersion(record.source_version)) return false;
        const entity = inventory.get(record.source_entity_id);
        if (!entity || entity.status !== 'active'
          || entity.source_version !== record.source_version) return false;
      }
      return true;
    } catch {
      return false;
    }
  };
}
