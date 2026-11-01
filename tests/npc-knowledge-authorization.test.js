import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { ActorBindingService } from '../src/application/actor-bindings.js';
import { HostConversationWorldBindingService } from '../src/application/host-conversation-world-bindings.js';
import { createHostBoundNpcKnowledgeAuthorizers } from '../src/application/npc-knowledge-authorization.js';
import { createAuthenticatedHostSessionContext } from '../src/application/host-session-context.js';

const sourceBytes = Buffer.from('approved deployment-owned source');
const source = {
  world_pack_id: 'test.world',
  world_pack_version: '1.0.0',
  source_kind: 'author_initial',
  source_ref: 'authoring:test.world@1.0.0',
  authorization_ref: 'rule:author-initial-v1',
  sha256: createHash('sha256').update(sourceBytes).digest('hex'),
};
const HOST_SESSION_ID = '11111111-1111-4111-8111-111111111111';
const HOST_CONVERSATION_ID = HOST_SESSION_ID + ':22222222-2222-4222-8222-222222222222:33333333-3333-4333-8333-333333333333';
const OTHER_SESSION_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_SESSION_CONVERSATION = OTHER_SESSION_ID + ':55555555-5555-4555-8555-555555555555:66666666-6666-4666-8666-666666666666';
const hostRequest = {
  user: { profile: { handle: 'alice' } },
  session: { handle: 'alice', logicEngineSessionId: HOST_SESSION_ID, logicEngineSessionHandle: 'alice' },
};

const importedSource = {
  ...source,
  source_kind: 'imported',
  authorization_ref: 'rule:imported-v1',
};

function setup(t) {
  const store = new SQLiteStore(':memory:');
  t.after(() => store.close());
  const engine = new LogicEngine(store);
  engine.createWorld({
    world_id: 'world-a',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2026-01-01T00:00:00Z',
  });
  engine.commitEvent('world-a', {
    event_id: 'create-npc',
    idempotency_key: 'create-npc',
    turn_id: 'create-npc',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [{ kind: 'entity.create', entity_id: 'npc-a', entity_type: 'character' }],
  });
  const actors = new ActorBindingService(engine);
  const conversations = new HostConversationWorldBindingService(engine);
  conversations.bind({
    adapterId: 'adapter-st',
    conversationId: HOST_CONVERSATION_ID,
    worldId: 'world-a',
  });
  conversations.bind({
    adapterId: 'adapter-st',
    conversationId: OTHER_SESSION_CONVERSATION,
    worldId: 'world-a',
  });
  actors.bind('world-a', 'adapter-st', 'npc-a');
  const authorizers = createHostBoundNpcKnowledgeAuthorizers({
    store,
    adapterIds: ['adapter-st'],
    trustedInitialKnowledgeSources: [source, importedSource],
  });
  const snapshot = engine.getSnapshot('world-a');
  const scope = {
    world_id: 'world-a',
    conversation_id: HOST_CONVERSATION_ID,
    adapter_id: 'adapter-st',
    actor_id: 'npc-a',
    recipient: 'model',
    purpose: 'npc_turn_context',
    world_revision: snapshot.world_revision,
    commit_sequence: snapshot.commit_sequence,
  };
  const hostSessionContext = createAuthenticatedHostSessionContext(hostRequest, HOST_CONVERSATION_ID);
  return { store, engine, actors, conversations, authorizers, scope, hostSessionContext };
}

test('production NPC query authorization requires a branded authenticated Host session and active bindings', (t) => {
  const { authorizers, scope, hostSessionContext } = setup(t);
  assert.deepEqual(authorizers.readAuthorizer(scope), {
    status: 'authorized',
    ...scope,
    authorization_ref: 'core:host-conversation-actor-binding-v1',
  });
  assert.equal(authorizers.readAuthorizer({ ...scope, conversation_id: 'other-session:installation:conversation' }), null);
  assert.equal(authorizers.readAuthorizer({ ...scope, adapter_id: 'unconfigured-adapter' }), null);
  assert.equal(authorizers.readAuthorizer({ ...scope, actor_id: 'other-actor' }), null);

  assert.equal(authorizers.memoryQueryAuthorizer(scope, hostSessionContext), true);
  assert.equal(authorizers.memoryQueryAuthorizer(scope), false);
  const otherConversation = HOST_SESSION_ID + ':22222222-2222-4222-8222-222222222222:44444444-4444-4444-8444-444444444444';
  const contextForOtherConversation = createAuthenticatedHostSessionContext(hostRequest, otherConversation);
  assert.equal(authorizers.memoryQueryAuthorizer(scope, contextForOtherConversation), false);
  const otherSessionId = OTHER_SESSION_ID;
  const otherSessionConversation = OTHER_SESSION_CONVERSATION;
  const otherSessionRequest = {
    user: { profile: { handle: 'bob' } },
    session: { handle: 'bob', logicEngineSessionId: otherSessionId, logicEngineSessionHandle: 'bob' },
  };
  const otherSessionContext = createAuthenticatedHostSessionContext(otherSessionRequest, otherSessionConversation);
  assert.notEqual(otherSessionContext, null);
  assert.equal(authorizers.memoryQueryAuthorizer({
    ...scope, conversation_id: otherSessionConversation,
  }, otherSessionContext), true);
  assert.equal(authorizers.memoryQueryAuthorizer({
    ...scope, conversation_id: otherSessionConversation,
  }, hostSessionContext), false);
  assert.equal(createAuthenticatedHostSessionContext(otherSessionRequest, HOST_CONVERSATION_ID), null);
  assert.equal(authorizers.memoryQueryAuthorizer({
    ...scope, conversation_id: '44444444-4444-4444-8444-444444444444:22222222-2222-4222-8222-222222222222:33333333-3333-4333-8333-333333333333',
  }, hostSessionContext), false);
  assert.equal(authorizers.memoryQueryAuthorizer({
    ...scope, adapter_id: 'unconfigured-adapter',
  }, hostSessionContext), false);
  assert.equal(authorizers.memoryQueryAuthorizer({
    ...scope, purpose: 'npc_decision',
  }, hostSessionContext), false);
  assert.equal(authorizers.memoryQueryAuthorizer({
    ...scope, recipient: 'player',
  }, hostSessionContext), false);
});
test('per-acquisition visibility requires exact trusted source provenance and the same live Host/actor bindings', (t) => {
  const { authorizers, scope, conversations, hostSessionContext } = setup(t);
  const acquisition = {
    ...scope,
    acquisition_id: 'acquisition-a',
    fact_id: 'fact-a',
    subject_ref: 'entity:npc-a',
    predicate: 'secret',
    acquisition_kind: 'author_initial',
    acquisition_authorization_ref: source.authorization_ref,
    provenance_ref: source.source_ref,
    provenance_digest: source.sha256,
  };
  assert.deepEqual(authorizers.visibilityAuthorizer(acquisition), {
    status: 'allowed',
    world_id: scope.world_id,
    conversation_id: scope.conversation_id,
    adapter_id: scope.adapter_id,
    actor_id: scope.actor_id,
    recipient: scope.recipient,
    purpose: scope.purpose,
    world_revision: scope.world_revision,
    commit_sequence: scope.commit_sequence,
    acquisition_id: 'acquisition-a',
    authorization_ref: source.authorization_ref,
  });
  assert.equal(authorizers.visibilityAuthorizer({
    ...acquisition,
    provenance_digest: '0'.repeat(64),
  }).status, 'denied');

  assert.equal(authorizers.visibilityAuthorizer({
    ...acquisition,
    acquisition_kind: 'imported',
  }).status, 'denied');
  assert.equal(authorizers.visibilityAuthorizer({
    ...acquisition,
    acquisition_authorization_ref: 'rule:imported-v1',
  }).status, 'denied');
  assert.equal(authorizers.visibilityAuthorizer({
    ...acquisition,
    acquisition_kind: 'imported',
    acquisition_authorization_ref: 'rule:imported-v1',
  }).status, 'allowed');
  assert.equal(authorizers.visibilityAuthorizer({
    ...acquisition,
    acquisition_authorization_ref: undefined,
  }).status, 'denied');

  conversations.revoke({
    adapterId: scope.adapter_id,
    conversationId: scope.conversation_id,
    reason: 'test revoke binding',
  });
  assert.equal(authorizers.readAuthorizer(scope), null);
  assert.equal(authorizers.memoryQueryAuthorizer(scope, hostSessionContext), false);
  assert.equal(authorizers.visibilityAuthorizer(acquisition).status, 'denied');
});

test('actor revocation blocks future Core reads even while Host conversation binding remains active', (t) => {
  const { authorizers, scope, actors } = setup(t);
  actors.revoke('world-a', 'adapter-st', 'npc-a');
  assert.equal(authorizers.readAuthorizer(scope), null);
});

test('authorizer configuration rejects ambiguous adapter identity input', (t) => {
  const { store } = setup(t);
  assert.throws(() => createHostBoundNpcKnowledgeAuthorizers({
    store,
    adapterIds: ['adapter-st', 'adapter-st'],
    trustedInitialKnowledgeSources: [source],
  }), /unique array/);
});
