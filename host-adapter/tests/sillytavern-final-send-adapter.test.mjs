import test from 'node:test';
import assert from 'node:assert/strict';
import { createSillyTavernFinalSendAdapter } from '../sillytavern-final-send-adapter.mjs';

const sourceKeys = [
  'CLAUDE', 'AI21', 'MAKERSUITE', 'VERTEXAI', 'MISTRALAI', 'COHERE',
  'DEEPSEEK', 'AIMLAPI', 'XAI', 'CHUTES', 'MINIMAX', 'ELECTRONHUB',
  'AZURE_OPENAI', 'OPENAI', 'OPENROUTER', 'CUSTOM', 'PERPLEXITY', 'GROQ',
  'FIREWORKS', 'NANOGPT', 'POLLINATIONS', 'MOONSHOT', 'ZAI', 'SILICONFLOW',
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
    const request = { body: {} };
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
  const request = { body: { chat_completion_source: 'OPENAI', stream: false } };
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
