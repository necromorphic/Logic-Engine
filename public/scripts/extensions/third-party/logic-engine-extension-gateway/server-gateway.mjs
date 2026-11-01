export const EXTENSION_GATEWAY_PATH = '/api/logic-engine/extension';
export const EXTENSION_GATEWAY_MAX_BODY_BYTES = 256 * 1024;

const mountedApps = new WeakSet();
const forbiddenIdentityKeys = new Set([
  '__proto__', 'prototype', 'constructor',
  'world_id', 'worldid', 'actor_id', 'actorid',
  'installation_id', 'installationid', 'account_id', 'accountid',
  'session_id', 'sessionid', 'conversation_id', 'conversationid',
]);

function send(response, status, body) {
  if (response.headersSent || response.destroyed) return;
  response.status(status);
  response.set('cache-control', 'no-store');
  response.set('content-type', 'application/json; charset=utf-8');
  response.json(body);
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateJsonTree(root) {
  const stack = [{ value: root, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const { value, depth } = stack.pop();
    nodes += 1;
    if (nodes > 10_000 || depth > 32) throw new Error('INVALID_ENVELOPE');
    if (Array.isArray(value)) {
      for (const item of value) stack.push({ value: item, depth: depth + 1 });
      continue;
    }
    if (value && typeof value === 'object') {
      if (!isPlainRecord(value)) throw new Error('INVALID_ENVELOPE');
      for (const [key, child] of Object.entries(value)) {
        if (forbiddenIdentityKeys.has(key.toLowerCase())) throw new Error('UNTRUSTED_IDENTITY_FIELD');
        stack.push({ value: child, depth: depth + 1 });
      }
    } else if (typeof value === 'string' && value.length > 64 * 1024) {
      throw new Error('INVALID_ENVELOPE');
    }
  }
}

function validateEnvelope(value) {
  if (!isPlainRecord(value)
    || Object.keys(value).some(key => !['schema_version', 'request_id', 'operation', 'payload'].includes(key))
    || value.schema_version !== 1
    || typeof value.request_id !== 'string'
    || !/^[A-Za-z0-9._:-]{1,128}$/.test(value.request_id)
    || typeof value.operation !== 'string'
    || !/^[a-z][a-z0-9._-]{0,63}$/.test(value.operation)
    || !isPlainRecord(value.payload)) {
    throw new Error('INVALID_ENVELOPE');
  }
  validateJsonTree(value.payload);
  return Object.freeze({
    schema_version: 1,
    request_id: value.request_id,
    operation: value.operation,
    payload: value.payload,
  });
}

async function readBoundedBody(request, maxBytes) {
  const declared = request.headers?.['content-length'];
  if (declared !== undefined) {
    if (!/^\d+$/.test(String(declared)) || Number(declared) > maxBytes) {
      throw new Error('REQUEST_TOO_LARGE');
    }
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maxBytes) throw new Error('REQUEST_TOO_LARGE');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, size).toString('utf8');
}

export function createExtensionGateway({ hostAdapter, maxBodyBytes = EXTENSION_GATEWAY_MAX_BODY_BYTES, now = () => new Date().toISOString(), onDiagnostic = () => {} } = {}) {
  if (!hostAdapter || typeof hostAdapter.handleExtensionRequest !== 'function'
    || !Number.isInteger(maxBodyBytes) || maxBodyBytes < 1024
    || maxBodyBytes > EXTENSION_GATEWAY_MAX_BODY_BYTES
    || typeof now !== 'function' || typeof onDiagnostic !== 'function') {
    throw new TypeError('Extension Gateway requires an Authenticated Host Adapter and a bounded request size.');
  }

  let state = 'ACTIVE';
  let inFlight = 0;

  function diagnostic(event, details = {}) {
    try {
      const result = onDiagnostic(Object.freeze({
        component: 'extension-gateway',
        event,
        at: now(),
        ...details,
      }));
      if (result && typeof result.then === 'function') return false;
      return true;
    } catch {
      return false;
    }
  }

  async function handle(request, response) {
    if (state !== 'ACTIVE') {
      diagnostic('INGRESS_REJECTED', { reason: 'GATEWAY_UNAVAILABLE' });
      send(response, 503, { error: 'GATEWAY_UNAVAILABLE' });
      return;
    }
    if (request.method !== 'POST' || request.path !== EXTENSION_GATEWAY_PATH) {
      diagnostic('INGRESS_REJECTED', { reason: 'NOT_FOUND' });
      send(response, 404, { error: 'NOT_FOUND' });
      return;
    }
    const contentType = String(request.headers?.['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
    if (contentType !== 'application/json') {
      diagnostic('INGRESS_REJECTED', { reason: 'UNSUPPORTED_MEDIA_TYPE' });
      send(response, 415, { error: 'UNSUPPORTED_MEDIA_TYPE' });
      return;
    }

    let raw;
    try {
      raw = await readBoundedBody(request, maxBodyBytes);
    } catch (error) {
      const reason = error?.message === 'REQUEST_TOO_LARGE' ? 'REQUEST_TOO_LARGE' : 'INVALID_REQUEST';
      diagnostic('INGRESS_REJECTED', { reason });
      send(response, reason === 'REQUEST_TOO_LARGE' ? 413 : 400, { error: reason });
      return;
    }

    let envelope;
    try {
      envelope = validateEnvelope(JSON.parse(raw));
    } catch {
      diagnostic('INGRESS_REJECTED', { reason: 'INVALID_ENVELOPE' });
      send(response, 400, { error: 'INVALID_ENVELOPE' });
      return;
    }

    if (state !== 'ACTIVE') {
      diagnostic('INGRESS_REJECTED', { reason: 'GATEWAY_UNAVAILABLE', request_id: envelope.request_id });
      send(response, 503, { error: 'GATEWAY_UNAVAILABLE' });
      return;
    }
    const receivedAt = now();
    if (!diagnostic('INGRESS_ACCEPTED', { request_id: envelope.request_id, operation: envelope.operation })) {
      send(response, 503, { error: 'GATEWAY_DIAGNOSTICS_UNAVAILABLE' });
      return;
    }
    inFlight += 1;
    try {
      // The Gateway forwards the native request object. Only Host Adapter may
      // inspect ST-owned session/account state and establish trusted bindings.
      const result = await hostAdapter.handleExtensionRequest({
        envelope,
        hostRequest: request,
        receivedAt: now(),
      });
      if (!result || !Number.isInteger(result.status) || result.status < 200 || result.status > 599
        || !Object.hasOwn(result, 'body')) {
        send(response, 503, { error: 'HOST_ADAPTER_UNAVAILABLE' });
        return;
      }
      if (!diagnostic('HOST_ADAPTER_RESULT', { request_id: envelope.request_id, operation: envelope.operation, status: result.status })) {
        send(response, 503, { error: 'GATEWAY_DIAGNOSTICS_UNAVAILABLE' });
        return;
      }
      send(response, result.status, result.body);
    } catch {
      diagnostic('HOST_ADAPTER_ERROR', { request_id: envelope.request_id, operation: envelope.operation });
      send(response, 503, { error: 'HOST_ADAPTER_UNAVAILABLE' });
    } finally {
      inFlight -= 1;
    }
  }

  return Object.freeze({
    handle,
    getLifecycle() { return Object.freeze({ state, in_flight: inFlight }); },
    async close({ drain = true } = {}) {
      if (state === 'CLOSED') return;
      state = 'DRAINING';
      if (drain) {
        while (inFlight > 0) await new Promise(resolve => setImmediate(resolve));
      }
      state = 'CLOSED';
    },
  });
}

/**
 * Mount exactly one same-process ST route after ST's authenticated-session
 * middleware and before native private/generation routers. The managed startup
 * integration must exclude this exact path from global JSON body parsing so
 * this handler can enforce its own byte limit on the raw request stream.
 * It opens no listener or port.
 */
export function mountExtensionGateway({ app, gateway } = {}) {
  if (!app || typeof app.post !== 'function'
    || !gateway || typeof gateway.handle !== 'function'
    || mountedApps.has(app)) {
    throw new Error('EXTENSION_GATEWAY_MOUNT_INVALID_OR_DUPLICATE');
  }
  mountedApps.add(app);
  app.post(EXTENSION_GATEWAY_PATH, (request, response) => gateway.handle(request, response));
  return Object.freeze({
    path: EXTENSION_GATEWAY_PATH,
    method: 'POST',
    close: options => gateway.close(options),
  });
}
