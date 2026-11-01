import { PROTECTED_MEMORY_SENDER_ROUTES } from '../src/security/memory-dispatch-gateway.js';

/**
 * Server-side final-send adapter for SillyTavern provider senders.
 *
 * Every generation sender must call this helper exactly once after provider
 * transformations and final body serialization. Non-generation fetches must
 * not call it. Protected Memory context is supplied by trusted Host code, never
 * copied from request JSON. The sender registry is owned by the sole Gateway.
 */
export { PROTECTED_MEMORY_SENDER_ROUTES };

const validRoute = (route) => PROTECTED_MEMORY_SENDER_ROUTES.includes(route);

function assertProtectedContext(context) {
  if (!context || typeof context !== 'object' || Array.isArray(context)
    || typeof context.requestId !== 'string' || !context.requestId
    || typeof context.model !== 'string' || !context.model
    || typeof context.worldId !== 'string' || !context.worldId
    || typeof context.actorId !== 'string' || !context.actorId
    || typeof context.purpose !== 'string' || !context.purpose
    || !Array.isArray(context.sources) || !Array.isArray(context.candidates)) {
    throw new Error('MEMORY_DISPATCH_NOT_READY');
  }
}

function assertRequest(endpointUrl, requestInit) {
  if (typeof endpointUrl !== 'string' || !/^https?:\/\//i.test(endpointUrl)
    || !requestInit || typeof requestInit !== 'object'
    || typeof requestInit.body !== 'string' || requestInit.body.length === 0
    || requestInit.body.length > 4_000_000
    || typeof requestInit.method !== 'string' || requestInit.method.toUpperCase() !== 'POST') {
    throw new Error('PROTECTED_MEMORY_FINAL_SEND_INVALID');
  }
}

/**
 * Create the one final-send function shared by all provider handlers.
 * fetchImpl is trusted server-side fetch; endpoint and headers must already
 * have been resolved by the provider handler. The transport closure is dormant
 * until the Gateway invokes it after durable DISPATCH_STARTED.
 */
export function createProtectedMemoryFinalSend({ gateway, resolveProtectedMemory, fetchImpl = globalThis.fetch }) {
  if (!gateway || typeof gateway.dispatchProtectedRequest !== 'function'
    || typeof resolveProtectedMemory !== 'function'
    || resolveProtectedMemory.constructor?.name === 'AsyncFunction'
    || typeof fetchImpl !== 'function') {
    throw new TypeError('Invalid protected Memory final-send configuration.');
  }

  return function finalSend({
    senderRoute,
    endpointUrl,
    requestInit,
    hostRequestContext,
    stream = false,
    forwardResponse,
    transport: transportImpl,
    protectedMemoryOverride,
    hostTransformsStream = false,
  }) {
    assertRequest(endpointUrl, requestInit);

    // Classification is performed synchronously from trusted server-side
    // request context. It must never be inferred from browser JSON or an
    // optional caller-supplied "protected" flag.
    const protectedMemory = protectedMemoryOverride !== undefined
      ? protectedMemoryOverride
      : resolveProtectedMemory(hostRequestContext);
    if (protectedMemory && typeof protectedMemory.then === 'function') {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }

    if (protectedMemory === undefined) throw new Error('MEMORY_DISPATCH_NOT_READY');

    // Only an explicit trusted null means this request carries no protected
    // Memory. Missing/indeterminate classification must never fall through.
    if (protectedMemory === null) {
      return (typeof transportImpl === 'function' ? transportImpl : fetchImpl)(endpointUrl, requestInit);
    }

    if (!validRoute(senderRoute)) throw new Error('MEMORY_DISPATCH_NOT_READY');
    assertProtectedContext(protectedMemory);
    if (typeof stream !== 'boolean' || typeof hostTransformsStream !== 'boolean'
      || stream && !hostTransformsStream && typeof forwardResponse !== 'function') {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }

    const exactBody = requestInit.body;
    const model = protectedMemory.model;
    const controllerSignal = requestInit.signal;
    const transport = () => {
      // Calling fetchImpl is the actual transport handoff. This function is
      // deliberately non-async so the handoff happens synchronously under the
      // Gateway's coordinator lease, immediately after DISPATCH_STARTED.
      // Return the upstream response without releasing it to the Host.
      // Gateway performs FINAL RESPONSE REVALIDATION first, then starts the
      // streaming write synchronously while holding the shared Coordinator.
      return (typeof transportImpl === 'function' ? transportImpl : fetchImpl)(endpointUrl, { ...requestInit, body: exactBody });
    };

    return gateway.dispatchProtectedRequest({
      ...protectedMemory,
      route: 'host-selected-chat-generation',
      senderRoute,
      model,
      stream,
      body: exactBody,
      transport,
      forwardResponse,
      hostTransformsStream,
      signal: controllerSignal,
    });
  };
}
