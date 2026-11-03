import test from 'node:test';
import assert from 'node:assert/strict';
import { createSillyTavernFinalSendAdapter } from '../host-adapter/sillytavern-final-send-adapter.mjs';

const sources = {
  CLAUDE: 'claude', AI21: 'ai21', MAKERSUITE: 'makersuite', VERTEXAI: 'vertexai',
  MISTRALAI: 'mistralai', COHERE: 'cohere', DEEPSEEK: 'deepseek', AIMLAPI: 'aimlapi',
  XAI: 'xai', CHUTES: 'chutes', MINIMAX: 'minimax', ELECTRONHUB: 'electronhub',
  AZURE_OPENAI: 'azure_openai', OPENAI: 'openai', OPENROUTER: 'openrouter', CUSTOM: 'custom',
  PERPLEXITY: 'perplexity', GROQ: 'groq', FIREWORKS: 'fireworks', NANOGPT: 'nanogpt',
  POLLINATIONS: 'pollinations', MOONSHOT: 'moonshot', ZAI: 'zai', SILICONFLOW: 'siliconflow',
  WORKERS_AI: 'workers_ai',
};

const protectedMemory = Object.freeze({
  status: 'ready',
  context: Object.freeze({
    requestId: 'req-1',
    model: 'gemini-test',
    worldId: 'world-1',
    actorId: 'actor-1',
    purpose: 'npc_decision',
    conversationId: 'core-conversation-1',
    adapterId: 'st-gateway',
    npcContextHandoff: Object.freeze(Object.create(null)),
    generationRequest: Object.freeze({
      request_id: 'req-1', generation_id: 'gen-1', generation_type: 'chat-completion',
    }),
    hostContext: Object.freeze({
      adapter_id: 'st-gateway',
      core_conversation_id: 'core-conversation-1',
      world_id: 'world-1',
      actor_id: 'actor-1',
      actor_type: 'npc',
      host_installation_id: 'installation-1',
      authenticated_account_id: 'account-1',
      host_session_id: 'session-1',
      host_conversation_id: 'host-conversation-1',
      conversation_uuid: 'conversation-uuid-1',
      root_id: 'a'.repeat(64),
      root_inventory_sequence: 1,
      root_manifest_sha256: 'b'.repeat(64),
    }),
  }),
});

const hostRouteFor = senderRoute => ['text-completions', 'kobold', 'novelai-text', 'horde-text'].includes(senderRoute)
  ? senderRoute : 'chat-completions';

function bodyFor(hostRoute) {
  if (hostRoute === 'chat-completions') return JSON.stringify({ messages: [{ role: 'user', content: 'protected' }] });
  if (hostRoute === 'novelai-text') return JSON.stringify({ input: 'protected' });
  return JSON.stringify({ prompt: 'protected', ...(hostRoute === 'horde-text' ? { params: { model: 'test' } } : {}) });
}

function makeAdapter(gateway, resolveProtectedMemory = () => protectedMemory) {
  return createSillyTavernFinalSendAdapter({
    gateway,
    resolveProtectedMemory,
    chatCompletionSources: sources,
    nativeForwardFetchResponse: async () => {},
  });
}

test('adapter maps every pinned Chat Completions sender key and leaves unknown senders unregistered', () => {
  const adapter = makeAdapter({ dispatchProtectedRequest: () => undefined });
  for (const [key, source] of Object.entries(sources)) {
    assert.notEqual(adapter.resolveSenderRoute({ body: { chat_completion_source: source } }), 'unregistered', key);
  }
  assert.equal(adapter.resolveSenderRoute({ body: { chat_completion_source: 'cometapi' } }), 'unregistered');
});

test('protected Chat Completions uses one Gateway-owned transport and final release', async () => {
  let handoffs = 0;
  let captured;
  let writes = 0;
  const gateway = {
    dispatchProtectedRequest(request) {
      captured = request;
      const exactBody = request.prepareBody([]);
      return request.transport(exactBody);
    },
    authorizeResponseWrite(requestId, write, { final }) {
      assert.equal(requestId, 'req-1');
      if (final) writes += 1;
      return write();
    },
  };
  const adapter = makeAdapter(gateway);
  const responseObject = {};
  const response = await adapter.dispatch({
    request: { body: { chat_completion_source: 'makersuite', stream: false } },
    response: responseObject,
    senderRoute: 'google-ai-studio',
    hostRoute: 'chat-completions',
    endpointUrl: 'https://provider.example/v1/chat/completions',
    requestInit: { method: 'POST', body: bodyFor('chat-completions') },
    stream: false,
    transport: async (_url, init) => {
      handoffs += 1;
      return { status: 200, body: init.body };
    },
  });
  assert.equal(response.status, 200);
  assert.equal(handoffs, 1);
  assert.equal(captured.senderRoute, 'google-ai-studio');
  assert.equal(JSON.parse(response.body).messages[0].role, 'system');
  assert.match(JSON.parse(response.body).messages[0].content, /Logic Engine NPC Memory Context/);
  adapter.authorizeResponseWrite(responseObject, () => { writes += 1; }, true);
  assert.equal(writes, 2);
});

test('all registered non-Chat-Completions generation routes enter the same Gateway', async () => {
  const routes = ['text-completions', 'kobold', 'novelai-text', 'horde-text'];
  const gatewayRoutes = [];
  const adapter = makeAdapter({
    dispatchProtectedRequest(request) {
      gatewayRoutes.push({ senderRoute: request.senderRoute, hostRoute: request.hostRoute });
      return request.transport(request.prepareBody([]));
    },
  });
  for (const route of routes) {
    const request = { body: { stream: false } };
    const result = await adapter.dispatch({
      request,
      response: {},
      senderRoute: adapter.resolveSenderRoute(request, route),
      hostRoute: route,
      endpointUrl: 'https://provider.example/generate',
      requestInit: { method: 'POST', body: bodyFor(route) },
      stream: false,
      transport: async (_url, init) => ({ status: 200, body: init.body }),
    });
    assert.equal(result.status, 200);
  }
  assert.deepEqual(gatewayRoutes, routes.map(route => ({ senderRoute: route, hostRoute: route })));
});

test('unknown and mismatched sender routes leave a terminal response tombstone', () => {
  const response = {};
  let gatewayCalls = 0;
  let transportCalls = 0;
  const adapter = makeAdapter({
    dispatchProtectedRequest() { gatewayCalls += 1; },
    authorizeResponseWrite() { throw new Error('must not authorize'); },
  });
  assert.throws(() => adapter.dispatch({
    request: { body: { chat_completion_source: 'makersuite' } },
    response,
    senderRoute: 'openai',
    hostRoute: 'chat-completions',
    endpointUrl: 'https://provider.example/generate',
    requestInit: { method: 'POST', body: bodyFor('chat-completions') },
    stream: false,
    transport: async () => { transportCalls += 1; return { status: 200 }; },
  }), /MEMORY_DISPATCH_NOT_READY/);
  assert.equal(gatewayCalls, 0);
  assert.equal(transportCalls, 0);
  assert.throws(() => adapter.authorizeResponseWrite(response, () => undefined, true),
    /MEMORY_DISPATCH_FINAL_RESPONSE_REVALIDATION_DENIED/);
});

test('unknown protected classification is terminal and never reaches native transport', () => {
  let gatewayCalls = 0;
  let transportCalls = 0;
  const adapter = makeAdapter({
    dispatchProtectedRequest() { gatewayCalls += 1; },
  }, () => undefined);
  assert.throws(() => adapter.dispatch({
    request: { body: { chat_completion_source: 'makersuite' } },
    response: {},
    senderRoute: 'google-ai-studio',
    hostRoute: 'chat-completions',
    endpointUrl: 'https://provider.example/generate',
    requestInit: { method: 'POST', body: bodyFor('chat-completions') },
    stream: false,
    transport: async () => { transportCalls += 1; return { status: 200 }; },
  }), /MEMORY_DISPATCH_NOT_READY/);
  assert.equal(gatewayCalls, 0);
  assert.equal(transportCalls, 0);
});
