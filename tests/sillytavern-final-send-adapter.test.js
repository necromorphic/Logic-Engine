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
  const response = await adapter.dispatch({
    request: { body: { chat_completion_source: 'makersuite', stream: false } },
    response: {},
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


test('Horde route is excluded from protected Gateway sender admission', () => {
  const adapter = createSillyTavernFinalSendAdapter({
    gateway: { dispatchProtectedRequest() { throw new Error('Horde must not dispatch protected Memory'); } },
    resolveProtectedMemory: () => protectedMemory,
    chatCompletionSources: sources,
    nativeForwardFetchResponse: async () => {},
  });
  const request = { body: { stream: false } };
  assert.equal(adapter.resolveSenderRoute(request, 'horde-text'), 'horde-text');
  assert.throws(() => adapter.dispatch({
    request, response: {}, senderRoute: 'horde-text', hostRoute: 'horde-text',
    endpointUrl: 'https://provider.example/generate',
    requestInit: { method: 'POST', body: '{"model":"test"}' },
    stream: false, transport: async () => ({ status: 200 }),
  }), /MEMORY_DISPATCH_NOT_READY/);
});

test('all registered non-Chat-Completions generation routes enter the shared Gateway', async () => {
  const routes = ['text-completions', 'kobold', 'novelai-text'];
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
  for (const route of routes) {
    const request = { body: { stream: false } };
    const result = await adapter.dispatch({
      request,
      response: {},
      senderRoute: adapter.resolveSenderRoute(request, route),
      hostRoute: route,
      endpointUrl: 'https://provider.example/generate',
      requestInit: { method: 'POST', body: '{"model":"test"}' },
      stream: false,
      transport: async () => ({ status: 200, route }),
    });
    assert.equal(result.status, 200);
    assert.equal(result.route, route);
  }
  assert.deepEqual(gatewayRoutes, routes);
});

test('protected route mismatch leaves a terminal response tombstone', () => {
  const response = {};
  let gatewayCalls = 0;
  let transportCalls = 0;
  let writes = 0;
  const adapter = createSillyTavernFinalSendAdapter({
    gateway: {
      dispatchProtectedRequest() { gatewayCalls += 1; },
      authorizeResponseWrite(_requestId, write) { return write(); },
    },
    resolveProtectedMemory: () => protectedMemory,
    chatCompletionSources: sources,
    nativeForwardFetchResponse: async () => {},
  });
  assert.throws(() => adapter.dispatch({
    request: { body: {} },
    response,
    senderRoute: 'text-completions',
    hostRoute: 'kobold',
    endpointUrl: 'https://provider.example/generate',
    requestInit: { method: 'POST', body: '{}' },
    stream: false,
    transport: async () => { transportCalls += 1; return { status: 200 }; },
  }), error => error.message === 'MEMORY_DISPATCH_NOT_READY'
    && error.logicEngineFinalSendTerminal === true);
  assert.throws(() => adapter.authorizeResponseWrite(response, () => { writes += 1; }, true),
    error => error.logicEngineFinalSendTerminal === true);
  assert.equal(gatewayCalls, 0);
  assert.equal(transportCalls, 0);
  assert.equal(writes, 0);
});

test('adapter denies unknown native sender before any transport handoff', async () => {
  let handoffs = 0;
  const adapter = createSillyTavernFinalSendAdapter({
    gateway: { dispatchProtectedRequest: () => { throw new Error('unexpected Gateway call'); } },
    resolveProtectedMemory: () => protectedMemory,
    chatCompletionSources: sources,
    nativeForwardFetchResponse: async () => {},
  });
  assert.throws(() => adapter.dispatch({
    request: { body: { chat_completion_source: 'not-registered' } },
    response: {},
    senderRoute: 'unknown',
    endpointUrl: 'https://provider.example/generate',
    requestInit: { method: 'POST', body: '{}' },
    stream: false,
    transport: async () => { handoffs += 1; },
  }), /MEMORY_DISPATCH_NOT_READY/);
  assert.equal(handoffs, 0);
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
  await adapter.dispatch({
    request: { body: { chat_completion_source: 'makersuite', stream: false } },
    response,
    senderRoute: 'google-ai-studio',
    endpointUrl: 'https://provider.example/v1/chat/completions',
    requestInit: { method: 'POST', body: '{"messages":[]}' },
    stream: false,
    transport: async () => ({ status: 200 }),
  });
  adapter.authorizeResponseWrite(response, () => writes.push('first'), true);
  assert.deepEqual(writes, ['first']);
  assert.deepEqual(leases, [{ requestId: protectedMemory.requestId, final: true }]);
  assert.equal(
    adapter.authorizeResponseWrite(response, () => writes.push('duplicate-end'), true),
    undefined,
    'a duplicate native Express end after the authorized final end must be idempotent',
  );
  assert.throws(
    () => adapter.authorizeResponseWrite(response, () => writes.push('bypass-write'), false),
    /MEMORY_DISPATCH_FINAL_RESPONSE_REVALIDATION_DENIED/,
  );
  assert.deepEqual(writes, ['first'], 'duplicate end and post-final writes must never invoke the native writer again');
});

test('revoke denial leaves a terminal response tombstone and blocks fallback Express writes', async () => {
  const response = {};
  let writes = 0;
  const adapter = createSillyTavernFinalSendAdapter({
    gateway: {
      dispatchProtectedRequest: async () => ({ status: 200 }),
      authorizeResponseWrite() {
        throw new Error('MEMORY_DISPATCH_FINAL_RESPONSE_REVALIDATION_DENIED');
      },
    },
    resolveProtectedMemory: () => protectedMemory,
    chatCompletionSources: sources,
    nativeForwardFetchResponse: async () => {},
  });
  await adapter.dispatch({
    request: { body: { chat_completion_source: 'makersuite', stream: false } },
    response,
    senderRoute: 'google-ai-studio',
    endpointUrl: 'https://provider.example/v1/chat/completions',
    requestInit: { method: 'POST', body: '{"messages":[]}' },
    stream: false,
    transport: async () => ({ status: 200 }),
  });
  assert.throws(
    () => adapter.authorizeResponseWrite(response, () => { writes += 1; }, true),
    (error) => error.message === 'MEMORY_DISPATCH_FINAL_RESPONSE_REVALIDATION_DENIED'
      && error.logicEngineFinalSendTerminal === true,
  );
  assert.throws(
    () => adapter.authorizeResponseWrite(response, () => { writes += 1; }, true),
    /MEMORY_DISPATCH_FINAL_RESPONSE_REVALIDATION_DENIED/,
  );
  assert.equal(writes, 0, 'neither the protected response nor an error fallback may be written');
});

test('asynchronous protected dispatch failure cannot clear the response protection tombstone', async () => {
  const response = {};
  let writes = 0;
  const adapter = createSillyTavernFinalSendAdapter({
    gateway: {
      dispatchProtectedRequest: async () => { throw new Error('dispatch denied'); },
      authorizeResponseWrite(_requestId, write) { return write(); },
    },
    resolveProtectedMemory: () => protectedMemory,
    chatCompletionSources: sources,
    nativeForwardFetchResponse: async () => {},
  });
  await assert.rejects(adapter.dispatch({
    request: { body: { chat_completion_source: 'makersuite', stream: false } },
    response,
    senderRoute: 'google-ai-studio',
    endpointUrl: 'https://provider.example/v1/chat/completions',
    requestInit: { method: 'POST', body: '{"messages":[]}' },
    stream: false,
    transport: async () => ({ status: 200 }),
  }), (error) => error.message === 'dispatch denied'
    && error.logicEngineFinalSendTerminal === true);
  assert.throws(
    () => adapter.authorizeResponseWrite(response, () => { writes += 1; }, true),
    /MEMORY_DISPATCH_FINAL_RESPONSE_REVALIDATION_DENIED/,
  );
  assert.equal(writes, 0);
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
  const dispatch = () => adapter.dispatch({
    request: { body: { chat_completion_source: 'makersuite', stream: false } },
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
    body: { chat_completion_source: 'makersuite', stream: false },
  };
  await adapter.prepare(request, response);
  await adapter.dispatch({
    request,
    response,
    senderRoute: 'google-ai-studio',
    endpointUrl: 'https://provider.example/v1/chat/completions',
    requestInit: { method: 'POST', body: '{"messages":[]}' },
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
  ]);
});
