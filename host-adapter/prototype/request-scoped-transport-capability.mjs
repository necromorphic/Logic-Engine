import { createHash } from 'node:crypto';

const validUrl = value => {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
};

const sha256 = value => createHash('sha256').update(value, 'utf8').digest('hex');

/**
 * Creates a one-shot, request-scoped transport capability.
 *
 * This function must be called only inside trusted server-side provider code,
 * after the provider has resolved its endpoint, credentials, transformations,
 * streaming mode, and exact serialized body. It does not authorize dispatch
 * and must not be exposed as a browser-callable route.
 *
 * The body is an already serialized string. This module never parses or
 * reserializes it. Calling start() synchronously invokes the configured
 * transport once and returns its response promise; it never retries.
 */
export function createRequestScopedTransportCapability({
  fetchImpl = globalThis.fetch,
  endpoint,
  method = 'POST',
  headers,
  serializedBody,
  streaming = false,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('A trusted transport implementation is required');
  if (!validUrl(endpoint)) throw new TypeError('A resolved HTTP(S) endpoint without URL credentials is required');
  if (typeof method !== 'string' || !/^[A-Z]+$/.test(method)) throw new TypeError('A normalized HTTP method is required');
  if (typeof serializedBody !== 'string') throw new TypeError('The exact serialized request body is required');
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) throw new TypeError('Resolved provider headers are required');
  if (typeof streaming !== 'boolean') throw new TypeError('streaming must be boolean');

  const copiedHeaders = Object.create(null);
  for (const [name, value] of Object.entries(headers)) {
    const normalizedName = name.toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)
      || typeof value !== 'string'
      || /[\\r\\n]/.test(value)
      || Object.hasOwn(copiedHeaders, normalizedName)) {
      throw new TypeError('Provider headers must be unique normalized string pairs without line breaks');
    }
    copiedHeaders[normalizedName] = value;
  }
  Object.freeze(copiedHeaders);

  const requestMetadata = Object.freeze({
    endpoint_sha256: sha256(endpoint),
    method,
    streaming,
    body_sha256: sha256(serializedBody),
    headers_sha256: sha256(JSON.stringify(Object.keys(copiedHeaders).sort().map(name => [name, copiedHeaders[name]]))),
  });
  const requestDigest = sha256(JSON.stringify(requestMetadata));
  let used = false;

  return Object.freeze({
    requestMetadata,
    requestDigest,
    start() {
      if (used) throw new Error('TRANSPORT_CAPABILITY_ALREADY_USED');
      used = true;
      let response;
      try {
        // This invocation is the only outbound call this capability can make.
        // A synchronous throw is still treated as an ambiguous post-start result.
        response = fetchImpl(endpoint, {
          method,
          headers: copiedHeaders,
          body: serializedBody,
          redirect: 'error',
        });
      } catch (error) {
        return Object.freeze({ started: true, response: Promise.reject(error) });
      }
      return Object.freeze({ started: true, response: Promise.resolve(response) });
    },
  });
}

/**
 * Orders authorization + durable DISPATCH_STARTED before the only transport.
 *
 * authorizeAndPersistStart is an owner-provided atomic operation: it must
 * validate current authorization and persist DISPATCH_STARTED under the same
 * serialization boundary used by source invalidation/revocation. Separate
 * sequential callbacks are intentionally not accepted here.
 *
 * This helper is a review candidate only until a real Core/Provider operation
 * can satisfy that atomic contract. It must not be wired to production by
 * replacing the owner operation with a mock or two independent checks.
 */
export async function dispatchThroughRequestScopedCapability({
  capability,
  authorizeAndPersistStart,
} = {}) {
  if (!capability || typeof capability.start !== 'function'
    || typeof capability.requestDigest !== 'string'
    || typeof capability.requestMetadata !== 'object') {
    return Object.freeze({ status: 'DENIED', reason: 'TRANSPORT_CAPABILITY_INVALID' });
  }
  if (typeof authorizeAndPersistStart !== 'function') {
    return Object.freeze({ status: 'DENIED', reason: 'ATOMIC_AUTHORIZATION_START_UNAVAILABLE' });
  }

  let decision;
  try {
    decision = await authorizeAndPersistStart(Object.freeze({
      requestDigest: capability.requestDigest,
      requestMetadata: capability.requestMetadata,
    }));
  } catch {
    return Object.freeze({ status: 'DENIED', reason: 'AUTHORIZATION_START_UNAVAILABLE' });
  }
  if (!decision || decision.status !== 'STARTED'
    || typeof decision.dispatchId !== 'string' || !decision.dispatchId
    || decision.requestDigest !== capability.requestDigest) {
    return Object.freeze({ status: 'DENIED', reason: 'DISPATCH_START_NOT_DURABLY_AUTHORIZED' });
  }

  let started;
  try {
    started = capability.start();
  } catch {
    // Once the durable start boundary has been accepted, never retry: transport
    // state is uncertain even if the local call failed synchronously.
    return Object.freeze({ status: 'UNKNOWN', dispatchId: decision.dispatchId });
  }
  if (!started || started.started !== true || !started.response || typeof started.response.then !== 'function') {
    return Object.freeze({ status: 'UNKNOWN', dispatchId: decision.dispatchId });
  }

  try {
    const response = await started.response;
    return Object.freeze({ status: 'RESPONSE_RECEIVED', dispatchId: decision.dispatchId, response });
  } catch {
    return Object.freeze({ status: 'UNKNOWN', dispatchId: decision.dispatchId });
  }
}
