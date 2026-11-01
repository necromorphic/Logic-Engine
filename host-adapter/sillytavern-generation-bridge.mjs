import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Bridge for SillyTavern's single /generate handler.
 *
 * Import the provider's node-fetch binding as nativeFetch, replace local fetch
 * with bridge.fetch, alias the existing forwardFetchResponse import to
 * nativeForwardFetchResponse, and wrap the /generate handler body with
 * bridge.run(request, response, async () => { ... }).
 *
 * This places every dedicated and generic sender's final fetch behind one
 * boundary without touching non-generation model-discovery fetches.
 */
export function createSillyTavernGenerationBridge({
  finalSend,
  nativeFetch,
  nativeForwardFetchResponse,
  resolveSenderRoute,
}) {
  if (typeof finalSend !== 'function'
    || typeof nativeFetch !== 'function'
    || typeof nativeForwardFetchResponse !== 'function'
    || typeof resolveSenderRoute !== 'function') {
    throw new TypeError('Invalid SillyTavern generation bridge configuration.');
  }

  const context = new AsyncLocalStorage();

  return Object.freeze({
    run(request, response, handler) {
      if (!request || typeof request !== 'object'
        || !response || typeof response !== 'object'
        || typeof handler !== 'function') {
        throw new TypeError('Invalid SillyTavern generation context.');
      }
      const senderRoute = resolveSenderRoute(request.body?.chat_completion_source);
      return context.run({
        request,
        response,
        senderRoute: typeof senderRoute === 'string' ? senderRoute : 'unknown',
        protectedStreamForward: null,
      }, handler);
    },

    fetch(endpointUrl, requestInit) {
      const active = context.getStore();
      if (!active) return nativeFetch(endpointUrl, requestInit);

      const stream = Boolean(active.request.body?.stream);
      const forwardResponse = stream
        ? (upstream) => {
          // Invoke the native response writer synchronously. Gateway calls
          // this callback only after final revalidation and while the shared
          // Coordinator lease is still held; only the resulting I/O Promise
          // is awaited after releasing that lease.
          const pending = nativeForwardFetchResponse(upstream, active.response);
          active.protectedStreamForward = Promise.resolve(pending);
          return active.protectedStreamForward;
        }
        : undefined;

      return finalSend({
        senderRoute: active.senderRoute,
        endpointUrl: String(endpointUrl),
        requestInit,
        hostRequestContext: active.request,
        stream,
        forwardResponse,
      });
    },

    forwardFetchResponse(upstream, response) {
      const active = context.getStore();
      // Protected streaming was already forwarded inside the Gateway's
      // transport Promise. The sender's legacy forwarding call becomes a
      // no-op waiter, preventing duplicate writes to the Express response.
      if (active?.protectedStreamForward) return active.protectedStreamForward;
      return nativeForwardFetchResponse(upstream, response);
    },
  });
}
