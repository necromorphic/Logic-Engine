const validId = (value) => typeof value === 'string' && value === value.trim()
  && value.length > 0 && value.length <= 200
  && ![...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const HOST_SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HOST_CONVERSATION_ID = new RegExp('^' + HOST_SESSION_UUID.source.slice(1, -1) + ':'
  + HOST_SESSION_UUID.source.slice(1, -1) + ':' + HOST_SESSION_UUID.source.slice(1, -1) + '$', 'i');

function requestMatchesAuthenticatedHostSession(request, conversationId) {
  const session = request?.session;
  const userHandle = request?.user?.profile?.handle;
  const sessionHandle = session?.handle;
  const sessionId = session?.logicEngineSessionId;
  return typeof userHandle === 'string' && userHandle.trim().length > 0
    && sessionHandle === userHandle
    && typeof sessionId === 'string' && HOST_SESSION_UUID.test(sessionId)
    && typeof conversationId === 'string'
    && HOST_CONVERSATION_ID.test(conversationId)
    && conversationId.startsWith(sessionId + ':');
}

const ALLOWED_FIELDS = new Set([
  'conversation_id', 'message_id', 'version_id', 'parent_version_id', 'content_sha256', 'active', 'deleted',
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
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.search || url.hash || !['', '/'].includes(url.pathname)) return null;
  url.pathname = '/v1/host-version-ledger/capture';
  return { url, apiToken, adapterId, adapterToken };
}

function validCapture(body) {
  return body && typeof body === 'object' && !Array.isArray(body)
    && Object.keys(body).every((key) => ALLOWED_FIELDS.has(key))
    && ['conversation_id', 'message_id', 'version_id'].every((key) => validId(body[key]))
    && Object.hasOwn(body, 'parent_version_id')
    && (body.parent_version_id === null || validId(body.parent_version_id))
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
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required');
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
    if (!requestMatchesAuthenticatedHostSession(request, request?.body?.conversation_id)) {
      return response.status(403).json({
        error: { code: 'HOST_SESSION_SCOPE_REQUIRED', message: 'The Host conversation is not bound to this authenticated SillyTavern session.' },
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
      parent_version_id: request.body.parent_version_id,
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
        signal: AbortSignal.timeout(timeoutMs),
      });
      let payload;
      try { payload = await upstream.json(); } catch {
        return response.status(502).json({
          error: { code: 'LOGIC_ENGINE_INVALID_RESPONSE', message: 'Logic-Engine returned an invalid response.' },
        });
      }
      return response.status(upstream.status).json(payload);
    } catch {
      return response.status(502).json({
        error: { code: 'LOGIC_ENGINE_UNREACHABLE', message: 'Logic-Engine digest capture is unavailable.' },
      });
    }
  };
}


const RECONCILE_ALLOWED_FIELDS = new Set(['conversation_id', 'complete', 'versions']);
const RECONCILE_VERSION_FIELDS = new Set([
  'message_id', 'version_id', 'parent_version_id', 'content_sha256', 'active', 'deleted',
]);
const MAX_RECONCILE_BYTES = 8 * 1024 * 1024;
const MAX_RECONCILE_VERSIONS = 25000;

function validReconciliation(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.getPrototypeOf(body) !== Object.prototype
    || Object.keys(body).some(key => !RECONCILE_ALLOWED_FIELDS.has(key))
    || !validId(body.conversation_id)
    || typeof body.complete !== 'boolean'
    || !Array.isArray(body.versions)) return false;
  return body.versions.every(version => version && typeof version === 'object' && !Array.isArray(version)
    && Object.getPrototypeOf(version) === Object.prototype
    && Object.keys(version).every(key => RECONCILE_VERSION_FIELDS.has(key))
    && validId(version.message_id)
    && validId(version.version_id)
    && Object.hasOwn(version, 'parent_version_id')
    && (version.parent_version_id === null || validId(version.parent_version_id))
    && typeof version.content_sha256 === 'string' && /^[a-f0-9]{64}$/.test(version.content_sha256)
    && typeof version.active === 'boolean'
    && typeof version.deleted === 'boolean'
    && !(version.deleted && version.active));
}

/**
 * Same-origin SillyTavern server proxy for a complete digest-only Host snapshot.
 * The caller cannot select the Core URL or provide Core/adapter credentials.
 * The complete flag is passed through exactly; the current bridge sets it false
 * until all lifecycle paths and pinned-source attestation are accepted.
 */
export function createHostInventoryReconcileProxyHandler({
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = 5000,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    throw new TypeError('timeoutMs must be an integer between 1 and 30000');
  }
  return async function hostInventoryReconcileProxy(request, response) {
    const target = configuredTarget(env);
    if (!target) {
      return response.status(503).json({
        error: { code: 'LOGIC_ENGINE_PROXY_UNCONFIGURED', message: 'The server-side Logic-Engine bridge is not configured.' },
      });
    }
    let bodyBytes = Infinity;
    try { bodyBytes = Buffer.byteLength(JSON.stringify(request?.body)); } catch {}
    if (!requestMatchesAuthenticatedHostSession(request, request?.body?.conversation_id)) {
      return response.status(403).json({
        error: { code: 'HOST_SESSION_SCOPE_REQUIRED', message: 'The Host conversation is not bound to this authenticated SillyTavern session.' },
      });
    }
    if (bodyBytes > MAX_RECONCILE_BYTES) {
      return response.status(413).json({
        error: { code: 'HOST_INVENTORY_TOO_LARGE', message: 'Host inventory request exceeds the 8 MiB limit.' },
      });
    }
    if (Array.isArray(request?.body?.versions)
      && request.body.versions.length > MAX_RECONCILE_VERSIONS) {
      return response.status(413).json({
        error: { code: 'HOST_INVENTORY_TOO_LARGE', message: 'Host inventory exceeds the 25,000-version limit.' },
      });
    }
    if (!validReconciliation(request?.body)) {
      return response.status(400).json({
        error: { code: 'INVALID_HOST_INVENTORY_RECONCILIATION', message: 'Only a bounded digest-only complete-inventory envelope is accepted.' },
      });
    }
    const body = {
      conversation_id: request.body.conversation_id,
      complete: request.body.complete,
      versions: request.body.versions.map(version => ({
        message_id: version.message_id,
        version_id: version.version_id,
        parent_version_id: version.parent_version_id,
        content_sha256: version.content_sha256,
        active: version.active,
        deleted: version.deleted,
      })),
    };
    target.url.pathname = '/v1/host-version-ledger/reconcile';
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
        signal: AbortSignal.timeout(timeoutMs),
      });
      let payload;
      try { payload = await upstream.json(); } catch {
        return response.status(502).json({
          error: { code: 'LOGIC_ENGINE_INVALID_RESPONSE', message: 'Logic-Engine returned an invalid response.' },
        });
      }
      return response.status(upstream.status).json(payload);
    } catch {
      return response.status(502).json({
        error: { code: 'LOGIC_ENGINE_UNREACHABLE', message: 'Logic-Engine inventory reconciliation is unavailable.' },
      });
    }
  };
}
