const validId = (value) => typeof value === 'string' && value === value.trim()
  && value.length > 0 && value.length <= 200
  && ![...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const ALLOWED_FIELDS = new Set([
  'conversation_id', 'message_id', 'version_id', 'content_sha256', 'active', 'deleted',
]);

function configuredTarget(env) {
  const coreUrl = env.LOGIC_ENGINE_CORE_URL;
  const apiToken = env.LOGIC_ENGINE_API_TOKEN;
  const adapterId = env.LOGIC_ENGINE_ADAPTER_ID;
  const adapterToken = env.LOGIC_ENGINE_ADAPTER_TOKEN;
  if (typeof coreUrl !== 'string' || !coreUrl.trim()
    || typeof apiToken !== 'string' || apiToken.length < 16
    || typeof adapterId !== 'string' || !validId(adapterId)
    || typeof adapterToken !== 'string' || adapterToken.length < 16
    || adapterToken === apiToken) return null;

  let url;
  try { url = new URL(coreUrl); } catch { return null; }
  const isLoopbackHost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
  // Never send reusable credentials to a remote Core endpoint over plaintext HTTP.
  // Remote phone→PC deployments require TLS (or an independently secured transport
  // terminated at an HTTPS endpoint); private LAN addresses are not a trust boundary.
  if (!['http:', 'https:'].includes(url.protocol)
    || (url.protocol === 'http:' && !isLoopbackHost)
    || url.username || url.password
    || url.search || url.hash || !['', '/'].includes(url.pathname)
    || adapterToken === apiToken) return null;
  url.pathname = '/v1/host-version-ledger/capture';
  return { url, apiToken, adapterId, adapterToken };
}

function validCapture(body) {
  return body && typeof body === 'object' && !Array.isArray(body)
    && Object.keys(body).every((key) => ALLOWED_FIELDS.has(key))
    && ['conversation_id', 'message_id', 'version_id'].every((key) => validId(body[key]))
    && typeof body.content_sha256 === 'string' && /^[a-f0-9]{64}$/.test(body.content_sha256)
    && typeof body.active === 'boolean' && typeof body.deleted === 'boolean'
    && !(body.deleted && body.active);
}

/**
 * Same-origin SillyTavern server proxy for digest-only Host capture.
 * Credentials and the Core URL are server environment configuration; the
 * browser can provide neither an upstream URL nor an authorization header.
 * Request bodies are allowlisted and never logged.
 */
export function createHostDigestProxyHandler({
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = 5000,
  onAcceptedCapture = null,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required');
  if (onAcceptedCapture !== null && typeof onAcceptedCapture !== 'function') throw new TypeError('onAcceptedCapture must be a trusted callback');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    throw new TypeError('timeoutMs must be an integer between 1 and 30000');
  }
  return async function hostDigestProxy(request, response) {
    const target = configuredTarget(env);
    if (!target) {
      return response.status(503).json({
        error: { code: 'LOGIC_ENGINE_PROXY_UNCONFIGURED', message: 'The server-side Logic-Engine bridge is not configured.' },
      });
    }
    if (!validCapture(request?.body)) {
      return response.status(400).json({
        error: { code: 'INVALID_HOST_VERSION_CAPTURE', message: 'Only digest-only Host version identity and lifecycle fields are accepted.' },
      });
    }
    const body = {
      conversation_id: request.body.conversation_id,
      message_id: request.body.message_id,
      version_id: request.body.version_id,
      content_sha256: request.body.content_sha256,
      active: request.body.active,
      deleted: request.body.deleted,
    };
    try {
      const upstream = await fetchImpl(target.url, {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + target.apiToken,
          'content-type': 'application/json',
          'x-adapter-id': target.adapterId,
          'x-adapter-token': target.adapterToken,
        },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      const upstreamOk = typeof upstream.ok === 'boolean'
        ? upstream.ok : upstream.status >= 200 && upstream.status < 300;
      if (!upstreamOk) {
        const status = upstream.status >= 400 && upstream.status <= 599 ? upstream.status : 502;
        return response.status(status).json({
          error: { code: 'LOGIC_ENGINE_CAPTURE_REJECTED', message: 'Logic-Engine did not accept the digest capture.' },
        });
      }
      if (onAcceptedCapture) {
        try {
          await onAcceptedCapture(request, body);
        } catch {
          // Core may have accepted the capture, but local durable evidence did
          // not. Do not report success; an idempotent retry can repair the gap.
          return response.status(503).json({
            error: { code: 'LOGIC_ENGINE_CAPTURE_ACK_UNAVAILABLE', message: 'Accepted capture acknowledgement could not be persisted.' },
          });
        }
      }
      // Do not relay upstream diagnostics. A successful digest write is not
      // readiness: Core's inventory verifier remains deny-only until an
      // authoritative complete-inventory contract is deployed.
      return response.status(upstream.status).json({ ok: true, inventory_status: 'NON_READY' });
    } catch {
      return response.status(502).json({
        error: { code: 'LOGIC_ENGINE_UNREACHABLE', message: 'Logic-Engine digest capture is unavailable.' },
      });
    }
  };
}
