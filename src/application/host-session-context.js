import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, timingSafeEqual } from 'node:crypto';

const HOST_SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HOST_CONVERSATION_ID = new RegExp('^' + HOST_SESSION_UUID.source.slice(1, -1) + ':'
  + HOST_SESSION_UUID.source.slice(1, -1) + ':' + HOST_SESSION_UUID.source.slice(1, -1) + '$', 'i');
const contexts = new WeakSet();
const contextBindings = new WeakMap();
const ASSERTION_KEYS = Object.freeze([
  'protocol_version', 'host_installation_id', 'authenticated_account_id',
  'host_session_id', 'conversation_id', 'issued_at', 'nonce',
]);
const requestContext = new AsyncLocalStorage();

/**
 * Build a non-serializable capability only after a deployment-owned Host
 * request authenticator confirms that this exact request passed SillyTavern's
 * server authentication middleware. The authenticator must be captured from
 * trusted server composition; it must not trust request body/header fields.
 */
export function createAuthenticatedHostSessionContext(
  request, conversationId, isAuthenticatedHostRequest, resolveHostConversationId,
) {
  try {
    if (typeof isAuthenticatedHostRequest !== 'function'
      || isAuthenticatedHostRequest(request) !== true
      || typeof resolveHostConversationId !== 'function'
      || resolveHostConversationId(request) !== conversationId) return null;
    const session = request?.session;
    const userHandle = request?.user?.profile?.handle;
    const sessionId = session?.logicEngineSessionId;
    if (typeof userHandle !== 'string' || !userHandle.trim()
      || (session?.handle !== undefined && session.handle !== userHandle)
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
    contextBindings.set(context, {
      kind: 'request',
      request,
      conversationId,
      hostSessionId: sessionId,
      hostUserHandle: userHandle,
      isAuthenticatedHostRequest,
      resolveHostConversationId,
    });
    return context;
  } catch {
    return null;
  }
}

function isLiveAuthenticatedHostContext(context, conversationId) {
  try {
    const binding = contextBindings.get(context);
    if (!binding || binding.conversationId && binding.conversationId !== conversationId) return false;
    if (binding.kind === 'assertion') {
      const currentSeconds = Math.floor(binding.now() / 1000);
      return Number.isSafeInteger(currentSeconds) && currentSeconds <= binding.expiresAt;
    }
    const {
      request,
      hostSessionId,
      hostUserHandle,
      isAuthenticatedHostRequest,
      resolveHostConversationId,
    } = binding;
    if (isAuthenticatedHostRequest(request) !== true
      || resolveHostConversationId(request) !== conversationId) return false;
    const session = request?.session;
    const currentUserHandle = request?.user?.profile?.handle;
    return currentUserHandle === hostUserHandle
      && session?.logicEngineSessionId === hostSessionId
      && session?.logicEngineSessionHandle === hostUserHandle
      && (session?.handle === undefined || session.handle === hostUserHandle);
  } catch {
    return false;
  }
}

export function isAuthenticatedHostSessionContext(context, conversationId) {
  try {
    return context !== null && typeof context === 'object'
      && contexts.has(context)
      && ['SIGNED_AUTHENTICATED_ST_SESSION', 'SIGNED_HOST_SESSION_ASSERTION'].includes(context.identity)
      && context.conversation_id === conversationId
      && isLiveAuthenticatedHostContext(context, conversationId);
  } catch {
    return false;
  }
}

/**
 * Run one Host-owned operation inside its authenticated request context.
 * The callback receives no identity arguments: Core/consumer code reads the
 * branded capability from AsyncLocalStorage, not from caller request data.
 */
export function runWithAuthenticatedHostSession(
  request, conversationId, callback, isAuthenticatedHostRequest, resolveHostConversationId,
) {
  if (typeof callback !== 'function') throw new TypeError('A Host operation callback is required');
  const context = createAuthenticatedHostSessionContext(
    request, conversationId, isAuthenticatedHostRequest, resolveHostConversationId,
  );
  if (!context) throw new Error('HOST_SESSION_AUTHENTICATION_REQUIRED');
  const revokeContext = () => {
    contexts.delete(context);
    contextBindings.delete(context);
  };
  try {
    const result = requestContext.run(context, callback);
    if (result && typeof result.then === 'function') return Promise.resolve(result).finally(revokeContext);
    revokeContext();
    return result;
  } catch (error) {
    revokeContext();
    throw error;
  }
}

export function getAuthenticatedHostSessionContext() {
  const context = requestContext.getStore();
  return isAuthenticatedHostSessionContext(context, context?.conversation_id) ? context : null;
}


function canonicalAssertion(assertion) {
  return JSON.stringify([
    assertion.protocol_version,
    assertion.host_installation_id,
    assertion.authenticated_account_id,
    assertion.host_session_id,
    assertion.conversation_id,
    assertion.issued_at,
    assertion.nonce,
  ]);
}

function validHostSessionAssertion(assertion) {
  try {
    if (!assertion || typeof assertion !== 'object' || Array.isArray(assertion)
      || (Object.getPrototypeOf(assertion) !== Object.prototype && Object.getPrototypeOf(assertion) !== null)
      || Reflect.ownKeys(assertion).length !== ASSERTION_KEYS.length
      || ASSERTION_KEYS.some(key => !Object.hasOwn(assertion, key))
      || Reflect.ownKeys(assertion).some(key => typeof key !== 'string' || !ASSERTION_KEYS.includes(key))) return false;
    for (const key of ASSERTION_KEYS) {
      const descriptor = Object.getOwnPropertyDescriptor(assertion, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return false;
    }
    return assertion.protocol_version === 1
      && [assertion.host_installation_id, assertion.authenticated_account_id,
        assertion.host_session_id, assertion.nonce].every(value =>
        typeof value === 'string' && HOST_SESSION_UUID.test(value))
      && typeof assertion.conversation_id === 'string'
      && HOST_CONVERSATION_ID.test(assertion.conversation_id)
      && assertion.conversation_id.toLowerCase().startsWith(
        assertion.host_session_id.toLowerCase() + ':' + assertion.host_installation_id.toLowerCase() + ':',
      )
      && Number.isSafeInteger(assertion.issued_at) && assertion.issued_at >= 0;
  } catch {
    return false;
  }
}

/**
 * Verifies a short-lived Host assertion signed by the server-held adapter
 * secret, then creates the same non-serializable Core capability used by the
 * in-process Host gate. The nonce cache is process-local; expired assertions
 * cannot be replayed after restart.
 */
export function createHostSessionAssertionRunner({
  secret,
  now = () => Date.now(),
  maxAgeSeconds = 30,
  maxFutureSkewSeconds = 5,
  maxRememberedNonces = 10000,
} = {}) {
  if (typeof secret !== 'string' || secret.length < 16
    || typeof now !== 'function'
    || !Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 1 || maxAgeSeconds > 120
    || !Number.isInteger(maxFutureSkewSeconds) || maxFutureSkewSeconds < 0 || maxFutureSkewSeconds > 30
    || !Number.isInteger(maxRememberedNonces) || maxRememberedNonces < 1 || maxRememberedNonces > 100000) {
    throw new TypeError('Host session assertion runner configuration is invalid.');
  }
  const usedNonces = new Map();
  return Object.freeze({
    run(assertion, signature, callback) {
      if (typeof callback !== 'function') throw new TypeError('A Host context callback is required.');
      if (!validHostSessionAssertion(assertion)
        || typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) {
        throw new Error('HOST_SESSION_ASSERTION_INVALID');
      }
      const currentSeconds = Math.floor(now() / 1000);
      if (!Number.isSafeInteger(currentSeconds)
        || assertion.issued_at < currentSeconds - maxAgeSeconds
        || assertion.issued_at > currentSeconds + maxFutureSkewSeconds) {
        throw new Error('HOST_SESSION_ASSERTION_EXPIRED');
      }
      const expected = createHmac('sha256', secret).update(canonicalAssertion(assertion), 'utf8').digest();
      const provided = Buffer.from(signature, 'hex');
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
        throw new Error('HOST_SESSION_ASSERTION_INVALID');
      }
      for (const [nonce, expiresAt] of usedNonces) {
        if (expiresAt < currentSeconds) usedNonces.delete(nonce);
      }
      if (usedNonces.has(assertion.nonce)) throw new Error('HOST_SESSION_ASSERTION_REPLAYED');
      if (usedNonces.size >= maxRememberedNonces) throw new Error('HOST_SESSION_ASSERTION_CAPACITY_EXCEEDED');
      usedNonces.set(assertion.nonce, assertion.issued_at + maxAgeSeconds);
      const context = Object.freeze({
        host_installation_id: assertion.host_installation_id,
        authenticated_account_id: assertion.authenticated_account_id,
        host_session_id: assertion.host_session_id,
        conversation_id: assertion.conversation_id,
        identity: 'SIGNED_HOST_SESSION_ASSERTION',
      });
      contexts.add(context);
      contextBindings.set(context, {
        kind: 'assertion',
        conversationId: assertion.conversation_id,
        expiresAt: assertion.issued_at + maxAgeSeconds,
        now,
      });
      const revokeContext = () => {
        contexts.delete(context);
        contextBindings.delete(context);
      };
      try {
        const result = requestContext.run(context, callback);
        if (result && typeof result.then === 'function') return Promise.resolve(result).finally(revokeContext);
        revokeContext();
        return result;
      } catch (error) {
        revokeContext();
        throw error;
      }
    },
  });
}
