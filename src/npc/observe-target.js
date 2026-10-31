/**
 * One-target, one-attribute NPC observation cycle.
 *
 * This composes the existing Core AuthorizedReadService. It is deliberately
 * read-only: it cannot create goals, persist beliefs, emit Core events, or
 * mutate canonical world state.
 */

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const plainDataObject = (value) => {
  if (!object(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Reflect.ownKeys(value).every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return typeof key === "string" && descriptor !== undefined && Object.hasOwn(descriptor, "value");
    });
  } catch {
    return false;
  }
};
const validId = (value) => typeof value === "string"
  && value === value.trim()
  && value.length > 0
  && value.length <= 200;
const validAttribute = (value) => typeof value === "string"
  && /^[a-zA-Z][a-zA-Z0-9_.-]{0,99}$/.test(value)
  && !["__proto__", "constructor", "prototype"].some((part) => value.split(".").includes(part));

const TRUSTED_CONTEXT_KEYS = new Set([
  "worldId",
  "adapterId",
  "actorEntityId",
  "expectedWorldRevision",
  "expectedCommitSequence",
  "expectedPolicyAuthority",
]);

function trustedContextOf(value) {
  if (!plainDataObject(value) || !Reflect.ownKeys(value).every((key) => TRUSTED_CONTEXT_KEYS.has(key))) {
    throw new TypeError("Trusted NPC read context is invalid.");
  }
  if (!validId(value.worldId) || !validId(value.adapterId) || !validId(value.actorEntityId)) {
    throw new TypeError("Trusted world, adapter, and actor identity are required.");
  }
  if (!Number.isSafeInteger(value.expectedWorldRevision) || value.expectedWorldRevision < 0
    || !Number.isSafeInteger(value.expectedCommitSequence) || value.expectedCommitSequence < 0) {
    throw new TypeError("Trusted world snapshot cursor is required.");
  }
  if (!object(value.expectedPolicyAuthority)) {
    throw new TypeError("Trusted versioned policy authority snapshot is required.");
  }
  return value;
}

function freezeData(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) freezeData(value[key]);
  return Object.freeze(value);
}

function copyData(value) {
  return freezeData(structuredClone(value));
}

/**
 * @param {{
 *   authorizedReadService: { readEntityAttributeForMechanic(request: object): object },
 *   getTrustedReadContext: () => object
 * }} dependencies
 *
 * getTrustedReadContext must be a Host-owned closure over authenticated adapter
 * identity, canonical actor binding, current Core snapshot cursor, and current
 * policy-authority snapshot. Never implement it from model output.
 */
export function createObserveTargetCycle({ authorizedReadService, getTrustedReadContext } = {}) {
  if (typeof authorizedReadService?.readEntityAttributeForMechanic !== "function") {
    throw new TypeError("ObserveTargetCycle requires Core AuthorizedReadService.");
  }
  if (typeof getTrustedReadContext !== "function") {
    throw new TypeError("ObserveTargetCycle requires a trusted Host context provider.");
  }

  function observeTarget(input) {
    if (!object(input)
      || Object.keys(input).some((key) => key !== "targetEntityId" && key !== "attribute")
      || !validId(input.targetEntityId)
      || !validAttribute(input.attribute)) {
      throw new TypeError("Observation requires exactly one targetEntityId and one valid attribute.");
    }

    const trusted = trustedContextOf(getTrustedReadContext());
    const result = authorizedReadService.readEntityAttributeForMechanic({
      worldId: trusted.worldId,
      adapterId: trusted.adapterId,
      actorEntityId: trusted.actorEntityId,
      recipient: "model",
      purpose: "npc_decision",
      entityId: input.targetEntityId,
      attribute: input.attribute,
      expectedWorldRevision: trusted.expectedWorldRevision,
      expectedCommitSequence: trusted.expectedCommitSequence,
      expectedPolicyAuthority: trusted.expectedPolicyAuthority,
    });

    if (!object(result)
      || result.world_id !== trusted.worldId
      || result.entity_id !== input.targetEntityId
      || result.attribute !== input.attribute
      || result.world_revision !== trusted.expectedWorldRevision
      || result.commit_sequence !== trusted.expectedCommitSequence
      || result.policy_authority?.authority_id !== trusted.expectedPolicyAuthority.authority_id
      || result.policy_authority?.generation !== trusted.expectedPolicyAuthority.generation
      || typeof result.present !== "boolean") {
      throw new Error("Core authorized-read result did not match the trusted observation request.");
    }

    return copyData({
      receipt_type: "npc.observe-target.receipt.v1",
      status: "observed",
      world_id: result.world_id,
      adapter_id: trusted.adapterId,
      actor_entity_id: trusted.actorEntityId,
      recipient: "model",
      purpose: "npc_decision",
      target_entity_id: result.entity_id,
      attribute: result.attribute,
      world_revision: result.world_revision,
      commit_sequence: result.commit_sequence,
      policy_authority: result.policy_authority,
      present: result.present,
      ...(result.present ? { value: result.value } : {}),
    });
  }

  return Object.freeze({ observeTarget });
}
