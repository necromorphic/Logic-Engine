import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { createHostBoundNpcKnowledgeAuthorizers } from '../src/application/npc-knowledge-authorization.js';
import { createApiServer } from '../src/api/server.js';

const TOKEN = 'test-token-long-enough-123456';
const ADMIN = 'admin-token-long-enough-123456';
const ADAPTER = 'adapter-a-token-long-enough-123456';
const headers = { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' };
const adapterHeaders = {
  ...headers,
  'x-adapter-id': 'adapter-a',
  'x-adapter-token': ADAPTER,
};
const json = (body) => JSON.stringify(body);

async function setup(t, enabled = true) {
  const store = new SQLiteStore(':memory:');
  const authorizers = createHostBoundNpcKnowledgeAuthorizers({
    store,
    adapterIds: ['adapter-a'],
    trustedInitialKnowledgeSources: [],
  });
  const engine = new LogicEngine(store, {
    npcKnowledgeContextResolver: authorizers.resolveContext,
    npcKnowledgePolicyAuthority: authorizers.policyAuthority,
    npcKnowledgeReadAuthorizer: authorizers.readAuthorizer,
    npcKnowledgeVisibilityAuthorizer: authorizers.visibilityAuthorizer,
  });
  engine.createWorld({
    world_id: 'host-api-world',
    world_pack_id: 'test.host-api',
    world_pack_version: '1.0.0',
    game_time: '2026-01-01T00:00:00Z',
  });
  engine.commitEvent('host-api-world', {
    idempotency_key: 'seed-host-api-actor',
    turn_id: 'seed-host-api-actor',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [{
      kind: 'entity.create',
      entity_id: 'npc-canonical',
      entity_type: 'character',
      attributes: { name: 'Canonical NPC' },
    }, {
      kind: 'entity.create',
      entity_id: 'npc-second',
      entity_type: 'character',
      attributes: { name: 'Second NPC' },
    }],
  });
  const server = createApiServer({
    engine,
    token: TOKEN,
    adminToken: ADMIN,
    adapterTokens: { 'adapter-a': ADAPTER },
    npcKnowledgeHostApiEnabled: enabled,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); store.close(); });
  return {
    base: 'http://127.0.0.1:' + server.address().port,
    store,
    engine,
    authorizers,
  };
}

async function bindHost(base, conversationId = 'st-conversation-test') {
  const host = await fetch(base + '/v1/host-conversation-bindings', {
    method: 'POST',
    headers: { ...headers, 'x-admin-token': ADMIN },
    body: json({
      adapter_id: 'adapter-a',
      conversation_id: conversationId,
      world_id: 'host-api-world',
    }),
  });
  assert.equal(host.status, 201);
  const actor = await fetch(base + '/v1/worlds/host-api-world/actor-bindings', {
    method: 'POST',
    headers: { ...headers, 'x-admin-token': ADMIN },
    body: json({ adapter_id: 'adapter-a', entity_id: 'npc-canonical' }),
  });
  assert.equal(actor.status, 201);
}

test('Core NPC Host context route derives adapter, world and actor and accepts no caller selectors', async (t) => {
  const { base, authorizers } = await setup(t);
  await bindHost(base);
  const path = base + '/v1/npc-knowledge/context';

  const unauthenticatedAdapter = await fetch(path, {
    method: 'POST', headers, body: json({ conversation_id: 'st-conversation-test' }),
  });
  assert.equal(unauthenticatedAdapter.status, 403);
  assert.equal((await unauthenticatedAdapter.json()).error.code, 'ADAPTER_REQUIRED');

  const wrongAdapter = await fetch(path, {
    method: 'POST',
    headers: { ...headers, 'x-adapter-id': 'adapter-a', 'x-adapter-token': 'wrong-adapter-token-1234567890' },
    body: json({ conversation_id: 'st-conversation-test' }),
  });
  assert.equal(wrongAdapter.status, 403);

  const forgedScope = await fetch(path, {
    method: 'POST',
    headers: adapterHeaders,
    body: json({
      conversation_id: 'st-conversation-test',
      world_id: 'attacker-world',
      actor_id: 'attacker-actor',
      adapter_id: 'adapter-b',
      purpose: 'npc_decision',
      recipient: 'memory_provider',
    }),
  });
  assert.equal(forgedScope.status, 400);
  assert.equal((await forgedScope.json()).error.code, 'INVALID_NPC_KNOWLEDGE_HOST_REQUEST');

  const response = await fetch(path, {
    method: 'POST',
    headers: adapterHeaders,
    body: json({ conversation_id: 'st-conversation-test', limit: 20 }),
  });
  assert.equal(response.status, 200);
  const { context } = await response.json();
  assert.equal(context.status, 'ready');
  assert.equal(context.world_id, 'host-api-world');
  assert.equal(context.actor_id, 'npc-canonical');
  assert.equal(context.recipient, 'model');
  assert.equal(context.purpose, 'npc_turn_context');
  assert.deepEqual(context.policy_authority, authorizers.policyAuthority.getSnapshot());
});

test('Core NPC Host context route is disabled unless explicitly enabled by deployment', async (t) => {
  const { base } = await setup(t, false);
  const response = await fetch(base + '/v1/npc-knowledge/context', {
    method: 'POST',
    headers: adapterHeaders,
    body: json({ conversation_id: 'st-conversation-test' }),
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'NPC_KNOWLEDGE_HOST_API_DISABLED');
});

test('Core NPC Host context route denies an unbound conversation or ambiguous actor scope', async (t) => {
  const { base } = await setup(t);
  const path = base + '/v1/npc-knowledge/context';
  const unbound = await fetch(path, {
    method: 'POST', headers: adapterHeaders, body: json({ conversation_id: 'not-bound' }),
  });
  assert.equal(unbound.status, 403);
  assert.equal((await unbound.json()).error.code, 'HOST_CONVERSATION_NOT_AUTHORIZED');

  await bindHost(base);
  const secondActor = await fetch(base + '/v1/worlds/host-api-world/actor-bindings', {
    method: 'POST',
    headers: { ...headers, 'x-admin-token': ADMIN },
    body: json({ adapter_id: 'adapter-a', entity_id: 'npc-second' }),
  });
  assert.equal(secondActor.status, 201);
  const ambiguous = await fetch(path, {
    method: 'POST', headers: adapterHeaders, body: json({ conversation_id: 'st-conversation-test' }),
  });
  assert.equal(ambiguous.status, 403);
  assert.equal((await ambiguous.json()).error.code, 'HOST_CONVERSATION_NOT_AUTHORIZED');
});
