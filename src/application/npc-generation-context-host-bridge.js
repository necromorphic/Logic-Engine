/**
 * In-process bridge between the Host Final-Send prepare() and dispatch()
 * callbacks and the Core NPC generation-context runtime.
 *
 * This module never serializes a context or handoff. The original Host request
 * and response objects are the lifecycle keys; request metadata is retained by
 * identity and is not reconstructed during dispatch.
 */
export function createNpcGenerationContextHostBridge({ runtime, createRequestMetadata }) {
  if (typeof runtime?.prepareForDispatch !== 'function'
    || typeof runtime?.consumeDispatchHandoff !== 'function'
    || typeof runtime?.getLaneBDispatchEvidence !== 'function'
    || typeof runtime?.revalidateLaneAForDispatch !== 'function'
    || typeof createRequestMetadata !== 'function') {
    throw new TypeError('NPC Host bridge requires the trusted Core runtime and request metadata resolver.');
  }

  const preparedByRequest = new WeakMap();

  async function prepare(hostRequest, hostResponse) {
    if (!hostRequest || typeof hostRequest !== 'object'
      || !hostResponse || typeof hostResponse !== 'object'
      || preparedByRequest.has(hostRequest)) {
      return Object.freeze({ status: 'non_ready', reason: 'host_request_not_preparable' });
    }
    let requestMetadata;
    try {
      requestMetadata = createRequestMetadata(hostRequest, hostResponse);
      if (!requestMetadata || typeof requestMetadata !== 'object'
        || Array.isArray(requestMetadata) || !Object.isFrozen(requestMetadata)) {
        return Object.freeze({ status: 'non_ready', reason: 'request_metadata_not_immutable' });
      }
    } catch { return Object.freeze({ status: 'non_ready', reason: 'request_metadata_unavailable' }); }
    let prepared;
    try { prepared = await runtime.prepareForDispatch(requestMetadata); }
    catch { return Object.freeze({ status: 'non_ready', reason: 'npc_context_preparation_failed' }); }
    if (prepared?.status !== 'ready' || !prepared.handoff) {
      return Object.freeze({ status: 'non_ready', reason: prepared?.reason ?? 'npc_context_not_ready' });
    }
    preparedByRequest.set(hostRequest, Object.freeze({
      response: hostResponse,
      requestMetadata,
      handoff: prepared.handoff,
    }));
    return Object.freeze({ status: 'ready', reason: null });
  }

  function consume(hostRequest, hostResponse) {
    const prepared = hostRequest && typeof hostRequest === 'object'
      ? preparedByRequest.get(hostRequest) : null;
    if (!prepared || prepared.response !== hostResponse) {
      return Object.freeze({ status: 'non_ready', reason: 'host_request_binding_mismatch' });
    }
    // Consume the Host lifecycle slot before invoking the runtime so failures
    // cannot be retried with a second response or a replayed dispatch callback.
    preparedByRequest.delete(hostRequest);
    try {
      const accepted = runtime.consumeDispatchHandoff(prepared.handoff, prepared.requestMetadata);
      if (accepted?.status !== 'accepted' || !accepted.context) {
        return Object.freeze({ status: 'non_ready', reason: accepted?.reason ?? 'npc_handoff_rejected' });
      }
      const laneB = runtime.getLaneBDispatchEvidence(accepted.context, prepared.requestMetadata);
      if (laneB?.status !== 'ready') {
        return Object.freeze({ status: 'non_ready', reason: laneB?.reason ?? 'npc_lane_b_not_ready' });
      }
      const context = accepted.context;
      const requestMetadata = prepared.requestMetadata;
      return Object.freeze({
        status: 'accepted',
        context,
        laneB,
        revalidateLaneA: () => {
          try { return runtime.revalidateLaneAForDispatch(context, requestMetadata); }
          catch { return Object.freeze({ status: 'non_ready', reason: 'npc_lane_a_revalidation_failed' }); }
        },
      });
    } catch {
      return Object.freeze({ status: 'non_ready', reason: 'npc_handoff_consumption_failed' });
    }
  }

  return Object.freeze({ prepare, consume });
}
