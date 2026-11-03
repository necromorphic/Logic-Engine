import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProtectedMemoryFinalSend,
  PROTECTED_MEMORY_SENDER_ROUTES,
} from '../host-adapter/protected-memory-final-send.mjs';

const generationRequest = Object.freeze({
  request_id: 'host-request-1',
  generation_id: 'generation-1',
  generation_type: 'chat-completion',
});
const hostContext = Object.freeze({
  adapter_id: 'st-gateway',
  core_conversation_id: 'core-conversation-1',
  world_id: 'world-1',
  actor_id: 'npc-1',
  actor_type: 'npc',
  host_installation_id: 'installation-1',
  authenticated_account_id: 'account-1',
  host_session_id: 'session-1',
  host_conversation_id: 'host-conversation-1',
  conversation_uuid: 'conversation-uuid-1',
  root_id: 'a'.repeat(64),
  root_inventory_sequence: 1,
  root_manifest_sha256: 'b'.repeat(64),
});
const context = Object.freeze({
  requestId: generationRequest.request_id,
  model: 'google/gemini-test',
  worldId: 'world-1',
  actorId: 'npc-1',
  purpose: 'npc_decision',
  conversationId: hostContext.core_conversation_id,
  adapterId: hostContext.adapter_id,
  npcContextHandoff: Object.freeze(Object.create(null)),
  generationRequest,
  hostContext,
});
const ready = Object.freeze({ status: 'ready', context });

function hostRoute(senderRoute) {
  return ['text-completions', 'kobold', 'novelai-text', 'horde-text'].includes(senderRoute)
    ? senderRoute : 'chat-completions';
}

function init(senderRoute, body) {
  const route = hostRoute(senderRoute);
  const payload = route === 'chat-completions'
    ? { messages: [{ role: 'user', content: 'exact bytes' }] }
    : route === 'novelai-text'
      ? { input: 'exact bytes' }
      : { prompt: 'exact bytes' };
  return {
    method: 'POST',
    headers: { authorization: 'Bearer server-secret', 'content-type': 'application/json' },
    body: body ?? JSON.stringify(payload),
  };
}

test('all registered sender identities defer serialization and share the protected Gateway', async () => {
  for (const senderRoute of PROTECTED_MEMORY_SENDER_ROUTES) {
    let calls = 0;
    let dispatched;
    const gateway = {
      async dispatchProtectedRequest(request) {
        dispatched = request;
        const exactBody = request.prepareBody([]);
        return request.transport(exactBody);
      },
    };
    const finalSend = createProtectedMemoryFinalSend({
      gateway,
      resolveProtectedMemory: () => ready,
      fetchImpl: async (_url, request) => {
        calls += 1;
        return { status: 200, body: request.body };
      },
    });
    const response = await finalSend({
      senderRoute,
      hostRoute: hostRoute(senderRoute),
      endpointUrl: 'https://provider.example/v1/generate',
      requestInit: init(senderRoute),
      hostRequestContext: { trusted: true },
    });
    assert.equal(response.status, 200, senderRoute);
    assert.equal(calls, 1, senderRoute);
    assert.equal(dispatched.route, 'host-selected-chat-generation', senderRoute);
    assert.equal(typeof dispatched.prepareBody, 'function', senderRoute);
    assert.equal(typeof dispatched.transport, 'function', senderRoute);
    const sent = JSON.parse(response.body);
    if (hostRoute(senderRoute) === 'chat-completions') {
      assert.equal(sent.messages[0].role, 'system', senderRoute);
      assert.match(sent.messages[0].content, /Logic Engine NPC Memory Context/, senderRoute);
    } else if (hostRoute(senderRoute) === 'novelai-text') {
      assert.match(sent.input, /^Logic Engine NPC Memory Context/, senderRoute);
    } else {
      assert.match(sent.prompt, /^Logic Engine NPC Memory Context/, senderRoute);
    }
  }
});

test('protected transport remains dormant until Gateway supplies its post-consumption body', async () => {
  let calls = 0;
  let captured;
  const finalSend = createProtectedMemoryFinalSend({
    gateway: {
      dispatchProtectedRequest(request) {
        captured = request;
        return { status: 'held' };
      },
    },
    resolveProtectedMemory: () => ready,
    fetchImpl: async (_url, request) => {
      calls += 1;
      return { status: 200, body: request.body };
    },
  });
  const result = finalSend({
    senderRoute: 'google-ai-studio',
    hostRoute: 'chat-completions',
    endpointUrl: 'https://provider.example/generate',
    requestInit: init('google-ai-studio'),
    hostRequestContext: { trusted: true },
  });
  assert.deepEqual(result, { status: 'held' });
  assert.equal(calls, 0);
  const exactBody = captured.prepareBody([]);
  await captured.transport(exactBody);
  assert.equal(calls, 1);
});

test('only explicit unprotected classification permits native transport', async () => {
  let calls = 0;
  let gatewayCalls = 0;
  const finalSend = createProtectedMemoryFinalSend({
    gateway: { dispatchProtectedRequest: () => { gatewayCalls += 1; } },
    resolveProtectedMemory: () => Object.freeze({ status: 'unprotected' }),
    fetchImpl: async (_url, request) => {
      calls += 1;
      return { status: 200, body: request.body };
    },
  });
  const response = await finalSend({
    senderRoute: 'google-ai-studio',
    hostRoute: 'chat-completions',
    endpointUrl: 'https://provider.example/generate',
    requestInit: init('google-ai-studio'),
    hostRequestContext: { trusted: true },
  });
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.equal(gatewayCalls, 0);
});

test('missing or unknown classification fails closed with zero egress', () => {
  for (const resolveProtectedMemory of [() => undefined, () => null, () => ({ status: 'unknown' }), () => ({ status: 'non_ready' })]) {
    let calls = 0;
    const finalSend = createProtectedMemoryFinalSend({
      gateway: { dispatchProtectedRequest: () => { throw new Error('must not dispatch'); } },
      resolveProtectedMemory,
      fetchImpl: async () => { calls += 1; return { status: 200 }; },
    });
    assert.throws(() => finalSend({
      senderRoute: 'google-ai-studio',
      hostRoute: 'chat-completions',
      endpointUrl: 'https://provider.example/generate',
      requestInit: init('google-ai-studio'),
      hostRequestContext: { trusted: true },
    }), /MEMORY_DISPATCH_NOT_READY/);
    assert.equal(calls, 0);
  }
});

test('unknown protected sender route fails closed with zero egress', () => {
  let calls = 0;
  const finalSend = createProtectedMemoryFinalSend({
    gateway: { dispatchProtectedRequest: () => { throw new Error('must not dispatch'); } },
    resolveProtectedMemory: () => ready,
    fetchImpl: async () => { calls += 1; return { status: 200 }; },
  });
  assert.throws(() => finalSend({
    senderRoute: 'unregistered-provider',
    hostRoute: 'chat-completions',
    endpointUrl: 'https://provider.example/generate',
    requestInit: init('google-ai-studio'),
    hostRequestContext: { trusted: true },
  }), /MEMORY_DISPATCH_NOT_READY/);
  assert.equal(calls, 0);
});

test('stream forwarding is inside the Gateway-owned transport promise', async () => {
  let calls = 0;
  let forwarded = 0;
  const finalSend = createProtectedMemoryFinalSend({
    gateway: {
      async dispatchProtectedRequest(request) {
        const exactBody = request.prepareBody([]);
        const upstream = await request.transport(exactBody);
        await request.forwardResponse(upstream);
        return upstream;
      },
    },
    resolveProtectedMemory: () => ready,
    fetchImpl: async () => {
      calls += 1;
      return { status: 200, body: 'stream' };
    },
  });
  await finalSend({
    senderRoute: 'google-ai-studio',
    hostRoute: 'chat-completions',
    endpointUrl: 'https://provider.example/stream',
    requestInit: init('google-ai-studio'),
    hostRequestContext: { trusted: true },
    stream: true,
    forwardResponse: async () => { forwarded += 1; },
  });
  assert.equal(calls, 1);
  assert.equal(forwarded, 1);
});
