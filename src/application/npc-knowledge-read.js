import { types as utilTypes } from "node:util";

const ID_MAX = 200;
const PURPOSES = new Set(["npc_turn_context", "npc_action_evaluation"]);
const RECIPIENTS = new Set(["model"]);
const nonReady = (reason) => Object.freeze({ status: "non_ready", request: null, reason });

function plainDataObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value)) return false;
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

/** Validate untrusted request data before the Core reads any request property. */
export function validateNpcKnowledgeReadInput(input) {
  try {
    if (!exactKeys(input, [
      "world_id", "conversation_id", "adapter_id", "actor_id", "recipient", "purpose",
      "expected_revision", "expected_commit_sequence", "limit",
    ])) return nonReady("invalid_request_shape");

    if (!validId(input.world_id) || !validId(input.conversation_id) || !validId(input.adapter_id) || !validId(input.actor_id)
      || !RECIPIENTS.has(input.recipient) || !PURPOSES.has(input.purpose)
      || !Number.isSafeInteger(input.expected_revision) || input.expected_revision < 0
      || !Number.isSafeInteger(input.expected_commit_sequence) || input.expected_commit_sequence < 0
      || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 200) {
      return nonReady("invalid_request_fields");
    }

    return Object.freeze({
      status: "ready",
      reason: null,
      request: Object.freeze({
        world_id: input.world_id,
        conversation_id: input.conversation_id,
        adapter_id: input.adapter_id,
        actor_id: input.actor_id,
        recipient: input.recipient,
        purpose: input.purpose,
        expected_revision: input.expected_revision,
        expected_commit_sequence: input.expected_commit_sequence,
        limit: input.limit,
      }),
    });
  } catch {
    return nonReady("invalid_read_input");
  }
}

/**
 * Validate a Core-owned, actor/purpose/snapshot-bound read request.
 * The authorizer is a deployment-injected trusted dependency, not request data.
 */
export function validateNpcKnowledgeRead(input, world, commitSequence, authorization) {
  const inputCheck = validateNpcKnowledgeReadInput(input);
  if (inputCheck.status !== "ready") return inputCheck;
  const request = inputCheck.request;
  try {
    if (!world || world.world_id !== request.world_id) return nonReady("world_not_found");
    if (world.status !== "active") return nonReady("world_not_active");
    if (request.expected_revision !== world.world_revision
      || request.expected_commit_sequence !== commitSequence) {
      return nonReady("stale_snapshot");
    }

    if (!exactKeys(authorization, [
      "status", "world_id", "conversation_id", "adapter_id", "actor_id", "recipient", "purpose",
      "world_revision", "commit_sequence", "authorization_ref",
    ]) || authorization.status !== "authorized"
      || authorization.world_id !== request.world_id
      || authorization.conversation_id !== request.conversation_id
      || authorization.adapter_id !== request.adapter_id
      || authorization.actor_id !== request.actor_id
      || authorization.recipient !== request.recipient
      || authorization.purpose !== request.purpose
      || authorization.world_revision !== world.world_revision
      || authorization.commit_sequence !== commitSequence
      || !validId(authorization.authorization_ref)) {
      return nonReady("read_not_authorized");
    }

    return Object.freeze({
      status: "ready",
      reason: null,
      request: Object.freeze({
        world_id: request.world_id,
        conversation_id: request.conversation_id,
        adapter_id: request.adapter_id,
        actor_id: request.actor_id,
        recipient: request.recipient,
        purpose: request.purpose,
        world_revision: world.world_revision,
        commit_sequence: commitSequence,
        authorization_ref: authorization.authorization_ref,
        limit: request.limit,
      }),
    });
  } catch {
    return nonReady("invalid_read_input");
  }
}
