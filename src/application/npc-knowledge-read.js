const ID_MAX = 200;
const PURPOSES = new Set(["npc_turn_context", "npc_action_evaluation"]);

const nonReady = (reason) => Object.freeze({ status: "non_ready", request: null, reason });

function plainDataObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Reflect.ownKeys(value).every((key) => {
      if (typeof key !== "string") return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor && Object.hasOwn(descriptor, "value");
    });
  } catch {
    return false;
  }
}

function validId(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= ID_MAX
    && value === value.trim()
    && ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    });
}

function exactKeys(value, keys) {
  return plainDataObject(value)
    && Reflect.ownKeys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key))
    && Reflect.ownKeys(value).every((key) => typeof key === "string" && keys.includes(key));
}

/**
 * Validate a Core-owned, actor/purpose/snapshot-bound read request.
 * The authorizer is a deployment-injected trusted dependency, not request data.
 */
export function validateNpcKnowledgeRead(input, world, commitSequence, authorization) {
  try {
    if (!exactKeys(input, [
      "world_id", "actor_id", "purpose",
      "expected_revision", "expected_commit_sequence", "limit",
    ])) return nonReady("invalid_request_shape");

    if (!validId(input.world_id) || !validId(input.actor_id)
      || !PURPOSES.has(input.purpose)
      || !Number.isSafeInteger(input.expected_revision) || input.expected_revision < 0
      || !Number.isSafeInteger(input.expected_commit_sequence) || input.expected_commit_sequence < 0
      || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 200) {
      return nonReady("invalid_request_fields");
    }

    if (!world || world.world_id !== input.world_id) return nonReady("world_not_found");
    if (world.status !== "active") return nonReady("world_not_active");
    if (input.expected_revision !== world.world_revision
      || input.expected_commit_sequence !== commitSequence) {
      return nonReady("stale_snapshot");
    }

    if (!exactKeys(authorization, [
      "status", "world_id", "actor_id", "purpose",
      "world_revision", "commit_sequence", "authorization_ref",
    ]) || authorization.status !== "authorized"
      || authorization.world_id !== input.world_id
      || authorization.actor_id !== input.actor_id
      || authorization.purpose !== input.purpose
      || authorization.world_revision !== world.world_revision
      || authorization.commit_sequence !== commitSequence
      || !validId(authorization.authorization_ref)) {
      return nonReady("read_not_authorized");
    }

    return Object.freeze({
      status: "ready",
      reason: null,
      request: Object.freeze({
        world_id: input.world_id,
        actor_id: input.actor_id,
        purpose: input.purpose,
        world_revision: world.world_revision,
        commit_sequence: commitSequence,
        authorization_ref: authorization.authorization_ref,
        limit: input.limit,
      }),
    });
  } catch {
    return nonReady("invalid_read_input");
  }
}
