import test from 'node:test';
import assert from 'node:assert/strict';
import { createSillyTavernFinalSendAdapter } from '../sillytavern-final-send-adapter.mjs';
import { createHash } from 'node:crypto';

const sourceKeys = [
  'CLAUDE', 'AI21', 'MAKERSUITE', 'VERTEXAI', 'MISTRALAI', 'COHERE',
  'DEEPSEEK', 'AIMLAPI', 'XAI', 'CHUTES', 'MINIMAX', 'ELECTRONHUB',
  'AZURE_OPENAI', 'OPENAI', 'OPENROUTER', 'CUSTOM', 'PERPLEXITY', 'GROQ',
  'FIREWORKS', 'NANOGPT', 'POLLINATIONS', 'MOONSHOT', 'ZAI', 'SILICONFLOW', 'COMETAPI',
  'WORKERS_AI',
];
const sources = Object.fromEntries(sourceKeys.map((key) => [key, key]));
const requestInit = { method: 'POST', body: '{"model":"test-model"}', headers: {} };

function createAdapter({
  resolveProtectedMemory,
  gateway = { dispatchProtectedRequest: () => 'gateway' },
  prepareHostContext,
}) {
  return createSillyTavernFinalSendAdapter({
    gateway,
    resolveProtectedMemory,
    prepareHostContext,
    chatCompletionSources: sources,
    nativeForwardFetchResponse: async () => undefined,
  });
}

test('adapter maps all pinned non-Chat-Completions route families', () => {
  const adapter = createAdapter({ resolveProtectedMemory: () => null });
  assert.equal(adapter.resolveSenderRoute({ body: { chat_completion_source: 'OPENAI' } }), 'openai');
  assert.equal(adapter.resolveSenderRoute({ body: { chat_completion_source: 'COMETAPI' } }), 'cometapi');
  assert.equal(adapter.resolveSenderRoute({}, 'text-completions'), 'text-completions');
  assert.equal(adapter.resolveSenderRoute({}, 'kobold'), 'kobold');
  assert.equal(adapter.resolveSenderRoute({}, 'novelai-text'), 'novelai-text');
  assert.equal(adapter.resolveSenderRoute({}, 'horde-text'), 'horde-text');
});

test('unregistered SillyTavern sender remains native for explicitly unprotected generation', async () => {
  let transportCalls = 0;
  const adapter = createAdapter({ resolveProtectedMemory: () => null });
  const request = { body: { chat_completion_source: 'UNKNOWN_SOURCE', stream: false } };
  const senderRoute = adapter.resolveSenderRoute(request);

  assert.equal(senderRoute, 'unregistered');
  const result = await adapter.dispatch({
    request,
    senderRoute,
    endpointUrl: 'https://provider.example/v1/chat/completions',
    requestInit,
    stream: false,
    transport: async () => { transportCalls += 1; return { status: 200 }; },
  });

  assert.equal(result.status, 200);
  assert.equal(transportCalls, 1);
});

test('unregistered SillyTavern sender is denied for protected Memory generation', () => {
  const protectedContext = {
    requestId: 'request-1',
    generationId: 'generation-request-1',
    model: 'test-model',
    worldId: 'world-1',
    actorId: 'actor-1',
    purpose: 'npc_decision',
    sources: [{ source_kind: 'canonical_entity', source_entity_id: 'entity-1', source_version: 'v1' }],
    candidates: [{ record_ref: 'record-1', record_version: 'v1', authorization_generation: 1,
      source_kind: 'canonical_entity', source_entity_id: 'entity-1', source_version: 'v1' }],
  };
  const adapter = createAdapter({ resolveProtectedMemory: () => protectedContext });
  const request = { body: { chat_completion_source: 'COMETAPI', stream: false } };

  assert.throws(() => adapter.dispatch({
    request,
    senderRoute: adapter.resolveSenderRoute(request),
    endpointUrl: 'https://provider.example/v1/chat/completions',
    requestInit,
    stream: false,
    transport: async () => ({ status: 200 }),
  }), /MEMORY_DISPATCH_NOT_READY/);
});

test('unknown native route remains unregistered and cannot enter protected dispatch', () => {
  const adapter = createAdapter({ resolveProtectedMemory: () => ({
    requestId: 'request-non-chat',
    generationId: 'generation-request-non-chat',
    model: 'test-model',
    worldId: 'world-1',
    actorId: 'actor-1',
    purpose: 'npc_decision',
    sources: [{ source_kind: 'canonical_entity', source_entity_id: 'entity-1', source_version: 'v1' }],
    candidates: [{ record_ref: 'record-1', record_version: 'v1', authorization_generation: 1,
      source_kind: 'canonical_entity', source_entity_id: 'entity-1', source_version: 'v1' }],
  }) });
  assert.throws(() => adapter.dispatch({
    request: { body: {} },
    senderRoute: adapter.resolveSenderRoute({}, 'unknown-route'),
    hostRoute: 'unknown-route',
    endpointUrl: 'https://provider.example/v1/chat/completions',
    requestInit,
    stream: false,
    transport: async () => ({ status: 200 }),
  }), /MEMORY_DISPATCH_NOT_READY/);
});

test('all four protected non-Chat-Completions routes dispatch through Core Gateway', async () => {
  const routes = ['text-completions', 'kobold', 'novelai-text', 'horde-text'];
  const calls = [];
  const adapter = createAdapter({
    resolveProtectedMemory: () => ({
      requestId: 'request-routes',
    generationId: 'generation-request-routes',
      model: 'test-model',
      worldId: 'world-1',
      actorId: 'actor-1',
      purpose: 'npc_decision',
      sources: [{ source_kind: 'canonical_entity', source_entity_id: 'entity-1', source_version: 'v1' }],
      candidates: [{ record_ref: 'record-1', record_version: 'v1', authorization_generation: 1,
        source_kind: 'canonical_entity', source_entity_id: 'entity-1', source_version: 'v1' }],
    }),
    gateway: {
      dispatchProtectedRequest(request) {
        calls.push(request.senderRoute);
        return request.transport();
      },
    },
  });
  for (const hostRoute of routes) {
    const body = hostRoute === 'novelai-text' ? { input: 'original prompt' }
      : hostRoute === 'horde-text' ? { params: { prompt: 'original prompt' } }
        : { prompt: 'original prompt' };
    const request = { body };
    const result = await adapter.dispatch({
      request,
      response: {},
      senderRoute: adapter.resolveSenderRoute(request, hostRoute),
      hostRoute,
      endpointUrl: 'https://provider.example/generate',
      requestInit,
      stream: false,
      transport: async () => ({ status: 200 }),
    });
    assert.equal(result.status, 200);
  }
  assert.deepEqual(calls, routes);
});

test('registered protected sender is delegated to the Core Gateway', () => {
  const protectedContext = {
    requestId: 'request-2',
    generationId: 'generation-request-2',
    model: 'test-model',
    worldId: 'world-1',
    actorId: 'actor-1',
    purpose: 'npc_decision',
    sources: [{ source_kind: 'canonical_entity', source_entity_id: 'entity-1', source_version: 'v1' }],
    candidates: [{ record_ref: 'record-1', record_version: 'v1', authorization_generation: 1,
      source_kind: 'canonical_entity', source_entity_id: 'entity-1', source_version: 'v1' }],
  };
  let gatewayCalls = 0;
  const gateway = {
    dispatchProtectedRequest(request) {
      gatewayCalls += 1;
      assert.equal(request.senderRoute, 'openai');
      assert.equal(request.route, 'host-selected-chat-generation');
      return 'gateway-result';
    },
    authorizeResponseWrite(requestId, write, options) {
      assert.equal(requestId, 'request-2');
      assert.equal(options.final, true);
      return write();
    },
  };
  const adapter = createAdapter({ resolveProtectedMemory: () => protectedContext, gateway });
  const request = { body: { chat_completion_source: 'OPENAI', stream: false,
    messages: [{ role: 'user', content: 'original prompt' }] } };
  const response = {};

  assert.equal(adapter.dispatch({
    request,
    response,
    senderRoute: adapter.resolveSenderRoute(request),
    endpointUrl: 'https://provider.example/v1/chat/completions',
    requestInit,
    stream: false,
    transport: async () => ({ status: 200 }),
  }), 'gateway-result');
  assert.equal(gatewayCalls, 1);
  let hostWrites = 0;
  adapter.authorizeResponseWrite(response, () => { hostWrites += 1; }, true);
  assert.equal(hostWrites, 1);
});


test('prepare requires an authenticated SillyTavern session before generation', async () => {
  const adapter = createAdapter({ resolveProtectedMemory: () => null });
  await assert.rejects(
    adapter.prepare({ body: {} }, {}),
    /LOGIC_ENGINE_HOST_SESSION_NOT_AUTHENTICATED/,
  );
});

test('prepare rejects browser-supplied protected Memory markers', async () => {
  const adapter = createAdapter({ resolveProtectedMemory: () => null });
  const request = {
    user: { profile: { handle: 'test-user' } },
    session: { handle: 'test-user' },
    body: { logic_engine_protected_context: { worldId: 'spoofed' } },
  };
  await assert.rejects(adapter.prepare(request, {}), /LOGIC_ENGINE_UNTRUSTED_MEMORY_MARKER/);
});

test('pinned generation route cannot dispatch before Host preparation', () => {
  let resolverCalls = 0;
  let transportCalls = 0;
  const adapter = createAdapter({
    resolveProtectedMemory: () => { resolverCalls += 1; return null; },
  });
  const request = {
    originalUrl: '/api/backends/chat-completions/generate',
    body: { chat_completion_source: 'OPENAI', stream: false },
  };

  assert.throws(() => adapter.dispatch({
    request,
    response: {},
    senderRoute: 'openai',
    endpointUrl: 'https://provider.example/v1/chat/completions',
    requestInit,
    stream: false,
    transport: async () => { transportCalls += 1; return { status: 200 }; },
  }), /LOGIC_ENGINE_HOST_PREPARATION_REQUIRED/);
  assert.equal(resolverCalls, 0);
  assert.equal(transportCalls, 0);
});

test('dispatch rejects a Host route changed after preparation', async () => {
  let resolverCalls = 0;
  let transportCalls = 0;
  const adapter = createAdapter({
    resolveProtectedMemory: () => { resolverCalls += 1; return null; },
  });
  const request = {
    originalUrl: '/api/backends/chat-completions/generate',
    user: { profile: { handle: 'test-user' } },
    session: { handle: 'test-user' },
    body: { chat_completion_source: 'OPENAI', stream: false },
  };
  const response = {};
  await adapter.prepare(request, response);

  assert.throws(() => adapter.dispatch({
    request,
    response,
    senderRoute: 'text-completions',
    hostRoute: 'text-completions',
    endpointUrl: 'https://provider.example/generate',
    requestInit,
    stream: false,
    transport: async () => { transportCalls += 1; return { status: 200 }; },
  }), /LOGIC_ENGINE_HOST_ROUTE_CONTEXT_MISMATCH/);
  assert.equal(resolverCalls, 0);
  assert.equal(transportCalls, 0);
});

test('dispatch cannot change the default route when preparation has no pinned path', async () => {
  let resolverCalls = 0;
  const adapter = createAdapter({
    resolveProtectedMemory: () => { resolverCalls += 1; return null; },
  });
  const request = {
    user: { profile: { handle: 'test-user' } },
    session: { handle: 'test-user' },
    body: { chat_completion_source: 'OPENAI', stream: false },
  };
  const response = {};
  await adapter.prepare(request, response);

  assert.throws(() => adapter.dispatch({
    request,
    response,
    senderRoute: 'text-completions',
    hostRoute: 'text-completions',
    endpointUrl: 'https://provider.example/generate',
    requestInit,
    stream: false,
    transport: async () => ({ status: 200 }),
  }), /LOGIC_ENGINE_HOST_ROUTE_CONTEXT_MISMATCH/);
  assert.equal(resolverCalls, 0);
});

test('dispatch rejects a response object different from the one bound during Host preparation', async () => {
  let resolverCalls = 0;
  const adapter = createAdapter({
    resolveProtectedMemory: () => { resolverCalls += 1; return null; },
  });
  const request = {
    originalUrl: '/api/backends/chat-completions/generate',
    user: { profile: { handle: 'test-user' } },
    session: { handle: 'test-user' },
    body: { chat_completion_source: 'OPENAI' },
  };
  const preparedResponse = {};
  await adapter.prepare(request, preparedResponse);

  assert.throws(() => adapter.dispatch({
    request,
    response: {},
    senderRoute: 'openai',
    endpointUrl: 'https://provider.example/v1/chat/completions',
    requestInit,
    stream: false,
    transport: async () => ({ status: 200 }),
  }), /LOGIC_ENGINE_FINAL_SEND_RESPONSE_CONTEXT_MISMATCH/);
  assert.equal(resolverCalls, 0);
});

test('trusted asynchronous Host preparation is passed to the synchronous Memory resolver', async () => {
  const trustedHostContext = Object.freeze({
    installationId: 'installation-1',
    accountId: 'account-1',
    conversationId: 'conversation-1',
  });
  let resolvedContext;
  const adapter = createAdapter({
    prepareHostContext: async request => {
      assert.equal(request.user.profile.handle, 'test-user');
      return trustedHostContext;
    },
    resolveProtectedMemory: preparedContext => {
      resolvedContext = preparedContext;
      return null;
    },
  });
  const request = {
    originalUrl: '/api/backends/chat-completions/generate',
    user: { profile: { handle: 'test-user' } },
    session: { handle: 'test-user' },
    body: { chat_completion_source: 'OPENAI' },
  };
  await adapter.prepare(request, {});
  const result = await adapter.dispatch({
    request,
    senderRoute: 'openai',
    endpointUrl: 'https://provider.example/v1/chat/completions',
    requestInit,
    stream: false,
    transport: async () => ({ status: 200 }),
  });
  assert.equal(result.status, 200);
  assert.equal(resolvedContext.hostContext, trustedHostContext);
  assert.equal(resolvedContext.request, request);
  assert.equal(resolvedContext.hostRoute, 'chat-completions');
});


test('Host preparation is one-shot for the exact request object', async () => {
  let preparations = 0;
  let resolverCalls = 0;
  const adapter = createAdapter({
    resolveProtectedMemory: () => { resolverCalls += 1; return null; },
    prepareHostContext: async () => { preparations += 1; return { status: 'READY', context: {} }; },
  });
  const request = {
    originalUrl: '/api/backends/chat-completions/generate',
    user: { profile: { handle: 'test-user' } },
    session: { handle: 'test-user' },
    body: { chat_completion_source: 'OPENAI', stream: false },
  };
  await adapter.prepare(request, {});
  await assert.rejects(adapter.prepare(request, {}), /LOGIC_ENGINE_HOST_PREPARATION_DUPLICATE/);
  assert.equal(preparations, 1);
  assert.equal(resolverCalls, 0);
});


test('concurrent Host preparation calls cannot race the one-shot reservation', async () => {
  let release;
  let preparations = 0;
  const wait = new Promise(resolve => { release = resolve; });
  const adapter = createAdapter({
    resolveProtectedMemory: () => null,
    prepareHostContext: async () => {
      preparations += 1;
      await wait;
      return { status: 'READY', context: {} };
    },
  });
  const request = {
    originalUrl: '/api/backends/chat-completions/generate',
    user: { profile: { handle: 'test-user' } },
    session: { handle: 'test-user' },
    body: { chat_completion_source: 'OPENAI', stream: false },
  };
  const first = adapter.prepare(request, {});
  await assert.rejects(adapter.prepare(request, {}), /LOGIC_ENGINE_HOST_PREPARATION_DUPLICATE/);
  release();
  await first;
  assert.equal(preparations, 1);
});


test('failed Host preparation remains terminal and cannot be retried on the same request', async () => {
  let preparations = 0;
  const adapter = createAdapter({
    resolveProtectedMemory: () => null,
    prepareHostContext: async () => {
      preparations += 1;
      throw new Error('inventory unavailable');
    },
  });
  const request = {
    originalUrl: '/api/backends/chat-completions/generate',
    user: { profile: { handle: 'test-user' } },
    session: { handle: 'test-user' },
    body: { chat_completion_source: 'OPENAI', stream: false },
  };
  await assert.rejects(adapter.prepare(request, {}), /inventory unavailable/);
  await assert.rejects(adapter.prepare(request, {}), /LOGIC_ENGINE_HOST_PREPARATION_DUPLICATE/);
  assert.equal(preparations, 1);
});

test('Host preparation receives the request AbortSignal and rejects cancellation after its await', async () => {
  let receivedSignal;
  let finishPreparation;
  const adapter = createAdapter({
    resolveProtectedMemory: () => null,
    prepareHostContext: (_request, _response, _route, signal) => {
      receivedSignal = signal;
      return new Promise(resolve => { finishPreparation = resolve; });
    },
  });
  const request = {
    user: { profile: { handle: 'default-user' } },
    session: { handle: 'default-user', logicEngineSessionId: '33333333-3333-4333-8333-333333333333' },
    originalUrl: '/api/backends/chat-completions/generate',
    body: {
      logic_engine_conversation_uuid: '44444444-4444-4444-8444-444444444444',
      logic_engine_request_id: '55555555-5555-4555-8555-555555555555',
      logic_engine_generation_id: '66666666-6666-4666-8666-666666666666',
      logic_engine_context_size: 8192,
      logic_engine_generation_type: 'normal',
    },
  };
  const controller = new AbortController();
  const pending = adapter.prepare(request, {}, controller.signal);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(receivedSignal, controller.signal);
  controller.abort(new Error('client disconnected'));
  finishPreparation({ status: 'READY', context: {} });
  await assert.rejects(pending, /LOGIC_ENGINE_HOST_GENERATION_CANCELLED/);
});

test('Host preparation snapshots replay identity before native sender mutation', async () => {
  const protectedContext = {
    requestId: 'request-ingress-snapshot',
    generationId: 'generation-ingress-snapshot',
    model: 'test-model',
    worldId: 'world-1',
    actorId: 'actor-1',
    purpose: 'npc_decision',
    sources: [{ source_kind: 'canonical_entity', source_entity_id: 'entity-1', source_version: 'v1' }],
    candidates: [{ record_ref: 'record-1', record_version: 'v1', authorization_generation: 1,
      source_kind: 'canonical_entity', source_entity_id: 'entity-1', source_version: 'v1' }],
  };
  let dispatchRequest;
  const adapter = createAdapter({
    resolveProtectedMemory: () => protectedContext,
    gateway: {
      dispatchProtectedRequest(request) {
        dispatchRequest = request;
        return request.transport();
      },
    },
  });
  const request = {
    originalUrl: '/api/backends/chat-completions/generate',
    user: { profile: { handle: 'test-user' } },
    session: { handle: 'test-user' },
    body: {
      chat_completion_source: 'OPENAI',
      model: 'model-before',
      messages: [{ role: 'user', content: 'original prompt' }],
    },
  };
  await adapter.prepare(request, {});
  const expected = createHash('sha256')
    .update(JSON.stringify(request.body.messages), 'utf8').digest('hex');
  request.body.messages = [{ role: 'user', content: 'mutated after Host ingress' }];
  await adapter.dispatch({
    request,
    response: [...[]],
    senderRoute: 'openai',
    hostRoute: 'chat-completions',
    endpointUrl: 'https://provider.example/v1/chat/completions',
    requestInit: { ...requestInit, body: JSON.stringify({ model: 'model-after', messages: request.body.messages }) },
    stream: false,
    transport: async () => ({ status: 200 }),
  });
  assert.equal(dispatchRequest.replayIdentity, expected);
});
