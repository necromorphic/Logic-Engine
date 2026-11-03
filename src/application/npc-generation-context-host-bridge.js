import { types as utilTypes } from 'node:util';

function validId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200
    && value === value.trim()
    && ![...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

function isDeepFrozenPlainData(value, depth = 0, seen = new WeakSet()) {
  if (depth > 32) return false;
  if (value === null || ['string', 'boolean'].includes(typeof value)) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || utilTypes.isProxy(value) || seen.has(value) || !Object.isFrozen(value)) return false;
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) return false;
      const keys = Reflect.ownKeys(value);
      if (keys.length !== value.length + 1 || !keys.includes('length')) return false;
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, 'value')
          || !isDeepFrozenPlainData(descriptor.value, depth + 1, seen)) return false;
      }
      return true;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const keys = Reflect.ownKeys(value);
    for (const key of keys) {
      if (typeof key !== 'string') return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')
        || !isDeepFrozenPlainData(descriptor.value, depth + 1, seen)) return false;
    }
    return true;
  } catch { return false; }
  finally { seen.delete(value); }
}

function validateProjection(value) {
  if (!isDeepFrozenPlainData(value) || !value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = [
    'world_id', 'actor_id', 'conversation_id', 'adapter_id', 'purpose', 'snapshot',
    'contentBlocks', 'sources', 'candidates',
  ];
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== 'string' || !keys.includes(key))
    || !keys.every(key => Object.hasOwn(value, key))
    || !validId(value.world_id) || !validId(value.actor_id)
    || !validId(value.conversation_id) || !validId(value.adapter_id)
    || value.purpose !== 'npc_turn_context'
    || !value.snapshot || typeof value.snapshot !== 'object'
    || Reflect.ownKeys(value.snapshot).length !== 2
    || !Object.hasOwn(value.snapshot, 'world_revision')
    || !Object.hasOwn(value.snapshot, 'commit_sequence')
    || !Number.isSafeInteger(value.snapshot.world_revision) || value.snapshot.world_revision < 0
    || !Number.isSafeInteger(value.snapshot.commit_sequence) || value.snapshot.commit_sequence < 0
    || !Array.isArray(value.contentBlocks) || !Array.isArray(value.sources)
    || !Array.isArray(value.candidates)) return false;
  return true;
}

/**
 * In-process bridge between the native Host request lifecycle and the Core NPC
 * generation-context runtime.
 *
 * prepare() builds and projects the exact immutable context but never consumes
 * the one-shot handoff. takeForDispatch() transfers that capability once to the
 * Gateway; only Gateway may consume it while holding the shared Coordinator.
 * The original Host request and response objects are lifecycle keys.
 */
export function createNpcGenerationContextHostBridge({
  runtime, createRequestMetadata, runWithAuthenticatedHostSession,
}) {
  if (typeof runtime?.prepareForDispatch !== 'function'
    || typeof runtime?.projectDispatchHandoff !== 'function'
    || typeof runtime?.consumeDispatchHandoff !== 'function'
    || typeof runtime?.revalidateLaneAForDispatch !== 'function'
    || typeof createRequestMetadata !== 'function'
    || typeof runWithAuthenticatedHostSession !== 'function') {
    throw new TypeError('NPC Host bridge requires the trusted Core runtime, authenticated Host session runner and request metadata resolver.');
  }

  const preparedByRequest = new WeakMap();
  const seenRequests = new WeakSet();
  const seenRequestMetadata = new WeakSet();

  async function prepare(hostRequest, hostResponse, hostContext) {
    if (!hostRequest || typeof hostRequest !== 'object'
      || !hostResponse || typeof hostResponse !== 'object'
      || !hostContext || typeof hostContext !== 'object'
      || !validId(hostContext.conversation_id)
      || seenRequests.has(hostRequest)) {
      return Object.freeze({ status: 'non_ready', reason: 'host_request_not_preparable' });
    }
    seenRequests.add(hostRequest);
    const authenticatedConversationId = hostContext.conversation_id;
    try {
      let requestMetadata;
      try { requestMetadata = createRequestMetadata(hostRequest, hostResponse); }
      catch { return Object.freeze({ status: 'non_ready', reason: 'request_metadata_unavailable' }); }
      if (!requestMetadata || typeof requestMetadata !== 'object'
        || Array.isArray(requestMetadata) || !Object.isFrozen(requestMetadata)) {
        return Object.freeze({ status: 'non_ready', reason: 'request_metadata_not_immutable' });
      }
      if (seenRequestMetadata.has(requestMetadata)) {
        return Object.freeze({ status: 'non_ready', reason: 'request_metadata_reused' });
      }
      seenRequestMetadata.add(requestMetadata);

      let prepared;
      let projected;
      try {
        await runWithAuthenticatedHostSession(hostRequest, authenticatedConversationId, async () => {
          prepared = await runtime.prepareForDispatch(requestMetadata);
          if (prepared?.status === 'ready' && prepared.handoff) {
            projected = runtime.projectDispatchHandoff(prepared.handoff, requestMetadata);
          }
        });
      } catch { return Object.freeze({ status: 'non_ready', reason: 'npc_context_preparation_failed' }); }
      if (prepared?.status !== 'ready' || !prepared.handoff) {
        return Object.freeze({ status: 'non_ready', reason: prepared?.reason ?? 'npc_context_not_ready' });
      }
      if (projected?.status !== 'ready' || !validateProjection(projected.projection)) {
        return Object.freeze({ status: 'non_ready', reason: projected?.reason ?? 'npc_context_projection_not_ready' });
      }

      preparedByRequest.set(hostRequest, Object.freeze({
        response: hostResponse,
        conversationId: authenticatedConversationId,
        requestMetadata,
        handoff: prepared.handoff,
        projection: projected.projection,
      }));
      return Object.freeze({ status: 'ready', reason: null });
    } catch {
      return Object.freeze({ status: 'non_ready', reason: 'npc_context_preparation_failed' });
    }
  }

  function takeForDispatch(hostRequest, hostResponse) {
    const prepared = hostRequest && typeof hostRequest === 'object'
      ? preparedByRequest.get(hostRequest) : null;
    if (!prepared || prepared.response !== hostResponse) {
      return Object.freeze({ status: 'non_ready', reason: 'host_request_binding_mismatch' });
    }
    // Transfer the exact opaque handoff and immutable projection once. Do not
    // consume it here: Gateway must consume it under its shared Coordinator.
    preparedByRequest.delete(hostRequest);
    return Object.freeze({
      status: 'ready',
      requestMetadata: prepared.requestMetadata,
      handoff: prepared.handoff,
      projection: prepared.projection,
      runWithHostSession: callback => {
        if (typeof callback !== 'function') throw new TypeError('Host session callback is required.');
        return runWithAuthenticatedHostSession(hostRequest, prepared.conversationId, callback);
      },
      reason: null,
    });
  }

  return Object.freeze({ prepare, takeForDispatch });
}
