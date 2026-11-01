import { AsyncLocalStorage } from 'node:async_hooks';

const HOST_SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HOST_CONVERSATION_ID = new RegExp('^' + HOST_SESSION_UUID.source.slice(1, -1) + ':'
  + HOST_SESSION_UUID.source.slice(1, -1) + ':' + HOST_SESSION_UUID.source.slice(1, -1) + '$', 'i');
const contexts = new WeakSet();
const requestContext = new AsyncLocalStorage();

/**
 * Build a non-serializable capability from the actual authenticated
 * SillyTavern server request. request.session must be the signed session
 * populated by SillyTavern's cookie-session middleware; never pass a browser
 * body, decoded client payload, or caller-constructed identity object here.
 */
export function createAuthenticatedHostSessionContext(request, conversationId) {
  try {
    const session = request?.session;
    const userHandle = request?.user?.profile?.handle;
    const sessionId = session?.logicEngineSessionId;
    if (typeof userHandle !== 'string' || !userHandle.trim()
      || session?.handle !== userHandle
      || session?.logicEngineSessionHandle !== userHandle
      || typeof sessionId !== 'string' || !HOST_SESSION_UUID.test(sessionId)
      || typeof conversationId !== 'string' || !HOST_CONVERSATION_ID.test(conversationId)
      || !conversationId.toLowerCase().startsWith(sessionId.toLowerCase() + ':')) return null;

    const context = Object.freeze({
      host_session_id: sessionId,
      host_user_handle: userHandle,
      conversation_id: conversationId,
      identity: 'SIGNED_AUTHENTICATED_ST_SESSION',
    });
    contexts.add(context);
    return context;
  } catch {
    return null;
  }
}

export function isAuthenticatedHostSessionContext(context, conversationId) {
  try {
    return context !== null && typeof context === 'object'
      && contexts.has(context)
      && context.identity === 'SIGNED_AUTHENTICATED_ST_SESSION'
      && context.conversation_id === conversationId;
  } catch {
    return false;
  }
}

/**
 * Run one Host-owned operation inside its authenticated request context.
 * The callback receives no identity arguments: Core/consumer code reads the
 * branded capability from AsyncLocalStorage, not from caller request data.
 */
export function runWithAuthenticatedHostSession(request, conversationId, callback) {
  if (typeof callback !== 'function') throw new TypeError('A Host operation callback is required');
  const context = createAuthenticatedHostSessionContext(request, conversationId);
  if (!context) throw new Error('HOST_SESSION_AUTHENTICATION_REQUIRED');
  return requestContext.run(context, callback);
}

export function getAuthenticatedHostSessionContext() {
  const context = requestContext.getStore();
  return isAuthenticatedHostSessionContext(context, context?.conversation_id) ? context : null;
}
