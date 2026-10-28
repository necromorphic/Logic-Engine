const PROTECTED_EGRESS_ROUTE_PREFIXES = Object.freeze([
  // Arbitrary proxying and extension routes can carry protected content outside the native provider families.
  '/proxy',
  '/api/extensions',
  '/api/search',
  '/api/backends/chat-completions',
  '/api/backends/text-completions',
  '/api/backends/kobold',
  '/api/openai',
  '/api/openrouter',
  '/api/nanogpt',
  '/api/google',
  '/api/anthropic',
  '/api/novelai',
  '/api/horde',
  '/api/sd',
  '/api/extra/caption',
  '/api/extra/classify',
  '/api/speech',
  '/api/azure',
  '/api/volcengine',
  '/api/minimax',
  '/api/translate',
]);

function isWithinPrefix(path, prefix) {
  const normalizedPath = path.toLowerCase();
  return normalizedPath === prefix || normalizedPath.startsWith(prefix + '/');
}

/**
 * Deny-only deployment guard for SillyTavern's known model-capable and unclassified egress route
 * families. It intentionally does not proxy or authorize requests: the current
 * Core/Provider contract cannot yet prove inventory readiness or final-send
 * ordering. When enforcement is enabled, these route families are unavailable
 * rather than allowed to fall back to direct provider transport.
 *
 * The guard blocks the native extension router and generic CORS proxy because they
 * can expose arbitrary outbound transports. Direct browser extension traffic and
 * unlisted transports remain outside this server middleware and unsupported for
 * protected Memory material. The vectorization route family is intentionally
 * not touched.
 */
export function createProtectedDispatchDenyMiddleware({ env = process.env } = {}) {
  return function protectedDispatchDenyMiddleware(request, response, next) {
    if (env.SILLYTAVERN_REQUIRE_PROTECTED_EGRESS_GATEWAY !== 'true') {
      return next();
    }

    const path = typeof request?.path === 'string' ? request.path : '';
    if (!PROTECTED_MODEL_ROUTE_PREFIXES.some((prefix) => isWithinPrefix(path, prefix))) {
      return next();
    }

    response.set('Cache-Control', 'no-store');
    return response.status(503).json({
      error: {
        code: 'PROTECTED_EGRESS_GATEWAY_REQUIRED',
        message: 'Model dispatch is disabled until the protected egress gateway is available.',
      },
    });
  };
}

export { PROTECTED_MODEL_ROUTE_PREFIXES };
