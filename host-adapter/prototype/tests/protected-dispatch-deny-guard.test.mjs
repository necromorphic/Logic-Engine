import test from 'node:test';
import assert from 'node:assert/strict';
import { createProtectedDispatchDenyMiddleware, PROTECTED_EGRESS_ROUTE_PREFIXES } from '../protected-dispatch-deny-guard.mjs';

function responseRecorder() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function invoke(middleware, path, method = 'POST') {
  const response = responseRecorder();
  let nextCalls = 0;
  middleware({ path, method }, response, () => { nextCalls += 1; });
  return { response, nextCalls };
}

test('enforcement disabled preserves existing SillyTavern routing', () => {
  const result = invoke(createProtectedDispatchDenyMiddleware({ env: {} }), '/api/backends/chat-completions/generate');
  assert.equal(result.nextCalls, 1);
  assert.equal(result.response.statusCode, null);
});

test('enforcement mode denies each known model-capable route family before its handler', () => {
  const middleware = createProtectedDispatchDenyMiddleware({
    env: { SILLYTAVERN_REQUIRE_PROTECTED_EGRESS_GATEWAY: 'true' },
  });
  for (const prefix of PROTECTED_EGRESS_ROUTE_PREFIXES) {
    const result = invoke(middleware, prefix + '/generate');
    assert.equal(result.nextCalls, 0, prefix);
    assert.equal(result.response.statusCode, 503, prefix);
    assert.equal(result.response.headers['Cache-Control'], 'no-store', prefix);
    assert.equal(result.response.body?.error?.code, 'PROTECTED_EGRESS_GATEWAY_REQUIRED', prefix);
  }
});

test('enforcement denies reads and writes under model route families to avoid alternate method bypasses', () => {
  const middleware = createProtectedDispatchDenyMiddleware({
    env: { SILLYTAVERN_REQUIRE_PROTECTED_EGRESS_GATEWAY: 'true' },
  });
  for (const [path, method] of [
    ['/api/backends/chat-completions/generate', 'POST'],
    ['/api/google/caption', 'POST'],
    ['/api/openai/models', 'GET'],
    ['/api/backends/text-completions/generate', 'PUT'],
    ['/proxy/http://provider.example/generate', 'POST'],
    ['/api/extensions/custom-route', 'POST'],
    ['/api/plugins/edge-tts/synthesize', 'POST'],
    ['/api/search/serpapi', 'POST'],
  ]) {
    const result = invoke(middleware, path, method);
    assert.equal(result.nextCalls, 0);
    assert.equal(result.response.statusCode, 503);
  }
});

test('prefix matching is case-insensitive and does not block unrelated routes', () => {
  const middleware = createProtectedDispatchDenyMiddleware({
    env: { SILLYTAVERN_REQUIRE_PROTECTED_EGRESS_GATEWAY: 'true' },
  });
  for (const path of [
    '/api/chats/current',
    '/api/vector/query',
    '/api/openaiish/generate',
    '/api/backups/create',
  ]) {
    const result = invoke(middleware, path);
    assert.equal(result.nextCalls, 1, path);
    assert.equal(result.response.statusCode, null, path);
  }
  for (const path of ['/API/GOOGLE/CAPTION', '/API/BACKENDS/CHAT-COMPLETIONS/GENERATE']) {
    const result = invoke(middleware, path);
    assert.equal(result.nextCalls, 0, path);
    assert.equal(result.response.statusCode, 503, path);
  }
});

test('denial response contains no request body, prompt, source metadata, or secrets', () => {
  const middleware = createProtectedDispatchDenyMiddleware({
    env: { SILLYTAVERN_REQUIRE_PROTECTED_EGRESS_GATEWAY: 'true' },
  });
  const response = responseRecorder();
  let nextCalls = 0;
  middleware({
    path: '/api/backends/chat-completions/generate',
    body: { prompt: 'must-not-leak', api_key: 'secret' },
  }, response, () => { nextCalls += 1; });
  assert.equal(nextCalls, 0);
  assert.equal(JSON.stringify(response.body).includes('must-not-leak'), false);
  assert.equal(JSON.stringify(response.body).includes('secret'), false);
});


test('exact existing vectorization endpoints remain outside this deny guard', () => {
  const middleware = createProtectedDispatchDenyMiddleware({
    env: { SILLYTAVERN_REQUIRE_PROTECTED_EGRESS_GATEWAY: 'true' },
  });
  for (const path of [
    '/api/backends/kobold/embed',
    '/api/openrouter/models/embedding',
    '/api/openai/chutes/models/embedding',
    '/api/openai/nanogpt/models/embedding',
    '/api/openai/electronhub/models',
    '/api/openai/siliconflow/models/embedding',
    '/api/openai/workers-ai/models/embedding',
  ]) {
    const result = invoke(middleware, path, 'POST');
    assert.equal(result.nextCalls, 1, path);
    assert.equal(result.response.statusCode, null, path);
  }
  for (const [path, method] of [
    ['/api/backends/kobold/embed', 'GET'],
    ['/api/backends/kobold/embed/other', 'POST'],
    ['/api/backends/kobold/generate', 'POST'],
    ['/api/openai/generate-voice', 'POST'],
    ['/api/openrouter/chat/completions', 'POST'],
  ]) {
    const result = invoke(middleware, path, method);
    assert.equal(result.nextCalls, 0, path);
    assert.equal(result.response.statusCode, 503, path);
  }
});
