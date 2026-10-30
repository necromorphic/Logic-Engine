import { hashRequest } from '../core/request-hash.js';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const validIdentity = (value) => typeof value === 'string' && value === value.trim()
  && value.length > 0 && value.length <= 200;
const validGeneration = (value) => (typeof value === 'string' && value === value.trim()
  && value.length > 0 && value.length <= 200)
  || (Number.isSafeInteger(value) && value >= 0);

/**
 * Deployment-owned source of truth for field authorization and policy freshness.
 *
 * resolveActivePolicy must return the currently effective policy on every call:
 * { authority_identity, generation, authorizeField(context, entity, field) }.
 * The deployment owns generation changes. Reusing a generation after changing
 * effective policy is a deployment contract violation.
 */
export class DeploymentPolicyAuthority {
  constructor({ authorityIdentity, resolveActivePolicy } = {}) {
    if (!validIdentity(authorityIdentity)) {
      throw new TypeError('DeploymentPolicyAuthority requires a stable authorityIdentity.');
    }
    if (typeof resolveActivePolicy !== 'function') {
      throw new TypeError('DeploymentPolicyAuthority requires resolveActivePolicy.');
    }
    this.authorityIdentity = authorityIdentity;
    this.resolveActivePolicy = resolveActivePolicy;
    Object.freeze(this);
  }

  resolve() {
    const active = this.resolveActivePolicy();
    if (!object(active)
      || active.authority_identity !== this.authorityIdentity
      || !validGeneration(active.generation)
      || typeof active.authorizeField !== 'function') {
      throw new TypeError('Active deployment policy is unavailable or malformed.');
    }
    return Object.freeze({
      authority_identity: this.authorityIdentity,
      policy_generation: String(active.generation),
      authorizeField: active.authorizeField,
    });
  }

  capture() {
    const active = this.resolve();
    return Object.freeze({
      authority_identity: active.authority_identity,
      policy_generation: active.policy_generation,
      policy_version: hashRequest({
        authority_identity: active.authority_identity,
        policy_generation: active.policy_generation,
      }),
    });
  }

  isCurrent(evidence) {
    if (!object(evidence)
      || evidence.authority_identity !== this.authorityIdentity
      || typeof evidence.policy_generation !== 'string'
      || !evidence.policy_generation.trim()) return false;
    try {
      const current = this.capture();
      return current.authority_identity === evidence.authority_identity
        && current.policy_generation === evidence.policy_generation
        && (evidence.policy_version === undefined || current.policy_version === evidence.policy_version);
    } catch {
      return false;
    }
  }

  authorizeField(context, entity, field, expectedEvidence) {
    try {
      const active = this.resolve();
      if (expectedEvidence && !this.isCurrent(expectedEvidence)) return false;
      return active.authorizeField(context, entity, field) === true;
    } catch {
      return false;
    }
  }
}
