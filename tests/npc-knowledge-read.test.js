import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { hashRequest } from '../src/core/request-hash.js';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import {
  createNpcBeliefProposalContext as createOpaqueNpcBeliefProposalContext,
  resolveNpcBeliefProposalHandles as resolveOpaqueNpcBeliefProposalHandles,
  verifyNpcBeliefProposalContextHandle,
} from '../src/application/npc-belief-proposal-handles.js';
import { validateNpcKnowledgeRead, validateNpcKnowledgeReadInput } from '../src/application/npc-knowledge-read.js';
import { buildNpcBeliefContext, reduceNpcBeliefTransition } from '../src/application/npc-belief-state.js';

const sourceBytes = JSON.stringify({
  schema_version: 1,
  world_pack_id: 'test.world',
  world_pack_version: '1.0.0',
  source_kind: 'author_initial',
  source_ref: 'authoring:test.world@1.0.0',
  authorization_ref: 'rule:initial-knowledge-v1',
  assignments: [{ subject_id: 'npc-a', fact_id: 'fact-a' }],
});
const trustedRegistry = [{
  world_pack_id: 'test.world',
  world_pack_version: '1.0.0',
  source_kind: 'author_initial',
  source_ref: 'authoring:test.world@1.0.0',
  authorization_ref: 'rule:initial-knowledge-v1',
  sha256: createHash('sha256').update(sourceBytes).digest('hex'),
}];

function setup(t, authorizer = (scope) => ({
  status: 'authorized',
  world_id: scope.world_id,
  conversation_id: scope.conversation_id,
  adapter_id: scope.adapter_id,
  actor_id: scope.actor_id,
  recipient: scope.recipient,
  purpose: scope.purpose,
  world_revision: scope.world_revision,
  commit_sequence: scope.commit_sequence,
  authorization_ref: 'rule:npc-read-v1',
}), visibilityAuthorizer = (scope) => ({
  status: 'allowed',
  world_id: scope.world_id,
  conversation_id: scope.conversation_id,
  adapter_id: scope.adapter_id,
  actor_id: scope.actor_id,
  recipient: scope.recipient,
  purpose: scope.purpose,
  world_revision: scope.world_revision,
  commit_sequence: scope.commit_sequence,
  acquisition_id: scope.acquisition_id,
  authorization_ref: 'rule:npc-visibility-v1',
})), engineOptions = {}) {
  const store = new SQLiteStore(':memory:');
  t.after(() => store.close());
  const engine = new LogicEngine(store, {
    trustedInitialKnowledgeSources: trustedRegistry,
    npcKnowledgeReadAuthorizer: authorizer,
    npcKnowledgeVisibilityAuthorizer: visibilityAuthorizer,
    ...engineOptions,
  });
  const binding = { adapter_id: 'adapter-st', conversation_id: 'conversation-a', world_id: 'world-a' };
  engine.createWorld({
    world_id: 'world-a',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2026-01-01T00:00:00Z',
  });

  store.db.prepare(`
    INSERT INTO host_conversation_world_bindings(
      adapter_id,conversation_id,world_id,active,created_at,updated_at
    ) VALUES(?,?,?,1,datetime('now'),datetime('now'))
  `).run(binding.adapter_id, binding.conversation_id, binding.world_id);

  engine.commitEvent('world-a', {
    event_id: 'author-seed',
    idempotency_key: 'author-seed-key',
    turn_id: 'author-seed',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [
      { kind: 'entity.create', entity_id: 'npc-a', entity_type: 'character' },
      { kind: 'entity.create', entity_id: 'npc-b', entity_type: 'character' },
      { kind: 'fact.set', fact_id: 'fact-a', subject_ref: 'entity:npc-a', predicate: 'secret', value: 'source-backed-value' },
    ],
  });
  const acquisition = engine.recordTrustedInitialKnowledgeSource({
    world_id: 'world-a',
    source_bytes: sourceBytes,
    idempotency_key: 'author-source-1',
    expected_revision: 1,
    expected_commit_sequence: 1,
  });
  return { store, engine, acquisition };
}

function request(store, overrides = {}) {
  const world = store.world('world-a');
  return {
    world_id: 'world-a',
    conversation_id: 'conversation-a',
    adapter_id: 'adapter-st',
    actor_id: 'npc-a',
    recipient: 'model',
    purpose: 'npc_turn_context',
    expected_revision: world.world_revision,
    expected_commit_sequence: store.currentCommitSequence('world-a'),
    limit: 20,
    ...overrides,
  };
}

function propositionRefFor(item) {
  return item.subject_ref && item.predicate
    ? 'proposition:' + encodeURIComponent(item.subject_ref) + '/' + encodeURIComponent(item.predicate)
    : 'proposition:fact/' + encodeURIComponent(item.fact_id);
}


test('untrusted reader requests with getters and proxies fail before access', () => {
  let invoked = false;
  const unsafe = {
    actor_id: 'npc-a',
    purpose: 'npc_turn_context',
    expected_revision: 1,
    expected_commit_sequence: 1,
    limit: 20,
  };
  Object.defineProperty(unsafe, 'world_id', {
    enumerable: true,
    get() { invoked = true; return 'world-a'; },
  });
  assert.equal(validateNpcKnowledgeRead(unsafe, { world_id: 'world-a', status: 'active', world_revision: 1 }, 1, {}).status, 'non_ready');
  assert.equal(invoked, false);
  assert.equal(validateNpcKnowledgeReadInput(new Proxy({}, {})).status, 'non_ready');
});

test('reader returns only facts acquired by the requesting NPC and binds the exact snapshot', (t) => {
  const { store, engine } = setup(t);
  const result = engine.readNpcKnowledge(request(store));
  assert.equal(result.status, 'ready');
  assert.equal(result.actor_id, 'npc-a');
  assert.equal(result.purpose, 'npc_turn_context');
  assert.deepEqual(result.snapshot, {
    world_revision: store.world('world-a').world_revision,
    commit_sequence: store.currentCommitSequence('world-a'),
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].fact_id, 'fact-a');
  assert.deepEqual(engine.readNpcKnowledge(request(store, { actor_id: 'npc-b' })).items, []);
  assert.equal(result.items[0].value, 'source-backed-value');
  assert.equal(result.items[0].provenance_ref, 'authoring:test.world@1.0.0');
  assert.deepEqual(result.items[0].source_event_ids, ['author-seed']);
  assert.equal(Object.isFrozen(result.items), true);
  assert.equal(Object.isFrozen(result.items[0]), true);
  assert.throws(() => { result.items[0].value = 'tampered'; }, TypeError);
});

test('reader fails closed without a trusted deployment authorizer', (t) => {
  const { store } = setup(t, null);
  const engine = new LogicEngine(store, { trustedInitialKnowledgeSources: trustedRegistry });
  assert.throws(() => engine.readNpcKnowledge(request(store)), { code: 'NPC_KNOWLEDGE_READ_NOT_CONFIGURED' });
});

test('reader rejects stale snapshot cursors and actor/purpose authorization mismatch', (t) => {
  const { store, engine } = setup(t);
  const current = request(store);
  assert.throws(() => engine.readNpcKnowledge({
    ...current,
    expected_commit_sequence: current.expected_commit_sequence - 1,
  }), { code: 'NPC_KNOWLEDGE_READ_NOT_READY' });

  const mismatch = new LogicEngine(store, {
    trustedInitialKnowledgeSources: trustedRegistry,
    npcKnowledgeReadAuthorizer: (scope) => ({
      status: 'authorized',
      world_id: scope.world_id,
      conversation_id: scope.conversation_id,
      adapter_id: scope.adapter_id,
      actor_id: 'npc-b',
      recipient: scope.recipient,
      purpose: scope.purpose,
      world_revision: scope.world_revision,
      commit_sequence: scope.commit_sequence,
      authorization_ref: 'rule:npc-read-v1',
    }),
  });
  assert.throws(() => mismatch.readNpcKnowledge(current), { code: 'NPC_KNOWLEDGE_READ_NOT_READY' });
});

test('reader rejects authorizer scope mismatches for world, purpose, revision, and commit sequence', (t) => {
  const { store } = setup(t);
  const current = request(store);
  const mismatches = [
    ['world_id', 'other-world'],
    ['adapter_id', 'other-adapter'],
    ['recipient', 'other-recipient'],
    ['purpose', 'npc_action_evaluation'],
    ['world_revision', current.expected_revision + 1],
    ['commit_sequence', current.expected_commit_sequence + 1],
  ];

  for (const [field, value] of mismatches) {
    const engine = new LogicEngine(store, {
      trustedInitialKnowledgeSources: trustedRegistry,
      npcKnowledgeReadAuthorizer: (scope) => ({
        status: 'authorized',
        world_id: scope.world_id,
        conversation_id: scope.conversation_id,
        adapter_id: scope.adapter_id,
        actor_id: scope.actor_id,
        recipient: scope.recipient,
        purpose: scope.purpose,
        world_revision: scope.world_revision,
        commit_sequence: scope.commit_sequence,
        authorization_ref: 'rule:npc-read-v1',
        [field]: value,
      }),
    });
    assert.throws(() => engine.readNpcKnowledge(current), {
      code: 'NPC_KNOWLEDGE_READ_NOT_READY',
    }, `must reject authorization mismatch for ${field}`);
  }
});

test('reader configuration rejects direct and bound asynchronous trusted authorizers', (t) => {
  const { store } = setup(t);
  const asyncAuthorizer = async (scope) => ({
    status: 'authorized',
    world_id: scope.world_id,
    conversation_id: scope.conversation_id,
    adapter_id: scope.adapter_id,
    actor_id: scope.actor_id,
    recipient: scope.recipient,
    purpose: scope.purpose,
    world_revision: scope.world_revision,
    commit_sequence: scope.commit_sequence,
    authorization_ref: 'rule:npc-read-v1',
  });
  const assertRejected = (authorizer) => assert.throws(() => new LogicEngine(store, {
    trustedInitialKnowledgeSources: trustedRegistry,
    npcKnowledgeReadAuthorizer: authorizer,
  }), {
    name: 'TypeError',
    message: 'npcKnowledgeReadAuthorizer must be a synchronous deployment-owned function',
  });
  assertRejected(asyncAuthorizer);
  assertRejected(asyncAuthorizer.bind(null));
  assert.throws(() => new LogicEngine(store, {
    trustedInitialKnowledgeSources: trustedRegistry,
    npcKnowledgeVisibilityAuthorizer: asyncAuthorizer.bind(null),
  }), {
    name: 'TypeError',
    message: 'npcKnowledgeVisibilityAuthorizer must be a synchronous deployment-owned function',
  });
});

test('reader rejects unsupported purpose, unknown actor, and malformed limits', (t) => {
  const { store, engine } = setup(t);
  assert.throws(() => engine.readNpcKnowledge(request(store, { purpose: 'prompt_injection' })), {
    code: 'NPC_KNOWLEDGE_READ_NOT_READY',
  });
  assert.throws(() => engine.readNpcKnowledge(request(store, { actor_id: 'missing-npc' })), {
    code: 'NPC_KNOWLEDGE_READER_NOT_ELIGIBLE',
  });
  assert.throws(() => engine.readNpcKnowledge(request(store, { limit: 201 })), {
    code: 'NPC_KNOWLEDGE_READ_NOT_READY',
  });
});


test('reader stops returning an acquisition after its canonical source is rolled back', (t) => {
  const { store, engine, acquisition } = setup(t);
  assert.equal(engine.readNpcKnowledge(request(store)).items.length, 1);
  const rollback = engine.rollbackEvent('world-a', {
    root_event_id: acquisition.event_id,
    idempotency_key: 'rollback-knowledge-acquisition',
  });
  assert.equal(rollback.accepted, true);
  const result = engine.readNpcKnowledge(request(store));
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.items, []);
});

test('pure read contract rejects extra keys and authorization from another snapshot', (t) => {
  const { store } = setup(t);
  const world = store.world('world-a');
  const commitSequence = store.currentCommitSequence('world-a');
  const input = request(store);
  const authorization = {
    status: 'authorized',
    world_id: 'world-a',
    conversation_id: 'conversation-a',
    adapter_id: 'adapter-st',
    actor_id: 'npc-a',
    recipient: 'model',
    purpose: 'npc_turn_context',
    world_revision: world.world_revision,
    commit_sequence: commitSequence,
    authorization_ref: 'rule:npc-read-v1',
  };
  assert.equal(validateNpcKnowledgeRead({ ...input, extra: true }, world, commitSequence, authorization).status, 'non_ready');
  assert.equal(validateNpcKnowledgeRead(input, world, commitSequence, {
    ...authorization, commit_sequence: commitSequence - 1,
  }).reason, 'read_not_authorized');
});

test('Core prepares an actor-bound belief context only after per-acquisition visibility authorization', (t) => {
  const { store, engine } = setup(t);
  const readRequest = request(store);
  const read = engine.readNpcKnowledge(readRequest);
  const proposal = {
    world_id: read.world_id,
    actor_id: read.actor_id,
    snapshot: read.snapshot,
    proposition_ref: propositionRefFor(read.items[0]),
    proposition_value: read.items[0].value,
    stance: 'believes_true',
    supporting_acquisition_ids: [read.items[0].acquisition_id],
    contradicting_acquisition_ids: [],
    reason_rule_ref: 'rule:belief-update-v1',
  };
  const prepared = engine.prepareNpcBeliefContext(readRequest, proposal);
  assert.equal(prepared.status, 'ready');
  assert.equal(prepared.context.actor_id, 'npc-a');
  assert.equal(prepared.context.evidence.length, 1);
  assert.equal(prepared.context.evidence[0].value, 'source-backed-value');
  assert.equal(prepared.context.belief_stance, 'believes_true');
  assert.equal(Object.isFrozen(prepared.context), true);
});

test('belief context final validation uses one atomic Core snapshot read', (t) => {
  const { store, engine } = setup(t);
  const readRequest = request(store);
  const read = engine.readNpcKnowledge(readRequest);
  const proposal = {
    world_id: read.world_id,
    actor_id: read.actor_id,
    snapshot: read.snapshot,
    proposition_ref: propositionRefFor(read.items[0]),
    proposition_value: read.items[0].value,
    stance: 'believes_true',
    supporting_acquisition_ids: [read.items[0].acquisition_id],
    contradicting_acquisition_ids: [],
    reason_rule_ref: 'rule:belief-update-v1',
  };

  // readNpcKnowledge performs two snapshot reads (before and after the
  // authorized query); context preparation must perform a third atomic read
  // after visibility authorization, rather than separately reading world/sequence.
  const originalGetSnapshot = engine.getSnapshot.bind(engine);
  let snapshotReads = 0;
  engine.getSnapshot = (...args) => {
    snapshotReads += 1;
    return originalGetSnapshot(...args);
  };
  const prepared = engine.prepareNpcBeliefContext(readRequest, proposal);
  assert.equal(prepared.status, 'ready');
  assert.equal(snapshotReads, 3);
});

test('Core omits denied acquisitions from the belief context and rejects proposals relying on them', (t) => {
  const { store } = setup(t);
  const engine = new LogicEngine(store, {
    trustedInitialKnowledgeSources: trustedRegistry,
    npcKnowledgeReadAuthorizer: (scope) => ({
      status: 'authorized',
      world_id: scope.world_id,
      conversation_id: scope.conversation_id,
      adapter_id: scope.adapter_id,
      actor_id: scope.actor_id,
      recipient: scope.recipient,
      purpose: scope.purpose,
      world_revision: scope.world_revision,
      commit_sequence: scope.commit_sequence,
      authorization_ref: 'rule:npc-read-v1',
    }),
    npcKnowledgeVisibilityAuthorizer: (scope) => ({
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
      authorization_ref: 'rule:npc-visibility-deny-v1',
    }),
  });
  const readRequest = request(store);
  const read = engine.readNpcKnowledge(readRequest);
  const proposal = {
    world_id: read.world_id,
    actor_id: read.actor_id,
    snapshot: read.snapshot,
    proposition_ref: propositionRefFor(read.items[0]),
    proposition_value: read.items[0].value,
    stance: 'believes_true',
    supporting_acquisition_ids: [read.items[0].acquisition_id],
    contradicting_acquisition_ids: [],
    reason_rule_ref: 'rule:belief-update-v1',
  };
  assert.throws(() => engine.prepareNpcBeliefContext(readRequest, proposal), {
    code: 'NPC_BELIEF_TRANSITION_NOT_READY',
  });
});

test('Core rejects accessor-backed visibility decisions without invoking getters', (t) => {
  let getterInvoked = false;
  const maliciousVisibilityAuthorizer = (scope) => {
    const decision = {
      world_id: scope.world_id,
      actor_id: scope.actor_id,
      purpose: scope.purpose,
      world_revision: scope.world_revision,
      commit_sequence: scope.commit_sequence,
      acquisition_id: scope.acquisition_id,
      authorization_ref: 'rule:npc-visibility-v1',
    };
    Object.defineProperty(decision, 'status', {
      enumerable: true,
      get() { getterInvoked = true; return 'allowed'; },
    });
    return decision;
  };
  const { store, engine } = setup(t, undefined, maliciousVisibilityAuthorizer);
  assert.throws(() => engine.prepareNpcBeliefContext(request(store), {}), {
    code: 'NPC_KNOWLEDGE_VISIBILITY_NOT_AUTHORIZED',
  });
  assert.equal(getterInvoked, false);
});

test('Core requires a trusted visibility authorizer before preparing model context', (t) => {
  const { store } = setup(t);
  const engine = new LogicEngine(store, { trustedInitialKnowledgeSources: trustedRegistry,
    npcKnowledgeReadAuthorizer: (scope) => ({
      status: 'authorized',
      world_id: scope.world_id,
      conversation_id: scope.conversation_id,
      adapter_id: scope.adapter_id,
      actor_id: scope.actor_id,
      recipient: scope.recipient,
      purpose: scope.purpose,
      world_revision: scope.world_revision,
      commit_sequence: scope.commit_sequence,
      authorization_ref: 'rule:npc-read-v1',
    }),
  });
  assert.throws(() => engine.prepareNpcBeliefContext(request(store), {}), {
    code: 'NPC_KNOWLEDGE_VISIBILITY_NOT_CONFIGURED',
  });
});

test('Core refuses a belief context if the snapshot changes during visibility evaluation', (t) => {
  const { store } = setup(t);
  let engine;
  let mutated = false;
  engine = new LogicEngine(store, {
    trustedInitialKnowledgeSources: trustedRegistry,
    npcKnowledgeReadAuthorizer: (scope) => ({
      status: 'authorized',
      world_id: scope.world_id,
      conversation_id: scope.conversation_id,
      adapter_id: scope.adapter_id,
      actor_id: scope.actor_id,
      recipient: scope.recipient,
      purpose: scope.purpose,
      world_revision: scope.world_revision,
      commit_sequence: scope.commit_sequence,
      authorization_ref: 'rule:npc-read-v1',
    }),
    npcKnowledgeVisibilityAuthorizer: (scope) => {
      if (!mutated) {
        mutated = true;
        engine.commitEvent('world-a', {
          event_id: 'snapshot-change-during-context',
          idempotency_key: 'snapshot-change-during-context-key',
          turn_id: 'snapshot-change-during-context',
          event_type: 'action.completed',
          expected_revision: scope.world_revision,
          effects: [],
        });
      }
      return {
        status: 'allowed',
        world_id: scope.world_id,
        conversation_id: scope.conversation_id,
        adapter_id: scope.adapter_id,
        actor_id: scope.actor_id,
        recipient: scope.recipient,
        purpose: scope.purpose,
        world_revision: scope.world_revision,
        commit_sequence: scope.commit_sequence,
        acquisition_id: scope.acquisition_id,
        authorization_ref: 'rule:npc-visibility-v1',
      };
    },
  });
  const readRequest = request(store);
  const read = engine.readNpcKnowledge(readRequest);
  const proposal = {
    world_id: read.world_id,
    actor_id: read.actor_id,
    snapshot: read.snapshot,
    proposition_ref: propositionRefFor(read.items[0]),
    proposition_value: read.items[0].value,
    stance: 'believes_true',
    supporting_acquisition_ids: [read.items[0].acquisition_id],
    contradicting_acquisition_ids: [],
    reason_rule_ref: 'rule:belief-update-v1',
  };
  assert.throws(() => engine.prepareNpcBeliefContext(readRequest, proposal), {
    code: 'NPC_BELIEF_CONTEXT_STALE',
  });
});

test('Core commits strict model output through fresh resolution and replays after the snapshot advances', (t) => {
  const { store, engine } = setup(t, undefined, undefined, {
    npcEvidenceHandleKeyProvider: adapterId => adapterId === 'adapter-st'
      ? 'test-adapter-secret-for-opaque-evidence-handles' : null,
  });
  const proposalContext = engine.createNpcBeliefProposalContext(request(store));
  assert.equal(proposalContext.status, 'ready');
  const proposition = proposalContext.model_context.propositions[0];
  const evidence = proposition.evidence[0];
  const raw_output = JSON.stringify({
    schema_version: 1,
    context_handle: proposalContext.model_context.context_handle,
    proposition_handle: proposition.handle,
    object: evidence.object,
    modality: 'asserted',
    stance: 'supported',
    supporting_evidence_handles: [evidence.handle],
    contradicting_evidence_handles: [],
  });
  const input = {
    authorization_context: proposalContext.authorization_context,
    raw_output,
  };

  const first = engine.commitNpcBeliefProposalOutput(input);
  assert.equal(first.status, 'ready');
  assert.equal(first.idempotent_replay, false);
  assert.equal(first.transition.stance, 'supported');
  assert.equal(first.transition.modality, 'asserted');

  const replay = engine.commitNpcBeliefProposalOutput(input);
  assert.equal(replay.status, 'ready');
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.transition.event_id, first.transition.event_id);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM npc_belief_transitions').get().count, 1);
  assert.throws(() => engine.commitNpcBeliefProposalOutput({
    ...input,
    authorization_context: {
      ...proposalContext.authorization_context,
      actor_id: 'npc-b',
    },
  }), { code: 'NPC_BELIEF_CONTEXT_SCOPE_MISMATCH' });

  const event = store.events('world-a').find(item => item.event_id === first.transition.event_id);
  assert.equal(event.effects[0].stance, 'supported');
  assert.equal(event.effects[0].modality, 'asserted');
});

test('Core persists an explicit belief transition, supports idempotent replay, and reports current evidence status', (t) => {
  const { store, engine } = setup(t);
  const current = request(store);
  const read = engine.readNpcKnowledge(current);
  const input = {
    ...current,
    proposition_ref: propositionRefFor(read.items[0]),
    proposition_value: read.items[0].value,
    stance: 'believes_true',
    supporting_acquisition_ids: [read.items[0].acquisition_id],
    contradicting_acquisition_ids: [],
    reason_rule_ref: 'rule:belief-update-v1',
    idempotency_key: 'belief-transition-1',
  };
  const first = engine.recordNpcBeliefTransition(input);
  assert.equal(first.status, 'ready');
  assert.equal(first.idempotent_replay, false);
  assert.equal(first.transition.stance, 'believes_true');
  assert.equal(first.transition.committed_revision, current.expected_revision + 1);
  const canonicalEvent = store.events('world-a').find((event) => event.event_id === first.transition.event_id);
  assert.equal(canonicalEvent.event_type, 'npc.belief.transitioned');
  assert.equal(canonicalEvent.effects.length, 1);
  assert.equal(canonicalEvent.effects[0].kind, 'npc.belief.transition');
  assert.deepEqual(canonicalEvent.effects[0].evidence_acquisition_ids, [read.items[0].acquisition_id]);
  assert.deepEqual(canonicalEvent.effects[0].proposition_value, read.items[0].value);
  assert.equal(canonicalEvent.effects[0].modality, 'asserted');

  const replay = engine.recordNpcBeliefTransition(input);
  assert.equal(replay.status, 'ready');
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.transition.event_id, first.transition.event_id);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM npc_belief_transitions').get().count, 1);

  const after = request(store);
  const state = engine.getNpcBeliefState({
    ...after,
    proposition_ref: input.proposition_ref,
  });
  assert.equal(state.status, 'ready');
  assert.equal(state.stance, 'believes_true');
  assert.equal(state.evidence_status, 'supported');
  assert.deepEqual(state.surviving_evidence_acquisition_ids, [read.items[0].acquisition_id]);
});

test('legacy belief transition idempotency hashes remain replayable after modality migration', (t) => {
  const { store, engine } = setup(t);
  const current = request(store);
  const read = engine.readNpcKnowledge(current);
  const input = {
    ...current,
    proposition_ref: propositionRefFor(read.items[0]),
    proposition_value: read.items[0].value,
    stance: 'believes_true',
    supporting_acquisition_ids: [read.items[0].acquisition_id],
    contradicting_acquisition_ids: [],
    reason_rule_ref: 'rule:belief-update-v1',
    idempotency_key: 'legacy-belief-transition-replay',
  };
  const first = engine.recordNpcBeliefTransition(input);
  const legacyHash = hashRequest({
    operation: 'npc.belief.transition',
    world_id: input.world_id,
    conversation_id: input.conversation_id,
    adapter_id: input.adapter_id,
    actor_id: input.actor_id,
    recipient: input.recipient,
    purpose: input.purpose,
    expected_revision: input.expected_revision,
    expected_commit_sequence: input.expected_commit_sequence,
    limit: input.limit,
    proposition_ref: input.proposition_ref,
    proposition_value: input.proposition_value,
    stance: input.stance,
    supporting_acquisition_ids: input.supporting_acquisition_ids,
    contradicting_acquisition_ids: input.contradicting_acquisition_ids,
    reason_rule_ref: input.reason_rule_ref,
  });
  store.db.prepare('UPDATE npc_belief_transitions SET request_hash=? WHERE world_id=? AND idempotency_key=?')
    .run(legacyHash, input.world_id, input.idempotency_key);

  const replay = engine.recordNpcBeliefTransition(input);
  assert.equal(replay.status, 'ready');
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.transition.event_id, first.transition.event_id);
});

test('identical concurrent Core belief commits return one canonical transition', (t) => {
  const { store, engine } = setup(t);
  const current = request(store);
  const read = engine.readNpcKnowledge(current);
  const input = {
    ...current,
    proposition_ref: propositionRefFor(read.items[0]),
    proposition_value: read.items[0].value,
    stance: 'believes_true',
    supporting_acquisition_ids: [read.items[0].acquisition_id],
    contradicting_acquisition_ids: [],
    reason_rule_ref: 'rule:belief-update-v1',
    idempotency_key: 'concurrent-belief-transition',
  };
  const originalTx = store.tx.bind(store);
  let competingCommit;
  let injected = false;
  store.tx = callback => {
    if (!injected) {
      injected = true;
      competingCommit = engine.recordNpcBeliefTransition(input);
    }
    return originalTx(callback);
  };

  const result = engine.recordNpcBeliefTransition(input);
  store.tx = originalTx;
  assert.equal(competingCommit.status, 'ready');
  assert.equal(competingCommit.idempotent_replay, false);
  assert.equal(result.status, 'ready');
  assert.equal(result.idempotent_replay, true);
  assert.equal(result.transition.event_id, competingCommit.transition.event_id);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM npc_belief_transitions').get().count, 1);
});

test('belief transition projection rebuilds from canonical event effects', (t) => {
  const { store, engine } = setup(t);
  const current = request(store);
  const read = engine.readNpcKnowledge(current);
  const input = {
    ...current,
    proposition_ref: propositionRefFor(read.items[0]),
    proposition_value: read.items[0].value,
    stance: 'believes_true',
    supporting_acquisition_ids: [read.items[0].acquisition_id],
    contradicting_acquisition_ids: [],
    reason_rule_ref: 'rule:belief-update-v1',
    idempotency_key: 'belief-transition-rebuild',
  };
  const first = engine.recordNpcBeliefTransition(input);
  store.db.prepare('DELETE FROM npc_belief_transitions WHERE world_id=?').run('world-a');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM npc_belief_transitions').get().count, 0);

  store.rebuild('world-a', store.world('world-a').world_revision);
  const row = store.db.prepare('SELECT event_id,stance,proposition_value_json,evidence_acquisition_ids_json FROM npc_belief_transitions WHERE world_id=?')
    .get('world-a');
  assert.ok(row);
  assert.equal(row.event_id, first.transition.event_id);
  assert.equal(row.stance, 'believes_true');
  assert.equal(row.modality, 'asserted');
  assert.deepEqual(JSON.parse(row.proposition_value_json), read.items[0].value);
  assert.deepEqual(JSON.parse(row.evidence_acquisition_ids_json), [read.items[0].acquisition_id]);
});

test('Core accepts ADR belief states, persists modality, and requires a prior value for dropped', (t) => {
  const { store, engine } = setup(t);
  const firstRead = engine.readNpcKnowledge(request(store));
  const propositionRef = propositionRefFor(firstRead.items[0]);
  const acquisitionId = firstRead.items[0].acquisition_id;
  const originalValue = firstRead.items[0].value;

  const commit = (stance, propositionValue, key) => {
    const current = request(store);
    const read = engine.readNpcKnowledge(current);
    return engine.recordNpcBeliefTransition({
      ...current,
      proposition_ref: propositionRef,
      proposition_value: propositionValue,
      stance,
      modality: 'asserted',
      supporting_acquisition_ids: stance === 'supported' ? [acquisitionId] : [],
      contradicting_acquisition_ids: stance === 'supported' ? [] : [acquisitionId],
      reason_rule_ref: 'rule:belief-update-v1',
      idempotency_key: key,
    });
  };

  const supported = commit('supported', originalValue, 'adr-supported');
  assert.equal(supported.status, 'ready');
  assert.equal(supported.transition.stance, 'supported');
  assert.equal(supported.transition.modality, 'asserted');

  const contradictedValue = { value: 'not-the-observed-value' };
  const contradicted = commit('contradicted', contradictedValue, 'adr-contradicted');
  assert.equal(contradicted.status, 'ready');
  assert.equal(contradicted.transition.stance, 'contradicted');

  const uncertain = commit('uncertain', contradictedValue, 'adr-uncertain');
  assert.equal(uncertain.status, 'ready');
  assert.equal(uncertain.transition.stance, 'uncertain');

  const dropped = commit('dropped', contradictedValue, 'adr-dropped');
  assert.equal(dropped.status, 'ready');
  assert.equal(dropped.transition.stance, 'dropped');

  const row = store.db.prepare('SELECT stance,modality FROM npc_belief_transitions WHERE world_id=? ORDER BY committed_revision DESC LIMIT 1')
    .get('world-a');
  assert.deepEqual(row, { stance: 'dropped', modality: 'asserted' });
});

test('generic event callers cannot forge Core NPC belief transitions with a public option flag', (t) => {
  const { store, engine } = setup(t);
  const current = request(store);
  assert.throws(() => engine.commitEvent('world-a', {
    idempotency_key: 'forged-belief-transition',
    turn_id: 'forged-belief-transition',
    event_type: 'npc.belief.transitioned',
    expected_revision: current.expected_revision,
    expected_commit_sequence: current.expected_commit_sequence,
    effects: [{
      kind: 'npc.belief.transition',
      transition_id: 'npc-belief:forged',
      actor_id: 'npc-a',
      purpose: 'npc_turn_context',
      proposition_ref: 'proposition:fact/fact-a',
      proposition_value: 'source-backed-value',
      stance: 'believes_true',
      supporting_acquisition_ids: ['invented-acquisition'],
      contradicting_acquisition_ids: [],
      evidence_acquisition_ids: ['invented-acquisition'],
      reason_rule_ref: 'rule:forged',
      idempotency_key: 'forged-belief-transition',
      request_hash: 'a'.repeat(64),
      snapshot_revision: current.expected_revision,
      snapshot_commit_sequence: current.expected_commit_sequence,
      previous_stance: null,
      surviving_prior_evidence: [],
      invalidated_prior_evidence: [],
      prior_stance_preserved_despite_invalidation: false,
    }],
  }, { allowNpcBeliefTransition: true }), { code: 'UNSUPPORTED_EFFECT' });
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM npc_belief_transitions').get().count, 0);
});

test('generic event callers cannot forge knowledge acquisition with a public option flag', (t) => {
  const { store, engine } = setup(t);
  const current = request(store);
  const read = engine.readNpcKnowledge(current);
  assert.throws(() => engine.commitEvent('world-a', {
    idempotency_key: 'forged-acquisition-option',
    turn_id: 'forged-acquisition-option',
    event_type: 'knowledge.acquisition.initial',
    expected_revision: current.expected_revision,
    expected_commit_sequence: current.expected_commit_sequence,
    effects: [{
      kind: 'knowledge.acquire',
      acquisition_id: 'acq:forged',
      subject_id: 'npc-a',
      fact_id: read.items[0].fact_id,
      acquisition_kind: 'author_initial',
      provenance_ref: 'authoring:forged',
      provenance_digest: 'b'.repeat(64),
      authorization_ref: 'rule:forged',
    }],
  }, { allowKnowledgeAcquisition: true }), { code: 'UNSUPPORTED_EFFECT' });
});

test('rolling back a belief transition removes its derived projection on rebuild', (t) => {
  const { store, engine } = setup(t);
  const current = request(store);
  const read = engine.readNpcKnowledge(current);
  const first = engine.recordNpcBeliefTransition({
    ...current,
    proposition_ref: propositionRefFor(read.items[0]),
    proposition_value: read.items[0].value,
    stance: 'believes_true',
    supporting_acquisition_ids: [read.items[0].acquisition_id],
    contradicting_acquisition_ids: [],
    reason_rule_ref: 'rule:belief-update-v1',
    idempotency_key: 'belief-transition-rollback',
  });
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM npc_belief_transitions').get().count, 1);
  engine.rollbackEvent('world-a', {
    root_event_id: first.transition.event_id,
    idempotency_key: 'rollback-belief-transition',
  });
  store.rebuild('world-a', store.world('world-a').world_revision);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM npc_belief_transitions').get().count, 0);
});

test('belief transition idempotency key cannot be reused for a different stance', (t) => {
  const { store, engine } = setup(t);
  const current = request(store);
  const read = engine.readNpcKnowledge(current);
  const input = {
    ...current,
    proposition_ref: propositionRefFor(read.items[0]),
    proposition_value: read.items[0].value,
    stance: 'believes_true',
    supporting_acquisition_ids: [read.items[0].acquisition_id],
    contradicting_acquisition_ids: [],
    reason_rule_ref: 'rule:belief-update-v1',
    idempotency_key: 'belief-transition-reused-key',
  };
  engine.recordNpcBeliefTransition(input);
  assert.throws(() => engine.recordNpcBeliefTransition({
    ...input,
    stance: 'suspects_true',
  }), { code: 'IDEMPOTENCY_KEY_REUSED' });
});

test('idempotent belief replay rechecks current read authorization and returns no belief content', (t) => {
  const { store, engine } = setup(t);
  const current = request(store);
  const read = engine.readNpcKnowledge(current);
  const input = {
    ...current,
    proposition_ref: propositionRefFor(read.items[0]),
    proposition_value: read.items[0].value,
    stance: 'believes_true',
    supporting_acquisition_ids: [read.items[0].acquisition_id],
    contradicting_acquisition_ids: [],
    reason_rule_ref: 'rule:belief-update-v1',
    idempotency_key: 'belief-replay-requires-current-authorization',
  };
  const committed = engine.recordNpcBeliefTransition(input);
  const denied = new LogicEngine(store, {
    trustedInitialKnowledgeSources: trustedRegistry,
    npcKnowledgeReadAuthorizer: (scope) => ({
      status: 'denied',
      world_id: scope.world_id,
      conversation_id: scope.conversation_id,
      adapter_id: scope.adapter_id,
      actor_id: scope.actor_id,
      recipient: scope.recipient,
      purpose: scope.purpose,
      world_revision: scope.world_revision,
      commit_sequence: scope.commit_sequence,
      authorization_ref: 'rule:read-revoked',
    }),
  });
  assert.throws(() => denied.recordNpcBeliefTransition(input), {
    code: 'NPC_KNOWLEDGE_READ_NOT_READY',
  });
  const replay = engine.recordNpcBeliefTransition(input);
  assert.equal(replay.idempotent_replay, true);
  assert.deepEqual(Object.keys(replay.transition).sort(), ['committed_revision', 'event_id', 'transition_id']);
  assert.equal(replay.transition.event_id, committed.transition.event_id);
});

test('belief-state reads do not disclose a proposition whose current evidence is withheld', (t) => {
  const { store, engine } = setup(t);
  const current = request(store);
  const read = engine.readNpcKnowledge(current);
  const propositionRef = propositionRefFor(read.items[0]);
  engine.recordNpcBeliefTransition({
    ...current,
    proposition_ref: propositionRef,
    proposition_value: read.items[0].value,
    stance: 'believes_true',
    supporting_acquisition_ids: [read.items[0].acquisition_id],
    contradicting_acquisition_ids: [],
    reason_rule_ref: 'rule:belief-update-v1',
    idempotency_key: 'belief-state-withheld',
  });
  const denied = new LogicEngine(store, {
    trustedInitialKnowledgeSources: trustedRegistry,
    npcKnowledgeReadAuthorizer: (scope) => ({
      status: 'authorized',
      world_id: scope.world_id,
      conversation_id: scope.conversation_id,
      adapter_id: scope.adapter_id,
      actor_id: scope.actor_id,
      recipient: scope.recipient,
      purpose: scope.purpose,
      world_revision: scope.world_revision,
      commit_sequence: scope.commit_sequence,
      authorization_ref: 'rule:npc-read-v1',
    }),
    npcKnowledgeVisibilityAuthorizer: (scope) => ({
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
      authorization_ref: 'rule:npc-visibility-deny-v1',
    }),
  });
  const state = denied.getNpcBeliefState({
    ...request(store),
    proposition_ref: propositionRef,
  });
  assert.deepEqual(state, {
    status: 'unavailable',
    actor_id: 'npc-a',
    proposition_ref: propositionRef,
  });
  assert.equal('proposition_value' in state, false);
  assert.equal('stance' in state, false);
});

test('rollback of an acquisition invalidates its belief support but preserves the belief transition for reconciliation', (t) => {
  const { store, engine, acquisition } = setup(t);
  const current = request(store);
  const read = engine.readNpcKnowledge(current);
  engine.recordNpcBeliefTransition({
    ...current,
    proposition_ref: propositionRefFor(read.items[0]),
    proposition_value: read.items[0].value,
    stance: 'believes_true',
    supporting_acquisition_ids: [read.items[0].acquisition_id],
    contradicting_acquisition_ids: [],
    reason_rule_ref: 'rule:belief-update-v1',
    idempotency_key: 'belief-transition-before-source-rollback',
  });
  engine.rollbackEvent('world-a', {
    root_event_id: acquisition.event_id,
    idempotency_key: 'rollback-acquisition-after-belief',
  });
  const fresh = request(store);
  const state = engine.getNpcBeliefState({
    ...fresh,
    proposition_ref: propositionRefFor(read.items[0]),
  });
  assert.equal(state.status, 'ready');
  assert.equal(state.stance, 'believes_true');
  assert.equal(state.evidence_status, 'unsupported');
  assert.deepEqual(state.surviving_evidence_acquisition_ids, []);
  assert.equal(store.db.prepare(
    'SELECT COUNT(*) AS count FROM npc_belief_transitions WHERE proposition_ref=?'
  ).get(propositionRefFor(read.items[0])).count, 1);
});

test('belief transition refuses a stale snapshot and does not write a projection row', (t) => {
  const { store, engine } = setup(t);
  const stale = request(store);
  const read = engine.readNpcKnowledge(stale);
  engine.commitEvent('world-a', {
    event_id: 'advance-before-belief-transition',
    idempotency_key: 'advance-before-belief-transition-key',
    turn_id: 'advance-before-belief-transition',
    event_type: 'action.completed',
    expected_revision: stale.expected_revision,
    effects: [],
  });
  assert.throws(() => engine.recordNpcBeliefTransition({
    ...stale,
    proposition_ref: propositionRefFor(read.items[0]),
    proposition_value: read.items[0].value,
    stance: 'believes_true',
    supporting_acquisition_ids: ['some-acquisition'],
    contradicting_acquisition_ids: [],
    reason_rule_ref: 'rule:belief-update-v1',
    idempotency_key: 'belief-transition-stale-snapshot',
  }), { code: 'NPC_KNOWLEDGE_READ_NOT_READY' });
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM npc_belief_transitions').get().count, 0);
});



test('over-limit contradictory acquisition fails closed before context or belief persistence', (t) => {
  const store = new SQLiteStore(':memory:');
  t.after(() => store.close());

  const multiSourceBytes = JSON.stringify({
    schema_version: 1,
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    source_kind: 'author_initial',
    source_ref: 'authoring:test.world@1.0.0',
    authorization_ref: 'rule:initial-knowledge-v1',
    assignments: [
      { subject_id: 'npc-a', fact_id: 'fact-a' },
      { subject_id: 'npc-a', fact_id: 'fact-b' },
    ],
  });
  const registry = [{
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    source_kind: 'author_initial',
    source_ref: 'authoring:test.world@1.0.0',
    authorization_ref: 'rule:initial-knowledge-v1',
    sha256: createHash('sha256').update(multiSourceBytes).digest('hex'),
  }];
  const engine = new LogicEngine(store, {
    trustedInitialKnowledgeSources: registry,
    npcKnowledgeReadAuthorizer: (scope) => ({
      status: 'authorized',
      world_id: scope.world_id,
      conversation_id: scope.conversation_id,
      adapter_id: scope.adapter_id,
      actor_id: scope.actor_id,
      recipient: scope.recipient,
      purpose: scope.purpose,
      world_revision: scope.world_revision,
      commit_sequence: scope.commit_sequence,
      authorization_ref: 'rule:npc-read-v1',
    }),
    npcKnowledgeVisibilityAuthorizer: (scope) => ({
      status: 'allowed',
      world_id: scope.world_id,
      conversation_id: scope.conversation_id,
      adapter_id: scope.adapter_id,
      actor_id: scope.actor_id,
      recipient: scope.recipient,
      purpose: scope.purpose,
      world_revision: scope.world_revision,
      commit_sequence: scope.commit_sequence,
      acquisition_id: scope.acquisition_id,
      authorization_ref: 'rule:npc-visibility-v1',
    }),
  });

  const binding = { adapter_id: 'adapter-st', conversation_id: 'conversation-a', world_id: 'world-a' };
  engine.createWorld({
    world_id: 'world-a',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2026-01-01T00:00:00Z',
  });
  store.db.prepare(`
    INSERT INTO host_conversation_world_bindings(
      adapter_id,conversation_id,world_id,active,created_at,updated_at
    ) VALUES(?,?,?,1,datetime('now'),datetime('now'))
  `).run(binding.adapter_id, binding.conversation_id, binding.world_id);
  engine.commitEvent('world-a', {
    event_id: 'author-seed',
    idempotency_key: 'author-seed-key',
    turn_id: 'author-seed',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [
      { kind: 'entity.create', entity_id: 'npc-a', entity_type: 'character' },
      { kind: 'fact.set', fact_id: 'fact-a', subject_ref: 'character:target', predicate: 'location', value: 'Kamurocho' },
      { kind: 'fact.set', fact_id: 'fact-b', subject_ref: 'character:target', predicate: 'location', value: 'Sotenbori' },
    ],
  });
  engine.recordTrustedInitialKnowledgeSource({
    world_id: 'world-a',
    source_bytes: multiSourceBytes,
    idempotency_key: 'author-source-multi',
    expected_revision: 1,
    expected_commit_sequence: 1,
  });

  const current = request(store, { limit: 1 });
  const read = engine.readNpcKnowledge(current);
  assert.equal(read.items.length, 1);
  assert.equal(read.truncated, true);
  assert.throws(() => engine.prepareNpcBeliefContext(current, {
    world_id: read.world_id,
    actor_id: read.actor_id,
    snapshot: read.snapshot,
    proposition_ref: propositionRefFor(read.items[0]),
    proposition_value: read.items[0].value,
    stance: 'believes_true',
    supporting_acquisition_ids: [read.items[0].acquisition_id],
    contradicting_acquisition_ids: [],
    reason_rule_ref: 'rule:belief-update-v1',
  }), { code: 'NPC_KNOWLEDGE_READ_INCOMPLETE' });

  assert.throws(() => engine.getNpcBeliefState({
    ...current,
    proposition_ref: propositionRefFor(read.items[0]),
  }), { code: 'NPC_KNOWLEDGE_READ_INCOMPLETE' });

  assert.throws(() => engine.recordNpcBeliefTransition({
    ...current,
    proposition_ref: propositionRefFor(read.items[0]),
    proposition_value: read.items[0].value,
    stance: 'believes_true',
    supporting_acquisition_ids: [read.items[0].acquisition_id],
    contradicting_acquisition_ids: [],
    reason_rule_ref: 'rule:belief-update-v1',
    idempotency_key: 'belief-transition-incomplete-inventory',
  }), { code: 'NPC_KNOWLEDGE_READ_INCOMPLETE' });
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM npc_belief_transitions').get().count, 0);
});

test('hidden proposition availability is indistinguishable when no belief transition exists', (t) => {
  const { store } = setup(t);
  const current = request(store);
  const read = new LogicEngine(store, {
    trustedInitialKnowledgeSources: trustedRegistry,
    npcKnowledgeReadAuthorizer: (scope) => ({
      status: 'authorized',
      world_id: scope.world_id,
      conversation_id: scope.conversation_id,
      adapter_id: scope.adapter_id,
      actor_id: scope.actor_id,
      recipient: scope.recipient,
      purpose: scope.purpose,
      world_revision: scope.world_revision,
      commit_sequence: scope.commit_sequence,
      authorization_ref: 'rule:npc-read-v1',
    }),
    npcKnowledgeVisibilityAuthorizer: (scope) => ({
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
      authorization_ref: 'rule:npc-visibility-deny-v1',
    }),
  });
  const item = read.readNpcKnowledge(current).items[0];
  const state = read.getNpcBeliefState({
    ...current,
    proposition_ref: propositionRefFor(item),
  });
  assert.deepEqual(state, {
    status: 'unavailable',
    actor_id: 'npc-a',
    proposition_ref: propositionRefFor(item),
  });
});

test('NPC acquisition remains pinned to its acquired fact version and rejects projection drift', (t) => {
  const { store, engine } = setup(t);
  const acquired = store.db.prepare(`
    SELECT acquired_value_json, acquired_source_event_ids_json
    FROM knowledge_acquisitions WHERE world_id='world-a' AND subject_id='npc-a' AND fact_id='fact-a'
  `).get();
  assert.ok(acquired);
  assert.equal(acquired.acquired_value_json, JSON.stringify('source-backed-value'));
  assert.deepEqual(JSON.parse(acquired.acquired_source_event_ids_json), ['author-seed']);

  // Simulate a stale/replaced fact projection while the acquisition row survives.
  // The reader must not silently reinterpret the original acquisition as knowledge of the replacement.
  store.db.prepare(`
    UPDATE facts SET value_json=?, source_event_ids_json=?
    WHERE world_id='world-a' AND fact_id='fact-a'
  `).run(JSON.stringify('replacement-value'), JSON.stringify(['independent-source-event']));

  assert.throws(() => engine.readNpcKnowledge(request(store)), {
    code: 'NPC_KNOWLEDGE_ACQUISITION_VERSION_MISMATCH',
  });
});

test('rolling back a belief revision restores the previous valid belief without erasing history', (t) => {
  const { store, engine } = setup(t);
  const initial = request(store);
  const read = engine.readNpcKnowledge(initial);
  const proposition_ref = propositionRefFor(read.items[0]);
  const first = engine.recordNpcBeliefTransition({
    ...initial,
    proposition_ref,
    proposition_value: read.items[0].value,
    stance: 'believes_true',
    supporting_acquisition_ids: [read.items[0].acquisition_id],
    contradicting_acquisition_ids: [],
    reason_rule_ref: 'rule:belief-update-v1',
    idempotency_key: 'belief-history-first',
  });
  assert.equal(first.status, 'ready');

  const revision = request(store);
  const second = engine.recordNpcBeliefTransition({
    ...revision,
    proposition_ref,
    proposition_value: read.items[0].value,
    stance: 'suspects_true',
    supporting_acquisition_ids: [read.items[0].acquisition_id],
    contradicting_acquisition_ids: [],
    reason_rule_ref: 'rule:belief-update-v1',
    idempotency_key: 'belief-history-revision',
  });
  assert.equal(second.status, 'ready');
  assert.equal(second.transition.previous_stance, 'believes_true');
  assert.equal(second.transition.stance_change, 'weakened');

  const rollback = engine.rollbackEvent('world-a', {
    root_event_id: second.transition.event_id,
    idempotency_key: 'rollback-belief-history-revision',
  });
  assert.equal(rollback.accepted, true);

  const afterRollback = request(store);
  const state = engine.getNpcBeliefState({
    ...afterRollback,
    proposition_ref,
  });
  assert.equal(state.status, 'ready');
  assert.equal(state.stance, 'believes_true');
  assert.equal(state.evidence_status, 'supported');
  assert.deepEqual(state.surviving_evidence_acquisition_ids, [read.items[0].acquisition_id]);

  const history = store.db.prepare(`
    SELECT transition_id, event_id
    FROM npc_belief_transitions
    WHERE world_id='world-a' AND actor_id='npc-a' AND proposition_ref=?
    ORDER BY committed_revision ASC
  `).all(proposition_ref);
  assert.equal(history.length, 1, 'the derived projection must omit the rolled-back transition');
  assert.equal(history[0].event_id, first.transition.event_id);
  assert.ok(store.db.prepare('SELECT event_id FROM world_events WHERE world_id=? AND event_id=?')
    .get('world-a', second.transition.event_id), 'canonical event history retains the rolled-back transition');
});

test('NPC revises a belief from newly acquired independent evidence after the old acquisition is rolled back', (t) => {
  const { store, engine, acquisition } = setup(t);
  const initial = request(store);
  const firstRead = engine.readNpcKnowledge(initial);
  const proposition_ref = propositionRefFor(firstRead.items[0]);
  const oldAcquisitionId = firstRead.items[0].acquisition_id;

  const originalBelief = engine.recordNpcBeliefTransition({
    ...initial,
    proposition_ref,
    proposition_value: firstRead.items[0].value,
    stance: 'believes_true',
    supporting_acquisition_ids: [oldAcquisitionId],
    contradicting_acquisition_ids: [],
    reason_rule_ref: 'rule:belief-update-v1',
    idempotency_key: 'belief-before-independent-evidence',
  });
  assert.equal(originalBelief.status, 'ready');

  engine.rollbackEvent('world-a', {
    root_event_id: acquisition.event_id,
    idempotency_key: 'rollback-old-npc-acquisition',
  });

  const afterRollback = request(store);
  engine.commitEvent('world-a', {
    event_id: 'independent-fact-b',
    idempotency_key: 'independent-fact-b-key',
    turn_id: 'independent-fact-b',
    event_type: 'action.completed',
    expected_revision: afterRollback.expected_revision,
    expected_commit_sequence: afterRollback.expected_commit_sequence,
    effects: [{
      kind: 'fact.set',
      fact_id: 'fact-b',
      subject_ref: firstRead.items[0].subject_ref,
      predicate: firstRead.items[0].predicate,
      value: firstRead.items[0].value,
    }],
  });

  const independentSourceBytes = JSON.stringify({
    schema_version: 1,
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    source_kind: 'author_initial',
    source_ref: 'authoring:test.world/independent-fact-b',
    authorization_ref: 'rule:independent-knowledge-v1',
    assignments: [{ subject_id: 'npc-a', fact_id: 'fact-b' }],
  });
  const independentRegistry = [...trustedRegistry, {
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    source_kind: 'author_initial',
    source_ref: 'authoring:test.world/independent-fact-b',
    authorization_ref: 'rule:independent-knowledge-v1',
    sha256: createHash('sha256').update(independentSourceBytes).digest('hex'),
  }];
  const independentEngine = new LogicEngine(store, {
    trustedInitialKnowledgeSources: independentRegistry,
    npcKnowledgeReadAuthorizer: (scope) => ({
      status: 'authorized',
      world_id: scope.world_id,
      conversation_id: scope.conversation_id,
      adapter_id: scope.adapter_id,
      actor_id: scope.actor_id,
      recipient: scope.recipient,
      purpose: scope.purpose,
      world_revision: scope.world_revision,
      commit_sequence: scope.commit_sequence,
      authorization_ref: 'rule:npc-read-v1',
    }),
    npcKnowledgeVisibilityAuthorizer: (scope) => ({
      status: 'allowed',
      world_id: scope.world_id,
      conversation_id: scope.conversation_id,
      adapter_id: scope.adapter_id,
      actor_id: scope.actor_id,
      recipient: scope.recipient,
      purpose: scope.purpose,
      world_revision: scope.world_revision,
      commit_sequence: scope.commit_sequence,
      acquisition_id: scope.acquisition_id,
      authorization_ref: 'rule:npc-visibility-v1',
    }),
  });

  const beforeAcquisition = request(store);
  const newAcquisition = independentEngine.recordTrustedInitialKnowledgeSource({
    world_id: 'world-a',
    source_bytes: independentSourceBytes,
    idempotency_key: 'acquire-independent-fact-b',
    expected_revision: beforeAcquisition.expected_revision,
    expected_commit_sequence: beforeAcquisition.expected_commit_sequence,
  });
  assert.equal(newAcquisition.accepted, true);

  const fresh = request(store);
  const freshRead = independentEngine.readNpcKnowledge(fresh);
  assert.equal(freshRead.items.length, 1);
  assert.equal(freshRead.items[0].fact_id, 'fact-b');
  assert.notEqual(freshRead.items[0].acquisition_id, oldAcquisitionId);
  assert.equal(propositionRefFor(freshRead.items[0]), proposition_ref);

  const revised = independentEngine.recordNpcBeliefTransition({
    ...fresh,
    proposition_ref,
    proposition_value: freshRead.items[0].value,
    stance: 'suspects_true',
    supporting_acquisition_ids: [freshRead.items[0].acquisition_id],
    contradicting_acquisition_ids: [],
    reason_rule_ref: 'rule:belief-update-v1',
    idempotency_key: 'belief-revised-from-independent-evidence',
  });
  assert.equal(revised.status, 'ready');
  assert.equal(revised.transition.previous_stance, 'believes_true');
  assert.equal(revised.transition.stance, 'suspects_true');

  const latest = request(store);
  const state = independentEngine.getNpcBeliefState({
    ...latest,
    proposition_ref,
  });
  assert.equal(state.status, 'ready');
  assert.equal(state.stance, 'suspects_true');
  assert.equal(state.evidence_status, 'supported');
  assert.deepEqual(state.surviving_evidence_acquisition_ids, [freshRead.items[0].acquisition_id]);
  assert.equal(state.surviving_evidence_acquisition_ids.includes(oldAcquisitionId), false);

  const history = store.db.prepare(`
    SELECT COUNT(*) AS count FROM npc_belief_transitions
    WHERE world_id='world-a' AND actor_id='npc-a' AND proposition_ref=?
  `).get(proposition_ref);
  assert.equal(history.count, 2, 'the old belief must remain in history beside the revised belief');
});

test('source rollback and same fact-id replacement do not refresh an NPC acquisition without a new grant', (t) => {
  const store = new SQLiteStore(':memory:');
  t.after(() => store.close());

  const sourceA = JSON.stringify({
    schema_version: 1,
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    source_kind: 'author_initial',
    source_ref: 'authoring:test.world/fact-a',
    authorization_ref: 'rule:initial-knowledge-v1',
    assignments: [{ subject_id: 'npc-a', fact_id: 'fact-a' }],
  });
  const sourceB = JSON.stringify({
    schema_version: 1,
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    source_kind: 'author_initial',
    source_ref: 'authoring:test.world/fact-b-replacement',
    authorization_ref: 'rule:replacement-knowledge-v1',
    assignments: [{ subject_id: 'npc-a', fact_id: 'fact-a' }],
  });
  const trustedInitialKnowledgeSources = [
    {
      world_pack_id: 'test.world',
      world_pack_version: '1.0.0',
      source_kind: 'author_initial',
      source_ref: 'authoring:test.world/fact-a',
      authorization_ref: 'rule:initial-knowledge-v1',
      sha256: createHash('sha256').update(sourceA).digest('hex'),
    },
    {
      world_pack_id: 'test.world',
      world_pack_version: '1.0.0',
      source_kind: 'author_initial',
      source_ref: 'authoring:test.world/fact-b-replacement',
      authorization_ref: 'rule:replacement-knowledge-v1',
      sha256: createHash('sha256').update(sourceB).digest('hex'),
    },
  ];
  const authorizer = (scope) => ({
    status: 'authorized',
    world_id: scope.world_id,
    conversation_id: scope.conversation_id,
    adapter_id: scope.adapter_id,
    actor_id: scope.actor_id,
    recipient: scope.recipient,
    purpose: scope.purpose,
    world_revision: scope.world_revision,
    commit_sequence: scope.commit_sequence,
    authorization_ref: 'rule:npc-read-v1',
  });
  const visibilityAuthorizer = (scope) => ({
    status: 'allowed',
    world_id: scope.world_id,
    conversation_id: scope.conversation_id,
    adapter_id: scope.adapter_id,
    actor_id: scope.actor_id,
    recipient: scope.recipient,
    purpose: scope.purpose,
    world_revision: scope.world_revision,
    commit_sequence: scope.commit_sequence,
    acquisition_id: scope.acquisition_id,
    authorization_ref: 'rule:npc-visibility-v1',
  });
  const engine = new LogicEngine(store, {
    trustedInitialKnowledgeSources,
    npcKnowledgeReadAuthorizer: authorizer,
    npcKnowledgeVisibilityAuthorizer: visibilityAuthorizer,
  });

  engine.createWorld({
    world_id: 'world-a',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2026-01-01T00:00:00Z',
  });
  engine.commitEvent('world-a', {
    event_id: 'npc-seed',
    idempotency_key: 'npc-seed-key',
    turn_id: 'npc-seed',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [{ kind: 'entity.create', entity_id: 'npc-a', entity_type: 'character' }],
  });
  engine.commitEvent('world-a', {
    event_id: 'fact-a-source',
    idempotency_key: 'fact-a-source-key',
    turn_id: 'fact-a-source',
    event_type: 'action.completed',
    expected_revision: 1,
    effects: [{
      kind: 'fact.set',
      fact_id: 'fact-a',
      subject_ref: 'entity:target',
      predicate: 'location',
      value: 'Kamurochō',
    }],
  });

  const beforeAcquisition = request(store);
  const acquiredA = engine.recordTrustedInitialKnowledgeSource({
    world_id: 'world-a',
    source_bytes: sourceA,
    idempotency_key: 'acquire-fact-a',
    expected_revision: beforeAcquisition.expected_revision,
    expected_commit_sequence: beforeAcquisition.expected_commit_sequence,
  });
  assert.equal(acquiredA.accepted, true);
  const firstRead = engine.readNpcKnowledge(request(store));
  assert.equal(firstRead.status, 'ready');
  assert.equal(firstRead.items.length, 1);
  assert.equal(firstRead.items[0].value, 'Kamurochō');

  engine.rollbackEvent('world-a', {
    root_event_id: 'fact-a-source',
    idempotency_key: 'rollback-fact-a-source',
  });

  const afterRollback = request(store);
  engine.commitEvent('world-a', {
    event_id: 'fact-a-replacement-b',
    idempotency_key: 'fact-a-replacement-b-key',
    turn_id: 'fact-a-replacement-b',
    event_type: 'action.completed',
    expected_revision: afterRollback.expected_revision,
    expected_commit_sequence: afterRollback.expected_commit_sequence,
    effects: [{
      kind: 'fact.set',
      fact_id: 'fact-a',
      subject_ref: 'entity:target',
      predicate: 'location',
      value: 'Sotenbori',
    }],
  });

  const withoutNewGrant = engine.readNpcKnowledge(request(store));
  assert.equal(withoutNewGrant.status, 'ready');
  assert.deepEqual(withoutNewGrant.items, [],
    'the replacement value for the same fact_id is not knowledge acquired by the NPC');

  const beforeReplacementGrant = request(store);
  const acquiredB = engine.recordTrustedInitialKnowledgeSource({
    world_id: 'world-a',
    source_bytes: sourceB,
    idempotency_key: 'acquire-fact-a-replacement-b',
    expected_revision: beforeReplacementGrant.expected_revision,
    expected_commit_sequence: beforeReplacementGrant.expected_commit_sequence,
  });
  assert.equal(acquiredB.accepted, true);

  const afterNewGrant = engine.readNpcKnowledge(request(store));
  assert.equal(afterNewGrant.status, 'ready');
  assert.equal(afterNewGrant.items.length, 1);
  assert.equal(afterNewGrant.items[0].fact_id, 'fact-a');
  assert.equal(afterNewGrant.items[0].value, 'Sotenbori');
  assert.notEqual(afterNewGrant.items[0].acquisition_id, firstRead.items[0].acquisition_id);
});


test('NPC read and full belief-context authorization hold the shared Coordinator lease against cross-connection revocation', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-npc-authorization-lease-'));
  const corePath = join(directory, 'core.sqlite');
  const store = new SQLiteStore(corePath);
  const competingStore = new SQLiteStore(corePath);
  competingStore.coordinatorDb.exec('PRAGMA busy_timeout=0;');
  t.after(() => {
    try { competingStore.close(); } catch {}
    try { store.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });

  const binding = {
    adapter_id: 'adapter-st',
    conversation_id: 'conversation-a',
    world_id: 'world-a',
  };
  let blockedRevocationAttempts = 0;
  const assertRevocationBlocked = () => {
    assert.throws(() => competingStore.tx(() => {
      competingStore.db.prepare(`
        UPDATE host_conversation_world_bindings SET active=0
        WHERE adapter_id=? AND conversation_id=? AND world_id=?
      `).run(binding.adapter_id, binding.conversation_id, binding.world_id);
    }), /locked|busy/i);
    blockedRevocationAttempts++;
  };
  const readAuthorizer = (scope) => {
    assertRevocationBlocked();
    return {
      status: 'authorized',
      world_id: scope.world_id,
      conversation_id: scope.conversation_id,
      adapter_id: scope.adapter_id,
      actor_id: scope.actor_id,
      recipient: scope.recipient,
      purpose: scope.purpose,
      world_revision: scope.world_revision,
      commit_sequence: scope.commit_sequence,
      authorization_ref: 'rule:npc-read-cross-connection-lease',
    };
  };
  const visibilityAuthorizer = (scope) => {
    assertRevocationBlocked();
    return {
      status: 'allowed',
      world_id: scope.world_id,
      conversation_id: scope.conversation_id,
      adapter_id: scope.adapter_id,
      actor_id: scope.actor_id,
      recipient: scope.recipient,
      purpose: scope.purpose,
      world_revision: scope.world_revision,
      commit_sequence: scope.commit_sequence,
      acquisition_id: scope.acquisition_id,
      authorization_ref: 'rule:npc-visibility-cross-connection-lease',
    };
  };
  const engine = new LogicEngine(store, {
    trustedInitialKnowledgeSources: trustedRegistry,
    npcKnowledgeReadAuthorizer: readAuthorizer,
    npcKnowledgeVisibilityAuthorizer: visibilityAuthorizer,
  });
  engine.createWorld({
    world_id: 'world-a',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2026-01-01T00:00:00Z',
  });
  store.db.prepare(`
    INSERT INTO host_conversation_world_bindings(
      adapter_id,conversation_id,world_id,active,created_at,updated_at
    ) VALUES(?,?,?,1,datetime('now'),datetime('now'))
  `).run(binding.adapter_id, binding.conversation_id, binding.world_id);
  engine.commitEvent('world-a', {
    event_id: 'author-seed',
    idempotency_key: 'author-seed-key',
    turn_id: 'author-seed',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [
      { kind: 'entity.create', entity_id: 'npc-a', entity_type: 'character' },
      { kind: 'fact.set', fact_id: 'fact-a', subject_ref: 'entity:npc-a', predicate: 'secret', value: 'source-backed-value' },
    ],
  });
  engine.recordTrustedInitialKnowledgeSource({
    world_id: 'world-a',
    source_bytes: sourceBytes,
    idempotency_key: 'author-source-1',
    expected_revision: 1,
    expected_commit_sequence: 1,
  });

  const readRequest = request(store);
  const read = engine.readNpcKnowledge(readRequest);
  assert.equal(read.status, 'ready');
  assert.equal(blockedRevocationAttempts, 1);

  const proposal = {
    world_id: read.world_id,
    actor_id: read.actor_id,
    snapshot: read.snapshot,
    proposition_ref: propositionRefFor(read.items[0]),
    proposition_value: read.items[0].value,
    stance: 'believes_true',
    supporting_acquisition_ids: [read.items[0].acquisition_id],
    contradicting_acquisition_ids: [],
    reason_rule_ref: 'rule:belief-update-v1',
  };
  const prepared = engine.prepareNpcBeliefContext(readRequest, proposal);
  assert.equal(prepared.status, 'ready');
  assert.equal(blockedRevocationAttempts, 3);

  const beliefState = engine.getNpcBeliefState({
    ...readRequest,
    proposition_ref: proposal.proposition_ref,
  });
  assert.equal(beliefState.status, 'unknown');
  assert.equal(blockedRevocationAttempts, 5);

  const recorded = engine.recordNpcBeliefTransition({
    ...readRequest,
    proposition_ref: proposal.proposition_ref,
    proposition_value: proposal.proposition_value,
    stance: proposal.stance,
    supporting_acquisition_ids: proposal.supporting_acquisition_ids,
    contradicting_acquisition_ids: [],
    reason_rule_ref: 'rule:belief-update-v1',
    idempotency_key: 'cross-connection-lease-belief-transition',
  });
  assert.equal(recorded.status, 'ready');
  assert.equal(recorded.idempotent_replay, false);
  assert.equal(blockedRevocationAttempts, 10);
  assert.equal(store.db.prepare(
    'SELECT active FROM host_conversation_world_bindings WHERE adapter_id=? AND conversation_id=?'
  ).get(binding.adapter_id, binding.conversation_id).active, 1);
});


test('reader returns typed communication evidence only while its signed source version remains active', (t) => {
  const contentDigest = createHash('sha256').update('persisted Host message bytes').digest('hex');
  const installationId = '11111111-1111-4111-8111-111111111111';
  const accountId = '22222222-2222-4222-8222-222222222222';
  const sessionId = '33333333-3333-4333-8333-333333333333';
  const conversationUuid = '44444444-4444-4444-8444-444444444444';
  const messageId = '55555555-5555-4555-8555-555555555555';
  const versionId = '66666666-6666-4666-8666-666666666666';
  const hostEventId = '77777777-7777-4777-8777-777777777777';
  const mutationId = '88888888-8888-4888-8888-888888888888';
  const conversationId = [sessionId, installationId, conversationUuid].join(':');
  const digest = value => createHash('sha256').update(value).digest('hex');
  const receiptDigest = digest('signed receipt');
  const receiptSignature = digest('receipt signature');
  const inventoryDigest = digest('delivery inventory');
  const deliveredAt = '2026-11-14T10:00:00.000Z';
  const receiptProof = {
    host_installation_id: installationId,
    authenticated_account_id: accountId,
    host_session_id: sessionId,
    conversation_uuid: conversationUuid,
    event_id: hostEventId,
    event_type: 'MUTATION_COMMITTED',
    mutation_id: mutationId,
    operation: 'message-send',
    mutation_digest: digest('mutation'),
    receipt_digest: receiptDigest,
    occurred_at: deliveredAt,
    receipt_signature: receiptSignature,
  };
  const sourceEvidence = {
    protocol_version: 1,
    evidence_type: 'communication_delivered',
    producer: 'logic-engine-host-delivery-receipt-v1',
    adapter_id: 'adapter-st',
    host_commit: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
    host_installation_id: installationId,
    authenticated_account_id: accountId,
    host_session_id: sessionId,
    conversation_uuid: conversationUuid,
    sender: { principal_type: 'host_authenticated_account', principal_id: accountId },
    recipient: {
      world_id: 'world-a', actor_id: 'npc-a', actor_type: 'character',
      host_character_avatar_id: 'avatar-a',
    },
    source_attestation: {
      protocol_version: 1,
      host_commit: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
      snapshot_alignment: 'SHARED_VSS_SNAPSHOT',
      before_snapshot_id: 'snapshot-before',
      after_snapshot_id: 'snapshot-after',
      before_snapshot_sha256: digest('before snapshot'),
      after_snapshot_sha256: digest('after snapshot'),
      before_source_inventory_sha256: digest('before inventory'),
      after_source_inventory_sha256: digest('after inventory'),
      source_manifest_sha256: digest('source manifest'),
      mutation_coverage_manifest_sha256: digest('mutation manifest'),
      mutation_coverage_source_files_sha256: digest('mutation files'),
    },
    channel: 'sillytavern.character_chat',
    source: { message_id: messageId, version_id: versionId, content_sha256: contentDigest },
    status: 'delivered',
    delivered_at: deliveredAt,
    host_event_id: hostEventId,
    mutation_id: mutationId,
    receipt_digest: receiptDigest,
    receipt_signature: receiptSignature,
    receipt_proof: receiptProof,
    inventory_snapshot_digest: inventoryDigest,
  };
  let currentVersionState = {
    status: 'ready', world_id: 'world-a', conversation_id: conversationId,
    message_id: messageId, version_id: versionId, content_sha256: contentDigest,
    snapshot_digest: digest('current inventory'),
  };
  const hostVersionDigestLedger = {
    getVersionState(...args) {
      assert.deepEqual(args, ['world-a', conversationId, messageId, versionId]);
      return currentVersionState;
    },
  };
  const hostCommunicationReceiptVerifier = ({ adapter_id, receipt_digest, receipt_proof, source_evidence }) =>
    adapter_id === 'adapter-st'
      && receipt_digest === receiptDigest
      && receipt_proof.receipt_digest === receiptDigest
      && receipt_proof.receipt_signature === receiptSignature
      && source_evidence.receipt_signature === receiptSignature;
  const { store, engine } = setup(t, undefined, undefined, {
    hostVersionDigestLedger,
    hostCommunicationReceiptVerifier,
    npcEvidenceHandleKeyProvider: adapterId => adapterId === 'adapter-st'
      ? 'test-adapter-secret-for-opaque-evidence-handles' : null,
  });
  const deliveryKeys = [
    'protocol_version', 'evidence_type', 'producer', 'host_commit', 'host_installation_id',
    'authenticated_account_id', 'host_session_id', 'conversation_uuid', 'sender', 'recipient',
    'source_attestation', 'channel', 'source', 'status', 'delivered_at', 'host_event_id', 'mutation_id',
  ];
  const delivery = Object.fromEntries(deliveryKeys.map(key => [key, sourceEvidence[key]]));
  const acquisition = engine.recordTrustedCommunicationDelivery({
    world_id: 'world-a',
    adapter_id: 'adapter-st',
    conversation_id: conversationId,
    delivery,
    receipt_digest: receiptDigest,
    receipt_proof: receiptProof,
    inventory_snapshot_digest: inventoryDigest,
  });
  assert.equal(acquisition.status, 'committed');

  const readRequest = request(store, { conversation_id: conversationId });
  const result = engine.readNpcKnowledge(readRequest);
  const item = result.items.find(value => value.acquisition_kind === 'communication_delivered');
  assert.ok(item);
  assert.equal(item.evidence_type, 'communication_delivered');
  assert.equal(item.fact_id, null);
  assert.equal(item.source.message_id, messageId);
  assert.equal(item.source.version_id, versionId);
  assert.equal(item.source.content_sha256, contentDigest);
  assert.equal(item.delivery.status, 'delivered');
  assert.equal(Object.hasOwn(item, 'value'), false);
  assert.equal(Object.isFrozen(item.source_evidence.recipient), true);
  assert.equal(Object.hasOwn(item.source_evidence, 'message_text'), false);

  const factItem = result.items.find(value => value.fact_id === 'fact-a');
  const prepared = engine.prepareNpcBeliefContext(readRequest, {
    world_id: result.world_id,
    actor_id: result.actor_id,
    snapshot: result.snapshot,
    proposition_ref: propositionRefFor(factItem),
    proposition_value: factItem.value,
    stance: 'believes_true',
    supporting_acquisition_ids: [factItem.acquisition_id],
    contradicting_acquisition_ids: [],
    reason_rule_ref: 'rule:belief-update-v1',
  });
  assert.equal(prepared.status, 'ready');
  assert.deepEqual(prepared.transition.evidence_acquisition_ids, [factItem.acquisition_id]);
  assert.equal(Object.hasOwn(prepared, 'context'), false);

  const proposalContext = engine.createNpcBeliefProposalContext(readRequest);
  assert.equal(proposalContext.status, 'ready');
  assert.equal(proposalContext.model_context.propositions.length, 1);
  const modelProposition = proposalContext.model_context.propositions[0];
  assert.equal(modelProposition.subject_kind, 'current_actor');
  assert.equal(modelProposition.evidence.length, 1);
  assert.equal(modelProposition.evidence[0].evidence_type, 'author_initial');
  const modelProjectionText = JSON.stringify(proposalContext.model_context);
  for (const internal of ['world-a', 'npc-a', 'fact-a', 'author-seed', 'authoring:test.world@1.0.0', 'acq:']) {
    assert.equal(modelProjectionText.includes(internal), false);
  }
  assert.equal(proposalContext.authorization_context.world_id, 'world-a');
  const modelProposal = {
    schema_version: 1,
    context_handle: proposalContext.model_context.context_handle,
    proposition_handle: modelProposition.handle,
    object: modelProposition.evidence[0].object,
    supporting_evidence_handles: [modelProposition.evidence[0].handle],
    contradicting_evidence_handles: [],
  };
  const resolvedProposal = engine.resolveNpcBeliefProposalHandles({
    authorization_context: proposalContext.authorization_context,
    proposal: modelProposal,
  });
  assert.equal(resolvedProposal.status, 'ready');
  assert.equal(resolvedProposal.resolution.proposition_value, factItem.value);
  assert.deepEqual(resolvedProposal.resolution.supporting_acquisition_ids, [factItem.acquisition_id]);
  assert.deepEqual(resolvedProposal.resolution.contradicting_acquisition_ids, []);
  const internalObjectProposal = engine.resolveNpcBeliefProposalHandles({
    authorization_context: proposalContext.authorization_context,
    proposal: { ...modelProposal, object: 'entity:npc-b' },
  });
  assert.equal(internalObjectProposal.status, 'non_ready');
  assert.equal(internalObjectProposal.reason, 'proposal_object_contains_internal_reference');
  const opaqueHandleAsValue = engine.resolveNpcBeliefProposalHandles({
    authorization_context: proposalContext.authorization_context,
    proposal: { ...modelProposal, object: modelProposition.evidence[0].handle },
  });
  assert.equal(opaqueHandleAsValue.status, 'non_ready');
  assert.equal(opaqueHandleAsValue.reason, 'proposal_object_contains_internal_reference');
  const nestedOpaqueHandleAsValue = engine.resolveNpcBeliefProposalHandles({
    authorization_context: proposalContext.authorization_context,
    proposal: { ...modelProposal, object: { quoted_source: modelProposition.evidence[0].handle } },
  });
  assert.equal(nestedOpaqueHandleAsValue.status, 'non_ready');
  assert.equal(nestedOpaqueHandleAsValue.reason, 'proposal_object_contains_internal_reference');
  const opaqueHandleAsKey = engine.resolveNpcBeliefProposalHandles({
    authorization_context: proposalContext.authorization_context,
    proposal: { ...modelProposal, object: { [modelProposition.evidence[0].handle]: 'quoted value' } },
  });
  assert.equal(opaqueHandleAsKey.status, 'non_ready');
  assert.equal(opaqueHandleAsKey.reason, 'proposal_object_contains_internal_reference');

  const rawRead = engine.readNpcKnowledge(readRequest);
  const fixedNow = 1_800_000_000_000;
  const expiringContext = createOpaqueNpcBeliefProposalContext({
    read: rawRead,
    visibleItems: rawRead.items,
    key: 'test-adapter-secret-for-opaque-evidence-handles',
    limit: readRequest.limit,
    now: () => fixedNow,
  });
  const expiringProposition = expiringContext.model_context.propositions[0];
  const expiryProposal = {
    schema_version: 1,
    context_handle: expiringContext.model_context.context_handle,
    proposition_handle: expiringProposition.handle,
    object: expiringProposition.evidence[0].object,
    supporting_evidence_handles: [expiringProposition.evidence[0].handle],
    contradicting_evidence_handles: [],
  };
  const expiredResolution = resolveOpaqueNpcBeliefProposalHandles({
    read: rawRead,
    visibleItems: rawRead.items,
    key: 'test-adapter-secret-for-opaque-evidence-handles',
    authorizationContext: proposalContext.authorization_context,
    proposal: expiryProposal,
    now: () => Number(expiringContext.model_context.context_handle.split('.')[2]) + 1,
  });
  assert.equal(expiredResolution.status, 'non_ready');
  assert.equal(expiredResolution.reason, 'invalid_expired_or_wrong_scope_context_handle');
  const expiredReplayContext = verifyNpcBeliefProposalContextHandle({
    authorizationContext: expiringContext.authorization_context,
    contextHandle: expiringContext.model_context.context_handle,
    key: 'test-adapter-secret-for-opaque-evidence-handles',
    now: () => Number(expiringContext.model_context.context_handle.split('.')[2]) + 1,
    allowExpired: true,
  });
  assert.equal(expiredReplayContext.status, 'ready');
  const expiredNormalContext = verifyNpcBeliefProposalContextHandle({
    authorizationContext: expiringContext.authorization_context,
    contextHandle: expiringContext.model_context.context_handle,
    key: 'test-adapter-secret-for-opaque-evidence-handles',
    now: () => Number(expiringContext.model_context.context_handle.split('.')[2]) + 1,
  });
  assert.equal(expiredNormalContext.status, 'non_ready');
  const crossActorReplayContext = verifyNpcBeliefProposalContextHandle({
    authorizationContext: {
      ...expiringContext.authorization_context,
      actor_id: 'npc-b',
    },
    contextHandle: expiringContext.model_context.context_handle,
    key: 'test-adapter-secret-for-opaque-evidence-handles',
    now: () => fixedNow + 1,
    allowExpired: true,
  });
  assert.equal(crossActorReplayContext.status, 'non_ready');
  assert.throws(() => createOpaqueNpcBeliefProposalContext({
    read: rawRead,
    visibleItems: [{ ...factItem, value: 'entity:unresolved-internal-id' }],
    key: 'test-adapter-secret-for-opaque-evidence-handles',
    limit: readRequest.limit,
  }), /fail closed/);

  assert.throws(() => engine.resolveNpcBeliefProposalHandles({
    authorization_context: proposalContext.authorization_context,
    proposal: {
      ...modelProposal,
      supporting_evidence_handles: ['evh1.' + 'A'.repeat(43)],
    },
  }), { code: 'NPC_BELIEF_HANDLE_RESOLUTION_FAILED' });
  assert.throws(() => engine.resolveNpcBeliefProposalHandles({
    authorization_context: { ...proposalContext.authorization_context, actor_id: 'npc-b' },
    proposal: modelProposal,
  }), { code: 'NPC_BELIEF_HANDLE_RESOLUTION_FAILED' });

  engine.commitEvent('world-a', {
    event_id: 'opaque-handle-stale-snapshot',
    idempotency_key: 'opaque-handle-stale-snapshot',
    turn_id: 'opaque-handle-stale-snapshot',
    event_type: 'action.completed',
    expected_revision: readRequest.expected_revision,
    effects: [{ kind: 'entity.create', entity_id: 'npc-after-context', entity_type: 'character' }],
  });
  assert.throws(() => engine.resolveNpcBeliefProposalHandles({
    authorization_context: proposalContext.authorization_context,
    proposal: modelProposal,
  }), { code: 'NPC_KNOWLEDGE_READ_NOT_READY' });

  currentVersionState = { status: 'non_ready', code: 'HOST_VERSION_NOT_ACTIVE' };
  assert.throws(() => engine.readNpcKnowledge(request(store, { conversation_id: conversationId })), {
    code: 'NPC_KNOWLEDGE_SOURCE_NOT_READY',
  });

  currentVersionState = {
    status: 'ready', world_id: 'world-a', conversation_id: conversationId,
    message_id: messageId, version_id: versionId, content_sha256: digest('different version bytes'),
    snapshot_digest: digest('current inventory'),
  };
  assert.throws(() => engine.readNpcKnowledge(request(store, { conversation_id: conversationId })), {
    code: 'NPC_KNOWLEDGE_SOURCE_NOT_READY',
  });

  currentVersionState = {
    status: 'ready', world_id: 'world-a', conversation_id: conversationId,
    message_id: messageId, version_id: versionId, content_sha256: contentDigest,
    snapshot_digest: digest('current inventory'),
  };
  engine.hostCommunicationReceiptVerifier = () => false;
  assert.throws(() => engine.readNpcKnowledge(request(store, { conversation_id: conversationId })), {
    code: 'NPC_KNOWLEDGE_SOURCE_NOT_AUTHORIZED',
  });
});
