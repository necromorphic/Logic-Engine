import { createHmac, randomUUID } from 'node:crypto';
import path from 'node:path';
import { HostIdentityStore } from './st-host-identity-store.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function configuredTarget(env) {
  const coreUrl = env.LOGIC_ENGINE_CORE_URL;
  const apiToken = env.LOGIC_ENGINE_API_TOKEN;
  const adapterId = env.LOGIC_ENGINE_ADAPTER_ID;
  const adapterToken = env.LOGIC_ENGINE_ADAPTER_TOKEN;
  if (typeof coreUrl !== 'string' || !coreUrl.trim()
    || typeof apiToken !== 'string' || apiToken.length < 16
    || typeof adapterId !== 'string' || !adapterId.trim()
    || typeof adapterToken !== 'string' || adapterToken.length < 16
    || adapterToken === apiToken) return null;
  let url;
  try { url = new URL(coreUrl); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.search || url.hash || !['', '/'].includes(url.pathname)) return null;
  url.pathname = '/v1/host/session/revoke';
  return { url, apiToken, adapterId, adapterToken };
}

export function createHostSessionRevocationClient({
  env = process.env,
  fetchImpl = globalThis.fetch,
  identityStore,
  getDataRoot = () => typeof globalThis.DATA_ROOT === 'string' && globalThis.DATA_ROOT.trim()
    ? path.resolve(globalThis.DATA_ROOT) : null,
  now = () => Date.now(),
  createNonce = randomUUID,
  timeoutMs = 5000,
} = {}) {
  if (typeof fetchImpl !== 'function' || !identityStore
    || typeof identityStore.resolveAuthenticatedAccount !== 'function'
    || typeof identityStore.assertOutsideRoot !== 'function'
    || typeof getDataRoot !== 'function' || typeof now !== 'function'
    || typeof createNonce !== 'function'
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    throw new TypeError('Host session revocation client configuration is invalid.');
  }
  return async function revokeHostSession(request, reason = 'logout') {
    const session = request?.session;
    if (!session || session.logicEngineSessionId === undefined) return false;
    const sessionId = session.logicEngineSessionId;
    const accountHandle = session.logicEngineSessionHandle;
    if (!UUID.test(sessionId ?? '') || typeof accountHandle !== 'string'
      || !accountHandle.trim() || accountHandle !== accountHandle.trim()
      || !['logout', 'session_rotation'].includes(reason)) {
      throw new Error('HOST_SESSION_REVOCATION_IDENTITY_INVALID');
    }
    const target = configuredTarget(env);
    if (!target) throw new Error('HOST_SESSION_REVOCATION_UNAVAILABLE');
    const dataRoot = getDataRoot();
    if (typeof dataRoot !== 'string' || !path.isAbsolute(dataRoot)) {
      throw new Error('HOST_SESSION_REVOCATION_UNAVAILABLE');
    }
    let identity;
    try {
      await identityStore.assertOutsideRoot(dataRoot);
      identity = await identityStore.resolveAuthenticatedAccount(accountHandle);
    } catch {
      throw new Error('HOST_SESSION_REVOCATION_UNAVAILABLE');
    }
    if (!UUID.test(identity?.host_installation_id ?? '')
      || !UUID.test(identity?.authenticated_account_id ?? '')) {
      throw new Error('HOST_SESSION_REVOCATION_UNAVAILABLE');
    }
    const issuedAt = Math.floor(now() / 1000);
    const nonce = createNonce();
    if (!Number.isSafeInteger(issuedAt) || issuedAt < 0 || !UUID.test(nonce ?? '')) {
      throw new Error('HOST_SESSION_REVOCATION_UNAVAILABLE');
    }
    const event = {
      protocol_version: 1,
      host_installation_id: identity.host_installation_id,
      authenticated_account_id: identity.authenticated_account_id,
      host_session_id: sessionId,
      issued_at: issuedAt,
      nonce,
      reason,
    };
    const proof = JSON.stringify([
      event.protocol_version, target.adapterId, event.host_installation_id,
      event.authenticated_account_id, event.host_session_id, event.issued_at,
      event.nonce, event.reason,
    ]);
    const signature = createHmac('sha256', target.adapterToken).update(proof, 'utf8').digest('hex');
    try {
      const upstream = await fetchImpl(target.url, {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + target.apiToken,
          'content-type': 'application/json',
          'x-adapter-id': target.adapterId,
          'x-adapter-token': target.adapterToken,
        },
        body: JSON.stringify({ ...event, signature }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (upstream.status !== 204) throw new Error('HOST_SESSION_REVOCATION_REJECTED');
      return true;
    } catch {
      throw new Error('HOST_SESSION_REVOCATION_UNAVAILABLE');
    }
  };
}

export async function revokeHostSessionBeforeLogout(request, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  getDataRoot = () => typeof globalThis.DATA_ROOT === 'string' && globalThis.DATA_ROOT.trim()
    ? path.resolve(globalThis.DATA_ROOT) : null,
} = {}) {
  if (!request?.session || request.session.logicEngineSessionId === undefined) return false;
  const directory = env.LOGIC_ENGINE_HOST_IDENTITY_DIR;
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
    throw new Error('HOST_SESSION_REVOCATION_UNAVAILABLE');
  }
  const identityStore = new HostIdentityStore({ directory });
  const revoke = createHostSessionRevocationClient({ env, fetchImpl, identityStore, getDataRoot });
  return revoke(request, 'logout');
}
