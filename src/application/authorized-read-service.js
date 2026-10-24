import { EngineError, assert } from '../core/errors.js';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = (value) => typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= 200;
const PURPOSES = new Set(['npc_decision', 'character_card', 'narrative']);
const RECIPIENTS = new Set(['model', 'player', 'adapter']);

const unavailable = () => new EngineError(
  'READ_NOT_AVAILABLE',
  'The requested read is not available.',
  404,
);

/**
 * Internal, fail-closed read boundary.
 *
 * fieldPolicy is trusted application configuration. It must explicitly return
 * true for each field that may be disclosed to the supplied requester/actor,
 * recipient and purpose. Missing/throwing policy decisions deny disclosure.
 *
 * This service is intentionally not an HTTP endpoint and does not define a
 * default public visibility policy. Do not pass model-produced policy functions.
 */
export class AuthorizedReadService {
  constructor(engine, actorBindingService, fieldPolicy) {
    if (typeof engine?.getSnapshot !== 'function') {
      throw new TypeError('AuthorizedReadService requires a LogicEngine');
    }
    if (typeof actorBindingService?.resolve !== 'function') {
      throw new TypeError('AuthorizedReadService requires an ActorBindingService');
    }
    if (typeof fieldPolicy !== 'function') {
      throw new TypeError('AuthorizedReadService requires an explicit trusted field policy');
    }
    this.engine = engine;
    this.actorBindingService = actorBindingService;
    this.fieldPolicy = fieldPolicy;
  }

  readEntityFields(request) {
    assert(object(request), 'INVALID_AUTHORIZED_READ', 'Read request must be an object.');
    assert(validId(request.worldId) && validId(request.adapterId) && validId(request.actorEntityId),
      'INVALID_AUTHORIZED_READ', 'worldId, adapterId and actorEntityId are required.');
    assert(RECIPIENTS.has(request.recipient), 'INVALID_READ_RECIPIENT', 'Unsupported read recipient.');
    assert(PURPOSES.has(request.purpose), 'INVALID_READ_PURPOSE', 'Unsupported read purpose.');
    assert(Array.isArray(request.entityIds) && request.entityIds.length > 0 && request.entityIds.length <= 50
      && request.entityIds.every(validId),
    'INVALID_READ_TARGETS', 'entityIds must contain between 1 and 50 valid identifiers.');
    assert(new Set(request.entityIds).size === request.entityIds.length,
      'INVALID_READ_TARGETS', 'entityIds must be unique.');
    assert(Array.isArray(request.fields) && request.fields.length > 0 && request.fields.length <= 50
      && request.fields.every((field) => typeof field === 'string' && /^[a-zA-Z][a-zA-Z0-9_.-]{0,99}$/.test(field)),
    'INVALID_READ_FIELDS', 'fields must contain between 1 and 50 valid field names.');
    assert(new Set(request.fields).size === request.fields.length,
      'INVALID_READ_FIELDS', 'fields must be unique.');

    const binding = this.actorBindingService.resolve(
      request.worldId,
      request.adapterId,
      request.actorEntityId,
    );
    const context = Object.freeze({
      worldId: request.worldId,
      authenticatedAdapterId: binding.adapter_id,
      actor: Object.freeze({ ...binding.actor }),
      recipient: request.recipient,
      purpose: request.purpose,
    });

    let snapshot;
    try {
      snapshot = this.engine.getSnapshot(request.worldId, { entityIds: request.entityIds });
    } catch (error) {
      if (error?.code === 'ENTITY_NOT_FOUND') throw unavailable();
      throw error;
    }

    // Treat the requested target set atomically. A snapshot can omit missing IDs;
    // returning the remaining entities would leak which requested IDs exist.
    const returnedIds = new Set(snapshot.entities.map((entity) => entity.entity_id));
    if (snapshot.entities.length !== request.entityIds.length
      || request.entityIds.some((entityId) => !returnedIds.has(entityId))) {
      throw unavailable();
    }

    const entities = [];
    for (const entity of snapshot.entities) {
      const disclosed = {};
      for (const field of request.fields) {
        let allowed = false;
        try {
          allowed = this.fieldPolicy(context, Object.freeze({ ...entity }), field) === true;
        } catch {
          allowed = false;
        }
        if (!allowed) continue;

        if (field === 'entity_id' || field === 'entity_type' || field === 'status') {
          if (Object.hasOwn(entity, field)) disclosed[field] = entity[field];
          continue;
        }
        if (field.startsWith('attributes.')) {
          const attributeName = field.slice('attributes.'.length);
          if (attributeName && object(entity.attributes) && Object.hasOwn(entity.attributes, attributeName)) {
            disclosed[field] = entity.attributes[attributeName];
          }
        }
      }
      // Do not return a partial target set: missing and fully withheld targets
      // share one external failure shape, preventing simple existence probing.
      if (Object.keys(disclosed).length === 0) throw unavailable();
      entities.push(disclosed);
    }

    return Object.freeze({
      world_id: snapshot.world_id,
      world_revision: snapshot.world_revision,
      commit_sequence: snapshot.commit_sequence,
      entities: Object.freeze(entities.map((entity) => Object.freeze(entity))),
    });
  }
}
