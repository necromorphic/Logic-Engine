import { createGoogleAiStudioTransport } from '../../src/security/memory-dispatch-google-transport.js';

const ROUTE = 'google-ai-studio-chat-completions';
const GOOGLE_ORIGIN = 'https://generativelanguage.googleapis.com';

/**
 * In-process SillyTavern sender seam for protected Google AI Studio requests.
 *
 * SECURITY CONTRACT:
 * - isProtectedRequest and getTrustedDispatchContext must use server-owned state,
 *   never a marker copied from request.body or another browser-controlled field.
 * - This function must be called after ST has completed Gemini body transformation
 *   and resolved the credential, but before the provider's ordinary fetch().
 * - If a request is protected, every error is handled here and the caller MUST NOT
 *   fall through to the ordinary fetch path.
 * - This seam is in-process. Do not serialize functions/capabilities through HTTP.
 */
export function createGoogleAiStudioDispatchHook({
  gateway,
  isProtectedRequest,
  getTrustedDispatchContext,
  fetchImpl = globalThis.fetch,
}) {
  if (!gateway || typeof gateway.dispatchProtectedRequest !== 'function'
    || typeof isProtectedRequest !== 'function'
    || typeof getTrustedDispatchContext !== 'function'
    || typeof fetchImpl !== 'function') {
    throw new TypeError('Invalid protected Google AI Studio dispatch hook configuration.');
  }

  return async function dispatchGoogleAiStudioIfProtected({
    request,
    response,
    apiUrl,
    apiKey,
    apiVersion = 'v1beta',
    model,
    stream,
    serializedBody,
    signal,
    forwardResponse,
  }) {
    let protectedRequest;
    try {
      protectedRequest = isProtectedRequest(request) === true;
    } catch {
      protectedRequest = true;
    }
    if (!protectedRequest) return false;

    // From this point on, failure is terminal for this request. Never return false
    // after the trusted policy marks it protected.
    try {
      const resolvedApiUrl = new URL(apiUrl);
      if (resolvedApiUrl.origin !== GOOGLE_ORIGIN
        || resolvedApiUrl.username || resolvedApiUrl.password
        || resolvedApiUrl.search || resolvedApiUrl.hash
        || !['', '/'].includes(resolvedApiUrl.pathname)) {
        throw new Error('MEMORY_DISPATCH_UNSUPPORTED_ENDPOINT');
      }
      if (typeof apiKey !== 'string' || apiKey.length < 8
        || typeof serializedBody !== 'string' || serializedBody.length === 0
        || typeof model !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(model)
        || typeof stream !== 'boolean'
        || typeof forwardResponse !== 'function') {
        throw new Error('MEMORY_DISPATCH_NOT_READY');
      }

      const context = getTrustedDispatchContext(request);
      if (!context || typeof context !== 'object') {
        throw new Error('MEMORY_DISPATCH_NOT_READY');
      }
      const transport = createGoogleAiStudioTransport({ apiKey, apiVersion, fetchImpl });
      await gateway.dispatchProtectedRequest({
        requestId: context.requestId,
        route: ROUTE,
        model,
        stream,
        body: serializedBody,
        worldId: context.worldId,
        actorId: context.actorId,
        purpose: context.purpose,
        sources: context.sources,
        candidates: context.candidates,
        signal,
        forwardResponse,
        prepareUpstream: transport,
      });
      return true;
    } catch {
      if (response?.headersSent || response?.destroyed) {
        try { response.destroy(); } catch {}
      } else if (response && typeof response.status === 'function' && typeof response.json === 'function') {
        response.status(503).json({
          error: {
            code: 'MEMORY_DISPATCH_NOT_READY',
            message: 'Protected Memory dispatch is unavailable; the request was not sent through the fallback provider path.',
          },
        });
      } else if (response && typeof response.writeHead === 'function' && typeof response.end === 'function') {
        response.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        response.end(JSON.stringify({ error: 'MEMORY_DISPATCH_NOT_READY' }));
      }
      return true;
    }
  };
}
