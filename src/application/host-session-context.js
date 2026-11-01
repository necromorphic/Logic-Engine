import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, timingSafeEqual } from 'node:crypto';

const HOST_SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HOST_CONVERSATION_ID = new RegExp('^' + HOST_SESSION_UUID.source.slice(1, -1) + ':'
  + HOST_SESSION_UUID.source.slice(1, -1) + ':' + HOST_SESSION_UUID.source.slice(1, -1) + '$', 'i');
const contexts = new WeakSet();
const signedAssertionRequests = new WeakSet();
const validBindingId = value => {
  if (typeof value !== 'string' || value !== value.trim()
    || value.length === 0 || value.length > 200) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return false;
  }
  return true;
};
const ASSERTION_KEYS = Object.freeze([
  'protocol_version', 'host_installation_id', 'authenticated_account_id',
  'host_session_id', 'conversation_id', 'world_id', 'actor_id', 'issued_at', 'nonce',
]);
const requestContext = new AsyncLocalStorage();

/**
 * Build a non-serializable capability only after a deployment-owned Host
 * request authenticator confirms that this exact request passed SillyTavern's
 * server authentication middleware. The authenticator must be captured from
 * trusted server composition; it must not trust request body/header fields.
 */
export function createAuthenticatedHostSessionContext(
  request, conversationId, isAuthenticatedHostRequest, resolveHostConversationId, resolveHostBindings,
) {
  try {
    if (typeof isAuthenticatedHostRequest !== 'function'
      || isAuthenticatedHostRequest(request) !== true
      || typeof resolveHostConversationId !== 'function'
      || resolveHostConversationId(request) !== conversationId
      || typeof resolveHostBindings !== 'function') return null;
    const session = request?.session;
    const userHandle = request?.user?.profile?.handle;
    const sessionId = session?.logicEngineSessionId;
    if (typeof userHandle !== 'string' || !userHandle.trim()
      || (session?.handle !== undefined && session.handle !== userHandle)
      || session?.logicEngineSessionHandle !== userHandle
      || typeof sessionId !== 'string' || !HOST_SESSION_UUID.test(sessionId)
      || typeof conversationId !== 'string' || !HOST_CONVERSATION_ID.test(conversationId)) return null;
    // Avoid Array iteration while authenticating: a hostile Array iterator
    // must not prevent the Consumer from detecting pollution and failing closed.
    const firstSeparator = conversationId.indexOf(':');
    const lastSeparator = conversationId.lastIndexOf(':');
    if (firstSeparator <= 0 || lastSeparator <= firstSeparator + 1
      || conversationId.indexOf(':', lastSeparator + 1) !== -1) return null;
    const installationId = conversationId.slice(0, firstSeparator);
    const accountId = conversationId.slice(firstSeparator + 1, lastSeparator);
    const conversationUuid = conversationId.slice(lastSeparator + 1);
    if (!HOST_SESSION_UUID.test(installationId)
      || !HOST_SESSION_UUID.test(accountId)
      || !HOST_SESSION_UUID.test(conversationUuid)) return null;

    const bindings = resolveHostBindings(request, conversationId);
    if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)
      || !validBindingId(bindings.world_id) || !validBindingId(bindings.actor_id)) return null;
    const context = Object.freeze({
      host_installation_id: installationId,
      authenticated_account_id: accountId,
      host_session_id: sessionId,
      host_user_handle: userHandle,
      conversation_id: conversationId,
      world_id: bindings.world_id,
      actor_id: bindings.actor_id,
      identity: signedAssertionRequests.has(request)
        ? 'SIGNED_HOST_SESSION_ASSERTION'
        : 'SIGNED_AUTHENTICATED_ST_SESSION',
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
      && ['SIGNED_AUTHENTICATED_ST_SESSION', 'SIGNED_HOST_SESSION_ASSERTION'].includes(context.identity)
      && context.conversation_id === conversationId
      && HOST_SESSION_UUID.test(context.host_installation_id ?? '')
      && HOST_SESSION_UUID.test(context.authenticated_account_id ?? '')
      && context.conversation_id.split(':')[0] === context.host_installation_id
      && context.conversation_id.split(':')[1] === context.authenticated_account_id
      && validBindingId(context.world_id) && validBindingId(context.actor_id);
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
  request, conversationId, callback, isAuthenticatedHostRequest, resolveHostConversationId, resolveHostBindings,
) {
  if (typeof callback !== 'function') throw new TypeError('A Host operation callback is required');
  const context = createAuthenticatedHostSessionContext(
    request, conversationId, isAuthenticatedHostRequest, resolveHostConversationId, resolveHostBindings,
  );
  if (!context) throw new Error('HOST_SESSION_AUTHENTICATION_REQUIRED');
  return requestContext.run({
    context,
    request,
    conversationId,
    isAuthenticatedHostRequest,
    resolveHostConversationId,
    resolveHostBindings,
    invalidated: false,
  }, callback);
}

export function getAuthenticatedHostSessionContext() {
  const active = requestContext.getStore();
  if (!active || active.invalidated || !active.context
    || typeof active.isAuthenticatedHostRequest !== 'function'
    || typeof active.resolveHostConversationId !== 'function'
    || typeof active.resolveHostBindings !== 'function') return null;
  // A capability is live only while the exact middleware-owned request and
  // its signed session/account/World/Actor bindings remain unchanged. This
  // revalidation makes rotation, logout, account switching and binding revoke
  // invalidate an already-entered async request context.
  const refreshed = createAuthenticatedHostSessionContext(
    active.request,
    active.conversationId,
    active.isAuthenticatedHostRequest,
    active.resolveHostConversationId,
    active.resolveHostBindings,
  );
  if (!refreshed) {
    active.invalidated = true;
    return null;
  }
  const original = active.context;
  const unchanged = refreshed.host_installation_id === original.host_installation_id
    && refreshed.authenticated_account_id === original.authenticated_account_id
    && refreshed.host_session_id === original.host_session_id
    && refreshed.conversation_id === original.conversation_id
    && refreshed.world_id === original.world_id
    && refreshed.actor_id === original.actor_id
    && refreshed.identity === original.identity;
  if (!unchanged || !isAuthenticatedHostSessionContext(original, active.conversationId)) {
    active.invalidated = true;
    return null;
  }
  return original;
}


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
      && validBindingId(assertion.world_id) && validBindingId(assertion.actor_id)
      && assertion.conversation_id.toLowerCase().startsWith(
        assertion.host_installation_id.toLowerCase() + ':' + assertion.authenticated_account_id.toLowerCase() + ':',
      )
      && Number.isSafeInteger(assertion.issued_at) && assertion.issued_at >= 0;
  } catch {
    return false;
  }
}

/**
 * Verifies a short-lived Host assertion signed by the server-held adapter
 * secret, then enters the same non-serializable Core capability boundary as
 * the in-process Host gate. Deployments should supply a durable nonce consumer
 * so replay protection survives Core restarts.
 */
export function createHostSessionAssertionRunner({
  secret,
  now = () => Date.now(),
  maxAgeSeconds = 30,
  maxFutureSkewSeconds = 5,
  maxRememberedNonces = 10000,
  consumeNonce = null,
} = {}) {
  if (typeof secret !== 'string' || secret.length < 16
    || typeof now !== 'function'
    || !Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 1 || maxAgeSeconds > 120
    || !Number.isInteger(maxFutureSkewSeconds) || maxFutureSkewSeconds < 0 || maxFutureSkewSeconds > 30
    || !Number.isInteger(maxRememberedNonces) || maxRememberedNonces < 1 || maxRememberedNonces > 100000
    || (consumeNonce !== null && typeof consumeNonce !== 'function')) {
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
      const expiresAt = assertion.issued_at + maxAgeSeconds;
      if (consumeNonce !== null) {
        let consumed = false;
        try { consumed = consumeNonce(assertion.nonce, expiresAt, currentSeconds) === true; } catch {}
        if (!consumed) throw new Error('HOST_SESSION_ASSERTION_REPLAYED');
      } else {
        for (const [nonce, expiry] of usedNonces) {
          if (expiry < currentSeconds) usedNonces.delete(nonce);
        }
        if (usedNonces.has(assertion.nonce)) throw new Error('HOST_SESSION_ASSERTION_REPLAYED');
        if (usedNonces.size >= maxRememberedNonces) throw new Error('HOST_SESSION_ASSERTION_CAPACITY_EXCEEDED');
        usedNonces.set(assertion.nonce, expiresAt);
      }

      // The Express request cannot cross the process boundary. Once its HMAC
      // is verified, build a private request object whose verifier and binding
      // resolvers are closed over the signed fields, then enter the shared
      // runWithAuthenticatedHostSession() capability boundary.
      const authenticatedAccountId = assertion.authenticated_account_id;
      const syntheticRequest = {
        user: { profile: { handle: authenticatedAccountId } },
        session: {
          handle: authenticatedAccountId,
          logicEngineSessionId: assertion.host_session_id,
          logicEngineSessionHandle: authenticatedAccountId,
        },
      };
      signedAssertionRequests.add(syntheticRequest);
      return runWithAuthenticatedHostSession(
        syntheticRequest,
        assertion.conversation_id,
        callback,
        request => request === syntheticRequest,
        request => request === syntheticRequest ? assertion.conversation_id : null,
        request => request === syntheticRequest
          ? { world_id: assertion.world_id, actor_id: assertion.actor_id }
          : null,
      );
    },
  });
}
