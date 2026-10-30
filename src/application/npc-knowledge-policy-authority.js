import { createHash, randomUUID } from 'node:crypto';
import { types as utilTypes } from 'node:util';

const PURPOSES = Object.freeze(['npc_action_evaluation', 'npc_turn_context']);
const RECIPIENTS = Object.freeze(['model']);

export function isNpcKnowledgePolicyAuthoritySnapshot(value) {
  try {
    if (!value || typeof value !== 'object' || utilTypes.isProxy(value) || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== 3
      || keys.some((key) => typeof key !== 'string')
      || !['authority_id', 'generation', 'snapshot_fingerprint'].every((key) => keys.includes(key))) return false;
    const descriptors = Object.fromEntries(keys.map((key) => [key, Object.getOwnPropertyDescriptor(value, key)]));
    if (keys.some((key) => !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key], 'value'))) return false;
    const authorityId = descriptors.authority_id.value;
    const generation = descriptors.generation.value;
    const fingerprint = descriptors.snapshot_fingerprint.value;
    return typeof authorityId === 'string'
      && authorityId.length > 0
      && authorityId === authorityId.trim()
      && Number.isSafeInteger(generation)
      && generation > 0
      && typeof fingerprint === 'string'
      && /^[a-f0-9]{64}$/.test(fingerprint);
  } catch {
    return false;
  }
}

export function isNpcKnowledgePolicyAuthority(value) {
  try {
    return value !== null && typeof value === 'object' && !utilTypes.isProxy(value)
      && typeof value.getSnapshot === 'function'
      && typeof value.isCurrent === 'function'
      && typeof value.advanceGeneration === 'function';
  } catch {
    return false;
  }
}

/**
 * Process-scoped Core policy authority for Lane A NPC knowledge reads.
 *
 * The fingerprint pins the deployment-owned source registry and the fixed
 * recipient/purpose rules. The generation advances when a trusted Core binding
 * is created, rebound, or revoked. A fresh authority ID on process start makes
 * every prior process snapshot stale. This is not a multi-process authority;
 * deployments with multiple independent Core writers remain disabled.
 */
export function createNpcKnowledgePolicyAuthority({ adapterIds, trustedInitialKnowledgeSources } = {}) {
  if (!Array.isArray(adapterIds) || adapterIds.some((id) => typeof id !== 'string' || !id.trim())
    || new Set(adapterIds).size !== adapterIds.length) {
    throw new TypeError('NPC knowledge policy authority requires unique configured adapter IDs.');
  }
  if (!Array.isArray(trustedInitialKnowledgeSources)) {
    throw new TypeError('NPC knowledge policy authority requires a deployment-owned source registry.');
  }

  const sources = trustedInitialKnowledgeSources.map((source) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      throw new TypeError('NPC knowledge policy source entries must be objects.');
    }
    const fields = [
      'world_pack_id', 'world_pack_version', 'source_kind', 'source_ref',
      'authorization_ref', 'sha256',
    ];
    if (fields.some((field) => typeof source[field] !== 'string' || !source[field].trim())
      || !/^[a-f0-9]{64}$/.test(source.sha256)) {
      throw new TypeError('NPC knowledge policy source entry is malformed.');
    }
    return Object.freeze(Object.fromEntries(fields.map((field) => [field, source[field]])));
  }).sort((left, right) => {
    const a = JSON.stringify(left);
    const b = JSON.stringify(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });

  const snapshotFingerprint = createHash('sha256').update(JSON.stringify({
    contract: 'core.npc-knowledge-disclosure.v1',
    adapter_ids: [...adapterIds].sort(),
    recipients: RECIPIENTS,
    lane_a_purposes: PURPOSES,
    visibility_rule: 'trusted-world-pack-source-reference-and-sha256-v1',
    sources,
  })).digest('hex');

  let authorityId = 'core:npc-knowledge-policy:' + randomUUID();
  let generation = 1;

  const getSnapshot = () => Object.freeze({
    authority_id: authorityId,
    generation,
    snapshot_fingerprint: snapshotFingerprint,
  });

  const isCurrent = (snapshot) => isNpcKnowledgePolicyAuthoritySnapshot(snapshot)
    && snapshot.authority_id === authorityId
    && snapshot.generation === generation
    && snapshot.snapshot_fingerprint === snapshotFingerprint;

  const advanceGeneration = () => {
    if (generation === Number.MAX_SAFE_INTEGER) {
      // Exhaustion is practically unreachable; rotate identity rather than
      // permit a stale snapshot to compare equal after wraparound.
      authorityId = 'core:npc-knowledge-policy:' + randomUUID();
      generation = 1;
    } else {
      generation += 1;
    }
    return getSnapshot();
  };

  return Object.freeze({ getSnapshot, isCurrent, advanceGeneration });
}
