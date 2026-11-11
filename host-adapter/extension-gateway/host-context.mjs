import { resolveStableHostConversationIdentity } from './conversation-identity.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GATEWAY = '/api/plugins/logic-engine-extension-gateway';

async function readJson(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, { credentials: 'same-origin', cache: 'no-store', ...options });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) throw new Error('HOST_GATEWAY_REQUEST_FAILED');
  return payload;
}

export async function resolveGatewayHostContext({
  fetchImpl = globalThis.fetch,
  getHostContext = null,
  storage = globalThis.localStorage,
  cryptoProvider = globalThis.crypto,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch is required');
  let hostContext = getHostContext;
  if (!hostContext) {
    const module = await import(new URL('/scripts/st-context.js', import.meta.url).href);
    hostContext = module.getContext();
  }
  if (!hostContext || typeof hostContext.getCurrentChatId !== 'function'
    || typeof hostContext.saveMetadata !== 'function') {
    throw new Error('HOST_EXTENSION_CONTEXT_UNAVAILABLE');
  }
  const session = await readJson(fetchImpl, GATEWAY + '/session');
  if (!UUID.test(session.host_session_id ?? '')
    || session.host_session_identity !== 'SIGNED_AUTHENTICATED_ST_SESSION') throw new Error('HOST_SESSION_IDENTITY_INVALID');
  const identity = await readJson(fetchImpl, GATEWAY + '/identity');
  if (identity.host_session_id !== session.host_session_id
    || !UUID.test(identity.host_installation_id ?? '')
    || !UUID.test(identity.authenticated_account_id ?? '')
    || identity.identity_source !== 'SERVER_PERSISTED_OPAQUE_IDENTITY') throw new Error('HOST_PERSISTED_IDENTITY_INVALID');
  const resolved = await resolveStableHostConversationIdentity({
    locator: hostContext.getCurrentChatId(),
    hostSessionId: session.host_session_id,
    hostInstallationId: identity.host_installation_id,
    authenticatedAccountId: identity.authenticated_account_id,
    metadata: hostContext.chatMetadata,
    storage,
    saveMetadata: hostContext.saveMetadata,
    getCurrentLocator: hostContext.getCurrentChatId,
    getCurrentMetadata: () => hostContext.chatMetadata,
    cryptoProvider,
  });
  if (resolved.status !== 'READY_FOR_REVIEW' || !UUID.test(resolved.conversationUuid ?? '')) {
    throw new Error('HOST_CONVERSATION_IDENTITY_NON_READY');
  }
  return Object.freeze({
    conversationId: resolved.conversationId,
    conversationUuid: resolved.conversationUuid,
    hostSessionId: session.host_session_id,
    hostInstallationId: identity.host_installation_id,
    authenticatedAccountId: identity.authenticated_account_id,
  });
}
