/**
 * Host-side handoff contract for protected Memory model dispatch.
 *
 * This module is not a SillyTavern route hook by itself. A pinned provider
 * handler must call it after final provider-specific transformation and
 * serialization. createServerTransport must only prepare an in-process
 * closure; it must not perform network I/O until that closure is invoked by
 * the Gateway after its durable DISPATCH_STARTED transition.
 *
 * No endpoint, credentials, headers, or admission fields are accepted from
 * browser/request data as authority. There is no direct-provider fallback.
 */
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function createProtectedMemoryDispatchAdapter({
  gateway,
  readTrustedContext,
  createServerTransport,
  forwardResponse,
}) {
  if (!gateway || typeof gateway.dispatchProtectedRequest !== 'function') {
    throw new TypeError('A protected Memory dispatch gateway is required.');
  }
  if (typeof readTrustedContext !== 'function') {
    throw new TypeError('A server-owned trusted-context reader is required.');
  }
  if (typeof createServerTransport !== 'function') {
    throw new TypeError('A server-owned transport factory is required.');
  }
  if (typeof forwardResponse !== 'function') {
    throw new TypeError('A response forwarder is required.');
  }

  return async function dispatchProtectedMemoryRequest({ serializedBody, model, stream, signal }) {
    if (typeof serializedBody !== 'string' || serializedBody.length === 0
      || serializedBody.length > 4_000_000
      || typeof model !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(model)
      || typeof stream !== 'boolean') {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }

    // Admission is read from server-owned Host/Core/Provider state. Browser
    // request fields never supply identity, source versions, or candidates.
    const context = await readTrustedContext();
    if (!isRecord(context)) throw new Error('MEMORY_DISPATCH_NOT_READY');
    const required = [
      'requestId', 'adapterId', 'conversationId', 'worldId', 'actorId',
      'purpose', 'sources', 'candidates',
    ];
    if (required.some((key) => !Object.hasOwn(context, key))) {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }

    // This factory must return a dormant server-side closure, not send yet.
    // The Gateway invokes it only after authority checks and durable start.
    if (createServerTransport.constructor?.name === 'AsyncFunction') {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }
    const transport = createServerTransport({
      serializedBody,
      model,
      stream,
      signal,
    });
    // Capability construction must be synchronous. An async factory could
    // perform side effects or start transport work before the Gateway has
    // persisted DISPATCH_STARTED, so reject thenables before entering Gateway.
    if (transport && (typeof transport === 'object' || typeof transport === 'function')
      && typeof transport.then === 'function') {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }
    if (typeof transport !== 'function') throw new Error('MEMORY_DISPATCH_NOT_READY');

    // Do not parse/stringify the final body here: exact serialized bytes are
    // passed to the Gateway and bound to its dispatch digest.
    return gateway.dispatchProtectedRequest({
      requestId: context.requestId,
      route: 'host-managed-chat-completions',
      model,
      stream,
      body: serializedBody,
      adapterId: context.adapterId,
      conversationId: context.conversationId,
      worldId: context.worldId,
      actorId: context.actorId,
      purpose: context.purpose,
      sources: context.sources,
      candidates: context.candidates,
      transport,
      forwardResponse,
      signal,
    });
  };
}
