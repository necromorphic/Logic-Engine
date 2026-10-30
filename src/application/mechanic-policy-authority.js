import { randomUUID } from 'node:crypto';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function defaultMechanicPolicyFieldPolicy(context, entity, field) {
  return entity.entity_id === context.actor.entity_id
    && ['entity_id', 'entity_type', 'status'].includes(field);
}

export function isMechanicPolicyAuthoritySnapshot(value) {
  try {
    return isRecord(value)
      && Object.keys(value).length === 2
      && typeof value.authority_id === 'string'
      && value.authority_id === value.authority_id.trim()
      && value.authority_id.length > 0
      && Number.isSafeInteger(value.generation)
      && value.generation > 0;
  } catch {
    return false;
  }
}

export function isMechanicPolicyAuthority(value) {
  try {
    return value !== null && typeof value === 'object'
      && typeof value.getSnapshot === 'function'
      && typeof value.isCurrent === 'function'
      && typeof value.authorizeField === 'function';
  } catch {
    return false;
  }
}

/**
 * Deployment-owned, versioned field-visibility authority.
 *
 * The authority identity is stable for one policy source. Its generation must
 * be supplied by trusted deployment code and must not be reset to an older
 * value after restart. If a deployment cannot persist/recover its generation,
 * it must use a new authority identity after restart so old proposals fail closed.
 *
 * rotate() is an in-process operation for trusted deployment code. It does not
 * provide cross-process coordination or linearizable revocation with Core commit.
 */
export class MechanicPolicyAuthority {
  #authorityId;
  #generation;
  #fieldPolicy;

  constructor({ authorityId, generation, fieldPolicy } = {}) {
    if (typeof authorityId !== 'string' || !authorityId.trim() || authorityId.length > 200) {
      throw new TypeError('Mechanic policy authority requires a stable authorityId.');
    }
    if (!Number.isSafeInteger(generation) || generation < 1) {
      throw new TypeError('Mechanic policy authority requires a positive safe-integer generation.');
    }
    if (typeof fieldPolicy !== 'function') {
      throw new TypeError('Mechanic policy authority requires a trusted synchronous fieldPolicy.');
    }
    this.#authorityId = authorityId.trim();
    this.#generation = generation;
    this.#fieldPolicy = fieldPolicy;
  }

  getSnapshot() {
    return Object.freeze({
      authority_id: this.#authorityId,
      generation: this.#generation,
    });
  }

  isCurrent(snapshot) {
    return isMechanicPolicyAuthoritySnapshot(snapshot)
      && snapshot.authority_id === this.#authorityId
      && snapshot.generation === this.#generation;
  }

  authorizeField(context, entity, field, expectedSnapshot = this.getSnapshot()) {
    if (!this.isCurrent(expectedSnapshot)) return false;
    let allowed = false;
    try {
      allowed = this.#fieldPolicy(context, entity, field) === true;
    } catch {
      return false;
    }
    // A policy callback may synchronously rotate the authority. Never allow a
    // decision made under the old generation to escape after that rotation.
    return allowed && this.isCurrent(expectedSnapshot);
  }

  rotate(fieldPolicy) {
    if (typeof fieldPolicy !== 'function') {
      throw new TypeError('A policy rotation requires a trusted synchronous fieldPolicy.');
    }
    if (this.#generation === Number.MAX_SAFE_INTEGER) {
      throw new RangeError('Mechanic policy authority generation is exhausted.');
    }
    this.#fieldPolicy = fieldPolicy;
    this.#generation += 1;
    return this.getSnapshot();
  }
}


/**
 * Build an authority identity that is unique to this process lifetime.
 *
 * The configured ID identifies the deployment policy source; the random
 * process suffix prevents persisted proposals from becoming current again
 * when a process restarts with an old generation value.
 */
export function createProcessScopedMechanicPolicyAuthority({
  authorityId,
  generation = 1,
  fieldPolicy,
} = {}) {
  if (typeof authorityId !== 'string' || !authorityId.trim() || authorityId.length > 160) {
    throw new TypeError('Mechanic policy authority requires a non-empty deployment identity.');
  }
  return new MechanicPolicyAuthority({
    authorityId: authorityId.trim() + ':' + randomUUID(),
    generation,
    fieldPolicy,
  });
}
