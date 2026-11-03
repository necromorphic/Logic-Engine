import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createHostMemoryDispatchProxyHandler } from '../server-plugin/st-server-digest-proxy.mjs';

const installation = '11111111-1111-4111-8111-111111111111';
const account = '22222222-2222-4222-8222-222222222222';
const session = '33333333-3333-4333-8333-333333333333';
const conversation = '44444444-4444-4444-8444-444444444444';
const requestId = '55555555-5555-4555-8555-555555555555';
const conversationId = session + ':' + installation + ':' + conversation;
const hostConversationKey = installation + ':' + account + ':' + conversation;
const worldId = 'world-main';
const actorId = 'actor-player';
const env = {
  LOGIC_ENGINE_CORE_URL: 'http://127.0.0.1:8787',
  LOGIC_ENGINE_API_TOKEN: 'core-api-token-long-enough',
  LOGIC_ENGINE_ADAPTER_ID: 'st-gateway',
  LOGIC_ENGINE_ADAPTER_TOKEN: 'adapter-token-long-enough',
};

function recorder() {
  return {
    statusCode: null, payload: null,
    set() { return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    sendStatus(code) { this.statusCode = code; return this; },
  };
}

function request() {
  return { body: { request_id: requestId, conversation_uuid: conversation, context_size: 8192, generation_type: 'normal' } };
}

test('Host Adapter resolves world and exactly one actor before signing the Host assertion', async () => {
  const calls = [];
  const handler = createHostMemoryDispatchProxyHandler({
    env,
    resolveHostContext: () => ({
      host_installation_id: installation,
      authenticated_account_id: account,
      host_session_id: session,
      conversation_id: hostConversationKey,
    }),
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (calls.length === 1) {
        return {
          ok: true, status: 200,
          json: async () => ({ context: {
            adapter_id: 'st-gateway', conversation_id: conversationId,
            world_id: worldId, actor_id: actorId, actor_type: 'player',
          } }),
        };
      }
      return { ok: false, status: 404, json: async () => ({ error: { code: 'NOT_FOUND' } }) };
    },
  });
  const response = recorder();
  await handler(request(), response);

  assert.equal(response.statusCode, 503);
  assert.equal(response.payload.code, 'CORE_HOST_DISPATCH_ROUTE_UNAVAILABLE');
  assert.match(calls[0].url, /\/v1\/host-context\/resolve$/);
  assert.match(calls[1].url, /\/v1\/host\/memory-npc\/retrieve$/);
  const resolveBody = JSON.parse(calls[0].options.body);
  assert.deepEqual(resolveBody, {
    conversation_id: conversationId,
    host_session_id: session,
    host_installation_id: installation,
    conversation_uuid: conversation,
  });
  assert.equal(calls[0].options.headers['x-adapter-id'], 'st-gateway');
  assert.equal(calls[0].options.headers['x-adapter-token'], env.LOGIC_ENGINE_ADAPTER_TOKEN);

  const body = JSON.parse(calls[1].options.body);
  assert.deepEqual(Object.keys(body).sort(), ['assertion', 'context_size', 'generation_type', 'request_id', 'signature']);
  assert.equal(body.assertion.host_installation_id, installation);
  assert.equal(body.assertion.authenticated_account_id, account);
  assert.equal(body.assertion.host_session_id, session);
  assert.equal(body.assertion.conversation_id, conversationId);
  assert.equal(body.assertion.world_id, worldId);
  assert.equal(body.assertion.actor_id, actorId);
  assert.equal('world_id' in resolveBody, false);
  assert.equal('actor_id' in resolveBody, false);
  assert.equal('chat' in body, false);

  const assertion = body.assertion;
  const canonical = JSON.stringify([
    assertion.protocol_version, assertion.host_installation_id, assertion.authenticated_account_id,
    assertion.host_session_id, assertion.conversation_id, assertion.world_id, assertion.actor_id,
    assertion.issued_at, assertion.nonce,
  ]);
  const expected = createHmac('sha256', env.LOGIC_ENGINE_ADAPTER_TOKEN).update(canonical, 'utf8').digest('hex');
  assert.equal(body.signature, expected);
});

test('Host Adapter accepts only a Core-received NPC context projection bound to the exact request and Host scope', async () => {
  const calls = [];
  const snapshot = { world_revision: 7, commit_sequence: 11 };
  const candidate = {
    record_ref: 'memory:record-1',
    record_version: 'v1',
    authorization_generation: 2,
    source_entity_id: 'source-1',
    epistemic_kind: 'acquired_report',
    evidence_assessment: 'supported',
    content: { claim: 'trusted provider content' },
  };
  const retrieval = {
    status: 'ready',
    admitted: [{ record_ref: candidate.record_ref, record_version: candidate.record_version }],
    candidates: [candidate],
    reason: null,
    snapshot,
  };
  const payload = {
    retrieval,
    npc_context: {
      schema: 'npc-generation-context-projection/v1',
      request_id: requestId,
      generation_id: requestId,
      generation_type: 'normal',
      world_id: worldId,
      actor_id: actorId,
      conversation_id: conversationId,
      adapter_id: 'st-gateway',
      recipient: 'model',
      purpose: 'npc_turn_context',
      snapshot,
      lanes: {
        lane_a: {
          lane: 'A',
          purpose: 'npc_turn_context',
          authorization_ref: 'core:read-auth-1',
          visibility_authorization_ref: 'core:visibility-auth-1',
          items: [],
        },
        lane_b: {
          lane: 'B',
          core_purpose: 'npc_turn_context',
          provider_purpose: 'npc_decision',
          status: 'ready',
          admitted: retrieval.admitted,
          candidates: retrieval.candidates,
          reason: null,
          snapshot,
        },
      },
    },
  };
  const handler = createHostMemoryDispatchProxyHandler({
    env,
    resolveHostContext: () => ({
      host_installation_id: installation,
      authenticated_account_id: account,
      host_session_id: session,
      conversation_id: hostConversationKey,
    }),
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (calls.length === 1) {
        return { ok: true, status: 200, json: async () => ({ context: {
          adapter_id: 'st-gateway', conversation_id: conversationId,
          world_id: worldId, actor_id: actorId, actor_type: 'player',
        } }) };
      }
      return { ok: true, status: 200, json: async () => payload };
    },
  });
  const response = recorder();
  await handler(request(), response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.npc_context.schema, 'npc-generation-context-projection/v1');
  assert.equal(response.payload.npc_context.conversation_id, conversationId);
  assert.equal(response.payload.npc_context.lanes.lane_b.candidates[0].content.claim, 'trusted provider content');
  assert.equal(calls.length, 2);
});

test('Host Adapter rejects a Core NPC context projection bound to another request', async () => {
  const handler = createHostMemoryDispatchProxyHandler({
    env,
    resolveHostContext: () => ({
      host_installation_id: installation,
      authenticated_account_id: account,
      host_session_id: session,
      conversation_id: hostConversationKey,
    }),
    fetchImpl: async (_url, _options) => {
      if (!_options.body.includes('assertion')) {
        return { ok: true, status: 200, json: async () => ({ context: {
          adapter_id: 'st-gateway', conversation_id: conversationId,
          world_id: worldId, actor_id: actorId, actor_type: 'player',
        } }) };
      }
      return { ok: true, status: 200, json: async () => ({
        retrieval: { status: 'ready', admitted: [], candidates: [], reason: null, snapshot: { world_revision: 1, commit_sequence: 1 } },
        npc_context: {
          schema: 'npc-generation-context-projection/v1',
          request_id: '66666666-6666-4666-8666-666666666666',
          generation_id: '66666666-6666-4666-8666-666666666666',
          generation_type: 'normal',
          world_id: worldId, actor_id: actorId, conversation_id: conversationId,
          adapter_id: 'st-gateway', recipient: 'model', purpose: 'npc_turn_context',
          snapshot: { world_revision: 1, commit_sequence: 1 },
          lanes: {
            lane_a: { lane: 'A', purpose: 'npc_turn_context', authorization_ref: 'a', visibility_authorization_ref: 'b', items: [] },
            lane_b: { lane: 'B', core_purpose: 'npc_turn_context', provider_purpose: 'npc_decision', status: 'ready', admitted: [], candidates: [], reason: null, snapshot: { world_revision: 1, commit_sequence: 1 } },
          },
        },
      }) };
    },
  });
  const response = recorder();
  await handler(request(), response);
  assert.equal(response.statusCode, 503);
  assert.equal(response.payload.code, 'NPC_GENERATION_CONTEXT_UNAVAILABLE');
});

test('Host Adapter fails closed when Core cannot resolve one unambiguous world/actor binding', async () => {
  let calls = 0;
  const handler = createHostMemoryDispatchProxyHandler({
    env,
    resolveHostContext: () => ({
      host_installation_id: installation,
      authenticated_account_id: account,
      host_session_id: session,
      conversation_id: hostConversationKey,
    }),
    fetchImpl: async () => {
      calls++;
      return { ok: false, status: 403, json: async () => ({ error: { code: 'ACTOR_BINDING_AMBIGUOUS' } }) };
    },
  });
  const response = recorder();
  await handler(request(), response);
  assert.equal(response.statusCode, 503);
  assert.equal(response.payload.code, 'HOST_WORLD_ACTOR_BINDING_UNAVAILABLE');
  assert.equal(calls, 1);
});

test('Host Adapter rejects a Core binding response for another adapter or conversation', async () => {
  let calls = 0;
  const handler = createHostMemoryDispatchProxyHandler({
    env,
    resolveHostContext: () => ({
      host_installation_id: installation,
      authenticated_account_id: account,
      host_session_id: session,
      conversation_id: hostConversationKey,
    }),
    fetchImpl: async () => {
      calls++;
      return {
        ok: true, status: 200,
        json: async () => ({ context: {
          adapter_id: 'other-adapter', conversation_id: conversationId,
          world_id: worldId, actor_id: actorId, actor_type: 'player',
        } }),
      };
    },
  });
  const response = recorder();
  await handler(request(), response);
  assert.equal(response.statusCode, 503);
  assert.equal(response.payload.code, 'HOST_WORLD_ACTOR_BINDING_UNAVAILABLE');
  assert.equal(calls, 1);
});

test('Host dispatch HTTP boundary rejects uppercase generation_type', async () => {
  let upstreamCalls = 0;
  const handler = createHostMemoryDispatchProxyHandler({
    env,
    resolveHostContext: () => ({
      host_installation_id: installation,
      authenticated_account_id: account,
      host_session_id: session,
      conversation_id: hostConversationKey,
    }),
    fetchImpl: async () => {
      upstreamCalls += 1;
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });
  const invalid = request();
  invalid.body.generation_type = 'NORMAL';
  const response = recorder();
  await handler(invalid, response);
  assert.equal(response.statusCode, 400);
  assert.equal(response.payload.code, 'HOST_DISPATCH_REQUEST_INVALID');
  assert.equal(upstreamCalls, 0);
});
