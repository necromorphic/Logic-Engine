import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { types as utilTypes } from 'node:util';

const HOST_SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HOST_CONVERSATION_ID = new RegExp('^' + HOST_SESSION_UUID.source.slice(1, -1) + ':'
  + HOST_SESSION_UUID.source.slice(1, -1) + ':' + HOST_SESSION_UUID.source.slice(1, -1) + '$', 'i');
const contexts = new WeakSet();
const contextBindings = new WeakMap();
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

function isExactPlainDataRecord(value, expectedKeys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== expectedKeys.length) return false;
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (typeof key !== 'string') return false;
      let expected = false;
      for (let expectedIndex = 0; expectedIndex < expectedKeys.length; expectedIndex += 1) {
        if (expectedKeys[expectedIndex] === key) {
          expected = true;
          break;
        }
      }
      if (!expected) return false;
    }
    for (let index = 0; index < expectedKeys.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, expectedKeys[index]);
      if (descriptor === undefined || descriptor.enumerable !== true
        || !Object.hasOwn(descriptor, 'value')) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Build a non-serializable capability only after a deployment-owned Host
 * request authenticator confirms that this exact request passed SillyTavern's
 * server authentication middleware. The authenticator must be captured from
 * trusted server composition; it must not trust request body/header fields.
 */
export function createAuthenticatedHostSessionContext(
  request, conversationId, isAuthenticatedHostRequest, resolveHostConversationId, resolveHostBindings, resolveHostIdentity,
) {
  try {
    if (typeof isAuthenticatedHostRequest !== 'function'
      || isAuthenticatedHostRequest(request) !== true
      || typeof resolveHostConversationId !== 'function'
      || resolveHostConversationId(request) !== conversationId
      || typeof resolveHostBindings !== 'function'
      || typeof resolveHostIdentity !== 'function') return null;
    const session = request?.session;
    const userHandle = request?.user?.profile?.handle;
    const sessionId = session?.logicEngineSessionId;
    if (typeof userHandle !== 'string' || userHandle !== userHandle.trim() || !userHandle
      || (session?.handle !== undefined && session.handle !== userHandle)
      || session?.logicEngineSessionHandle !== userHandle
      || typeof sessionId !== 'string' || !HOST_SESSION_UUID.test(sessionId)
      || typeof conversationId !== 'string' || !HOST_CONVERSATION_ID.test(conversationId)) return null;
    const firstSeparator = conversationId.indexOf(':');
    const lastSeparator = conversationId.lastIndexOf(':');
    if (firstSeparator <= 0 || lastSeparator <= firstSeparator + 1
      || conversationId.indexOf(':', lastSeparator + 1) !== -1) return null;
    const conversationSessionId = conversationId.slice(0, firstSeparator);
    const installationId = conversationId.slice(firstSeparator + 1, lastSeparator);
    const conversationUuid = conversationId.slice(lastSeparator + 1);
    if (!HOST_SESSION_UUID.test(conversationSessionId)
      || conversationSessionId !== sessionId
      || !HOST_SESSION_UUID.test(installationId)
      || !HOST_SESSION_UUID.test(conversationUuid)) return null;

    const identity = resolveHostIdentity(request, conversationId);
    if (!isExactPlainDataRecord(identity, ['host_installation_id', 'authenticated_account_id'])) return null;
    const identityInstallationId = identity.host_installation_id;
    const authenticatedAccountId = identity.authenticated_account_id;
    if (!HOST_SESSION_UUID.test(identityInstallationId ?? '')
      || !HOST_SESSION_UUID.test(authenticatedAccountId ?? '')
      || identityInstallationId !== installationId) return null;
    const bindings = resolveHostBindings(request, conversationId);
    if (!isExactPlainDataRecord(bindings, ['world_id', 'actor_id'])
      || !validBindingId(bindings.world_id) || !validBindingId(bindings.actor_id)) return null;
    const context = Object.freeze({
      host_installation_id: installationId,
      authenticated_account_id: authenticatedAccountId,
      host_session_id: sessionId,
      host_user_handle: userHandle,
      conversation_id: conversationId,
      world_id: bindings.world_id,
      actor_id: bindings.actor_id,
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
      resolveHostBindings,
      resolveHostIdentity,
    });
    return context;
  } catch {
    return null;
  }
}

function isLiveAuthenticatedHostContext(context, conversationId) {
  try {
    const binding = contextBindings.get(context);
    if (!binding || binding.conversationId !== conversationId) return false;
    if (binding.kind === 'assertion') {
      const currentSeconds = Math.floor(binding.now() / 1000);
      return Number.isSafeInteger(currentSeconds) && currentSeconds <= binding.expiresAt
        && binding.isSessionRevoked(binding.adapterId, binding.identity) === false;
    }
    if (binding.kind !== 'request') return false;
    const {
      request, hostSessionId, hostUserHandle, isAuthenticatedHostRequest,
      resolveHostConversationId, resolveHostBindings, resolveHostIdentity,
    } = binding;
    if (isAuthenticatedHostRequest(request) !== true
      || resolveHostConversationId(request) !== conversationId) return false;
    const session = request?.session;
    const currentUserHandle = request?.user?.profile?.handle;
    if (currentUserHandle !== hostUserHandle
      || session?.logicEngineSessionId !== hostSessionId
      || session?.logicEngineSessionHandle !== hostUserHandle
      || (session?.handle !== undefined && session.handle !== hostUserHandle)) return false;
    const identity = resolveHostIdentity(request, conversationId);
    if (!isExactPlainDataRecord(identity, ['host_installation_id', 'authenticated_account_id'])
      || identity.host_installation_id !== context.host_installation_id
      || identity.authenticated_account_id !== context.authenticated_account_id) return false;
    const bindings = resolveHostBindings(request, conversationId);
    return isExactPlainDataRecord(bindings, ['world_id', 'actor_id'])
      && bindings.world_id === context.world_id && bindings.actor_id === context.actor_id;
  } catch {
    return false;
  }
}

function invalidateHostContext(context) {
  try {
    contexts.delete(context);
    contextBindings.delete(context);
  } catch {}
}

export function isAuthenticatedHostSessionContext(context, conversationId) {
  try {
    if (context === null || typeof context !== 'object' || !contexts.has(context)
      || (context.identity !== 'SIGNED_AUTHENTICATED_ST_SESSION'
        && context.identity !== 'SIGNED_HOST_SESSION_ASSERTION')
      || context.conversation_id !== conversationId
      || !HOST_SESSION_UUID.test(context.host_installation_id ?? '')
      || !HOST_SESSION_UUID.test(context.authenticated_account_id ?? '')
      || context.conversation_id.slice(0, context.conversation_id.indexOf(':')) !== context.host_session_id
      || context.conversation_id.slice(
        context.conversation_id.indexOf(':') + 1,
        context.conversation_id.lastIndexOf(':'),
      ) !== context.host_installation_id
      || !HOST_SESSION_UUID.test(context.host_session_id ?? '')
      || !validBindingId(context.world_id) || !validBindingId(context.actor_id)) {
      invalidateHostContext(context);
      return false;
    }
    if (!isLiveAuthenticatedHostContext(context, conversationId)) {
      invalidateHostContext(context);
      return false;
    }
    return true;
  } catch {
    invalidateHostContext(context);
    return false;
  }
}

/**
 * Run one Host-owned operation inside its authenticated request context.
 * The callback receives no identity arguments: Core/consumer code reads the
 * branded capability from AsyncLocalStorage, not from caller request data.
 */
export function runWithAuthenticatedHostSession(
  request, conversationId, callback, isAuthenticatedHostRequest, resolveHostConversationId, resolveHostBindings, resolveHostIdentity,
) {
  if (typeof callback !== 'function') throw new TypeError('A Host operation callback is required');
  const context = createAuthenticatedHostSessionContext(
    request, conversationId, isAuthenticatedHostRequest, resolveHostConversationId, resolveHostBindings, resolveHostIdentity,
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
    assertion.world_id,
    assertion.actor_id,
    assertion.issued_at,
    assertion.nonce,
  ]);
}

function validHostSessionAssertion(assertion) {
  try {
    if (!assertion || typeof assertion !== 'object' || Array.isArray(assertion) || utilTypes.isProxy(assertion)
      || (Object.getPrototypeOf(assertion) !== Object.prototype && Object.getPrototypeOf(assertion) !== null)) return false;
    const ownKeys = Reflect.ownKeys(assertion);
    if (ownKeys.length !== ASSERTION_KEYS.length) return false;
    for (let index = 0; index < ASSERTION_KEYS.length; index += 1) {
      const key = ASSERTION_KEYS[index];
      const descriptor = Object.getOwnPropertyDescriptor(assertion, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return false;
    }
    for (let index = 0; index < ownKeys.length; index += 1) {
      const key = ownKeys[index];
      if (typeof key !== 'string') return false;
      let known = false;
      for (let keyIndex = 0; keyIndex < ASSERTION_KEYS.length; keyIndex += 1) {
        if (ASSERTION_KEYS[keyIndex] === key) {
          known = true;
          break;
        }
      }
      if (!known) return false;
    }
    return assertion.protocol_version === 1
      && typeof assertion.host_installation_id === 'string' && HOST_SESSION_UUID.test(assertion.host_installation_id)
      && typeof assertion.authenticated_account_id === 'string' && HOST_SESSION_UUID.test(assertion.authenticated_account_id)
      && typeof assertion.host_session_id === 'string' && HOST_SESSION_UUID.test(assertion.host_session_id)
      && typeof assertion.nonce === 'string' && HOST_SESSION_UUID.test(assertion.nonce)
      && typeof assertion.conversation_id === 'string'
      && HOST_CONVERSATION_ID.test(assertion.conversation_id)
      && validBindingId(assertion.world_id) && validBindingId(assertion.actor_id)
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
 * in-process Host gate. Production Memory retrieval must inject durable nonce
 * consumption and session-revocation callbacks; the local Map fallback is only
 * for isolated callers and must never authorize the production Memory route.
 */
export function createHostSessionAssertionRunner({
  secret,
  now = () => Date.now(),
  maxAgeSeconds = 30,
  maxFutureSkewSeconds = 5,
  maxRememberedNonces = 10000,
  consumeNonce = null,
  adapterId = null,
  isSessionRevoked = null,
} = {}) {
  if (typeof secret !== 'string' || secret.length < 16
    || typeof now !== 'function'
    || !Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 1 || maxAgeSeconds > 120
    || !Number.isInteger(maxFutureSkewSeconds) || maxFutureSkewSeconds < 0 || maxFutureSkewSeconds > 30
    || !Number.isInteger(maxRememberedNonces) || maxRememberedNonces < 1 || maxRememberedNonces > 100000
    || (consumeNonce !== null && typeof consumeNonce !== 'function')
    || (adapterId !== null && (typeof adapterId !== 'string' || !adapterId.trim()))
    || (isSessionRevoked !== null && typeof isSessionRevoked !== 'function')
    || ((adapterId === null) !== (isSessionRevoked === null))) {
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
      if (consumeNonce !== null) {
        let consumed;
        try {
          consumed = consumeNonce(assertion.nonce, assertion.issued_at + maxAgeSeconds, currentSeconds);
        } catch {
          throw new Error('HOST_ASSERTION_REPLAY_GUARD_UNAVAILABLE');
        }
        if (consumed !== true) throw new Error('HOST_SESSION_ASSERTION_REPLAYED');
      } else {
        for (const [nonce, expiresAt] of usedNonces) {
          if (expiresAt < currentSeconds) usedNonces.delete(nonce);
        }
        if (usedNonces.has(assertion.nonce)) throw new Error('HOST_SESSION_ASSERTION_REPLAYED');
        if (usedNonces.size >= maxRememberedNonces) throw new Error('HOST_SESSION_ASSERTION_CAPACITY_EXCEEDED');
        usedNonces.set(assertion.nonce, assertion.issued_at + maxAgeSeconds);
      }
      const identity = Object.freeze({
        host_installation_id: assertion.host_installation_id,
        authenticated_account_id: assertion.authenticated_account_id,
        host_session_id: assertion.host_session_id,
      });
      if (isSessionRevoked !== null) {
        let revoked;
        try { revoked = isSessionRevoked(adapterId, identity); }
        catch { throw new Error('HOST_SESSION_REVOCATION_STATUS_UNAVAILABLE'); }
        if (revoked === true) throw new Error('HOST_SESSION_REVOKED');
        if (revoked !== false) throw new Error('HOST_SESSION_REVOCATION_STATUS_UNAVAILABLE');
      }
      const context = Object.freeze({
        host_installation_id: assertion.host_installation_id,
        authenticated_account_id: assertion.authenticated_account_id,
        host_session_id: assertion.host_session_id,
        conversation_id: assertion.conversation_id,
        world_id: assertion.world_id,
        actor_id: assertion.actor_id,
        identity: 'SIGNED_HOST_SESSION_ASSERTION',
      });
      contexts.add(context);
      contextBindings.set(context, {
        kind: 'assertion',
        conversationId: assertion.conversation_id,
        expiresAt: assertion.issued_at + maxAgeSeconds,
        now,
        adapterId,
        identity,
        isSessionRevoked: isSessionRevoked || (() => false),
      });
      const revokeContext = () => {
        contexts.delete(context);
        contextBindings.delete(context);
      };
      try {
        const result = requestContext.run(context, callback);
        if (result && typeof result.then === 'function') {
          return Promise.resolve(result).then(value => {
            if (!isAuthenticatedHostSessionContext(context, assertion.conversation_id)) {
              const currentSeconds = Math.floor(now() / 1000);
              if (!Number.isSafeInteger(currentSeconds) || currentSeconds > assertion.issued_at + maxAgeSeconds) {
                throw new Error('HOST_SESSION_ASSERTION_EXPIRED');
              }
              let revoked;
              try { revoked = isSessionRevoked === null ? false : isSessionRevoked(adapterId, identity); }
              catch { throw new Error('HOST_SESSION_REVOCATION_STATUS_UNAVAILABLE'); }
              if (revoked === true) throw new Error('HOST_SESSION_REVOKED');
              if (revoked !== false) throw new Error('HOST_SESSION_REVOCATION_STATUS_UNAVAILABLE');
              throw new Error('HOST_SESSION_REVOKED');
            }
            return value;
          }).finally(revokeContext);
        }
        if (!isAuthenticatedHostSessionContext(context, assertion.conversation_id)) {
          const currentSeconds = Math.floor(now() / 1000);
          if (!Number.isSafeInteger(currentSeconds) || currentSeconds > assertion.issued_at + maxAgeSeconds) {
            throw new Error('HOST_SESSION_ASSERTION_EXPIRED');
          }
          let revoked;
          try { revoked = isSessionRevoked === null ? false : isSessionRevoked(adapterId, identity); }
          catch { throw new Error('HOST_SESSION_REVOCATION_STATUS_UNAVAILABLE'); }
          if (revoked === true) throw new Error('HOST_SESSION_REVOKED');
          if (revoked !== false) throw new Error('HOST_SESSION_REVOCATION_STATUS_UNAVAILABLE');
          throw new Error('HOST_SESSION_REVOKED');
        }
        revokeContext();
        return result;
      } catch (error) {
        revokeContext();
        throw error;
      }
    },
  });
}
