/**
 * Deployment-owned authority for the bounded mechanic context policy.
 *
 * The deployment supplies the authoritative active-policy resolver. The
 * returned record is trusted application state, never request/evaluation data.
 * One authority instance is shared by context resolution and ProposalService.
 */
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const validPrincipal = (value) => object(value)
  && Object.keys(value).every((key) => ['adapterId', 'actorEntityId', 'recipient', 'purpose'].includes(key))
  && typeof value.adapterId === 'string' && value.adapterId.trim()
  && typeof value.actorEntityId === 'string' && value.actorEntityId.trim()
  && ['model', 'player', 'adapter'].includes(value.recipient)
  && ['npc_decision', 'character_card', 'narrative'].includes(value.purpose);
const samePrincipal = (left, right) => validPrincipal(left) && validPrincipal(right)
  && left.adapterId === right.adapterId
  && left.actorEntityId === right.actorEntityId
  && left.recipient === right.recipient
  && left.purpose === right.purpose;

function validPolicyRecord(record) {
  return object(record)
    && Object.keys(record).every((key) => ['authority_id', 'generation', 'contextProvider'].includes(key))
    && typeof record.authority_id === 'string' && record.authority_id.trim().length > 0
    && Number.isSafeInteger(record.generation) && record.generation >= 1
    && typeof record.contextProvider?.resolve === 'function'
    && typeof record.contextProvider.policyFingerprint === 'string'
    && record.contextProvider.policyFingerprint.trim().length > 0
    && typeof record.contextProvider.authorizationScope === 'string'
    && record.contextProvider.authorizationScope.trim().length > 0
    && validPrincipal(record.contextProvider.authorizationPrincipal);
}

function sameGeneration(left, right) {
  return left.authority_id === right.authority_id && left.generation === right.generation;
}

export class DeploymentMechanicPolicyAuthority {
  #authorityId = null;
  #highestGeneration = 0;
  #lastFingerprint = null;

  constructor({ resolveActivePolicy } = {}) {
    if (typeof resolveActivePolicy !== 'function') {
      throw new TypeError('A trusted deployment-owned active mechanic policy resolver is required.');
    }
    this.resolveActivePolicy = resolveActivePolicy;
    Object.freeze(this);
  }

  resolveCurrentPolicy() {
    let record;
    try {
      record = this.resolveActivePolicy();
    } catch {
      throw new Error('Active mechanic policy authority is unavailable.');
    }
    if (!validPolicyRecord(record)) {
      throw new Error('Active mechanic policy authority returned a malformed identity, generation, principal, or context provider.');
    }
    if (this.#authorityId !== null && record.authority_id !== this.#authorityId) {
      throw new Error('Active mechanic policy authority identity changed unexpectedly.');
    }
    if (record.generation < this.#highestGeneration
      || (record.generation === this.#highestGeneration && this.#lastFingerprint !== null
        && record.contextProvider.policyFingerprint !== this.#lastFingerprint)) {
      throw new Error('Active mechanic policy generation is not monotonic for the configured authority.');
    }
    this.#authorityId ??= record.authority_id;
    this.#highestGeneration = record.generation;
    this.#lastFingerprint = record.contextProvider.policyFingerprint;
    return record;
  }

  resolveAuthorizedContext(args) {
    const active = this.resolveCurrentPolicy();
    const principal = active.contextProvider.authorizationPrincipal;
    if (!object(args) || args.authenticatedAdapterId !== principal.adapterId) {
      throw new Error('Mechanic evaluation adapter does not match the deployment policy principal.');
    }
    const resolved = active.contextProvider.resolve(args);
    const after = this.resolveCurrentPolicy();
    if (!sameGeneration(active, after)
      || active.contextProvider.policyFingerprint !== after.contextProvider.policyFingerprint
      || active.contextProvider.authorizationScope !== after.contextProvider.authorizationScope
      || !samePrincipal(active.contextProvider.authorizationPrincipal, after.contextProvider.authorizationPrincipal)) {
      throw new Error('Mechanic policy changed during authorized context resolution.');
    }
    if (!object(resolved)
      || resolved.policy_version !== active.contextProvider.policyFingerprint
      || resolved.authorization_scope !== active.contextProvider.authorizationScope
      || !samePrincipal(resolved.authorization_principal, principal)) {
      throw new Error('Context provider evidence does not match the active deployment policy principal.');
    }
    return Object.freeze({
      ...resolved,
      authority_id: active.authority_id,
      policy_generation: active.generation,
    });
  }

  validateMechanicPolicy(identity) {
    if (!object(identity)
      || typeof identity.worldId !== 'string' || !identity.worldId.trim()
      || typeof identity.authorityId !== 'string' || !identity.authorityId.trim()
      || !Number.isSafeInteger(identity.policyGeneration) || identity.policyGeneration < 1
      || typeof identity.policyVersion !== 'string' || !identity.policyVersion.trim()
      || typeof identity.authorizationScope !== 'string' || !identity.authorizationScope.trim()
      || !validPrincipal(identity.authorizationPrincipal)
      || !object(identity.snapshotIdentity)
      || identity.snapshotIdentity.world_id !== identity.worldId
      || !Number.isSafeInteger(identity.snapshotIdentity.world_revision)
      || !Number.isSafeInteger(identity.snapshotIdentity.commit_sequence)) {
      return false;
    }

    let current;
    try {
      current = this.resolveCurrentPolicy();
    } catch {
      return false;
    }
    return identity.authorityId === current.authority_id
      && identity.policyGeneration === current.generation
      && identity.policyVersion === current.contextProvider.policyFingerprint
      && identity.authorizationScope === current.contextProvider.authorizationScope
      && samePrincipal(identity.authorizationPrincipal, current.contextProvider.authorizationPrincipal);
  }
}
