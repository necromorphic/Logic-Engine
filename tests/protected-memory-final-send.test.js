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
