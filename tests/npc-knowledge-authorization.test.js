import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { ActorBindingService } from '../src/application/actor-bindings.js';
import { HostConversationWorldBindingService } from '../src/application/host-conversation-world-bindings.js';
import { createHostBoundNpcKnowledgeAuthorizers } from '../src/application/npc-knowledge-authorization.js';

const sourceBytes = Buffer.from('approved deployment-owned source');
const source = {
  world_pack_id: 'test.world',
  world_pack_version: '1.0.0',
  source_kind: 'author_initial',
  source_ref: 'authoring:test.world@1.0.0',
  authorization_ref: 'rule:author-initial-v1',
  sha256: createHash('sha256').update(sourceBytes).digest('hex'),
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
    conversationId: 'session:installation:conversation',
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
    conversation_id: 'session:installation:conversation',
    adapter_id: 'adapter-st',
    actor_id: 'npc-a',
    recipient: 'model',
    purpose: 'npc_turn_context',
    world_revision: snapshot.world_revision,
    commit_sequence: snapshot.commit_sequence,
  };
  return { store, engine, actors, conversations, authorizers, scope };
}

test('production NPC read authorization requires configured adapter, active Host conversation binding, and active actor binding', (t) => {
  const { authorizers, scope } = setup(t);
  assert.deepEqual(authorizers.readAuthorizer(scope), {
    status: 'authorized',
    ...scope,
    authorization_ref: 'core:host-conversation-actor-binding-v1',
  });
  assert.equal(authorizers.readAuthorizer({ ...scope, conversation_id: 'other-session:installation:conversation' }), null);
  assert.equal(authorizers.readAuthorizer({ ...scope, adapter_id: 'unconfigured-adapter' }), null);
  assert.equal(authorizers.readAuthorizer({ ...scope, actor_id: 'other-actor' }), null);
});

test('Core resolves world and actor only from active bindings and denies ambiguous actor selection', (t) => {
  const { engine, authorizers, scope, actors } = setup(t);
  assert.deepEqual(authorizers.resolveContext({
    adapter_id: scope.adapter_id,
    conversation_id: scope.conversation_id,
  }), {
    world_id: scope.world_id,
    conversation_id: scope.conversation_id,
    adapter_id: scope.adapter_id,
    actor_id: scope.actor_id,
  });

  // Caller-supplied world/actor fields are not part of the identity contract.
  assert.equal(authorizers.resolveContext({
    adapter_id: scope.adapter_id,
    conversation_id: scope.conversation_id,
    world_id: 'attacker-world',
    actor_id: 'attacker-actor',
  }), null);

  let getterInvoked = false;
  const accessorIdentity = {
    adapter_id: scope.adapter_id,
    get conversation_id() {
      getterInvoked = true;
      return scope.conversation_id;
    },
  };
  assert.equal(authorizers.resolveContext(accessorIdentity), null);
  assert.equal(getterInvoked, false);

  engine.commitEvent('world-a', {
    event_id: 'create-second-npc',
    idempotency_key: 'create-second-npc',
    turn_id: 'create-second-npc',
    event_type: 'action.completed',
    expected_revision: 1,
    effects: [{ kind: 'entity.create', entity_id: 'npc-b', entity_type: 'character' }],
  });
  actors.bind('world-a', 'adapter-st', 'npc-b');

  // Multiple active actors cannot be selected by supplying actor_id in a request.
  assert.equal(authorizers.resolveContext({
    adapter_id: scope.adapter_id,
    conversation_id: scope.conversation_id,
  }), null);
  assert.equal(authorizers.readAuthorizer(scope), null);

  actors.revoke('world-a', 'adapter-st', 'npc-b');
  assert.equal(authorizers.resolveContext({
    adapter_id: scope.adapter_id,
    conversation_id: scope.conversation_id,
  }).actor_id, 'npc-a');
  assert.equal(authorizers.readAuthorizer(scope).status, 'authorized');
});

test('per-acquisition visibility requires exact trusted source provenance and the same live Host/actor bindings', (t) => {
  const { authorizers, scope, conversations } = setup(t);
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
