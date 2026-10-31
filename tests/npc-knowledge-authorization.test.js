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
  engine.npcKnowledgePolicyAuthority = authorizers.policyAuthority;
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
    ...authorizers.policyAuthority.getSnapshot(),
  });
  assert.equal(authorizers.readAuthorizer({ ...scope, conversation_id: 'other-session:installation:conversation' }), null);
  assert.equal(authorizers.readAuthorizer({ ...scope, adapter_id: 'unconfigured-adapter' }), null);
  assert.equal(authorizers.readAuthorizer({ ...scope, actor_id: 'other-actor' }), null);
});

test('Core validates the exact Host-selected actor binding without selecting an actor from adapter identity', (t) => {
  const { engine, authorizers, scope, actors } = setup(t);
  const resolve = (actorId = scope.actor_id) => authorizers.resolveContext({
    adapter_id: scope.adapter_id,
    conversation_id: scope.conversation_id,
    actor_id: actorId,
  });
  assert.deepEqual(resolve(), {
    world_id: scope.world_id,
    conversation_id: scope.conversation_id,
    adapter_id: scope.adapter_id,
    actor_id: scope.actor_id,
  });

  // The Host-selected actor is only a selector; Core still requires the exact
  // active binding and never accepts caller-supplied world scope.
  assert.equal(authorizers.resolveContext({
    adapter_id: scope.adapter_id,
    conversation_id: scope.conversation_id,
    actor_id: 'attacker-actor',
  }), null);
  assert.equal(authorizers.resolveContext({
    adapter_id: scope.adapter_id,
    conversation_id: scope.conversation_id,
    actor_id: scope.actor_id,
    world_id: 'attacker-world',
  }), null);

  let getterInvoked = false;
  const accessorIdentity = {
    adapter_id: scope.adapter_id,
    get conversation_id() {
      getterInvoked = true;
      return scope.conversation_id;
    },
    actor_id: scope.actor_id,
  };
  assert.equal(authorizers.resolveContext(accessorIdentity), null);
  assert.equal(getterInvoked, false);

  let proxyTrapInvoked = false;
  const proxyIdentity = new Proxy({}, {
    getPrototypeOf() {
      proxyTrapInvoked = true;
      throw new Error('proxy trap must not run');
    },
  });
  assert.equal(authorizers.resolveContext(proxyIdentity), null);
  assert.equal(proxyTrapInvoked, false);

  engine.commitEvent('world-a', {
    event_id: 'create-second-npc',
    idempotency_key: 'create-second-npc',
    turn_id: 'create-second-npc',
    event_type: 'action.completed',
    expected_revision: 1,
    effects: [{ kind: 'entity.create', entity_id: 'npc-b', entity_type: 'character' }],
  });
  actors.bind('world-a', 'adapter-st', 'npc-b');

  assert.equal(resolve('npc-b').actor_id, 'npc-b');
  assert.equal(authorizers.readAuthorizer({ ...scope, actor_id: 'npc-b' }).actor_id, 'npc-b');
  actors.revoke('world-a', 'adapter-st', 'npc-b');
  assert.equal(resolve('npc-b'), null);
  assert.equal(resolve().actor_id, 'npc-a');
  assert.equal(authorizers.readAuthorizer(scope).status, 'authorized');
});

test('Core write authorization is separate from read authorization and binds the exact belief operation', (t) => {
  const { authorizers, scope } = setup(t);
  const writeScope = {
    ...scope,
    operation: 'npc.belief.transition',
    expected_revision: scope.world_revision,
    expected_commit_sequence: scope.commit_sequence,
    ...authorizers.policyAuthority.getSnapshot(),
  };
  const decision = authorizers.writeAuthorizer(writeScope);
  assert.equal(decision.status, 'authorized');
  assert.equal(decision.operation, 'npc.belief.transition');
  assert.equal(decision.authorization_ref, 'core:npc-belief-transition-write-v1');
  assert.equal(authorizers.writeAuthorizer({ ...writeScope, operation: 'npc.knowledge.read' }), null);
  assert.equal(authorizers.writeAuthorizer({ ...writeScope, actor_id: 'attacker-actor' }), null);
  assert.equal(authorizers.writeAuthorizer({
    ...writeScope,
    generation: writeScope.generation + 1,
  }), null);
});

test('Core reader, belief writer, and belief-state reader reject caller-selected world or actor scope', (t) => {
  const { store, authorizers, scope, actors } = setup(t);
  const guardedEngine = new LogicEngine(store, {
    npcKnowledgeContextResolver: authorizers.resolveContext,
    npcKnowledgeWriteAuthorizer: authorizers.writeAuthorizer,
    npcKnowledgePolicyAuthority: authorizers.policyAuthority,
    npcKnowledgeReadAuthorizer: authorizers.readAuthorizer,
    npcKnowledgeVisibilityAuthorizer: authorizers.visibilityAuthorizer,
  });
  const snapshot = guardedEngine.getSnapshot(scope.world_id);
  const request = {
    world_id: scope.world_id,
    conversation_id: scope.conversation_id,
    adapter_id: scope.adapter_id,
    actor_id: scope.actor_id,
    recipient: scope.recipient,
    purpose: scope.purpose,
    expected_revision: snapshot.world_revision,
    expected_commit_sequence: snapshot.commit_sequence,
    limit: 20,
  };
  assert.equal(guardedEngine.readNpcKnowledge(request).status, 'ready');
  assert.throws(() => guardedEngine.readNpcKnowledge({
    ...request,
    world_id: 'attacker-world',
  }), { code: 'NPC_KNOWLEDGE_READ_NOT_AUTHORIZED' });
  assert.throws(() => guardedEngine.readNpcKnowledge({
    ...request,
    actor_id: 'attacker-actor',
  }), { code: 'NPC_KNOWLEDGE_READ_NOT_AUTHORIZED' });

  const forgedWrite = {
    ...request,
    actor_id: 'attacker-actor',
    proposition_ref: 'proposition:fact/fact-a',
    proposition_value: 'forged',
    stance: 'believes_true',
    supporting_acquisition_ids: [],
    contradicting_acquisition_ids: [],
    reason_rule_ref: 'rule:test',
    idempotency_key: 'forged-actor-transition',
  };
  assert.throws(() => guardedEngine.recordNpcBeliefTransition(forgedWrite), {
    code: 'NPC_KNOWLEDGE_READ_NOT_AUTHORIZED',
  });
  assert.throws(() => guardedEngine.getNpcBeliefState({
    ...request,
    actor_id: 'attacker-actor',
    proposition_ref: 'proposition:fact/fact-a',
  }), { code: 'NPC_KNOWLEDGE_READ_NOT_AUTHORIZED' });

  // Revocation blocks a previously valid actor on both state mutation and read.
  actors.revoke('world-a', 'adapter-st', 'npc-a');
  const revokedWrite = {
    ...request,
    proposition_ref: 'proposition:fact/fact-a',
    proposition_value: 'value',
    stance: 'believes_true',
    supporting_acquisition_ids: [],
    contradicting_acquisition_ids: [],
    reason_rule_ref: 'rule:test',
    idempotency_key: 'revoked-actor-transition',
  };
  assert.throws(() => guardedEngine.recordNpcBeliefTransition(revokedWrite), {
    code: 'NPC_KNOWLEDGE_READ_NOT_AUTHORIZED',
  });
  assert.throws(() => guardedEngine.getNpcBeliefState({
    ...request,
    proposition_ref: 'proposition:fact/fact-a',
  }), { code: 'NPC_KNOWLEDGE_READ_NOT_AUTHORIZED' });
});

test('Core revalidates Host binding after the acquisition query before returning a read', (t) => {
  const { store, authorizers, scope, conversations } = setup(t);
  let revoked = false;
  const readAuthorizer = (request) => {
    const decision = authorizers.readAuthorizer(request);
    if (!revoked) {
      revoked = true;
      conversations.revoke({
        adapterId: scope.adapter_id,
        conversationId: scope.conversation_id,
        reason: 'revoke during read authorization',
      });
    }
    return decision;
  };
  const engine = new LogicEngine(store, {
    npcKnowledgeContextResolver: authorizers.resolveContext,
    npcKnowledgeWriteAuthorizer: authorizers.writeAuthorizer,
    npcKnowledgePolicyAuthority: authorizers.policyAuthority,
    npcKnowledgeReadAuthorizer: readAuthorizer,
    npcKnowledgeVisibilityAuthorizer: authorizers.visibilityAuthorizer,
  });
  const request = {
    world_id: scope.world_id,
    conversation_id: scope.conversation_id,
    adapter_id: scope.adapter_id,
    actor_id: scope.actor_id,
    recipient: scope.recipient,
    purpose: scope.purpose,
    expected_revision: scope.world_revision,
    expected_commit_sequence: scope.commit_sequence,
    limit: 20,
  };
  assert.throws(() => engine.readNpcKnowledge(request), {
    code: 'NPC_KNOWLEDGE_READ_NOT_AUTHORIZED',
  });
  assert.equal(revoked, true);
});

test('Core read rejects policy generation rotation after authorization but before returning acquisitions', (t) => {
  const { store, authorizers, scope } = setup(t);
  let rotated = false;
  const readAuthorizer = (request) => {
    const decision = authorizers.readAuthorizer(request);
    if (!rotated) {
      rotated = true;
      authorizers.policyAuthority.advanceGeneration();
    }
    return decision;
  };
  const engine = new LogicEngine(store, {
    npcKnowledgeContextResolver: authorizers.resolveContext,
    npcKnowledgeWriteAuthorizer: authorizers.writeAuthorizer,
    npcKnowledgePolicyAuthority: authorizers.policyAuthority,
    npcKnowledgeReadAuthorizer: readAuthorizer,
    npcKnowledgeVisibilityAuthorizer: authorizers.visibilityAuthorizer,
  });
  const request = {
    world_id: scope.world_id,
    conversation_id: scope.conversation_id,
    adapter_id: scope.adapter_id,
    actor_id: scope.actor_id,
    recipient: scope.recipient,
    purpose: scope.purpose,
    expected_revision: scope.world_revision,
    expected_commit_sequence: scope.commit_sequence,
    limit: 20,
  };
  assert.throws(() => engine.readNpcKnowledge(request), {
    code: 'NPC_KNOWLEDGE_READ_NOT_AUTHORIZED',
  });
  assert.equal(rotated, true);
});

test('per-acquisition visibility requires exact trusted source provenance and the same live Host/actor bindings', (t) => {
  const { authorizers, scope, conversations } = setup(t);
  const acquisition = {
    ...scope,
    acquisition_id: 'acquisition-a',
    ...authorizers.policyAuthority.getSnapshot(),
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
    ...authorizers.policyAuthority.getSnapshot(),
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
  assert.equal(authorizers.resolveContext({
    adapter_id: scope.adapter_id,
    conversation_id: scope.conversation_id,
    actor_id: scope.actor_id,
  }), null);
  assert.equal(authorizers.readAuthorizer(scope), null);
  assert.equal(authorizers.visibilityAuthorizer(acquisition).status, 'denied');
});

test('actor revocation blocks future Core reads even while Host conversation binding remains active', (t) => {
  const { authorizers, scope, actors } = setup(t);
  actors.revoke('world-a', 'adapter-st', 'npc-a');
  assert.equal(authorizers.resolveContext({
    adapter_id: scope.adapter_id,
    conversation_id: scope.conversation_id,
    actor_id: scope.actor_id,
  }), null);
  assert.equal(authorizers.readAuthorizer(scope), null);
});

test('trusted Host and actor binding revocation advances the NPC policy generation', (t) => {
  const { authorizers, scope, actors, conversations } = setup(t);
  const initial = authorizers.policyAuthority.getSnapshot();

  actors.revoke(scope.world_id, scope.adapter_id, scope.actor_id);
  const afterActorRevoke = authorizers.policyAuthority.getSnapshot();
  assert.equal(afterActorRevoke.authority_id, initial.authority_id);
  assert.equal(afterActorRevoke.generation, initial.generation + 1);
  assert.equal(afterActorRevoke.snapshot_fingerprint, initial.snapshot_fingerprint);
  assert.equal(authorizers.policyAuthority.isCurrent(initial), false);

  conversations.revoke({
    adapterId: scope.adapter_id,
    conversationId: scope.conversation_id,
    reason: 'test policy generation revoke',
  });
  const afterConversationRevoke = authorizers.policyAuthority.getSnapshot();
  assert.equal(afterConversationRevoke.generation, afterActorRevoke.generation + 1);
  assert.equal(authorizers.policyAuthority.isCurrent(afterActorRevoke), false);
});

test('authorizer configuration rejects ambiguous adapter identity input', (t) => {
  const { store } = setup(t);
  assert.throws(() => createHostBoundNpcKnowledgeAuthorizers({
    store,
    adapterIds: ['adapter-st', 'adapter-st'],
    trustedInitialKnowledgeSources: [source],
  }), /unique array/);
});
