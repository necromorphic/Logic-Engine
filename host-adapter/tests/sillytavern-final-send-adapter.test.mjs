import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSillyTavernFinalSendAdapter } from '../sillytavern-final-send-adapter.mjs';
import { createProtectedMemoryFinalSend, PROTECTED_MEMORY_SENDER_ROUTES } from '../protected-memory-final-send.mjs';

const sourceKeys = [
  'CLAUDE', 'AI21', 'MAKERSUITE', 'VERTEXAI', 'MISTRALAI', 'COHERE',
  'COMETAPI', 'DEEPSEEK', 'AIMLAPI', 'XAI', 'CHUTES', 'MINIMAX', 'ELECTRONHUB',
  'AZURE_OPENAI', 'OPENAI', 'OPENROUTER', 'CUSTOM', 'PERPLEXITY', 'GROQ',
  'FIREWORKS', 'NANOGPT', 'POLLINATIONS', 'MOONSHOT', 'ZAI', 'SILICONFLOW',
  'WORKERS_AI',
];
const sources = Object.fromEntries(sourceKeys.map((key) => [key, key.toLowerCase()]));
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
const requestInit = { method: 'POST', body: '{"model":"test-model","messages":[{"role":"user","content":"hello"}]}', headers: {} };

function makeAdapterHandoffFields(requestId) {
  const generationRequest = {
    request_id: requestId,
    generation_id: `generation-${requestId}`,
    generation_type: 'chat',
  };
  return {
    conversationId: 'conversation-1',
    adapterId: 'sillytavern-1',
    generationRequest,
    npcContextHandoff: { generationRequest, context: {} },
  };
}

function createAdapter({
  resolveProtectedMemory,
  gateway = { dispatchProtectedRequest: () => 'gateway' },
  prepareHostContext,
  chatCompletionSources = sources,
  npcContextHostBridge = null,
  shouldPrepareNpcContext = () => false,
}) {
  return createSillyTavernFinalSendAdapter({
    gateway,
    resolveProtectedMemory,
    prepareHostContext,
    chatCompletionSources,
    npcContextHostBridge,
    shouldPrepareNpcContext,
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

test('Final-Send hook refuses adapters without a mandatory response authorization method', () => {
  const patch = readFileSync(new URL('../patches/sillytavern-1.19.0-final-send.patch', import.meta.url), 'utf8');
  const rootPlugin = readFileSync(new URL('../../index.mjs', import.meta.url), 'utf8');
  assert.ok(patch.includes("typeof candidate.authorizeResponseWrite !== 'function'"));
  assert.ok(patch.includes('const authorizeResponseWrite = responseAdapter.authorizeResponseWrite.bind(responseAdapter)'));
  assert.ok(patch.includes('const transport = (outboundRequestInit = requestInit) => nativeFetch(endpointUrl, outboundRequestInit)'));
  assert.ok(!patch.includes("if (typeof responseAdapter.authorizeResponseWrite === 'function')"));
  assert.ok(rootPlugin.includes('authorizeResponseWrite(_response, write)'));
  assert.ok(rootPlugin.includes("cometapi: 'cometapi'"));
  assert.ok(!rootPlugin.includes("'horde-text': 'horde-text'"));
  assert.ok(rootPlugin.includes("return HOST_ROUTE_MAP[hostRoute] ?? 'unregistered'"));
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
    ...makeAdapterHandoffFields('request-cometapi'),
    model: 'test-model',
    worldId: 'world-1',
    actorId: 'actor-1',
    purpose: 'npc_decision',
    sources: [{ source_kind: 'canonical_entity', source_entity_id: 'entity-1', source_version: 'v1' }],
    candidates: [{ record_ref: 'record-1', record_version: 'v1', authorization_generation: 1,
      source_kind: 'canonical_entity', source_entity_id: 'entity-1', source_version: 'v1' }],
    contentBlocks: [{ epistemic_kind: 'acquired_report', evidence_assessment: 'supported',
      content: { note: 'The bridge is closed.' } }],
  };
  const gatewayRoutes = [];
  let transportCalls = 0;
  const adapter = createAdapter({
    resolveProtectedMemory: () => ({ status: 'ready', context: protectedContext }),
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

test('Host bridge transfer is bound to the exact generation request and prompt projection', async () => {
  const generationRequest = Object.freeze({
    request_id: 'request-bridge', generation_id: 'generation-bridge', generation_type: 'chat',
  });
  const handoff = Object.freeze({});
  const projection = Object.freeze({
    world_id: 'world-1', actor_id: 'actor-1', conversation_id: 'conversation-1',
    adapter_id: 'sillytavern-1', purpose: 'npc_turn_context',
    sources: Object.freeze([{ source_kind: 'canonical_entity', source_entity_id: 'entity-1', source_version: 'core-entity-v1:1' }]),
    candidates: Object.freeze([{ record_ref: 'record-1', record_version: 'v1', authorization_generation: 1,
      source_kind: 'canonical_entity', source_entity_id: 'entity-1', source_version: 'core-entity-v1:1' }]),
    contentBlocks: Object.freeze([{ epistemic_kind: 'direct_observation', evidence_assessment: 'unassessed',
      content: Object.freeze({ note: 'trusted fact' }) }]),
  });
  let prepared = 0;
  let transferred = 0;
  let gatewayCalls = 0;
  let transportCalls = 0;
  const bridge = {
    async prepare(request, response) {
      assert.ok(request && response);
      prepared += 1;
      return { status: 'ready' };
    },
    takeForDispatch() {
      transferred += 1;
      return { status: 'ready', requestMetadata: generationRequest, handoff, projection };
    },
  };
  const adapter = createAdapter({
    npcContextHostBridge: bridge,
    shouldPrepareNpcContext: () => true,
    resolveProtectedMemory: (_request, _hostContext, transfer) => ({
      status: 'ready',
      context: {
        requestId: transfer.requestMetadata.request_id,
        model: 'test-model',
        worldId: transfer.projection.world_id,
        actorId: transfer.projection.actor_id,
        purpose: transfer.projection.purpose,
        conversationId: transfer.projection.conversation_id,
        adapterId: transfer.projection.adapter_id,
        generationRequest: transfer.requestMetadata,
        npcContextHandoff: transfer.handoff,
        sources: transfer.projection.sources,
        candidates: transfer.projection.candidates,
        contentBlocks: transfer.projection.contentBlocks,
      },
    }),
    gateway: {
      dispatchProtectedRequest(request) {
        gatewayCalls += 1;
        return request.transport();
      },
    },
  });
  const request = { body: { chat_completion_source: 'COMETAPI', model: 'test-model', stream: false } };
  const response = {};
  await adapter.prepare(request, response);
  const result = await adapter.dispatch({
    request, response, senderRoute: 'cometapi',
    endpointUrl: 'https://provider.example/v1/chat/completions',
    requestInit, stream: false,
    transport: async () => { transportCalls += 1; return { status: 200 }; },
  });
  assert.equal(result.status, 200);
  assert.equal(prepared, 1);
  assert.equal(transferred, 1);
  assert.equal(gatewayCalls, 1);
  assert.equal(transportCalls, 1);
});

test('Host bridge projection mismatch blocks protected native transport', async () => {
  let transportCalls = 0;
  const generationRequest = Object.freeze({
    request_id: 'request-mismatch', generation_id: 'generation-mismatch', generation_type: 'chat',
  });
  const handoff = Object.freeze({});
  const projection = Object.freeze({
    world_id: 'world-1', actor_id: 'actor-1', conversation_id: 'conversation-1',
    adapter_id: 'sillytavern-1', purpose: 'npc_turn_context',
    sources: Object.freeze([]), candidates: Object.freeze([]),
    contentBlocks: Object.freeze([{ epistemic_kind: 'direct_observation', evidence_assessment: 'unassessed',
      content: Object.freeze({ note: 'trusted fact' }) }]),
  });
  const adapter = createAdapter({
    npcContextHostBridge: {
      async prepare() { return { status: 'ready' }; },
      takeForDispatch() { return { status: 'ready', requestMetadata: generationRequest, handoff, projection }; },
    },
    shouldPrepareNpcContext: () => true,
    resolveProtectedMemory: (_request, _hostContext, transfer) => ({
      status: 'ready',
      context: {
        requestId: transfer.requestMetadata.request_id, model: 'test-model',
        worldId: transfer.projection.world_id, actorId: transfer.projection.actor_id,
        purpose: transfer.projection.purpose, conversationId: transfer.projection.conversation_id,
        adapterId: transfer.projection.adapter_id, generationRequest: transfer.requestMetadata,
        npcContextHandoff: transfer.handoff, sources: [...transfer.projection.sources],
        candidates: transfer.projection.candidates, contentBlocks: transfer.projection.contentBlocks,
      },
    }),
  });
  const request = { body: { chat_completion_source: 'COMETAPI', model: 'test-model' } };
  const response = {};
  await adapter.prepare(request, response);
  assert.throws(() => adapter.dispatch({
    request, response, senderRoute: 'cometapi',
    endpointUrl: 'https://provider.example/v1/chat/completions',
    requestInit, stream: false,
    transport: async () => { transportCalls += 1; return { status: 200 }; },
  }), /MEMORY_DISPATCH_PROJECTION_BINDING_MISMATCH/);
  assert.equal(transportCalls, 0);
});

test('protected resolution cannot bypass the configured Host bridge', async () => {
  let transportCalls = 0;
  const adapter = createAdapter({
    npcContextHostBridge: {
      async prepare() { return { status: 'ready' }; },
      takeForDispatch() { throw new Error('should not be called'); },
    },
    shouldPrepareNpcContext: () => false,
    resolveProtectedMemory: () => ({ status: 'ready', context: {
      requestId: 'request-no-bridge', ...makeAdapterHandoffFields('request-no-bridge'),
      model: 'test-model', worldId: 'world-1', actorId: 'actor-1', purpose: 'npc_decision',
      sources: [], candidates: [], contentBlocks: [{ epistemic_kind: 'direct_observation',
        evidence_assessment: 'unassessed', content: { note: 'x' } }],
    } }),
  });
  const request = { body: { chat_completion_source: 'COMETAPI', model: 'test-model' } };
  const response = {};
  await adapter.prepare(request, response);
  assert.throws(() => adapter.dispatch({
    request, response, senderRoute: 'cometapi',
    endpointUrl: 'https://provider.example/v1/chat/completions',
    requestInit, stream: false,
    transport: async () => { transportCalls += 1; return { status: 200 }; },
  }), /MEMORY_DISPATCH_NOT_READY/);
  assert.equal(transportCalls, 0);
});

test('only a complete-empty NPC projection may explicitly classify generation as unprotected', async () => {
  let transportCalls = 0;
  const generationRequest = Object.freeze({
    request_id: 'request-empty', generation_id: 'generation-empty', generation_type: 'chat',
  });
  const projection = Object.freeze({
    world_id: 'world-1', actor_id: 'actor-1', conversation_id: 'conversation-1',
    adapter_id: 'sillytavern-1', purpose: 'npc_turn_context',
    snapshot: Object.freeze({ world_revision: 1, commit_sequence: 1 }),
    contentBlocks: Object.freeze([]), sources: Object.freeze([]), candidates: Object.freeze([]),
  });
  const adapter = createAdapter({
    npcContextHostBridge: {
      async prepare() { return { status: 'ready' }; },
      takeForDispatch() { return { status: 'ready', requestMetadata: generationRequest, handoff: {}, projection }; },
    },
    shouldPrepareNpcContext: () => true,
    resolveProtectedMemory: (_request, _hostContext, transfer) => {
      assert.equal(transfer.projection.contentBlocks.length, 0);
      return { status: 'unprotected' };
    },
  });
  const request = { body: { chat_completion_source: 'COMETAPI', model: 'test-model' } };
  const response = {};
  await adapter.prepare(request, response);
  const result = await adapter.dispatch({
    request, response, senderRoute: 'cometapi',
    endpointUrl: 'https://provider.example/v1/chat/completions',
    requestInit, stream: false,
    transport: async () => { transportCalls += 1; return { status: 200 }; },
  });
  assert.equal(result.status, 200);
  assert.equal(transportCalls, 1);
});

test('non-empty NPC projection cannot be downgraded to native unprotected generation', async () => {
  let transportCalls = 0;
  const generationRequest = Object.freeze({
    request_id: 'request-nonempty', generation_id: 'generation-nonempty', generation_type: 'chat',
  });
  const projection = Object.freeze({
    world_id: 'world-1', actor_id: 'actor-1', conversation_id: 'conversation-1',
    adapter_id: 'sillytavern-1', purpose: 'npc_turn_context',
    snapshot: Object.freeze({ world_revision: 1, commit_sequence: 1 }),
    contentBlocks: Object.freeze([Object.freeze({ epistemic_kind: 'direct_observation',
      evidence_assessment: 'unassessed', content: Object.freeze({ note: 'secret' }) })]),
    sources: Object.freeze([]), candidates: Object.freeze([]),
  });
  const adapter = createAdapter({
    npcContextHostBridge: {
      async prepare() { return { status: 'ready' }; },
      takeForDispatch() { return { status: 'ready', requestMetadata: generationRequest, handoff: {}, projection }; },
    },
    shouldPrepareNpcContext: () => true,
    resolveProtectedMemory: () => ({ status: 'unprotected' }),
  });
  const request = { body: { chat_completion_source: 'COMETAPI', model: 'test-model' } };
  const response = {};
  await adapter.prepare(request, response);
  assert.throws(() => adapter.dispatch({
    request, response, senderRoute: 'cometapi',
    endpointUrl: 'https://provider.example/v1/chat/completions',
    requestInit, stream: false,
    transport: async () => { transportCalls += 1; return { status: 200 }; },
  }), /MEMORY_DISPATCH_NOT_READY/);
  assert.equal(transportCalls, 0);
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
  const adapter = createAdapter({ resolveProtectedMemory: () => ({ status: 'ready', context: protectedContext }) });
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
      ...makeAdapterHandoffFields('request-routes'),
      model: 'test-model',
      worldId: 'world-1',
      actorId: 'actor-1',
      purpose: 'npc_decision',
      sources: [{ source_kind: 'canonical_entity', source_entity_id: 'entity-1', source_version: 'v1' }],
      candidates: [{ record_ref: 'record-1', record_version: 'v1', authorization_generation: 1,
        source_kind: 'canonical_entity', source_entity_id: 'entity-1', source_version: 'v1' }],
      contentBlocks: [{ epistemic_kind: 'acquired_report', evidence_assessment: 'supported',
        content: { note: 'The bridge is closed.' } }],
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
      requestInit: {
        ...requestInit,
        body: hostRoute === 'novelai-text' ? JSON.stringify({ input: 'hello' }) : JSON.stringify({ prompt: 'hello' }),
      },
      stream: false,
      transport: async () => ({ status: 200 }),
    });
    assert.equal(result.status, 200);
  }
  assert.deepEqual(calls, routes);
});

test('adapter rejects native dispatch when the exact request has not been prepared', async () => {
  let transportCalls = 0;
  const adapter = createAdapter({ resolveProtectedMemory: () => ({ status: 'unprotected' }) });
  await assert.rejects(() => adapter.dispatch({
    request: {},
    senderRoute: 'openai',
    hostRoute: 'chat-completions',
    endpointUrl: 'https://provider.example/v1/chat/completions',
    requestInit: { method: 'POST', body: '{}' },
    transport: () => { transportCalls += 1; return { status: 200 }; },
    response: {},
  }), /MEMORY_DISPATCH_HOST_PREPARATION_REQUIRED/);
  assert.equal(transportCalls, 0);
});

test('adapter never treats null or NON_READY resolution as an unprotected native request', () => {
  for (const resolution of [null, undefined, { status: 'non_ready' }]) {
    let transportCalls = 0;
    const adapter = createAdapter({ resolveProtectedMemory: () => resolution });
    assert.throws(() => adapter.dispatch({
      request: { body: { chat_completion_source: 'OPENAI', stream: false } },
      senderRoute: 'openai',
      hostRoute: 'chat-completions',
      endpointUrl: 'https://provider.example/generate',
      requestInit: { method: 'POST', body: '{}' },
      transport: () => { transportCalls += 1; return { status: 200 }; },
      response: {},
    }), /MEMORY_DISPATCH_NOT_READY/);
    assert.equal(transportCalls, 0);
  }
});

test('Horde async task creation remains native only when unprotected', async () => {
  const unprotectedAdapter = createAdapter({ resolveProtectedMemory: () => ({ status: 'unprotected' }) });
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
  const protectedAdapter = createAdapter({ resolveProtectedMemory: () => ({ status: 'ready', context: protectedContext }) });
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
    ...makeAdapterHandoffFields('request-2'),
    model: 'test-model',
    worldId: 'world-1',
    actorId: 'actor-1',
    purpose: 'npc_decision',
    sources: [{ source_kind: 'canonical_entity', source_entity_id: 'entity-1', source_version: 'v1' }],
    candidates: [{ record_ref: 'record-1', record_version: 'v1', authorization_generation: 1,
      source_kind: 'canonical_entity', source_entity_id: 'entity-1', source_version: 'v1' }],
    contentBlocks: [{ epistemic_kind: 'acquired_report', evidence_assessment: 'supported',
      content: { note: 'The bridge is closed.' } }],
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
  const adapter = createAdapter({ resolveProtectedMemory: () => ({ status: 'ready', context: protectedContext }), gateway });
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
      return { status: 'unprotected' };
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
  await assert.rejects(
    adapter.dispatch({
      request,
      senderRoute: 'openai',
      endpointUrl: 'https://provider.example/v1/chat/completions',
      requestInit,
      stream: false,
      transport: async () => ({ status: 200 }),
    }),
    /MEMORY_DISPATCH_HOST_PREPARATION_REQUIRED/,
  );
});

function makeNpcProtectedMemory(overrides = {}) {
  return {
    requestId: 'dispatch-1',
    ...makeAdapterHandoffFields('dispatch-1'),
    model: 'test-model',
    worldId: 'world-1',
    actorId: 'actor-1',
    purpose: 'npc_decision',
    sources: [{ source_kind: 'canonical_entity', source_entity_id: 'entity-1', source_version: 'v1' }],
    candidates: [{
      record_ref: 'record-1',
      record_version: 'v1',
      authorization_generation: 1,
      source_kind: 'canonical_entity',
      source_entity_id: 'entity-1',
      source_version: 'v1',
    }],
    contentBlocks: [{
      epistemic_kind: 'acquired_report',
      evidence_assessment: 'supported',
      content: { 'attributes.public_note': 'The bridge is closed.' },
    }],
    ...overrides,
  };
}

function makeNpcProviderBody(hostRoute) {
  if (hostRoute === 'chat-completions') {
    return {
      model: 'test-model',
      messages: [
        { role: 'system', content: 'Base system rules.' },
        { role: 'developer', content: 'Keep the character consistent.' },
        { role: 'user', content: 'What do you know?' },
      ],
      logic_engine_context_size: 4096,
      memory_dispatch: { forged: true },
      metadata: { host_context: { conversation_uuid: 'forged' }, session_id: 'host-only', chat_id: 'host-only', installation_id: 'host-only', account_id: 'host-only', x_host_session_id: 'host-only', x_conversation_id: 'host-only' },
    };
  }
  if (hostRoute === 'novelai-text') return { model: 'test-model', input: 'What do you know?' };
  return { model: 'test-model', prompt: 'What do you know?' };
}

function makeNpcRequestInit(body) {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer provider-secret',
      'x-logic-engine-conversation-uuid': 'host-only',
      'x-host-session-id': 'host-only',
      'x-conversation-id': 'host-only',
      'x-world-id': 'host-only',
      'x-actor-id': 'host-only',
      'x-generation-id': 'host-only',
    },
    body: JSON.stringify(body),
  };
}

function npcBodyText(hostRoute, body) {
  if (hostRoute === 'chat-completions') return body.messages.map((message) => message.content).join('\n');
  if (hostRoute === 'novelai-text') return body.input;
  return body.prompt;
}

function makeNpcFinalSendHarness({ context = makeNpcProtectedMemory(), resolve = () => ({ status: 'ready', context }), gatewayDispatch } = {}) {
  const providerCalls = [];
  const gatewayCalls = [];
  const gateway = {
    dispatchProtectedRequest(request) {
      gatewayCalls.push(request);
      return gatewayDispatch ? gatewayDispatch(request) : request.transport();
    },
  };
  const finalSend = createProtectedMemoryFinalSend({
    gateway,
    resolveProtectedMemory: resolve,
    fetchImpl: async (url, init) => {
      providerCalls.push({ url, init });
      return { status: 200, body: init.body };
    },
  });
  return { finalSend, providerCalls, gatewayCalls };
}

test('all 29 registered sender identities inject NPC context into exact outbound provider bytes', async () => {
  assert.equal(PROTECTED_MEMORY_SENDER_ROUTES.length, 29);
  for (const senderRoute of PROTECTED_MEMORY_SENDER_ROUTES) {
    const hostRoute = ['text-completions', 'kobold', 'novelai-text'].includes(senderRoute)
      ? senderRoute
      : 'chat-completions';
    const harness = makeNpcFinalSendHarness();
    const result = await harness.finalSend({
      senderRoute,
      hostRoute,
      endpointUrl: 'https://provider.example/generate',
      requestInit: makeNpcRequestInit(makeNpcProviderBody(hostRoute)),
      stream: false,
    });
    assert.equal(result.status, 200, senderRoute);
    assert.equal(harness.providerCalls.length, 1, senderRoute);
    assert.equal(harness.gatewayCalls.length, 1, senderRoute);
    const outboundInit = harness.providerCalls[0].init;
    const outboundBody = JSON.parse(outboundInit.body);
    const promptText = npcBodyText(hostRoute, outboundBody);
    assert.match(promptText, /Logic Engine NPC Memory Context/, senderRoute);
    assert.match(promptText, /The bridge is closed\./, senderRoute);
    assert.equal(JSON.stringify(outboundBody).includes('logic_engine_'), false, senderRoute);
    assert.equal(JSON.stringify(outboundBody).includes('memory_dispatch'), false, senderRoute);
    assert.equal(JSON.stringify(outboundBody).includes('host_context'), false, senderRoute);
    assert.equal(JSON.stringify(outboundBody).includes('session_id'), false, senderRoute);
    assert.equal(JSON.stringify(outboundBody).includes('chat_id'), false, senderRoute);
    assert.equal(JSON.stringify(outboundBody).includes('installation_id'), false, senderRoute);
    assert.equal(JSON.stringify(outboundBody).includes('account_id'), false, senderRoute);
    assert.equal(JSON.stringify(outboundBody).includes('x_host_session_id'), false, senderRoute);
    assert.equal(JSON.stringify(outboundBody).includes('x_conversation_id'), false, senderRoute);
    assert.equal(outboundInit.headers.authorization, 'Bearer provider-secret', senderRoute);
    assert.equal(Object.keys(outboundInit.headers).some((key) => key.toLowerCase().startsWith('x-logic-engine-')), false);
    assert.equal(Object.keys(outboundInit.headers).some((key) => key.toLowerCase().startsWith('x-host-')), false);
    assert.equal(Object.keys(outboundInit.headers).some((key) => key.toLowerCase().startsWith('x-conversation-')), false);
    assert.equal(Object.keys(outboundInit.headers).some((key) => key.toLowerCase().startsWith('x-world-')), false);
    assert.equal(Object.keys(outboundInit.headers).some((key) => key.toLowerCase().startsWith('x-actor-')), false);
    assert.equal(Object.keys(outboundInit.headers).some((key) => key.toLowerCase().startsWith('x-generation-')), false);
    assert.equal(harness.gatewayCalls[0].body, outboundInit.body, senderRoute);
    assert.equal(harness.gatewayCalls[0].senderRoute, senderRoute);
  }
});

test('chat NPC context is inserted after existing system/developer instructions and before user content', async () => {
  const harness = makeNpcFinalSendHarness();
  await harness.finalSend({
    senderRoute: 'openai',
    hostRoute: 'chat-completions',
    endpointUrl: 'https://provider.example/generate',
    requestInit: makeNpcRequestInit(makeNpcProviderBody('chat-completions')),
  });
  const messages = JSON.parse(harness.providerCalls[0].init.body).messages;
  assert.deepEqual(messages.map((message) => message.role), ['system', 'developer', 'system', 'user']);
  assert.match(messages[2].content, /The bridge is closed\./);
});

test('empty protected NPC context fails closed before Gateway or provider egress', () => {
  const harness = makeNpcFinalSendHarness({ context: makeNpcProtectedMemory({ contentBlocks: [] }) });
  assert.throws(() => harness.finalSend({
    senderRoute: 'openai',
    hostRoute: 'chat-completions',
    endpointUrl: 'https://provider.example/generate',
    requestInit: makeNpcRequestInit(makeNpcProviderBody('chat-completions')),
  }), /MEMORY_DISPATCH_NOT_READY/);
  assert.equal(harness.providerCalls.length, 0);
  assert.equal(harness.gatewayCalls.length, 0);
});

test('protected Horde text dispatch is denied before provider transport', async () => {
  const harness = makeNpcFinalSendHarness();
  assert.throws(() => harness.finalSend({
    senderRoute: 'horde-text',
    hostRoute: 'horde-text',
    endpointUrl: 'https://provider.example/generate',
    requestInit: makeNpcRequestInit({ prompt: 'ordinary' }),
  }), /MEMORY_DISPATCH_NOT_READY/);
  assert.equal(harness.providerCalls.length, 0);
  assert.equal(harness.gatewayCalls.length, 0);
});

test('Horde task-status remains ordinary-only and receives no injected NPC context', async () => {
  const harness = makeNpcFinalSendHarness({ resolve: () => ({ status: 'unprotected' }) });
  const init = makeNpcRequestInit({ task_id: 'ordinary-task' });
  const result = await harness.finalSend({
    senderRoute: 'unregistered',
    hostRoute: 'horde-task-status',
    endpointUrl: 'https://provider.example/task-status',
    requestInit: init,
  });
  assert.equal(result.status, 200);
  assert.equal(harness.gatewayCalls.length, 0);
  assert.equal(harness.providerCalls[0].init.body, init.body);
});

test('null, unknown and NON_READY protection states never fall back to native transport', () => {
  for (const resolution of [null, undefined, { status: 'non_ready' }, { status: 'ready' }]) {
    const harness = makeNpcFinalSendHarness({ resolve: () => resolution });
    assert.throws(() => harness.finalSend({
      senderRoute: 'openai',
      hostRoute: 'chat-completions',
      endpointUrl: 'https://provider.example/generate',
      requestInit: makeNpcRequestInit(makeNpcProviderBody('chat-completions')),
    }), /MEMORY_DISPATCH_NOT_READY/);
    assert.equal(harness.providerCalls.length, 0);
    assert.equal(harness.gatewayCalls.length, 0);
  }
});

test('protected dispatch fails closed when NPC content blocks are missing or malformed', async () => {
  for (const contentBlocks of [undefined, null, [{}], [{ epistemic_kind: 'report', evidence_assessment: 'supported', content: [] }]]) {
    const harness = makeNpcFinalSendHarness({ context: makeNpcProtectedMemory({ contentBlocks }) });
    assert.throws(() => harness.finalSend({
      senderRoute: 'openai',
      hostRoute: 'chat-completions',
      endpointUrl: 'https://provider.example/generate',
      requestInit: makeNpcRequestInit(makeNpcProviderBody('chat-completions')),
    }), /MEMORY_DISPATCH_NOT_READY/);
    assert.equal(harness.providerCalls.length, 0);
    assert.equal(harness.gatewayCalls.length, 0);
  }
});

test('protected dispatch fails closed on malformed provider body or route/body mismatch', async () => {
  const harness = makeNpcFinalSendHarness();
  assert.throws(() => harness.finalSend({
    senderRoute: 'openai',
    hostRoute: 'chat-completions',
    endpointUrl: 'https://provider.example/generate',
    requestInit: { method: 'POST', body: '{not-json' },
  }), /MEMORY_DISPATCH_NOT_READY/);
  assert.throws(() => harness.finalSend({
    senderRoute: 'kobold',
    hostRoute: 'kobold',
    endpointUrl: 'https://provider.example/generate',
    requestInit: makeNpcRequestInit({ input: 'wrong route field' }),
  }), /MEMORY_DISPATCH_NOT_READY/);
  assert.equal(harness.providerCalls.length, 0);
});

test('transport remains dormant until Gateway invokes the exact outbound capability', async () => {
  let captured;
  const harness = makeNpcFinalSendHarness({
    gatewayDispatch(request) {
      captured = request;
      return { accepted: true };
    },
  });
  const result = harness.finalSend({
    senderRoute: 'openai',
    hostRoute: 'chat-completions',
    endpointUrl: 'https://provider.example/generate',
    requestInit: makeNpcRequestInit(makeNpcProviderBody('chat-completions')),
  });
  assert.deepEqual(result, { accepted: true });
  assert.equal(harness.providerCalls.length, 0);
  assert.match(captured.body, /Logic Engine NPC Memory Context/);
  const response = await captured.transport();
  assert.equal(response.status, 200);
  assert.equal(harness.providerCalls.length, 1);
  assert.equal(harness.providerCalls[0].init.body, captured.body);
});

test('transport override receives the post-injection requestInit', async () => {
  let sentInit;
  const harness = makeNpcFinalSendHarness({
    gatewayDispatch(request) {
      return request.transport();
    },
  });
  await harness.finalSend({
    senderRoute: 'kobold',
    hostRoute: 'kobold',
    endpointUrl: 'https://provider.example/generate',
    requestInit: makeNpcRequestInit(makeNpcProviderBody('kobold')),
    transport: (outboundRequestInit) => {
      sentInit = outboundRequestInit;
      return Promise.resolve({ status: 201 });
    },
  });
  assert.equal(sentInit.method, 'POST');
  assert.match(JSON.parse(sentInit.body).prompt, /The bridge is closed\./);
});
