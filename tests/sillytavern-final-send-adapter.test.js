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

test('adapter maps every pinned SillyTavern sender key to the Gateway sender registry', () => {
  const adapter = createSillyTavernFinalSendAdapter({
    gateway: { dispatchProtectedRequest: request => request.transport() },
    resolveProtectedMemory: () => null,
    chatCompletionSources: sources,
    nativeForwardFetchResponse: async () => {},
  });
  for (const source of Object.values(sources)) {
    assert.equal(adapter.resolveSenderRoute({ body: { chat_completion_source: source } }) !== '', true);
  }
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

test('adapter denies unknown native sender before any transport handoff', async () => {
  let handoffs = 0;
  const adapter = createSillyTavernFinalSendAdapter({
    gateway: { dispatchProtectedRequest: () => { throw new Error('unexpected Gateway call'); } },
    resolveProtectedMemory: () => protectedMemory,
    chatCompletionSources: sources,
    nativeForwardFetchResponse: async () => {},
  });
  await assert.rejects(adapter.dispatch({
    request: { body: { chat_completion_source: 'not-registered' } },
    senderRoute: 'unknown',
    endpointUrl: 'https://provider.example/generate',
    requestInit: { method: 'POST', body: '{}' },
    stream: false,
    transport: async () => { handoffs += 1; },
  }), /MEMORY_DISPATCH_NOT_READY/);
  assert.equal(handoffs, 0);
});
