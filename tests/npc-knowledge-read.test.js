import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
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
  actor_id: scope.actor_id,
  purpose: scope.purpose,
  world_revision: scope.world_revision,
  commit_sequence: scope.commit_sequence,
  authorization_ref: 'rule:npc-read-v1',
})) {
  const store = new SQLiteStore(':memory:');
  t.after(() => store.close());
  const visibilityAuthorizer = (scope) => ({
    status: 'allowed',
    world_id: scope.world_id,
    actor_id: scope.actor_id,
    purpose: scope.purpose,
    world_revision: scope.world_revision,
    commit_sequence: scope.commit_sequence,
    acquisition_id: scope.acquisition_id,
    authorization_ref: 'rule:npc-visibility-v1',
  });
  const engine = new LogicEngine(store, {
    trustedInitialKnowledgeSources: trustedRegistry,
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
    event_id: 'author-seed',
    idempotency_key: 'author-seed-key',
    turn_id: 'author-seed',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [
      { kind: 'entity.create', entity_id: 'npc-a', entity_type: 'character' },
      { kind: 'entity.create', entity_id: 'npc-b', entity_type: 'character' },
      { kind: 'fact.set', fact_id: 'fact-a', predicate: 'secret', value: 'source-backed-value' },
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
    actor_id: 'npc-a',
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
      actor_id: 'npc-b',
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
        actor_id: scope.actor_id,
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

test('reader configuration rejects an asynchronous trusted authorizer', (t) => {
  const { store } = setup(t);
  assert.throws(() => new LogicEngine(store, {
    trustedInitialKnowledgeSources: trustedRegistry,
    npcKnowledgeReadAuthorizer: async (scope) => ({
      status: 'authorized',
      world_id: scope.world_id,
      actor_id: scope.actor_id,
      purpose: scope.purpose,
      world_revision: scope.world_revision,
      commit_sequence: scope.commit_sequence,
      authorization_ref: 'rule:npc-read-v1',
    }),
  }), {
    name: 'TypeError',
    message: 'npcKnowledgeReadAuthorizer must be a synchronous deployment-owned function',
  });
});

test('reader rejects unsupported purpose, unknown actor, and malformed limits', (t) => {
  const { store, engine } = setup(t);
  assert.throws(() => engine.readNpcKnowledge(request(store, { purpose: 'prompt_injection' })), {
    code: 'INVALID_NPC_KNOWLEDGE_READ',
  });
  assert.throws(() => engine.readNpcKnowledge(request(store, { actor_id: 'missing-npc' })), {
    code: 'NPC_KNOWLEDGE_READER_NOT_ELIGIBLE',
  });
  assert.throws(() => engine.readNpcKnowledge(request(store, { limit: 201 })), {
    code: 'INVALID_NPC_KNOWLEDGE_READ',
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
    actor_id: 'npc-a',
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

test('Core omits denied acquisitions from the belief context and rejects proposals relying on them', (t) => {
  const { store } = setup(t);
  const engine = new LogicEngine(store, {
    trustedInitialKnowledgeSources: trustedRegistry,
    npcKnowledgeReadAuthorizer: (scope) => ({
      status: 'authorized',
      world_id: scope.world_id,
      actor_id: scope.actor_id,
      purpose: scope.purpose,
      world_revision: scope.world_revision,
      commit_sequence: scope.commit_sequence,
      authorization_ref: 'rule:npc-read-v1',
    }),
    npcKnowledgeVisibilityAuthorizer: (scope) => ({
      status: 'denied',
      world_id: scope.world_id,
      actor_id: scope.actor_id,
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

test('Core requires a trusted visibility authorizer before preparing model context', (t) => {
  const { store } = setup(t);
  const engine = new LogicEngine(store, { trustedInitialKnowledgeSources: trustedRegistry,
    npcKnowledgeReadAuthorizer: (scope) => ({
      status: 'authorized',
      world_id: scope.world_id,
      actor_id: scope.actor_id,
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
      actor_id: scope.actor_id,
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
        actor_id: scope.actor_id,
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
  assert.deepEqual(JSON.parse(row.proposition_value_json), read.items[0].value);
  assert.deepEqual(JSON.parse(row.evidence_acquisition_ids_json), [read.items[0].acquisition_id]);
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
    "SELECT COUNT(*) AS count FROM npc_belief_transitions WHERE proposition_ref='proposition:fact/fact-a'"
  ).get().count, 1);
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
      actor_id: scope.actor_id,
      purpose: scope.purpose,
      world_revision: scope.world_revision,
      commit_sequence: scope.commit_sequence,
      authorization_ref: 'rule:npc-read-v1',
    }),
    npcKnowledgeVisibilityAuthorizer: (scope) => ({
      status: 'allowed',
      world_id: scope.world_id,
      actor_id: scope.actor_id,
      purpose: scope.purpose,
      world_revision: scope.world_revision,
      commit_sequence: scope.commit_sequence,
      acquisition_id: scope.acquisition_id,
      authorization_ref: 'rule:npc-visibility-v1',
    }),
  });

  engine.createWorld({
    world_id: 'world-a',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2026-01-01T00:00:00Z',
  });
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
