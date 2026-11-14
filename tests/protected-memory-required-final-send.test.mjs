import test from 'node:test';
import assert from 'node:assert/strict';
import { createSillyTavernFinalSendAdapter } from '../host-adapter/sillytavern-final-send-adapter.mjs';

const chatCompletionSources = {
  CLAUDE: 'claude', AI21: 'ai21', MAKERSUITE: 'makersuite', VERTEXAI: 'vertexai',
  MISTRALAI: 'mistral', COHERE: 'cohere', COMETAPI: 'cometapi', DEEPSEEK: 'deepseek',
  AIMLAPI: 'aimlapi', XAI: 'xai', CHUTES: 'chutes', MINIMAX: 'minimax',
  ELECTRONHUB: 'electronhub', AZURE_OPENAI: 'azure-openai', OPENAI: 'openai',
  OPENROUTER: 'openrouter', CUSTOM: 'custom', PERPLEXITY: 'perplexity', GROQ: 'groq',
  FIREWORKS: 'fireworks', NANOGPT: 'nanogpt', POLLINATIONS: 'pollinations',
  MOONSHOT: 'moonshot', ZAI: 'zai', SILICONFLOW: 'siliconflow', WORKERS_AI: 'workers-ai',
};

const request = () => ({
  originalUrl: '/api/backends/chat-completions/generate',
  body: {
    chat_completion_source: 'makersuite',
    messages: [{ role: 'user', content: 'continue' }],
  },
});

const protectedMemory = Object.freeze({
  requestId: 'host-request-1',
  generationId: 'host-generation-1',
  runId: '77777777-7777-4777-8777-777777777777',
  contextDigest: 'a'.repeat(64),
  coreEnvelopeDigest: 'b'.repeat(64),
  model: 'selected-model',
  worldId: 'world-1',
  actorId: 'actor-1',
  purpose: 'npc_decision',
  sources: Object.freeze([]),
  candidates: Object.freeze([]),
  laneA: Object.freeze({
    lane: 'A', purpose: 'npc_turn_context',
    authorization_ref: 'read-1', visibility_authorization_ref: 'visibility-1',
    items: Object.freeze([]),
  }),
  contentBlocks: Object.freeze([]),
});

function createAdapter({
  resolveProtectedMemory,
  gateway = { dispatchProtectedRequest: async () => { throw new Error('gateway must not be reached'); } },
  prepareHostContext = async () => ({ status: 'READY', coreConversationId: 'core-conversation-1' }),
  runWithAuthenticatedHostSession = (_request, _conversationId, execute) => execute(),
} = {}) {
  return createSillyTavernFinalSendAdapter({
    gateway,
    resolveProtectedMemory,
    requireProtectedMemory: true,
    chatCompletionSources,
    nativeForwardFetchResponse: async () => {},
    prepareHostContext,
    runWithAuthenticatedHostSession,
  });
}

function dispatch(adapter, req, response, transport) {
  return adapter.dispatch({
    request: req,
    response,
    senderRoute: 'google-ai-studio',
    endpointUrl: 'http://127.0.0.1:9/fake-model',
    requestInit: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: req.body.messages }),
    },
    stream: false,
    transport,
  });
}

test('required Memory denies native egress when Host preparation is NON_READY', async () => {
  let upstreamCalls = 0;
  const adapter = createAdapter({
    resolveProtectedMemory: () => undefined,
    prepareHostContext: async () => ({ status: 'NON_READY', code: 'HOST_INVENTORY_NOT_AUTHORITATIVE' }),
  });
  const req = request();
  const response = {};
  await adapter.prepare(req, response);
  await assert.rejects(
    Promise.resolve().then(() => dispatch(adapter, req, response, async () => {
      upstreamCalls += 1;
      return { status: 200 };
    })),
    /MEMORY_DISPATCH_HOST_SESSION_UNAVAILABLE/,
  );
  assert.equal(upstreamCalls, 0);
  assert.throws(() => adapter.authorizeResponseWrite(response, () => ({ status: 200 }), true),
    /MEMORY_DISPATCH_FINAL_RESPONSE_REVALIDATION_DENIED/);
});

test('required Memory denies native egress when Receiver projection is unavailable', async () => {
  let upstreamCalls = 0;
  const adapter = createAdapter({ resolveProtectedMemory: () => undefined });
  const req = request();
  const response = {};
  await adapter.prepare(req, response);
  await assert.rejects(
    Promise.resolve().then(() => dispatch(adapter, req, response, async () => {
      upstreamCalls += 1;
      return { status: 200 };
    })),
    /MEMORY_DISPATCH_NOT_READY/,
  );
  assert.equal(upstreamCalls, 0);
});

test('required Memory does not fall back to native egress when Gateway rejects before transport', async () => {
  let gatewayCalls = 0;
  let upstreamCalls = 0;
  const adapter = createAdapter({
    resolveProtectedMemory: () => protectedMemory,
    gateway: {
      dispatchProtectedRequest() {
        gatewayCalls += 1;
        throw new Error('MEMORY_DISPATCH_NOT_READY');
      },
    },
  });
  const req = request();
  const response = {};
  await adapter.prepare(req, response);
  await assert.rejects(
    Promise.resolve().then(() => dispatch(adapter, req, response, async () => {
      upstreamCalls += 1;
      return { status: 200 };
    })),
    /MEMORY_DISPATCH_NOT_READY/,
  );
  assert.equal(gatewayCalls, 1);
  assert.equal(upstreamCalls, 0);
});

test('explicit complete-empty Memory result may use native transport', async () => {
  let upstreamCalls = 0;
  let gatewayCalls = 0;
  const adapter = createAdapter({
    resolveProtectedMemory: () => null,
    gateway: { dispatchProtectedRequest() { gatewayCalls += 1; } },
  });
  const req = request();
  const response = {};
  await adapter.prepare(req, response);
  const result = await dispatch(adapter, req, response, async () => {
    upstreamCalls += 1;
    return { status: 200 };
  });
  assert.equal(result.status, 200);
  assert.equal(upstreamCalls, 1);
  assert.equal(gatewayCalls, 0);
});
