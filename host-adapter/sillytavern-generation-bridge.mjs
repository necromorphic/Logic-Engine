import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Experimental Logic-Engine-side model of the desired SillyTavern generation
 * boundary. This module is NOT an approved SillyTavern integration mechanism.
 *
 * Do not install it by editing SillyTavern imports, replacing its fetch binding,
 * or wrapping its native /generate handler. Those steps modify Host source and
 * are prohibited for this project. The supplied ST 1.19.0 Extension Manager and
 * server-plugin APIs do not expose the required native final-send hook.
 *
 * Retained for isolated contract tests only. Its existence does not protect
 * any native SillyTavern route until a supported non-invasive Host hook exists.
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
