import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { createApiServer } from '../src/api/server.js';
import { createHostBoundNpcKnowledgeAuthorizers } from '../src/application/npc-knowledge-authorization.js';

const TOKEN = 'host-npc-api-token-long-enough';
const ADMIN = 'host-npc-admin-token-long-enough';
const ADAPTER = 'host-npc-adapter-token-long-enough';
const adapterTokens = { 'adapter-st': ADAPTER };
const sourceBytes = JSON.stringify({
  schema_version: 1,
  world_pack_id: 'host-auth.world',
  world_pack_version: '1.0.0',
  source_kind: 'author_initial',
  source_ref: 'authoring:host-auth.world@1.0.0',
  authorization_ref: 'rule:host-auth-initial-v1',
  assignments: [{ subject_id: 'npc-a', fact_id: 'fact-a' }],
});
const trustedSources = [{
  world_pack_id: 'host-auth.world',
  world_pack_version: '1.0.0',
  source_kind: 'author_initial',
  source_ref: 'authoring:host-auth.world@1.0.0',
  authorization_ref: 'rule:host-auth-initial-v1',
  sha256: createHash('sha256').update(sourceBytes).digest('hex'),
}];
const json = value => JSON.stringify(value);
const hostHeaders = {
  authorization: 'Bearer ' + TOKEN,
  'content-type': 'application/json',
  'x-adapter-id': 'adapter-st',
  'x-adapter-token': ADAPTER,
};
const adminHeaders = {
  authorization: 'Bearer ' + TOKEN,
  'content-type': 'application/json',
  'x-admin-token': ADMIN,
};

async function setup(t, registry = trustedSources) {
  const store = new SQLiteStore(':memory:');
  const authorizers = createHostBoundNpcKnowledgeAuthorizers({
    store,
    adapterIds: Object.keys(adapterTokens),
    trustedInitialKnowledgeSources: registry,
  });
  const engine = new LogicEngine(store, {
    trustedInitialKnowledgeSources: registry,
    npcKnowledgeReadAuthorizer: authorizers.readAuthorizer,
    npcKnowledgeVisibilityAuthorizer: authorizers.visibilityAuthorizer,
    npcKnowledgeHostIdentityResolver: authorizers.resolveHostIdentity,
  });
  engine.createWorld({
    world_id: 'world-a',
    world_pack_id: 'host-auth.world',
    world_pack_version: '1.0.0',
    game_time: '2026-01-01T00:00:00Z',
  });
  engine.commitEvent('world-a', {
    event_id: 'host-auth-seed',
    idempotency_key: 'host-auth-seed',
    turn_id: 'host-auth-seed',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [
      { kind: 'entity.create', entity_id: 'npc-a', entity_type: 'character' },
      { kind: 'entity.create', entity_id: 'npc-b', entity_type: 'character' },
      { kind: 'fact.set', fact_id: 'fact-a', subject_ref: 'entity:npc-a', predicate: 'secret', value: 'bound-value' },
    ],
  });
  if (registry.length > 0) {
    engine.recordTrustedInitialKnowledgeSource({
      world_id: 'world-a',
      source_bytes: sourceBytes,
      idempotency_key: 'host-auth-acquisition',
      expected_revision: 1,
      expected_commit_sequence: 1,
    });
  }

  const server = createApiServer({
    engine,
    token: TOKEN,
    adminToken: ADMIN,
    adapterTokens,
    npcKnowledgeAuthorizers: authorizers,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); store.close(); });
  const base = 'http://127.0.0.1:' + server.address().port;

  const actor = await fetch(base + '/v1/worlds/world-a/actor-bindings', {
    method: 'POST',
    headers: adminHeaders,
    body: json({ adapter_id: 'adapter-st', entity_id: 'npc-a' }),
  });
  assert.equal(actor.status, 201);

  const conversation = await fetch(base + '/v1/host-conversation-bindings', {
    method: 'POST',
    headers: adminHeaders,
    body: json({
      adapter_id: 'adapter-st',
      conversation_id: 'conversation-a',
      world_id: 'world-a',
    }),
  });
  assert.equal(conversation.status, 201);
  return { base, store, engine, authorizers };
}

async function read(base, body = { conversation_id: 'conversation-a' }, headers = hostHeaders) {
  return fetch(base + '/v1/host/npc-knowledge/read', {
    method: 'POST', headers, body: json(body),
  });
}

function propositionRef(item) {
  return 'proposition:' + encodeURIComponent(item.subject_ref) + '/' + encodeURIComponent(item.predicate);
}

test('Host API derives world and actor only from authenticated Host and Core-owned bindings', async t => {
  const { base } = await setup(t);
  const response = await read(base);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.read.world_id, 'world-a');
  assert.equal(body.read.actor_id, 'npc-a');
  assert.equal(body.read.adapter_id, 'adapter-st');
  assert.equal(body.read.items.length, 1);
  assert.equal(body.read.items[0].value, 'bound-value');

  const injected = await read(base, {
    conversation_id: 'conversation-a',
    world_id: 'attacker-world',
    actor_id: 'attacker-actor',
  });
  assert.equal(injected.status, 400);
  assert.equal((await injected.json()).error.code, 'INVALID_NPC_HOST_READ');

  const noAdapter = await read(base, { conversation_id: 'conversation-a' }, {
    authorization: hostHeaders.authorization,
    'content-type': 'application/json',
  });
  assert.equal(noAdapter.status, 403);
  assert.equal((await noAdapter.json()).error.code, 'ADAPTER_REQUIRED');

  const unbound = await read(base, { conversation_id: 'unbound-conversation' });
  assert.equal(unbound.status, 404);
  assert.equal((await unbound.json()).error.code, 'READ_NOT_AVAILABLE');
});

test('Host belief mutation is separately validated and cannot select world or actor', async t => {
  const { base, store } = await setup(t);
  const readResponse = await read(base);
  const readBody = await readResponse.json();
  const item = readBody.read.items[0];
  const request = {
    conversation_id: 'conversation-a',
    expected_revision: readBody.read.snapshot.world_revision,
    expected_commit_sequence: readBody.read.snapshot.commit_sequence,
    proposition_ref: propositionRef(item),
    proposition_value: item.value,
    stance: 'believes_true',
    supporting_acquisition_ids: [item.acquisition_id],
    contradicting_acquisition_ids: [],
    reason_rule_ref: 'rule:host-belief-v1',
    idempotency_key: 'host-belief-transition-1',
  };
  const committed = await fetch(base + '/v1/host/npc-belief-transitions', {
    method: 'POST', headers: hostHeaders, body: json(request),
  });
  assert.equal(committed.status, 201);
  const committedBody = await committed.json();
  assert.equal(committedBody.transition.status, 'ready');
  assert.equal(committedBody.transition.transition.stance, 'believes_true');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM npc_belief_transitions').get().count, 1);

  const injected = await fetch(base + '/v1/host/npc-belief-transitions', {
    method: 'POST', headers: hostHeaders,
    body: json({ ...request, idempotency_key: 'host-belief-transition-injected', world_id: 'attacker-world', actor_id: 'attacker-actor' }),
  });
  assert.equal(injected.status, 400);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM npc_belief_transitions').get().count, 1);

  const state = await fetch(base + '/v1/host/npc-belief-state', {
    method: 'POST',
    headers: hostHeaders,
    body: json({
      conversation_id: 'conversation-a',
      expected_revision: committedBody.transition.transition.committed_revision,
      expected_commit_sequence: store.currentCommitSequence('world-a'),
      proposition_ref: request.proposition_ref,
    }),
  });
  assert.equal(state.status, 200);
  assert.equal((await state.json()).state.stance, 'believes_true');

  // The Host adapter credential is not a general world-mutation capability.
  const directCommit = await fetch(base + '/v1/worlds/world-a/events', {
    method: 'POST',
    headers: hostHeaders,
    body: json({
      event_id: 'host-must-not-direct-commit',
      idempotency_key: 'host-must-not-direct-commit',
      turn_id: 'host-must-not-direct-commit',
      event_type: 'action.completed',
      expected_revision: store.world('world-a').world_revision,
      effects: [{ kind: 'entity.update', entity_id: 'npc-a', attributes: { compromised: true } }],
    }),
  });
  assert.equal(directCommit.status, 403);
  assert.equal(store.db.prepare("SELECT attributes_json FROM entities WHERE world_id='world-a' AND entity_id='npc-a'").get().attributes_json.includes('compromised'), false);
});

test('Core binding revocation immediately disables Host read and belief mutation; revocation is admin-only', async t => {
  const { base, store } = await setup(t);
  const first = await read(base);
  assert.equal(first.status, 200);

  const deniedRevoke = await fetch(base + '/v1/worlds/world-a/actor-bindings/adapter-st/npc-a', {
    method: 'DELETE', headers: hostHeaders,
  });
  assert.equal(deniedRevoke.status, 403);

  const revoked = await fetch(base + '/v1/worlds/world-a/actor-bindings/adapter-st/npc-a', {
    method: 'DELETE', headers: adminHeaders,
  });
  assert.equal(revoked.status, 200);

  const after = await read(base);
  assert.equal(after.status, 404);
  assert.equal((await after.json()).error.code, 'READ_NOT_AVAILABLE');

  const mutation = await fetch(base + '/v1/host/npc-belief-transitions', {
    method: 'POST', headers: hostHeaders,
    body: json({
      conversation_id: 'conversation-a',
      expected_revision: store.world('world-a').world_revision,
      expected_commit_sequence: store.currentCommitSequence('world-a'),
      proposition_ref: 'proposition:fact/fact-a',
      proposition_value: 'bound-value',
      stance: 'believes_true',
      supporting_acquisition_ids: ['not-authorized-after-revoke'],
      contradicting_acquisition_ids: [],
      reason_rule_ref: 'rule:host-belief-v1',
      idempotency_key: 'host-transition-after-revoke',
    }),
  });
  assert.equal(mutation.status, 404);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM npc_belief_transitions').get().count, 0);
});

test('missing trusted source keeps read visibility empty and prevents belief-state mutation', async t => {
  const { base, store } = await setup(t, []);
  const response = await read(base);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.read.items.length, 0);
  assert.equal(Object.hasOwn(body.read, 'withheld_proposition_refs'), false);
  assert.equal(JSON.stringify(body.read).includes('fact-a'), false);

  const mutation = await fetch(base + '/v1/host/npc-belief-transitions', {
    method: 'POST',
    headers: hostHeaders,
    body: json({
      conversation_id: 'conversation-a',
      expected_revision: body.read.snapshot.world_revision,
      expected_commit_sequence: body.read.snapshot.commit_sequence,
      proposition_ref: 'proposition:entity%3Anpc-a/secret',
      proposition_value: 'caller-forged-value',
      stance: 'believes_true',
      supporting_acquisition_ids: ['caller-forged-acquisition'],
      contradicting_acquisition_ids: [],
      reason_rule_ref: 'rule:host-belief-v1',
      idempotency_key: 'host-transition-without-trusted-source',
    }),
  });
  assert.notEqual(mutation.status, 201);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM npc_belief_transitions').get().count, 0);
});


test('ambiguous actor bindings and revoked Host conversation bindings deny rather than selecting a caller actor', async t => {
  const { base } = await setup(t);
  const secondActor = await fetch(base + '/v1/worlds/world-a/actor-bindings', {
    method: 'POST',
    headers: adminHeaders,
    body: json({ adapter_id: 'adapter-st', entity_id: 'npc-b' }),
  });
  assert.equal(secondActor.status, 201);
  const ambiguous = await read(base);
  assert.equal(ambiguous.status, 404);
  assert.equal((await ambiguous.json()).error.code, 'READ_NOT_AVAILABLE');

  const revokeSecond = await fetch(base + '/v1/worlds/world-a/actor-bindings/adapter-st/npc-b', {
    method: 'DELETE', headers: adminHeaders,
  });
  assert.equal(revokeSecond.status, 200);
  assert.equal((await read(base)).status, 200);

  const deniedRevoke = await fetch(base + '/v1/host-conversation-bindings/adapter-st/conversation-a', {
    method: 'DELETE', headers: hostHeaders, body: json({ reason: 'unauthorized revoke' }),
  });
  assert.equal(deniedRevoke.status, 403);

  const revokedConversation = await fetch(base + '/v1/host-conversation-bindings/adapter-st/conversation-a', {
    method: 'DELETE', headers: adminHeaders, body: json({ reason: 'Host session retired' }),
  });
  assert.equal(revokedConversation.status, 200);

  const afterRevoke = await read(base);
  assert.equal(afterRevoke.status, 404);
  assert.equal((await afterRevoke.json()).error.code, 'READ_NOT_AVAILABLE');
});


test('opaque Host identity cannot be forged and expires when its Core actor binding is revoked', async t => {
  const { base, engine, authorizers } = await setup(t);
  const identity = authorizers.createHostIdentity({
    adapter_id: 'adapter-st',
    conversation_id: 'conversation-a',
  });
  assert.ok(identity);
  assert.deepEqual(authorizers.resolveHostIdentity(identity), {
    world_id: 'world-a',
    conversation_id: 'conversation-a',
    adapter_id: 'adapter-st',
    actor_id: 'npc-a',
  });
  const forged = Object.freeze(Object.create(null));
  assert.equal(authorizers.resolveHostIdentity(forged), null);
  assert.throws(() => engine.readVisibleNpcKnowledgeForHost(forged), {
    code: 'NPC_HOST_IDENTITY_NOT_AUTHORIZED',
  });

  const revoked = await fetch(base + '/v1/worlds/world-a/actor-bindings/adapter-st/npc-a', {
    method: 'DELETE', headers: adminHeaders,
  });
  assert.equal(revoked.status, 200);
  assert.equal(authorizers.resolveHostIdentity(identity), null);
  assert.throws(() => engine.readVisibleNpcKnowledgeForHost(identity), {
    code: 'NPC_HOST_IDENTITY_NOT_AUTHORIZED',
  });
});


test('Host-facing knowledge read fails closed when the bounded acquisition query is truncated', async t => {
  const { engine, authorizers } = await setup(t);
  const identity = authorizers.createHostIdentity({
    adapter_id: 'adapter-st',
    conversation_id: 'conversation-a',
  });
  engine.readNpcKnowledge = () => ({ truncated: true });
  assert.throws(() => engine.readVisibleNpcKnowledgeForHost(identity, { limit: 1 }), {
    code: 'NPC_KNOWLEDGE_READ_INCOMPLETE',
  });
});
