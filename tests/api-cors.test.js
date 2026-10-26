import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { createApiServer } from '../src/api/server.js';

const TOKEN = 'cors-test-token-long-enough-123456';
const ALLOWED_ORIGIN = 'http://127.0.0.1:8000';

async function setup(t, allowedOrigins = [ALLOWED_ORIGIN]) {
  const store = new SQLiteStore(':memory:');
  const server = createApiServer({ engine: new LogicEngine(store), token: TOKEN, allowedOrigins });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); store.close(); });
  return 'http://127.0.0.1:' + server.address().port;
}

test('health endpoint returns CORS headers only for an exact allowlisted origin', async (t) => {
  const base = await setup(t);
  const allowed = await fetch(base + '/health', { headers: { Origin: ALLOWED_ORIGIN } });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN);
  assert.equal(allowed.headers.get('vary'), 'Origin');
  assert.deepEqual(await allowed.json(), { ok: true, service: 'logic-engine', protocol_version: 'v1' });

  const denied = await fetch(base + '/health', { headers: { Origin: 'http://evil.example' } });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error.code, 'ORIGIN_NOT_ALLOWED');
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
});

test('CORS preflight permits only adapter-facing headers and supported methods', async (t) => {
  const base = await setup(t);
  const preflight = await fetch(base + '/v1/worlds/demo/proposals', {
    method: 'OPTIONS',
    headers: {
      Origin: ALLOWED_ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization, content-type, x-adapter-id, x-adapter-token',
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN);
  assert.match(preflight.headers.get('access-control-allow-headers'), /x-adapter-token/);

  const forbiddenHeader = await fetch(base + '/v1/worlds/demo/proposals', {
    method: 'OPTIONS',
    headers: {
      Origin: ALLOWED_ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'x-admin-token',
    },
  });
  assert.equal(forbiddenHeader.status, 403);
  assert.equal((await forbiddenHeader.json()).error.code, 'CORS_HEADERS_NOT_ALLOWED');

  const forbiddenMethod = await fetch(base + '/v1/worlds/demo/proposals', {
    method: 'OPTIONS',
    headers: { Origin: ALLOWED_ORIGIN, 'Access-Control-Request-Method': 'PUT' },
  });
  assert.equal(forbiddenMethod.status, 403);
  assert.equal((await forbiddenMethod.json()).error.code, 'CORS_METHOD_NOT_ALLOWED');
});

test('CORS origin configuration rejects wildcards and non-origin URLs', () => {
  const store = new SQLiteStore(':memory:');
  try {
    const engine = new LogicEngine(store);
    assert.throws(() => createApiServer({ engine, token: TOKEN, allowedOrigins: ['*'] }), /valid HTTP\(S\) origin/);
    assert.throws(() => createApiServer({ engine, token: TOKEN, allowedOrigins: ['http://127.0.0.1:8000/path'] }), /exact origin/);
  } finally {
    store.close();
  }
});

test('non-browser health requests remain supported without CORS configuration', async (t) => {
  const base = await setup(t, []);
  const response = await fetch(base + '/health');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});
