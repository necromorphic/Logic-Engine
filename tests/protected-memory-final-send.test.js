import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProtectedMemoryFinalSend,
  PROTECTED_MEMORY_SENDER_ROUTES,
} from '../host-adapter/protected-memory-final-send.mjs';

const context = {
  requestId: 'host-request-1',
  model: 'google/gemini-test',
  worldId: 'world-1',
  actorId: 'npc-1',
  purpose: 'recall',
  sources: [{ source_kind: 'canonical_entity', source_entity_id: 'entity-1', source_version: 'v1' }],
  candidates: [{
    record_ref: 'record-1', record_version: 'rv1',
    source_kind: 'canonical_entity', source_entity_id: 'entity-1', source_version: 'v1',
  }],
};

const init = (body = '{"messages":[{"role":"user","content":"exact bytes"}]}') => ({
  method: 'POST',
  headers: { authorization: 'Bearer server-secret', 'content-type': 'application/json' },
  body,
});

test('all registered provider sender families share the same protected final-send adapter', async () => {
  for (const senderRoute of PROTECTED_MEMORY_SENDER_ROUTES) {
    let calls = 0;
    let dispatched;
    const gateway = {
      dispatchProtectedRequest(request) {
        dispatched = request;
        return request.transport();
      },
    };
    const finalSend = createProtectedMemoryFinalSend({
      gateway,
      resolveProtectedMemory: () => context,
      fetchImpl: async (_url, request) => {
        calls += 1;
        return { status: 200, body: request.body };
      },
    });
    const body = '{"provider-transformed":true,"keep":"exact"}';
    const response = await finalSend({
      senderRoute,
      endpointUrl: 'https://provider.example/v1/chat/completions',
      requestInit: init(body),
      hostRequestContext: { trusted: true },
    });
    assert.equal(response.status, 200, senderRoute);
    assert.equal(calls, 1, senderRoute);
    assert.equal(dispatched.route, 'host-selected-chat-generation', senderRoute);
    assert.equal(dispatched.body, body, senderRoute);
    assert.equal(dispatched.transport instanceof Function, true, senderRoute);
  }
});

test('protected transport remains dormant until Gateway invokes the capability', async () => {
  let calls = 0;
  let capability;
  const finalSend = createProtectedMemoryFinalSend({
    gateway: {
      dispatchProtectedRequest(request) {
        capability = request.transport;
        return { status: 'held' };
      },
    },
    resolveProtectedMemory: () => context,
    fetchImpl: async () => {
      calls += 1;
      return { status: 200 };
    },
  });
  const result = finalSend({
    senderRoute: 'google-ai-studio',
    endpointUrl: 'https://provider.example/generate',
    requestInit: init(),
    hostRequestContext: { trusted: true },
  });
  assert.deepEqual(result, { status: 'held' });
  assert.equal(calls, 0);
  await capability();
  assert.equal(calls, 1);
});

test('indeterminate trusted Memory classification fails closed instead of using direct fetch', () => {
  let calls = 0;
  const finalSend = createProtectedMemoryFinalSend({
    gateway: { dispatchProtectedRequest: () => { throw new Error('must not dispatch'); } },
    resolveProtectedMemory: () => undefined,
    fetchImpl: async () => { calls += 1; return { status: 200 }; },
  });
  assert.throws(() => finalSend({
    senderRoute: 'google-ai-studio',
    endpointUrl: 'https://provider.example/generate',
    requestInit: init(),
    hostRequestContext: {},
  }), /MEMORY_DISPATCH_NOT_READY/);
  assert.equal(calls, 0);
});

test('unknown protected sender route fails closed with zero egress', async () => {
  let calls = 0;
  const finalSend = createProtectedMemoryFinalSend({
    gateway: { dispatchProtectedRequest: () => { throw new Error('must not dispatch'); } },
    resolveProtectedMemory: () => context,
    fetchImpl: async () => { calls += 1; return { status: 200 }; },
  });
  assert.throws(() => finalSend({
    senderRoute: 'unregistered-provider',
    endpointUrl: 'https://provider.example/generate',
    requestInit: init(),
    hostRequestContext: { trusted: true },
  }), /MEMORY_DISPATCH_NOT_READY/);
  assert.equal(calls, 0);
});

test('stream forwarding is inside the transport promise so forwarding failure is ambiguous', async () => {
  let calls = 0;
  let captured;
  const finalSend = createProtectedMemoryFinalSend({
    gateway: {
      dispatchProtectedRequest(request) {
        captured = request;
        return Promise.resolve(request.transport()).then(async (upstream) => {
          if (request.stream) await request.forwardResponse(upstream);
          return upstream;
        });
      },
    },
    resolveProtectedMemory: () => context,
    fetchImpl: async () => {
      calls += 1;
      return { status: 200, body: 'stream' };
    },
  });
  await assert.rejects(finalSend({
    senderRoute: 'google-ai-studio',
    endpointUrl: 'https://provider.example/stream',
    requestInit: init(),
    hostRequestContext: { trusted: true },
    stream: true,
    forwardResponse: async () => { throw new Error('client disconnected during stream'); },
  }), /client disconnected during stream/);
  assert.equal(calls, 1);
  assert.equal(typeof captured.transport, 'function');
});

test('ordinary non-Memory generation keeps its direct provider path', async () => {
  let calls = 0;
  const finalSend = createProtectedMemoryFinalSend({
    gateway: { dispatchProtectedRequest: () => { throw new Error('Gateway must not be called'); } },
    resolveProtectedMemory: () => null,
    fetchImpl: async (url, request) => {
      calls += 1;
      return { status: 200, url, body: request.body };
    },
  });
  const result = await finalSend({
    senderRoute: 'google-ai-studio',
    endpointUrl: 'https://provider.example/generate',
    requestInit: init(),
    hostRequestContext: { trusted: true },
  });
  assert.equal(result.status, 200);
  assert.equal(calls, 1);
});

test('protected NPC content is serialized into the exact outbound request and Host locators are stripped', async () => {
  const protectedContext = {
    ...context,
    contentBlocks: [{
      epistemic_kind: 'acquired_report',
      evidence_assessment: 'supported',
      content: { 'attributes.public_note': 'The NPC was told the bridge is closed.' },
    }],
  };
  for (const [senderRoute, body, readPrompt] of [
    ['google-ai-studio', JSON.stringify({ model: 'gemini-test', messages: [{ role: 'system', content: 'system' }, { role: 'user', content: 'hello' }], logic_engine_conversation_uuid: 'untrusted' }), parsed => parsed.messages.map(message => message.content).join('\\n')],
    ['text-completions', JSON.stringify({ prompt: 'hello', logic_engine_request_id: 'untrusted' }), parsed => parsed.prompt],
    ['kobold', JSON.stringify({ prompt: 'hello', logic_engine_context_size: 9000 }), parsed => parsed.prompt],
    ['novelai-text', JSON.stringify({ input: 'hello', logic_engine_generation_type: 'untrusted' }), parsed => parsed.input],
    ['horde-text', JSON.stringify({ prompt: 'hello', params: { logic_engine_conversation_uuid: 'untrusted' } }), parsed => parsed.prompt],
  ]) {
    let dispatched;
    let outbound;
    const finalSend = createProtectedMemoryFinalSend({
      gateway: {
        dispatchProtectedRequest(request) {
          dispatched = request;
          return request.transport();
        },
      },
      resolveProtectedMemory: () => protectedContext,
      fetchImpl: async (_url, request) => {
        outbound = request.body;
        return { status: 200, body: request.body };
      },
    });
    await finalSend({
      senderRoute,
      endpointUrl: 'https://provider.example/generate',
      requestInit: init(body),
    });
    assert.equal(dispatched.body, outbound, senderRoute);
    const parsed = JSON.parse(outbound);
    assert.match(readPrompt(parsed), /Logic Engine NPC Memory Context/, senderRoute);
    assert.match(readPrompt(parsed), /bridge is closed/, senderRoute);
    assert.equal(JSON.stringify(parsed).includes('logic_engine_'), false, senderRoute);
    assert.equal(JSON.stringify(parsed).includes('memory_dispatch'), false, senderRoute);
  }
});

test('protected complete-empty context is not misrepresented as an admitted source set', async () => {
  let directCalls = 0;
  const finalSend = createProtectedMemoryFinalSend({
    gateway: { dispatchProtectedRequest: () => { throw new Error('empty context must not dispatch'); } },
    resolveProtectedMemory: () => null,
    fetchImpl: async () => { directCalls += 1; return { status: 200 }; },
  });
  await finalSend({
    senderRoute: 'google-ai-studio',
    endpointUrl: 'https://provider.example/generate',
    requestInit: init(),
  });
  assert.equal(directCalls, 1);
});

test('Core Lane A and Provider Lane B are projected separately with Lane A provenance preserved', async () => {
  let outbound;
  const laneAItem = {
    acquisition_id: 'acquisition-1',
    fact_id: 'fact-1',
    subject_ref: 'subject-1',
    predicate: 'knows_location',
    value: { place: 'north gate' },
    acquisition_kind: 'direct_observation',
    provenance_ref: 'provenance-1',
    provenance_digest: 'a'.repeat(64),
    acquisition_authorization_ref: 'acquisition-auth-1',
    source_event_ids: ['event-1'],
    visibility_authorization_ref: 'visibility-auth-1',
  };
  const protectedContext = {
    ...context,
    laneA: {
      lane: 'A',
      purpose: 'npc_turn_context',
      authorization_ref: 'read-auth-1',
      visibility_authorization_ref: 'visibility-read-auth-1',
      items: [laneAItem],
    },
    revalidateLaneAUnderCoordinatorLease: () => ({ status: 'ready' }),
    contentBlocks: [{
      epistemic_kind: 'acquired_report',
      evidence_assessment: 'supported',
      content: { note: 'A provider-backed report.' },
    }],
  };
  const finalSend = createProtectedMemoryFinalSend({
    gateway: {
      dispatchProtectedRequest(request) {
        return request.transport();
      },
    },
    resolveProtectedMemory: () => protectedContext,
    fetchImpl: async (_url, request) => {
      outbound = JSON.parse(request.body);
      return { status: 200 };
    },
  });
  await finalSend({
    senderRoute: 'google-ai-studio',
    endpointUrl: 'https://provider.example/generate',
    requestInit: init(JSON.stringify({
      messages: [{ role: 'user', content: 'continue' }],
    })),
    hostRequestContext: { trusted: true },
  });
  const prompt = outbound.messages.map(message => message.content).join('\\n');
  assert.match(prompt, /Logic Engine Core Knowledge — Lane A/);
  assert.match(prompt, /Logic Engine NPC Memory Context — Lane B/);
  assert.match(prompt, /north gate/);
  assert.match(prompt, /direct_observation/);
  assert.match(prompt, /provenance-1/);
  assert.match(prompt, /event-1/);
  assert.match(prompt, /A provider-backed report/);
  assert.doesNotMatch(prompt, /acquisition-auth-1/);
  assert.doesNotMatch(prompt, /visibility-auth-1/);
});

test('Lane A projection rejects accessors instead of invoking them', async () => {
  let calls = 0;
  const item = {
    acquisition_id: 'acquisition-1',
    fact_id: 'fact-1',
    subject_ref: 'subject-1',
    predicate: 'knows_location',
    value: 'north gate',
    acquisition_kind: 'direct_observation',
    provenance_ref: 'provenance-1',
    provenance_digest: 'a'.repeat(64),
    acquisition_authorization_ref: 'acquisition-auth-1',
    source_event_ids: ['event-1'],
    visibility_authorization_ref: 'visibility-auth-1',
  };
  Object.defineProperty(item, 'value', {
    enumerable: true,
    get() { calls += 1; throw new Error('must not execute'); },
  });
  const finalSend = createProtectedMemoryFinalSend({
    gateway: { dispatchProtectedRequest: () => { throw new Error('must not dispatch'); } },
    resolveProtectedMemory: () => ({
      ...context,
      laneA: { items: [item] },
      revalidateLaneAUnderCoordinatorLease: () => ({ status: 'ready' }),
      contentBlocks: [],
    }),
    fetchImpl: async () => { throw new Error('must not fetch'); },
  });
  assert.throws(() => finalSend({
    senderRoute: 'google-ai-studio',
    endpointUrl: 'https://provider.example/generate',
    requestInit: init(),
    hostRequestContext: { trusted: true },
  }), /PROTECTED_MEMORY_FINAL_SEND_LANE_A_INVALID/);
  assert.equal(calls, 0);
});
