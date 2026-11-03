import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSillyTavernFinalSendAdapter } from '../sillytavern-final-send-adapter.mjs';

const sourceKeys = [
  'CLAUDE', 'AI21', 'MAKERSUITE', 'VERTEXAI', 'MISTRALAI', 'COHERE',
  'COMETAPI', 'DEEPSEEK', 'AIMLAPI', 'XAI', 'CHUTES', 'MINIMAX', 'ELECTRONHUB',
  'AZURE_OPENAI', 'OPENAI', 'OPENROUTER', 'CUSTOM', 'PERPLEXITY', 'GROQ',
  'FIREWORKS', 'NANOGPT', 'POLLINATIONS', 'MOONSHOT', 'ZAI', 'SILICONFLOW',
  'WORKERS_AI',
];
const sources = Object.fromEntries(sourceKeys.map((key) => [key, key]));
const expectedRoutes = Object.freeze({
  CLAUDE: 'claude',
  AI21: 'ai21',
  MAKERSUITE: 'google-ai-studio',
  VERTEXAI: 'vertex-ai',
  MISTRALAI: 'mistral',
  COHERE: 'cohere',
  COMETAPI: 'cometapi',
  DEEPSEEK: 'deepseek',
  AIMLAPI: 'aimlapi',
  XAI: 'xai',
  CHUTES: 'chutes',
  MINIMAX: 'minimax',
  ELECTRONHUB: 'electronhub',
  AZURE_OPENAI: 'azure-openai',
  OPENAI: 'openai',
  OPENROUTER: 'openrouter',
  CUSTOM: 'custom',
  PERPLEXITY: 'perplexity',
  GROQ: 'groq',
  FIREWORKS: 'fireworks',
  NANOGPT: 'nanogpt',
  POLLINATIONS: 'pollinations',
  MOONSHOT: 'moonshot',
  ZAI: 'zai',
  SILICONFLOW: 'siliconflow',
  WORKERS_AI: 'workers-ai',
});
const requestInit = { method: 'POST', body: '{"model":"test-model"}', headers: {} };

function createAdapter({
  resolveProtectedMemory,
  gateway = { dispatchProtectedRequest: () => 'gateway' },
  prepareHostContext,
  chatCompletionSources = sources,
}) {
  return createSillyTavernFinalSendAdapter({
    gateway,
    resolveProtectedMemory,
    prepareHostContext,
    chatCompletionSources,
    nativeForwardFetchResponse: async () => undefined,
  });
}

test('adapter rejects missing or extra pinned source keys instead of silently omitting a sender', () => {
  const { COMETAPI, ...withoutCometApi } = sources;
  assert.equal(COMETAPI, 'COMETAPI');
  assert.throws(
    () => createAdapter({ resolveProtectedMemory: () => null, chatCompletionSources: withoutCometApi }),
    /SILLYTAVERN_SOURCE_REGISTRY_MISMATCH/,
  );
  assert.throws(
    () => createAdapter({
      resolveProtectedMemory: () => null,
      chatCompletionSources: { ...sources, FUTURE_PROVIDER: 'future-provider' },
    }),
    /SILLYTAVERN_SOURCE_REGISTRY_MISMATCH/,
  );
});

test('adapter maps every pinned Chat Completions source key to its protected sender identity', () => {
  const adapter = createAdapter({ resolveProtectedMemory: () => null });
  assert.deepEqual(Object.keys(expectedRoutes).sort(), [...sourceKeys].sort());
  for (const [sourceKey, expectedRoute] of Object.entries(expectedRoutes)) {
    assert.equal(
      adapter.resolveSenderRoute({ body: { chat_completion_source: sources[sourceKey] } }),
      expectedRoute,
      sourceKey,
    );
  }
});

test('native abort bypass is restricted to empty POST control requests', () => {
  const patch = readFileSync(new URL('../patches/sillytavern-1.19.0-final-send.patch', import.meta.url), 'utf8');
  assert.ok(patch.includes("requestInit?.method?.toUpperCase() === 'POST'"));
  assert.ok(patch.includes("requestInit.body === undefined"));
  assert.ok(patch.includes("requestInit.body === null"));
  assert.ok(patch.includes("requestInit.body === ''"));
  assert.ok(!patch.includes("if (/\\/(?:extra\\/abort|abort)(?:[?#]|$)/i.test(String(endpointUrl)))"),
    'a generation POST with a serialized prompt must never bypass the Gateway by using an /abort URL');
});

test('adapter maps all pinned non-Chat-Completions route families', () => {
  const adapter = createAdapter({ resolveProtectedMemory: () => null });
  assert.equal(adapter.resolveSenderRoute({ body: { chat_completion_source: 'OPENAI' } }), 'openai');
  assert.equal(adapter.resolveSenderRoute({}, 'text-completions'), 'text-completions');
  assert.equal(adapter.resolveSenderRoute({}, 'kobold'), 'kobold');
  assert.equal(adapter.resolveSenderRoute({}, 'novelai-text'), 'novelai-text');
  assert.equal(adapter.resolveSenderRoute({}, 'horde-text'), 'unregistered');
});

test('CometAPI is registered and protected generation reaches the sole Gateway', async () => {
  const protectedContext = {
    requestId: 'request-cometapi',
    model: 'test-model',
    worldId: 'world-1',
    actorId: 'actor-1',
    purpose: 'npc_decision',
    sources: [{ source_kind: 'canonical_entity', source_entity_id: 'entity-1', source_version: 'v1' }],
    candidates: [{ record_ref: 'record-1', record_version: 'v1', authorization_generation: 1,
      source_kind: 'canonical_entity', source_entity_id: 'entity-1', source_version: 'v1' }],
  };
  const gatewayRoutes = [];
  let transportCalls = 0;
  const adapter = createAdapter({
    resolveProtectedMemory: () => protectedContext,
    gateway: {
      dispatchProtectedRequest(request) {
        gatewayRoutes.push(request.senderRoute);
        return request.transport();
      },
    },
  });
  const request = { body: { chat_completion_source: 'COMETAPI', stream: false } };
  const senderRoute = adapter.resolveSenderRoute(request);

  assert.equal(senderRoute, 'cometapi');
  const result = await adapter.dispatch({
    request,
    response: {},
    senderRoute,
    endpointUrl: 'https://provider.example/v1/chat/completions',
    requestInit,
    stream: false,
    transport: async () => { transportCalls += 1; return { status: 200 }; },
  });

  assert.equal(result.status, 200);
  assert.deepEqual(gatewayRoutes, ['cometapi']);
  assert.equal(transportCalls, 1);
});

test('unknown SillyTavern sender is denied for protected Memory generation', () => {
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
  const request = { body: { chat_completion_source: 'UNKNOWN_SOURCE', stream: false } };

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

test('all three synchronous protected non-Chat-Completions routes dispatch through Core Gateway', async () => {
  const routes = ['text-completions', 'kobold', 'novelai-text'];
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

test('Horde async task creation remains native only when unprotected', async () => {
  const unprotectedAdapter = createAdapter({ resolveProtectedMemory: () => null });
  const unprotectedRequest = { body: {} };
  const unprotectedRoute = unprotectedAdapter.resolveSenderRoute(unprotectedRequest, 'horde-text');
  assert.equal(unprotectedRoute, 'unregistered');
  let ordinaryTransportCalls = 0;
  const ordinaryResult = await unprotectedAdapter.dispatch({
    request: unprotectedRequest,
    response: {},
    senderRoute: unprotectedRoute,
    hostRoute: 'horde-text',
    endpointUrl: 'https://aihorde.net/api/v2/generate/text/async',
    requestInit,
    stream: false,
    transport: async () => {
      ordinaryTransportCalls += 1;
      return { status: 200 };
    },
  });
  assert.equal(ordinaryResult.status, 200);
  assert.equal(ordinaryTransportCalls, 1);

  const protectedContext = {
    requestId: 'request-horde-protected',
    model: 'test-model',
    worldId: 'world-1',
    actorId: 'actor-1',
    purpose: 'npc_decision',
    sources: [{ source_kind: 'canonical_entity', source_entity_id: 'entity-1', source_version: 'v1' }],
    candidates: [{ record_ref: 'record-1', record_version: 'v1', authorization_generation: 1,
      source_kind: 'canonical_entity', source_entity_id: 'entity-1', source_version: 'v1' }],
  };
  const protectedAdapter = createAdapter({ resolveProtectedMemory: () => protectedContext });
  const protectedRequest = { body: {} };
  let protectedTransportCalls = 0;
  assert.equal(protectedAdapter.resolveSenderRoute(protectedRequest, 'horde-text'), 'unregistered');
  assert.throws(() => protectedAdapter.dispatch({
    request: protectedRequest,
    response: {},
    senderRoute: 'unregistered',
    hostRoute: 'horde-text',
    endpointUrl: 'https://aihorde.net/api/v2/generate/text/async',
    requestInit,
    stream: false,
    transport: async () => {
      protectedTransportCalls += 1;
      return { status: 200 };
    },
  }), /MEMORY_DISPATCH_NOT_READY/);
  assert.equal(protectedTransportCalls, 0, 'protected Horde task creation must be denied before task submission');
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
    resolveProtectedMemory: (_request, hostContext) => {
      resolvedContext = hostContext;
      return null;
    },
  });
  const request = {
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
  assert.equal(resolvedContext, trustedHostContext);
});
