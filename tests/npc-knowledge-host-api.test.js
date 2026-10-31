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
const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:33333333-3333-4333-8333-333333333333';
const UNBOUND_CONVERSATION_ID = '11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:44444444-4444-4444-8444-444444444444';
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
    npcKnowledgeWriteAuthorizer: authorizers.writeAuthorizer,
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

async function bindHost(base, conversationId = CONVERSATION_ID, actorId = 'npc-canonical') {
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
    body: json({ adapter_id: 'adapter-a', entity_id: actorId }),
  });
  assert.equal(actor.status, 201);
}

test('Core NPC Host context route authenticates adapter and validates Host-selected actor while rejecting authority selectors', async (t) => {
  const { base, authorizers } = await setup(t);
  await bindHost(base);
  const path = base + '/v1/npc-knowledge/context';

  const unauthenticatedAdapter = await fetch(path, {
    method: 'POST', headers, body: json({ conversation_id: CONVERSATION_ID, actor_id: 'npc-canonical' }),
  });
  assert.equal(unauthenticatedAdapter.status, 403);
  assert.equal((await unauthenticatedAdapter.json()).error.code, 'ADAPTER_REQUIRED');

  const wrongAdapter = await fetch(path, {
    method: 'POST',
    headers: { ...headers, 'x-adapter-id': 'adapter-a', 'x-adapter-token': 'wrong-adapter-token-1234567890' },
    body: json({ conversation_id: CONVERSATION_ID }),
  });
  assert.equal(wrongAdapter.status, 403);

  const forgedScope = await fetch(path, {
    method: 'POST',
    headers: adapterHeaders,
    body: json({
      conversation_id: CONVERSATION_ID,
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
    body: json({ conversation_id: CONVERSATION_ID, actor_id: 'npc-canonical', limit: 20 }),
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

test('Core NPC Host context route filters every acquisition through per-acquisition visibility before disclosure', async (t) => {
  const { base, engine, authorizers } = await setup(t);
  await bindHost(base);
  const secretItem = Object.freeze({
    acquisition_id: 'acquisition-secret',
    fact_id: 'fact-secret',
    subject_ref: 'entity:npc-canonical',
    predicate: 'private_detail',
    value: 'must-not-leak',
    acquisition_kind: 'author_initial',
    provenance_ref: 'authoring:private',
    provenance_digest: 'a'.repeat(64),
    acquisition_authorization_ref: 'rule:private',
    source_event_ids: Object.freeze(['event-private']),
  });
  const originalRead = engine.readNpcKnowledge.bind(engine);
  engine.readNpcKnowledge = (input) => Object.freeze({
    ...originalRead(input),
    items: Object.freeze([secretItem]),
    truncated: false,
  });
  let visibilityCalls = 0;
  engine.npcKnowledgeVisibilityAuthorizer = (scope) => {
    visibilityCalls += 1;
    return Object.freeze({
      status: 'denied',
      world_id: scope.world_id,
      conversation_id: scope.conversation_id,
      adapter_id: scope.adapter_id,
      actor_id: scope.actor_id,
      recipient: scope.recipient,
      purpose: scope.purpose,
      world_revision: scope.world_revision,
      commit_sequence: scope.commit_sequence,
      acquisition_id: scope.acquisition_id,
      authorization_ref: 'core:deny',
      authority_id: scope.authority_id,
      generation: scope.generation,
      snapshot_fingerprint: scope.snapshot_fingerprint,
    });
  };

  const response = await fetch(base + '/v1/npc-knowledge/context', {
    method: 'POST',
    headers: adapterHeaders,
    body: json({ conversation_id: CONVERSATION_ID, actor_id: 'npc-canonical' }),
  });
  assert.equal(response.status, 200);
  const { context } = await response.json();
  assert.equal(visibilityCalls, 1);
  assert.deepEqual(context.items, []);
  assert.equal(JSON.stringify(context).includes('must-not-leak'), false);
  assert.deepEqual(context.policy_authority, authorizers.policyAuthority.getSnapshot());
});

test('Core NPC Host context route is disabled unless explicitly enabled by deployment', async (t) => {
  const { base } = await setup(t, false);
  const response = await fetch(base + '/v1/npc-knowledge/context', {
    method: 'POST',
    headers: adapterHeaders,
    body: json({ conversation_id: CONVERSATION_ID }),
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'NPC_KNOWLEDGE_HOST_API_DISABLED');
});

test('Core NPC Host context route denies unbound conversations and unbound actor selections', async (t) => {
  const { base } = await setup(t);
  const path = base + '/v1/npc-knowledge/context';
  const malformed = await fetch(path, {
    method: 'POST', headers: adapterHeaders, body: json({ conversation_id: 'not-bound', actor_id: 'npc-canonical' }),
  });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, 'INVALID_NPC_KNOWLEDGE_HOST_REQUEST');

  const unbound = await fetch(path, {
    method: 'POST', headers: adapterHeaders, body: json({ conversation_id: UNBOUND_CONVERSATION_ID, actor_id: 'npc-canonical' }),
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
  const selectedSecondActor = await fetch(path, {
    method: 'POST', headers: adapterHeaders,
    body: json({ conversation_id: CONVERSATION_ID, actor_id: 'npc-second' }),
  });
  assert.equal(selectedSecondActor.status, 200);
  assert.equal((await selectedSecondActor.json()).context.actor_id, 'npc-second');
  const forgedActor = await fetch(path, {
    method: 'POST', headers: adapterHeaders,
    body: json({ conversation_id: CONVERSATION_ID, actor_id: 'attacker-actor' }),
  });
  assert.equal(forgedActor.status, 403);
  assert.equal((await forgedActor.json()).error.code, 'HOST_CONVERSATION_NOT_AUTHORIZED');
});
