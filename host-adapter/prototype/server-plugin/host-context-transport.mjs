import { createHmac, randomUUID } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PINNED_HOST_COMMIT = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';
const validBindingId = value => typeof value === 'string' && value === value.trim()
  && value.length > 0 && value.length <= 200
  && ![...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);

function canonicalAssertion(assertion) {
  return JSON.stringify([
    assertion.protocol_version,
    assertion.host_installation_id,
    assertion.authenticated_account_id,
    assertion.host_session_id,
    assertion.conversation_id,
    assertion.world_id,
    assertion.actor_id,
    assertion.issued_at,
    assertion.nonce,
  ]);
}

function resolveCoreUrl(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('CORE_TRANSPORT_NOT_CONFIGURED');
  let url;
  try { url = new URL(value); } catch { throw new Error('CORE_TRANSPORT_CONFIGURATION_INVALID'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
    || url.search || url.hash || !['', '/'].includes(url.pathname)
    || (url.protocol === 'http:' && !['127.0.0.1', '::1', 'localhost'].includes(url.hostname))) {
    throw new Error('CORE_TRANSPORT_CONFIGURATION_INVALID');
  }
  return url.origin;
}

function trustedSession(request) {
  const handle = request?.user?.profile?.handle;
  const session = request?.session;
  if (typeof handle !== 'string' || !handle.trim() || !session
    || (session.handle !== undefined && session.handle !== handle)
    || session.logicEngineSessionHandle !== handle
    || typeof session.logicEngineSessionId !== 'string'
    || !UUID.test(session.logicEngineSessionId)) return null;
  return { handle, sessionId: session.logicEngineSessionId };
}

export function createHostContextTransportHandler({
  identityStore,
  enumerate,
  fetchImpl = fetch,
  env = process.env,
  now = () => Date.now(),
  createNonce = randomUUID,
}) {
  if (!identityStore || typeof identityStore.resolveAuthenticatedAccount !== 'function'
    || typeof enumerate !== 'function' || typeof fetchImpl !== 'function'
    || typeof now !== 'function' || typeof createNonce !== 'function') {
    throw new TypeError('Host context transport dependencies are invalid.');
  }

  return async function hostContextTransportHandler(request, response) {
    response.set('Cache-Control', 'no-store, private');
    response.set('Vary', 'Cookie');
    const session = trustedSession(request);
    if (!session || !request?.user?.directories) return response.sendStatus(403);

    const body = request?.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'conversation_uuid')
      || typeof body.conversation_uuid !== 'string' || !UUID.test(body.conversation_uuid)) {
      return response.status(400).json({ status: 'NON_READY', code: 'HOST_CONVERSATION_ID_INVALID' });
    }

    const coreUrl = (() => {
      try { return resolveCoreUrl(env.LOGIC_ENGINE_CORE_URL); } catch { return null; }
    })();
    const apiToken = env.LOGIC_ENGINE_API_TOKEN;
    const adapterId = env.LOGIC_ENGINE_ADAPTER_ID;
    const adapterToken = env.LOGIC_ENGINE_ADAPTER_TOKEN;
    const worldId = env.LOGIC_ENGINE_HOST_WORLD_ID;
    const actorId = env.LOGIC_ENGINE_HOST_ACTOR_ID;
    if (!coreUrl || typeof apiToken !== 'string' || apiToken.length < 16
      || !validBindingId(adapterId) || typeof adapterToken !== 'string' || adapterToken.length < 16
      || !validBindingId(worldId) || !validBindingId(actorId)
      || env.LOGIC_ENGINE_HOST_BUILD_SHA !== PINNED_HOST_COMMIT) {
      return response.status(503).json({ status: 'NON_READY', code: 'HOST_CORE_TRANSPORT_NOT_CONFIGURED' });
    }

    try {
      const account = await identityStore.resolveAuthenticatedAccount(session.handle);
      const installationId = account?.host_installation_id;
      const accountId = account?.authenticated_account_id;
      if (!UUID.test(installationId ?? '') || !UUID.test(accountId ?? '')) {
        return response.status(503).json({ status: 'NON_READY', code: 'HOST_IDENTITY_UNAVAILABLE' });
      }

      const inventory = await enumerate({
        directories: request.user.directories,
        hostCommit: PINNED_HOST_COMMIT,
      });
      if (inventory?.filesystem?.status !== 'complete'
        || inventory?.source?.status !== 'DOUBLE_SCAN_CANDIDATE'
        || inventory?.source?.logical_identity_status !== 'CURRENT_FILE_IDENTITIES_VERIFIED'
        || !Array.isArray(inventory?.source?.files)) {
        return response.status(503).json({ status: 'NON_READY', code: 'HOST_CONVERSATION_INVENTORY_NON_READY' });
      }
      const matchingFiles = inventory.source.files.filter(file =>
        file?.logical_identity?.conversation_uuid === body.conversation_uuid);
      if (matchingFiles.length !== 1) {
        return response.status(403).json({ status: 'NON_READY', code: 'HOST_CONVERSATION_NOT_IN_AUTHENTICATED_ACCOUNT' });
      }

      const issuedAt = Math.floor(now() / 1000);
      const nonce = createNonce();
      if (!Number.isSafeInteger(issuedAt) || issuedAt < 0 || typeof nonce !== 'string' || !UUID.test(nonce)) {
        return response.status(503).json({ status: 'NON_READY', code: 'HOST_ASSERTION_GENERATION_FAILED' });
      }
      const conversationId = [installationId, accountId, body.conversation_uuid].join(':');
      const assertion = Object.freeze({
        protocol_version: 1,
        host_installation_id: installationId,
        authenticated_account_id: accountId,
        host_session_id: session.sessionId,
        conversation_id: conversationId,
        world_id: worldId,
        actor_id: actorId,
        issued_at: issuedAt,
        nonce,
      });
      const signature = createHmac('sha256', adapterToken)
        .update(canonicalAssertion(assertion), 'utf8')
        .digest('hex');

      const upstream = await fetchImpl(coreUrl + '/v1/host/session-context', {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + apiToken,
          'content-type': 'application/json',
          'x-adapter-id': adapterId,
          'x-adapter-token': adapterToken,
        },
        body: JSON.stringify({ assertion, signature }),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      if (!upstream.ok) {
        return response.status(upstream.status === 403 ? 403 : 502).json({
          status: 'NON_READY',
          code: upstream.status === 403 ? 'CORE_HOST_CONTEXT_DENIED' : 'CORE_HOST_CONTEXT_UNAVAILABLE',
        });
      }
      const result = await upstream.json();
      if (result?.status !== 'HOST_CONTEXT_AUTHENTICATED'
        || result?.conversation_id !== conversationId
        || result?.host_session_id !== session.sessionId
        || result?.world_binding_verified !== true
        || result?.actor_binding_verified !== true) {
        return response.status(502).json({ status: 'NON_READY', code: 'CORE_HOST_CONTEXT_RESPONSE_INVALID' });
      }
      return response.status(200).json({
        status: 'HOST_CONTEXT_AUTHENTICATED',
        conversation_id: conversationId,
        host_session_id: session.sessionId,
        world_binding_verified: true,
        actor_binding_verified: true,
      });
    } catch {
      return response.status(503).json({ status: 'NON_READY', code: 'HOST_CORE_CONTEXT_TRANSPORT_FAILED' });
    }
  };
}
