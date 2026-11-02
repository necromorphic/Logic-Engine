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
  assert.throws(() => adapter.resolveSenderRoute({
    body: { chat_completion_source: 'cometapi' },
  }), /MEMORY_DISPATCH_NOT_READY/);
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


test('separately routed native generation handlers pass route admission and use the shared Gateway', async () => {
  const routes = ['text-completions', 'kobold', 'novelai-text', 'horde-text'];
  const calls = [];
  const adapter = createSillyTavernFinalSendAdapter({
    gateway: {
      dispatchProtectedRequest(request) {
        calls.push(request.senderRoute);
        return request.transport();
      },
      authorizeResponseWrite(_requestId, write) { return write(); },
    },
    resolveProtectedMemory: () => protectedMemory,
    chatCompletionSources: sources,
    nativeForwardFetchResponse: async () => {},
  });
  for (const route of routes) {
    const result = await adapter.dispatch({
      request: { body: { stream: false } },
      response: {},
      senderRoute: adapter.resolveSenderRoute({}, route),
      endpointUrl: 'https://provider.example/generate',
      requestInit: { method: 'POST', body: '{"model":"test"}' },
      stream: false,
      transport: async () => ({ status: 200, route }),
    });
    assert.equal(result.status, 200);
    assert.equal(result.route, route);
  }
  assert.deepEqual(calls, routes);
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
  assert.throws(
    () => adapter.authorizeResponseWrite(response, () => writes.push('bypass'), true),
    /MEMORY_DISPATCH_FINAL_RESPONSE_REVALIDATION_DENIED/,
  );
  assert.deepEqual(writes, ['first'], 'a second Express end must not fall through as unprotected');
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
    /MEMORY_DISPATCH_FINAL_RESPONSE_REVALIDATION_DENIED/,
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
  }), /dispatch denied/);
  assert.throws(
    () => adapter.authorizeResponseWrite(response, () => { writes += 1; }, true),
    /MEMORY_DISPATCH_FINAL_RESPONSE_REVALIDATION_DENIED/,
  );
  assert.equal(writes, 0);
});
