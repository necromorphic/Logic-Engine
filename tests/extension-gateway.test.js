import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createExtensionGateway,
  EXTENSION_GATEWAY_PATH,
  mountExtensionGateway,
} from '../src/deployment/extension-gateway.js';

function request({ method = 'POST', path = EXTENSION_GATEWAY_PATH, headers = {}, body = {} } = {}) {
  const bytes = Buffer.from(JSON.stringify(body));
  return {
    method, path,
    headers: { 'content-type': 'application/json', 'content-length': String(bytes.length), ...headers },
    async *[Symbol.asyncIterator]() { yield bytes; },
  };
}

function response() {
  return {
    headersSent: false, destroyed: false, statusCode: null, headers: {}, body: null,
    status(code) { this.statusCode = code; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    json(value) { this.body = value; this.headersSent = true; return this; },
  };
}

const valid = {
  schema_version: 1,
  request_id: 'req-0001',
  operation: 'conversation.read',
  payload: { include_metadata: true },
};

test('positive ingress routes one validated envelope to Host Adapter exactly once', async () => {
  const seen = [];
  const gateway = createExtensionGateway({
    hostAdapter: { async handleExtensionRequest(input) { seen.push(input); return { status: 200, body: { ok: true } }; } },
    now: () => '2026-11-01T00:00:00.000Z',
  });
  const res = response();
  await gateway.handle(request({ body: valid }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].envelope, valid);
  assert.equal(seen[0].receivedAt, '2026-11-01T00:00:00.000Z');
  assert.equal(gateway.getLifecycle().in_flight, 0);
});

test('unknown path and method never reach Host Adapter', async () => {
  let calls = 0;
  const gateway = createExtensionGateway({ hostAdapter: { handleExtensionRequest: async () => { calls++; return { status: 200, body: {} }; } } });
  const unknown = response();
  await gateway.handle(request({ path: '/api/other', body: valid }), unknown);
  const wrongMethod = response();
  await gateway.handle(request({ method: 'GET', body: valid }), wrongMethod);
  assert.equal(unknown.statusCode, 404);
  assert.equal(wrongMethod.statusCode, 404);
  assert.equal(calls, 0);
});

test('malformed, extra-field, and forged identity envelopes are denied before Host Adapter', async () => {
  let calls = 0;
  const gateway = createExtensionGateway({ hostAdapter: { handleExtensionRequest: async () => { calls++; return { status: 200, body: {} }; } } });
  for (const body of [
    { ...valid, extra: true },
    { ...valid, payload: { world_id: 'forged-world' } },
    { ...valid, payload: { nested: { actor_id: 'forged-actor' } } },
    { ...valid, payload: [] },
    { ...valid, schema_version: 2 },
  ]) {
    const res = response();
    await gateway.handle(request({ body }), res);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(calls, 0);
});

test('oversized body and unsupported content type are denied before Host Adapter', async () => {
  let calls = 0;
  const gateway = createExtensionGateway({
    maxBodyBytes: 1024,
    hostAdapter: { handleExtensionRequest: async () => { calls++; return { status: 200, body: {} }; } },
  });
  const large = response();
  await gateway.handle(request({ headers: { 'content-length': '2048' }, body: valid }), large);
  const media = response();
  await gateway.handle(request({ headers: { 'content-type': 'text/plain' }, body: valid }), media);
  assert.equal(large.statusCode, 413);
  assert.equal(media.statusCode, 415);
  assert.equal(calls, 0);
});

test('Host Adapter outage fails closed and no alternate handler is attempted', async () => {
  let calls = 0;
  const gateway = createExtensionGateway({
    hostAdapter: { handleExtensionRequest: async () => { calls++; throw new Error('offline'); } },
  });
  const res = response();
  await gateway.handle(request({ body: valid }), res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { error: 'HOST_ADAPTER_UNAVAILABLE' });
  assert.equal(calls, 1);
});

test('lifecycle drains in-flight requests and rejects new ingress after shutdown starts', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const gateway = createExtensionGateway({
    hostAdapter: { handleExtensionRequest: async () => { await pending; return { status: 200, body: {} }; } },
  });
  const res = response();
  const handling = gateway.handle(request({ body: valid }), res);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(gateway.getLifecycle().in_flight, 1);
  let closed = false;
  const closing = gateway.close().then(() => { closed = true; });
  const rejected = response();
  await gateway.handle(request({ body: valid }), rejected);
  assert.equal(rejected.statusCode, 503);
  assert.equal(closed, false);
  release();
  await Promise.all([handling, closing]);
  assert.equal(closed, true);
  assert.deepEqual(gateway.getLifecycle(), { state: 'CLOSED', in_flight: 0 });
});

test('mount registers exactly one same-process route and rejects duplicate mounts', () => {
  const routes = [];
  const app = { post(path, handler) { routes.push({ path, handler }); } };
  const gateway = createExtensionGateway({ hostAdapter: { handleExtensionRequest: async () => ({ status: 200, body: {} }) } });
  assert.deepEqual(mountExtensionGateway({ app, gateway }), { path: EXTENSION_GATEWAY_PATH, method: 'POST' });
  assert.deepEqual(routes.map(route => route.path), [EXTENSION_GATEWAY_PATH]);
  assert.throws(() => mountExtensionGateway({ app, gateway }), /DUPLICATE/);
});


test('unknown operation is forwarded to Host Adapter for trusted semantic denial, not authorized by Gateway', async () => {
  let received;
  const gateway = createExtensionGateway({
    hostAdapter: { handleExtensionRequest: async input => { received = input.envelope.operation; return { status: 403, body: { error: 'OPERATION_DENIED' } }; } },
  });
  const res = response();
  await gateway.handle(request({ body: { ...valid, operation: 'admin.root' } }), res);
  assert.equal(received, 'admin.root');
  assert.equal(res.statusCode, 403);
});

test('repeated request identifiers are independently routed to Host Adapter and never bypass its checks', async () => {
  let calls = 0;
  const gateway = createExtensionGateway({
    hostAdapter: { handleExtensionRequest: async () => { calls += 1; return { status: 403, body: { error: 'REAUTH_REQUIRED' } }; } },
  });
  for (let i = 0; i < 2; i += 1) {
    const res = response();
    await gateway.handle(request({ body: valid }), res);
    assert.equal(res.statusCode, 403);
  }
  assert.equal(calls, 2);
});

test('chunked oversized body is rejected even without Content-Length', async () => {
  let calls = 0;
  const gateway = createExtensionGateway({
    maxBodyBytes: 1024,
    hostAdapter: { handleExtensionRequest: async () => { calls += 1; return { status: 200, body: {} }; } },
  });
  const req = {
    method: 'POST',
    path: EXTENSION_GATEWAY_PATH,
    headers: { 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.alloc(700, 0x61);
      yield Buffer.alloc(700, 0x61);
    },
  };
  const res = response();
  await gateway.handle(req, res);
  assert.equal(res.statusCode, 413);
  assert.equal(calls, 0);
});
