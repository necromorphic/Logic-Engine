import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createExtensionGateway,
  EXTENSION_GATEWAY_PATH,
  mountExtensionGateway,
  mountDefaultExtensionGateway,
  registerAuthenticatedHostAdapter,
  closeDefaultExtensionGateway,
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
  const mounted = mountExtensionGateway({ app, gateway });
  assert.equal(mounted.path, EXTENSION_GATEWAY_PATH);
  assert.equal(mounted.method, 'POST');
  assert.equal(typeof mounted.close, 'function');
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


test('client Extension has exactly one same-origin Gateway transport and no direct Core or Provider route', () => {
  const clientPath = new URL('../public/scripts/extensions/third-party/logic-engine-extension-gateway/index.js', import.meta.url);
  const manifestPath = new URL('../public/scripts/extensions/third-party/logic-engine-extension-gateway/manifest.json', import.meta.url);
  const source = readFileSync(clientPath, 'utf8');
  const serverSource = readFileSync(new URL('../public/scripts/extensions/third-party/logic-engine-extension-gateway/server-gateway.mjs', import.meta.url), 'utf8');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal((source.match(/fetch\s*\(/g) || []).length, 1);
  assert.match(source, /const GATEWAY_PATH = '\/api\/logic-engine\/extension'/);
  assert.match(source, /credentials: 'same-origin'/);
  assert.match(source, /redirect: 'error'/);
  assert.match(source, /export function teardown/);
  assert.doesNotMatch(source, /localhost:\\d+|127\\.0\\.0\\.1:\\d+|LOGIC_ENGINE_CORE_URL|Provider Base URL/i);
  assert.equal((serverSource.match(/app\.post\s*\(/g) || []).length, 1);
  assert.match(serverSource, /app\.post\(EXTENSION_GATEWAY_PATH/);
  assert.doesNotMatch(serverSource, /createServer\s*\(|fetch\s*\(|MemoryProvider|ProviderRelay/i);
  assert.equal(manifest.js, 'index.js');
  assert.equal(manifest.hooks.activate, 'init');
});


test('diagnostics expose metadata only and audit failure prevents Host Adapter dispatch', async () => {
  const events = [];
  let calls = 0;
  const gateway = createExtensionGateway({
    hostAdapter: { handleExtensionRequest: async () => { calls += 1; return { status: 200, body: {} }; } },
    onDiagnostic: event => events.push(event),
  });
  const ok = response();
  await gateway.handle(request({ body: valid }), ok);
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(events.map(event => event.event), ['INGRESS_ACCEPTED', 'HOST_ADAPTER_RESULT']);
  assert.equal(events[0].request_id, valid.request_id);
  assert.equal(Object.hasOwn(events[0], 'payload'), false);

  const unavailable = createExtensionGateway({
    hostAdapter: { handleExtensionRequest: async () => { calls += 1; return { status: 200, body: {} }; } },
    onDiagnostic: () => { throw new Error('audit sink unavailable'); },
  });
  const denied = response();
  await unavailable.handle(request({ body: valid }), denied);
  assert.equal(denied.statusCode, 503);
  assert.deepEqual(denied.body, { error: 'GATEWAY_DIAGNOSTICS_UNAVAILABLE' });
  assert.equal(calls, 1);
});


test('default ST mount is a single in-process ingress and fails closed until trusted Host Adapter registration', async () => {
  const routes = [];
  const app = { post(path, handler) { routes.push({ path, handler }); } };
  const mounted = mountDefaultExtensionGateway(app);
  assert.equal(mounted.path, EXTENSION_GATEWAY_PATH);
  assert.equal(routes.length, 1);

  const unavailable = response();
  await routes[0].handler(request({ body: valid }), unavailable);
  assert.equal(unavailable.statusCode, 503);
  assert.equal(unavailable.body.error, 'GATEWAY_DIAGNOSTICS_UNAVAILABLE');

  const events = [];
  let calls = 0;
  const adapter = {
    async handleExtensionRequest({ envelope, hostRequest }) {
      calls += 1;
      assert.deepEqual(envelope, valid);
      assert.equal(hostRequest.path, EXTENSION_GATEWAY_PATH);
      return { status: 200, body: { adapter: 'authenticated-host-adapter' } };
    },
  };
  const unregister = registerAuthenticatedHostAdapter(adapter, {
    onDiagnostic: event => events.push(event),
  });
  const accepted = response();
  await routes[0].handler(request({ body: valid }), accepted);
  assert.equal(accepted.statusCode, 200);
  assert.equal(calls, 1);
  assert.deepEqual(events.map(event => event.event), ['INGRESS_ACCEPTED', 'HOST_ADAPTER_RESULT']);
  assert.equal(unregister(), true);

  const afterUnregister = response();
  await routes[0].handler(request({ body: valid }), afterUnregister);
  assert.equal(afterUnregister.statusCode, 503);
  assert.equal(calls, 1);
  await closeDefaultExtensionGateway();
});


test('pinned ST integration patch installs the sole route after auth and preserves the raw body limit', () => {
  const patchPath = new URL('../host-adapter/extension-gateway/patches/sillytavern-1.19.0-extension-gateway.patch', import.meta.url);
  const manifestPath = new URL('../host-adapter/extension-gateway/patches/patch-manager-manifest.json', import.meta.url);
  const patch = readFileSync(patchPath, 'utf8');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const startupHunk = patch.slice(patch.indexOf('diff --git a/src/server-startup.js'));
  const mainHunk = patch.slice(patch.indexOf('diff --git a/src/server-main.js'));

  assert.equal(manifest.target_git_commit, '7e8663cd9c184a550b37238218bdd32c6efc68e9');
  assert.deepEqual([...manifest.target_paths].sort(), [
    'public/scripts/extensions/third-party/logic-engine-extension-gateway/index.js',
    'public/scripts/extensions/third-party/logic-engine-extension-gateway/manifest.json',
    'public/scripts/extensions/third-party/logic-engine-extension-gateway/server-gateway.mjs',
    'src/server-main.js',
    'src/server-startup.js',
  ].sort());

  assert.match(startupHunk, /mountDefaultExtensionGateway\(app\);[\s\S]*?app\.use\('\/', userDataRouter\)/);
  assert.equal((startupHunk.match(/mountDefaultExtensionGateway\(app\)/g) || []).length, 1);
  assert.match(mainHunk, /request\.path !== EXTENSION_GATEWAY_PATH && request\.is\('application\/json'\)/);
  assert.match(mainHunk, /request\.path !== EXTENSION_GATEWAY_PATH && request\.is\('application\/x-www-form-urlencoded'\)/);
  assert.match(mainHunk, /await closeDefaultExtensionGateway\(\{ drain: true \}\)/);
  assert.ok(mainHunk.indexOf('closeDefaultExtensionGateway') < mainHunk.indexOf('await statsOnExit()'));
  assert.doesNotMatch(patch, /createServer\s*\(|\.listen\s*\(|Provider Base URL|MemoryProvider|ProviderRelay/i);
  assert.equal((patch.match(/app\.post\(EXTENSION_GATEWAY_PATH/g) || []).length, 1);
});

test('Host Adapter registration is singleton and cannot be withdrawn while requests are in flight', async () => {
  const events = [];
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const routes = [];
  const app = { post(path, handler) { routes.push(handler); } };
  const mounted = mountDefaultExtensionGateway(app);
  const adapter = { async handleExtensionRequest() { await pending; return { status: 200, body: {} }; } };
  const unregister = registerAuthenticatedHostAdapter(adapter, { onDiagnostic: event => events.push(event) });
  assert.throws(
    () => registerAuthenticatedHostAdapter(adapter, { onDiagnostic: () => true }),
    /DUPLICATE/,
  );

  const res = response();
  const handling = routes[0](request({ body: valid }), res);
  await new Promise(resolve => setImmediate(resolve));
  assert.throws(unregister, /STILL_IN_FLIGHT/);
  release();
  await handling;
  assert.equal(res.statusCode, 200);
  assert.equal(unregister(), true);
  await mounted.close({ drain: true });
  await closeDefaultExtensionGateway();
});
