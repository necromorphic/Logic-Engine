/**
 * In-process bridge between the native Host request lifecycle and the Core NPC
 * generation-context runtime.
 *
 * prepare() builds and projects the exact immutable context but never consumes
 * the one-shot handoff. takeForDispatch() transfers that capability once to the
 * Gateway; only Gateway may consume it while holding the shared Coordinator.
 * The original Host request and response objects are lifecycle keys.
 */
export function createNpcGenerationContextHostBridge({ runtime, createRequestMetadata }) {
  if (typeof runtime?.prepareForDispatch !== 'function'
    || typeof runtime?.projectDispatchHandoff !== 'function'
    || typeof runtime?.consumeDispatchHandoff !== 'function'
    || typeof runtime?.revalidateLaneAForDispatch !== 'function'
    || typeof createRequestMetadata !== 'function') {
    throw new TypeError('NPC Host bridge requires the trusted Core runtime and request metadata resolver.');
  }

  const preparedByRequest = new WeakMap();
  const seenRequests = new WeakSet();
  const seenRequestMetadata = new WeakSet();

  async function prepare(hostRequest, hostResponse) {
    if (!hostRequest || typeof hostRequest !== 'object'
      || !hostResponse || typeof hostResponse !== 'object'
      || seenRequests.has(hostRequest)) {
      return Object.freeze({ status: 'non_ready', reason: 'host_request_not_preparable' });
    }
    seenRequests.add(hostRequest);
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
      try { prepared = await runtime.prepareForDispatch(requestMetadata); }
      catch { return Object.freeze({ status: 'non_ready', reason: 'npc_context_preparation_failed' }); }
      if (prepared?.status !== 'ready' || !prepared.handoff) {
        return Object.freeze({ status: 'non_ready', reason: prepared?.reason ?? 'npc_context_not_ready' });
      }

      let projected;
      try { projected = runtime.projectDispatchHandoff(prepared.handoff, requestMetadata); }
      catch { return Object.freeze({ status: 'non_ready', reason: 'npc_context_projection_failed' }); }
      if (projected?.status !== 'ready' || !projected.projection
        || !Array.isArray(projected.projection.contentBlocks)
        || !Array.isArray(projected.projection.sources)
        || !Array.isArray(projected.projection.candidates)) {
        return Object.freeze({ status: 'non_ready', reason: projected?.reason ?? 'npc_context_projection_not_ready' });
      }

      preparedByRequest.set(hostRequest, Object.freeze({
        response: hostResponse,
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
      reason: null,
    });
  }

  return Object.freeze({ prepare, takeForDispatch });
}
