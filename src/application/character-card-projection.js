import { EngineError, assert } from '../core/errors.js';

const PROJECTION_VERSION = 'character-card-read-v1';
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Build a minimal, read-only character-card projection from an already obtained
 * world-state snapshot. This function deliberately does not read storage,
 * infer profile fields, expose attributes/facts, or establish player access.
 *
 * supportedEntityTypes must be an explicit caller-owned allowlist. An empty
 * or missing allowlist fails closed.
 */
export function projectCharacterCard(worldSnapshot, entityId, options = {}) {
  assert(isObject(worldSnapshot), 'INVALID_PROJECTION_SNAPSHOT', 'World snapshot must be an object.');
  assert(typeof worldSnapshot.world_id === 'string' && worldSnapshot.world_id.trim(),
    'INVALID_PROJECTION_SNAPSHOT', 'World snapshot must contain a world_id.');
  assert(typeof entityId === 'string' && entityId.trim(),
    'INVALID_ENTITY_ID', 'entityId must be a non-empty string.');

  const supportedEntityTypes = options.supportedEntityTypes;
  assert(Array.isArray(supportedEntityTypes) && supportedEntityTypes.length > 0
    && supportedEntityTypes.every((type) => typeof type === 'string' && type.trim()),
  'CHARACTER_TYPE_ALLOWLIST_REQUIRED', 'An explicit non-empty supportedEntityTypes allowlist is required.');

  const entities = worldSnapshot.entities;
  assert(Array.isArray(entities), 'INVALID_PROJECTION_SNAPSHOT', 'World snapshot must contain an entities array.');

  const entity = entities.find((item) => isObject(item) && item.entity_id === entityId);
  if (!entity) {
    throw new EngineError('ENTITY_NOT_FOUND', 'Entity not found in the requested world snapshot.', 404);
  }

  if (!supportedEntityTypes.includes(entity.entity_type)) {
    throw new EngineError('UNSUPPORTED_CHARACTER_ENTITY_TYPE', 'Entity type is not enabled for character-card projection.', 422);
  }

  // Intentionally omit attributes, facts, event payloads and inferred profile
  // data. Current runtime attributes have no typed card schema or field policy.
  const projection = {
    projection_version: PROJECTION_VERSION,
    world_id: worldSnapshot.world_id,
    entity_id: entity.entity_id,
    entity_type: entity.entity_type,
    status: entity.status,
  };

  if (Number.isSafeInteger(worldSnapshot.world_revision) && worldSnapshot.world_revision >= 0) {
    projection.source_revision = worldSnapshot.world_revision;
  }

  return projection;
}
