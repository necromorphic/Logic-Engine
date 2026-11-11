import test from 'node:test';
import assert from 'node:assert/strict';
import { createSillyTavernFinalSendAdapter } from '../host-adapter/sillytavern-final-send-adapter.mjs';

const sources = {
  CLAUDE: 'claude', AI21: 'ai21', MAKERSUITE: 'makersuite', VERTEXAI: 'vertexai',
  MISTRALAI: 'mistralai', COHERE: 'cohere', COMETAPI: 'cometapi', DEEPSEEK: 'deepseek', AIMLAPI: 'aimlapi',
  XAI: 'xai', CHUTES: 'chutes', MINIMAX: 'minimax', ELECTRONHUB: 'electronhub',
  AZURE_OPENAI: 'azure_openai', OPENAI: 'openai', OPENROUTER: 'openrouter', CUSTOM: 'custom',
  PERPLEXITY: 'perplexity', GROQ: 'groq', FIREWORKS: 'fireworks', NANOGPT: 'nanogpt',
  POLLINATIONS: 'pollinations', MOONSHOT: 'moonshot', ZAI: 'zai', SILICONFLOW: 'siliconflow',
  WORKERS_AI: 'workers_ai',
};

const protectedMemory = {
  requestId: 'req-1',
  generationId: 'generation-req-1',
  runId: '77777777-7777-4777-8777-777777777777',
  contextDigest: 'a'.repeat(64),
  coreEnvelopeDigest: 'b'.repeat(64),
  model: 'gemini-test',
  worldId: 'world-1',
  actorId: 'actor-1',
  purpose: 'recall',
  sources: [{ source_kind: 'canonical_entity', source_entity_id: 'entity-1', source_version: 'v1' }],
  candidates: [{
    record_ref: 'record-1', record_version: 'record-v1', authorization_generation: 1,
    source_kind: 'canonical_entity', source_entity_id: 'entity-1', source_version: 'v1',
  }],
};

test('adapter maps every pinned Chat Completions sender key and leaves unknown senders unregistered', () => {
  const adapter = createSillyTavernFinalSendAdapter({
    gateway: { dispatchProtectedRequest: request => request.transport() },
    resolveProtectedMemory: () => null,
    chatCompletionSources: sources,
    nativeForwardFetchResponse: async () => {},
  });
  for (const [key, source] of Object.entries(sources)) {
    assert.notEqual(adapter.resolveSenderRoute({ body: { chat_completion_source: source } }), 'unregistered', key);
  }
  assert.equal(adapter.resolveSenderRoute({
    body: { chat_completion_source: 'not-registered' },
  }), 'unregistered');
});

test('adapter sends exact native transport through Core Gateway for protected context', async () => {
  let handoffs = 0;
  let captured;
  const adapter = createSillyTavernFinalSendAdapter({
    gateway: {
      dispatchProtectedRequest(request) {
        captured = request;
        return request.transport();
      },
    },
    resolveProtectedMemory: () => protectedMemory,
    chatCompletionSources: sources,
    nativeForwardFetchResponse: async () => {},
  });
  const body = JSON.stringify({ messages: [{ role: 'user', content: 'protected' }] });
  const request = {
    originalUrl: '/api/backends/chat-completions/generate',
    body: { chat_completion_source: 'makersuite', stream: false, messages: [{ role: 'user', content: 'original host prompt' }] },
  };
  const responseContext = {};
  await adapter.prepare(request, responseContext);
  const response = await adapter.dispatch({
    request,
    response: responseContext,
    senderRoute: 'google-ai-studio',
    endpointUrl: 'https://provider.example/v1/chat/completions',
    requestInit: { method: 'POST', body },
    stream: false,
    transport: async (_url, init) => {
      handoffs += 1;
      return { status: 200, body: init.body };
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body, body);
  assert.equal(handoffs, 1);
  assert.equal(captured.senderRoute, 'google-ai-studio');
  assert.equal(captured.body, body);
});


test('Horde text route is admitted through the protected Gateway sender registry', async () => {
  const adapter = createSillyTavernFinalSendAdapter({
    gateway: { dispatchProtectedRequest(request) { return request.transport(); } },
    resolveProtectedMemory: () => protectedMemory,
    chatCompletionSources: sources,
    nativeForwardFetchResponse: async () => {},
  });
  const request = {
    originalUrl: '/api/horde/generate-text',
    body: { stream: false, messages: [{ role: 'user', content: 'original host prompt' }], prompt: 'original host prompt', input: 'original host prompt', params: { prompt: 'original host prompt' } },
  };
  const responseContext = {};
  await adapter.prepare(request, responseContext);
  assert.equal(adapter.resolveSenderRoute(request, 'horde-text'), 'horde-text');
  const result = await adapter.dispatch({
    request, response: responseContext, senderRoute: 'horde-text', hostRoute: 'horde-text',
    endpointUrl: 'https://provider.example/generate',
    requestInit: { method: 'POST', body: JSON.stringify(request.body) },
    stream: false, transport: async () => ({ status: 200 }),
  });
  assert.equal(result.status, 200);
});

test('all registered non-Chat-Completions generation routes enter the shared Gateway', async () => {
  const routes = ['text-completions', 'kobold', 'novelai-text', 'horde-text'];
  const gatewayRoutes = [];
  const adapter = createSillyTavernFinalSendAdapter({
    gateway: {
      dispatchProtectedRequest(request) {
        gatewayRoutes.push(request.senderRoute);
        return request.transport();
      },
    },
    resolveProtectedMemory: () => protectedMemory,
    chatCompletionSources: sources,
    nativeForwardFetchResponse: async () => {},
  });
  const pathByRoute = {
    'text-completions': '/api/backends/text-completions/generate',
    kobold: '/api/backends/kobold/generate',
    'novelai-text': '/api/novelai/generate',
    'horde-text': '/api/horde/generate-text',
  };
  for (const route of routes) {
    const request = {
      originalUrl: pathByRoute[route],
      body: { stream: false, messages: [{ role: 'user', content: 'original host prompt' }], prompt: 'original host prompt', input: 'original host prompt', params: { prompt: 'original host prompt' } },
    };
    const responseContext = {};
    await adapter.prepare(request, responseContext);
    const result = await adapter.dispatch({
      request,
      response: responseContext,
      senderRoute: adapter.resolveSenderRoute(request, route),
      hostRoute: route,
      endpointUrl: 'https://provider.example/generate',
      requestInit: { method: 'POST', body: JSON.stringify(request.body) },
      stream: false,
      transport: async () => ({ status: 200, route }),
    });
    assert.equal(result.status, 200);
    assert.equal(result.route, route);
  }
  assert.deepEqual(gatewayRoutes, routes);
});

test('protected route mismatch falls back to native provider transport', async () => {
  const response = {};
  let gatewayCalls = 0;
  let transportCalls = 0;
  const adapter = createSillyTavernFinalSendAdapter({
    gateway: { dispatchProtectedRequest() { gatewayCalls += 1; } },
    resolveProtectedMemory: () => protectedMemory,
    chatCompletionSources: sources,
    nativeForwardFetchResponse: async () => {},
  });
  const request = {
    originalUrl: '/api/backends/kobold/generate',
    body: { prompt: 'original host prompt' },
  };
  await adapter.prepare(request, response);
  const result = await adapter.dispatch({
    request, response,
    senderRoute: 'text-completions', hostRoute: 'kobold',
    endpointUrl: 'https://provider.example/generate',
    requestInit: { method: 'POST', body: JSON.stringify(request.body) }, stream: false,
    transport: async () => { transportCalls += 1; return { status: 200 }; },
  });
  assert.equal(result.status, 200);
  assert.equal(gatewayCalls, 0);
  assert.equal(transportCalls, 1);
  let writes = 0;
  adapter.authorizeResponseWrite(response, () => { writes += 1; }, true);
  assert.equal(writes, 1, 'route mismatch must release an ordinary native ST response');
});

test('unknown native sender bypasses Memory Gateway and keeps native provider output', async () => {
  let handoffs = 0;
  let gatewayCalls = 0;
  const adapter = createSillyTavernFinalSendAdapter({
    gateway: { dispatchProtectedRequest: () => { gatewayCalls += 1; } },
    resolveProtectedMemory: () => protectedMemory,
    chatCompletionSources: sources,
    nativeForwardFetchResponse: async () => {},
  });
  const result = await adapter.dispatch({
    request: { body: { chat_completion_source: 'not-registered' } },
    response: {},
    senderRoute: 'unknown',
    endpointUrl: 'https://provider.example/generate',
    requestInit: { method: 'POST', body: '{}' },
    stream: false,
    transport: async () => { handoffs += 1; return { status: 200 }; },
  });
  assert.equal(result.status, 200);
  assert.equal(handoffs, 1);
  assert.equal(gatewayCalls, 0);
});


test('protected response stays terminal after final write and cannot be written again', async () => {
  const response = {};
  const writes = [];
  const leases = [];
  const adapter = createSillyTavernFinalSendAdapter({
    gateway: {
      dispatchProtectedRequest: async () => ({ status: 200 }),
      authorizeResponseWrite(requestId, write, options) {
        leases.push({ requestId, final: options.final });
        return write();
      },
    },
    resolveProtectedMemory: () => protectedMemory,
    chatCompletionSources: sources,
    nativeForwardFetchResponse: async () => {},
  });
  const request = {
    originalUrl: '/api/backends/chat-completions/generate',
    body: { chat_completion_source: 'makersuite', stream: false, messages: [{ role: 'user', content: 'original host prompt' }] },
  };
  await adapter.prepare(request, response);
  await adapter.dispatch({
    request,
    response,
    senderRoute: 'google-ai-studio',
    endpointUrl: 'https://provider.example/v1/chat/completions',
    requestInit: { method: 'POST', body: JSON.stringify(request.body) },
    stream: false,
    transport: async () => ({ status: 200 }),
  });
  adapter.authorizeResponseWrite(response, () => writes.push('first'), true);
  assert.deepEqual(writes, ['first']);
  assert.deepEqual(leases, [{ requestId: 'req-1', final: true }],
    'Memory-enriched responses must pass through the Gateway release lease');
  assert.equal(
    adapter.authorizeResponseWrite(response, () => writes.push('duplicate-end'), true),
    undefined,
    'a duplicate native Express end after the authorized final end must be idempotent',
  );
  assert.equal(
    adapter.authorizeResponseWrite(response, () => writes.push('post-final-write'), false),
    undefined,
  );
  assert.deepEqual(writes, ['first'], 'duplicate end and post-final writes must never invoke the native writer again');
});

test('Gateway response revalidation failure blocks only the Memory-enriched response', async () => {
  const response = {};
  let writes = 0;
  const adapter = createSillyTavernFinalSendAdapter({
    gateway: {
      dispatchProtectedRequest: async () => ({ status: 200 }),
      authorizeResponseWrite() { throw new Error('MEMORY_DISPATCH_FINAL_RESPONSE_REVALIDATION_DENIED'); },
    },
    resolveProtectedMemory: () => protectedMemory,
    chatCompletionSources: sources,
    nativeForwardFetchResponse: async () => {},
  });
  await adapter.dispatch({
    request: { body: { chat_completion_source: 'makersuite', stream: false, messages: [{ role: 'user', content: 'original host prompt' }] } },
    response, senderRoute: 'google-ai-studio',
    endpointUrl: 'https://provider.example/v1/chat/completions',
    requestInit: { method: 'POST', body: JSON.stringify(request.body) },
    stream: false, transport: async () => ({ status: 200 }),
  });
  assert.throws(
    () => adapter.authorizeResponseWrite(response, () => { writes += 1; }, true),
    /MEMORY_DISPATCH_FINAL_RESPONSE_REVALIDATION_DENIED/,
  );
  assert.equal(writes, 0, 'revoked Memory must not be released to the client');
});

test('Gateway failure before provider handoff falls back to native transport exactly once', async () => {
  const response = {};
  let nativeCalls = 0;
  const adapter = createSillyTavernFinalSendAdapter({
    gateway: { dispatchProtectedRequest: async () => { throw new Error('Gateway unavailable'); } },
    resolveProtectedMemory: () => protectedMemory,
    chatCompletionSources: sources,
    nativeForwardFetchResponse: async () => {},
  });
  const result = await adapter.dispatch({
    request: {
      originalUrl: '/api/backends/chat-completions/generate',
      body: { chat_completion_source: 'makersuite', stream: false, messages: [{ role: 'user', content: 'prompt' }] },
    },
    response, senderRoute: 'google-ai-studio',
    endpointUrl: 'https://provider.example/v1/chat/completions',
    requestInit: { method: 'POST', body: JSON.stringify(request.body) }, stream: false,
    transport: async () => { nativeCalls += 1; return { status: 200 }; },
  });
  assert.equal(result.status, 200);
  assert.equal(nativeCalls, 1);
});

test('Gateway failure after provider handoff is never retried', async () => {
  const response = {};
  let nativeCalls = 0;
  const adapter = createSillyTavernFinalSendAdapter({
    gateway: {
      dispatchProtectedRequest: async request => {
        await request.transport();
        throw new Error('response forwarding failed after egress');
      },
    },
    resolveProtectedMemory: () => protectedMemory,
    chatCompletionSources: sources,
    nativeForwardFetchResponse: async () => {},
  });
  await assert.rejects(adapter.dispatch({
    request: { body: { chat_completion_source: 'makersuite', stream: false, messages: [{ role: 'user', content: 'prompt' }] } },
    response, senderRoute: 'google-ai-studio',
    endpointUrl: 'https://provider.example/v1/chat/completions',
    requestInit: { method: 'POST', body: JSON.stringify(request.body) }, stream: false,
    transport: async () => { nativeCalls += 1; return { status: 200 }; },
  }), /response forwarding failed after egress/);
  assert.equal(nativeCalls, 1);
});

test('one protected Host response cannot dispatch the model twice after a completed first handoff', async () => {
  const response = {};
  let upstreamCalls = 0;
  let gatewayCalls = 0;
  const adapter = createSillyTavernFinalSendAdapter({
    gateway: {
      async dispatchProtectedRequest(request) {
        gatewayCalls += 1;
        return request.transport();
      },
      authorizeResponseWrite(_requestId, write) {
        return write();
      },
    },
    resolveProtectedMemory: () => protectedMemory,
    chatCompletionSources: sources,
    nativeForwardFetchResponse: async () => {},
  });
  const request = {
    originalUrl: '/api/backends/chat-completions/generate',
    body: { chat_completion_source: 'makersuite', stream: false, messages: [{ role: 'user', content: 'original host prompt' }] },
  };
  await adapter.prepare(request, response);
  const dispatch = () => adapter.dispatch({
    request,
    response,
    senderRoute: 'google-ai-studio',
    endpointUrl: 'https://provider.example/v1/chat/completions',
    requestInit: { method: 'POST', body: '{"messages":[{"role":"user","content":"once"}]}' },
    stream: false,
    transport: async () => {
      upstreamCalls += 1;
      return { status: 200 };
    },
  });

  const first = await dispatch();
  assert.equal(first.status, 200);
  assert.throws(() => dispatch(), /MEMORY_DISPATCH_DUPLICATE_HOST_SEND/);
  assert.equal(gatewayCalls, 1);
  assert.equal(upstreamCalls, 1);
});

test('authenticated Host session remains active across async provider handoff and response release', async () => {
  const { AsyncLocalStorage } = await import('node:async_hooks');
  const session = new AsyncLocalStorage();
  const response = {};
  const observed = [];
  let adapter;
  adapter = createSillyTavernFinalSendAdapter({
    gateway: {
      async dispatchProtectedRequest(request) {
        return request.transport();
      },
      authorizeResponseWrite(_requestId, write) {
        observed.push({ phase: 'release', conversationId: session.getStore() });
        return write();
      },
    },
    resolveProtectedMemory: () => protectedMemory,
    chatCompletionSources: sources,
    nativeForwardFetchResponse: async () => {},
    prepareHostContext: async () => ({ coreConversationId: 'core-conversation-1' }),
    runWithAuthenticatedHostSession(_request, conversationId, execute) {
      return session.run(conversationId, execute);
    },
  });

  const request = {
    user: { profile: { handle: 'test-user' } },
    session: { handle: 'test-user' },
    originalUrl: '/api/backends/chat-completions/generate',
    body: { chat_completion_source: 'makersuite', stream: false, messages: [{ role: 'user', content: 'original host prompt' }] },
  };
  await adapter.prepare(request, response);
  await adapter.dispatch({
    request,
    response,
    senderRoute: 'google-ai-studio',
    endpointUrl: 'https://provider.example/v1/chat/completions',
    requestInit: { method: 'POST', body: JSON.stringify(request.body) },
    stream: false,
    transport: async () => new Promise(resolve => {
      setImmediate(() => {
        observed.push({ phase: 'provider', conversationId: session.getStore() });
        adapter.authorizeResponseWrite(response, () => ({ status: 200 }), true);
        resolve({ status: 200 });
      });
    }),
  });

  assert.deepEqual(observed, [
    { phase: 'provider', conversationId: 'core-conversation-1' },
    { phase: 'release', conversationId: 'core-conversation-1' },
  ], 'Memory-enriched response release must remain inside the authenticated Host session');
});

test('authenticated Host session remains active across async provider handoff and response release', async () => {
  const { AsyncLocalStorage } = await import('node:async_hooks');
  const session = new AsyncLocalStorage();
  const response = {};
  const observed = [];
  let adapter;
  adapter = createSillyTavernFinalSendAdapter({
    gateway: {
      async dispatchProtectedRequest(request) {
        return request.transport();
      },
      authorizeResponseWrite(_requestId, write) {
        observed.push({ phase: 'release', conversationId: session.getStore() });
        return write();
      },
    },
    resolveProtectedMemory: () => protectedMemory,
    chatCompletionSources: sources,
    nativeForwardFetchResponse: async () => {},
    prepareHostContext: async () => ({ coreConversationId: 'core-conversation-1' }),
    runWithAuthenticatedHostSession(_request, conversationId, execute) {
      return session.run(conversationId, execute);
    },
  });

  const request = {
    user: { profile: { handle: 'test-user' } },
    session: { handle: 'test-user' },
    originalUrl: '/api/backends/chat-completions/generate',
    body: { chat_completion_source: 'makersuite', stream: false, messages: [{ role: 'user', content: 'original host prompt' }] },
  };
  await adapter.prepare(request, response);
  await adapter.dispatch({
    request,
    response,
    senderRoute: 'google-ai-studio',
    endpointUrl: 'https://provider.example/v1/chat/completions',
    requestInit: { method: 'POST', body: JSON.stringify(request.body) },
    stream: false,
    transport: async () => new Promise(resolve => {
      setImmediate(() => {
        observed.push({ phase: 'provider', conversationId: session.getStore() });
        adapter.authorizeResponseWrite(response, () => ({ status: 200 }), true);
        resolve({ status: 200 });
      });
    }),
  });

  assert.deepEqual(observed, [
    { phase: 'provider', conversationId: 'core-conversation-1' },
    { phase: 'release', conversationId: 'core-conversation-1' },
  ], 'Memory-enriched response release must remain inside the authenticated Host session');
});
