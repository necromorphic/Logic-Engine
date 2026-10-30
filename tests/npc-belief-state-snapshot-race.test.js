import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';

const sourceBytes = JSON.stringify({
  schema_version: 1,
  world_pack_id: 'test.belief-state-race',
  world_pack_version: '1',
  source_kind: 'author_initial',
  source_ref: 'authoring:test.belief-state-race@1',
  authorization_ref: 'rule:initial-knowledge-v1',
  assignments: [{ subject_id: 'npc-race', fact_id: 'fact-race' }],
});
const trustedSources = [{
  world_pack_id: 'test.belief-state-race',
  world_pack_version: '1',
  source_kind: 'author_initial',
  source_ref: 'authoring:test.belief-state-race@1',
  authorization_ref: 'rule:initial-knowledge-v1',
  sha256: createHash('sha256').update(sourceBytes).digest('hex'),
}];

const readAuthorization = (scope) => ({
  status: 'authorized',
  world_id: scope.world_id,
  adapter_id: scope.adapter_id,
  actor_id: scope.actor_id,
  recipient: scope.recipient,
  purpose: scope.purpose,
  world_revision: scope.world_revision,
  commit_sequence: scope.commit_sequence,
  authorization_ref: 'rule:npc-read-v1',
});
const visibilityAuthorization = (scope) => ({
  status: 'allowed',
  world_id: scope.world_id,
  adapter_id: scope.adapter_id,
  actor_id: scope.actor_id,
  recipient: scope.recipient,
  purpose: scope.purpose,
  world_revision: scope.world_revision,
  commit_sequence: scope.commit_sequence,
  acquisition_id: scope.acquisition_id,
  authorization_ref: 'rule:npc-visibility-v1',
});

test('belief replay reauthorizes the adapter and recipient before exposing an idempotency conflict', (t) => {
  const store = new SQLiteStore(':memory:');
  t.after(() => store.close());
  let authorized = true;
  const engine = new LogicEngine(store, {
    trustedInitialKnowledgeSources: trustedSources,
    npcKnowledgeReadAuthorizer: (scope) => ({
      ...readAuthorization(scope),
      status: authorized ? 'authorized' : 'denied',
    }),
    npcKnowledgeVisibilityAuthorizer: visibilityAuthorization,
  });

  engine.createWorld({
    world_id: 'world-belief-replay-auth',
    world_pack_id: 'test.belief-state-race',
    world_pack_version: '1',
    game_time: '2026-01-01T00:00:00Z',
  });
  engine.commitEvent('world-belief-replay-auth', {
    event_id: 'belief-replay-auth-seed',
    idempotency_key: 'belief-replay-auth-seed',
    turn_id: 'belief-replay-auth-seed',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [
      { kind: 'entity.create', entity_id: 'npc-race', entity_type: 'character' },
      { kind: 'fact.set', fact_id: 'fact-race', predicate: 'secret', value: 'private-value' },
    ],
  });
  engine.recordTrustedInitialKnowledgeSource({
    world_id: 'world-belief-replay-auth',
    source_bytes: sourceBytes,
    idempotency_key: 'belief-replay-auth-acquisition',
    expected_revision: 1,
    expected_commit_sequence: 1,
  });

  const world = store.world('world-belief-replay-auth');
  const current = {
    world_id: 'world-belief-replay-auth',
    adapter_id: 'adapter-st',
    actor_id: 'npc-race',
    recipient: 'model',
    purpose: 'npc_turn_context',
    expected_revision: world.world_revision,
    expected_commit_sequence: store.currentCommitSequence('world-belief-replay-auth'),
    limit: 20,
  };
  const read = engine.readNpcKnowledge(current);
  const transition = {
    ...current,
    proposition_ref: 'proposition:fact/fact-race',
    proposition_value: read.items[0].value,
    stance: 'believes_true',
    supporting_acquisition_ids: [read.items[0].acquisition_id],
    contradicting_acquisition_ids: [],
    reason_rule_ref: 'rule:belief-update-v1',
    idempotency_key: 'belief-replay-auth-transition',
  };
  engine.recordNpcBeliefTransition(transition);
  const before = store.db.prepare(
    'SELECT COUNT(*) AS count FROM npc_belief_transitions WHERE world_id=? AND actor_id=?',
  ).get(current.world_id, current.actor_id).count;

  authorized = false;
  assert.throws(
    () => engine.recordNpcBeliefTransition({
      ...transition,
      proposition_value: 'caller-forged-different-value',
    }),
    (error) => error.code === 'NPC_KNOWLEDGE_READ_NOT_READY',
  );
  const after = store.db.prepare(
    'SELECT COUNT(*) AS count FROM npc_belief_transitions WHERE world_id=? AND actor_id=?',
  ).get(current.world_id, current.actor_id).count;
  assert.equal(after, before);
});

test('belief-state read fails closed if visibility authorization races a canonical commit', (t) => {
  const store = new SQLiteStore(':memory:');
  t.after(() => store.close());
  const engine = new LogicEngine(store, {
    trustedInitialKnowledgeSources: trustedSources,
    npcKnowledgeReadAuthorizer: readAuthorization,
    npcKnowledgeVisibilityAuthorizer: visibilityAuthorization,
  });

  engine.createWorld({
    world_id: 'world-belief-race',
    world_pack_id: 'test.belief-state-race',
    world_pack_version: '1',
    game_time: '2026-01-01T00:00:00Z',
  });
  engine.commitEvent('world-belief-race', {
    event_id: 'belief-race-seed',
    idempotency_key: 'belief-race-seed',
    turn_id: 'belief-race-seed',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [
      { kind: 'entity.create', entity_id: 'npc-race', entity_type: 'character' },
      { kind: 'fact.set', fact_id: 'fact-race', predicate: 'secret', value: 'private-value' },
    ],
  });
  const acquisition = engine.recordTrustedInitialKnowledgeSource({
    world_id: 'world-belief-race',
    source_bytes: sourceBytes,
    idempotency_key: 'belief-race-acquisition',
    expected_revision: 1,
    expected_commit_sequence: 1,
  });
  const currentWorld = store.world('world-belief-race');
  const current = {
    world_id: 'world-belief-race',
    adapter_id: 'adapter-st',
    actor_id: 'npc-race',
    recipient: 'model',
    purpose: 'npc_turn_context',
    expected_revision: currentWorld.world_revision,
    expected_commit_sequence: store.currentCommitSequence('world-belief-race'),
    limit: 20,
  };
  const read = engine.readNpcKnowledge(current);
  const propositionRef = 'proposition:fact/fact-race';
  engine.recordNpcBeliefTransition({
    ...current,
    proposition_ref: propositionRef,
    proposition_value: read.items[0].value,
    stance: 'believes_true',
    supporting_acquisition_ids: [read.items[0].acquisition_id],
    contradicting_acquisition_ids: [],
    reason_rule_ref: 'rule:belief-update-v1',
    idempotency_key: 'belief-race-transition',
  });

  let racedEngine;
  let mutated = false;
  racedEngine = new LogicEngine(store, {
    trustedInitialKnowledgeSources: trustedSources,
    npcKnowledgeReadAuthorizer: readAuthorization,
    npcKnowledgeVisibilityAuthorizer: (scope) => {
      if (!mutated) {
        mutated = true;
        racedEngine.commitEvent(scope.world_id, {
          event_id: 'commit-during-belief-visibility',
          idempotency_key: 'commit-during-belief-visibility',
          turn_id: 'commit-during-belief-visibility',
          event_type: 'action.completed',
          expected_revision: scope.world_revision,
          effects: [],
        });
      }
      return visibilityAuthorization(scope);
    },
  });

  const latestWorld = store.world('world-belief-race');
  assert.throws(() => racedEngine.getNpcBeliefState({
    ...current,
    expected_revision: latestWorld.world_revision,
    expected_commit_sequence: store.currentCommitSequence('world-belief-race'),
    proposition_ref: propositionRef,
  }), (error) => ['NPC_KNOWLEDGE_READ_NOT_READY', 'NPC_BELIEF_STATE_NOT_READY'].includes(error.code));
  assert.equal(acquisition.accepted, true);
});

test('belief-state read rejects rollback between visibility evaluation and final cursor check', (t) => {
  const store = new SQLiteStore(':memory:');
  t.after(() => store.close());
  const engine = new LogicEngine(store, {
    trustedInitialKnowledgeSources: trustedSources,
    npcKnowledgeReadAuthorizer: readAuthorization,
    npcKnowledgeVisibilityAuthorizer: visibilityAuthorization,
  });

  engine.createWorld({
    world_id: 'world-belief-rollback-race',
    world_pack_id: 'test.belief-state-race',
    world_pack_version: '1',
    game_time: '2026-01-01T00:00:00Z',
  });
  engine.commitEvent('world-belief-rollback-race', {
    event_id: 'belief-rollback-seed',
    idempotency_key: 'belief-rollback-seed',
    turn_id: 'belief-rollback-seed',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [
      { kind: 'entity.create', entity_id: 'npc-race', entity_type: 'character' },
      { kind: 'fact.set', fact_id: 'fact-race', predicate: 'secret', value: 'private-value' },
    ],
  });
  engine.recordTrustedInitialKnowledgeSource({
    world_id: 'world-belief-rollback-race',
    source_bytes: sourceBytes,
    idempotency_key: 'belief-rollback-acquisition',
    expected_revision: 1,
    expected_commit_sequence: 1,
  });

  const read = engine.readNpcKnowledge({
    world_id: 'world-belief-rollback-race',
    adapter_id: 'adapter-st',
    actor_id: 'npc-race',
    recipient: 'model',
    purpose: 'npc_turn_context',
    expected_revision: store.world('world-belief-rollback-race').world_revision,
    expected_commit_sequence: store.currentCommitSequence('world-belief-rollback-race'),
    limit: 20,
  });
  const propositionRef = 'proposition:fact/fact-race';
  engine.recordNpcBeliefTransition({
    world_id: 'world-belief-rollback-race',
    adapter_id: 'adapter-st',
    actor_id: 'npc-race',
    recipient: 'model',
    purpose: 'npc_turn_context',
    expected_revision: read.snapshot.world_revision,
    expected_commit_sequence: read.snapshot.commit_sequence,
    limit: 20,
    proposition_ref: propositionRef,
    proposition_value: read.items[0].value,
    stance: 'believes_true',
    supporting_acquisition_ids: [read.items[0].acquisition_id],
    contradicting_acquisition_ids: [],
    reason_rule_ref: 'rule:belief-update-v1',
    idempotency_key: 'belief-rollback-transition',
  });

  const before = engine.getSnapshot('world-belief-rollback-race');
  engine.commitEvent('world-belief-rollback-race', {
    event_id: 'independent-rollback-target',
    idempotency_key: 'independent-rollback-target',
    turn_id: 'independent-rollback-target',
    event_type: 'action.completed',
    expected_revision: before.world_revision,
    effects: [{ kind: 'entity.create', entity_id: 'temporary-independent-entity', entity_type: 'object' }],
  });
  const requestSnapshot = engine.getSnapshot('world-belief-rollback-race');
  const request = {
    world_id: 'world-belief-rollback-race',
    adapter_id: 'adapter-st',
    actor_id: 'npc-race',
    recipient: 'model',
    purpose: 'npc_turn_context',
    expected_revision: requestSnapshot.world_revision,
    expected_commit_sequence: requestSnapshot.commit_sequence,
    limit: 20,
    proposition_ref: propositionRef,
  };

  const originalGetSnapshot = engine.getSnapshot.bind(engine);
  let snapshotCalls = 0;
  engine.getSnapshot = (worldId, options) => {
    snapshotCalls += 1;
    if (snapshotCalls === 3) {
      const rollback = engine.rollbackEvent(worldId, {
        root_event_id: 'independent-rollback-target',
        idempotency_key: 'rollback-independent-target',
      });
      assert.equal(rollback.rollback_outcome, 'resolved');
      assert.equal(store.currentCommitSequence(worldId), requestSnapshot.commit_sequence,
        'rollback must not advance the event commit sequence');
      assert.ok(store.world(worldId).world_revision > requestSnapshot.world_revision,
        'rollback must advance the world revision');
    }
    return originalGetSnapshot(worldId, options);
  };

  assert.throws(
    () => engine.getNpcBeliefState(request),
    (error) => error.code === 'NPC_KNOWLEDGE_READ_NOT_READY',
    'belief-state read must reject if rollback occurs after visibility decisions but before the final cursor check',
  );
});


test('belief transition and state APIs reject Proxy/accessor inputs before reading caller fields', (t) => {
  const store = new SQLiteStore(':memory:');
  t.after(() => store.close());
  const engine = new LogicEngine(store);

  let trapCalls = 0;
  let getterCalls = 0;
  const hostileProxy = new Proxy({}, {
    getPrototypeOf() { trapCalls += 1; throw new Error('proxy trap must not execute'); },
    ownKeys() { trapCalls += 1; throw new Error('proxy trap must not execute'); },
  });
  assert.throws(
    () => engine.recordNpcBeliefTransition(hostileProxy),
    (error) => error.code === 'INVALID_NPC_BELIEF_TRANSITION',
  );
  assert.throws(
    () => engine.getNpcBeliefState(hostileProxy),
    (error) => error.code === 'INVALID_NPC_BELIEF_STATE_REQUEST',
  );
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assert.throws(
    () => engine.recordNpcBeliefTransition(revoked.proxy),
    (error) => error.code === 'INVALID_NPC_BELIEF_TRANSITION',
  );
  assert.throws(
    () => engine.getNpcBeliefState(revoked.proxy),
    (error) => error.code === 'INVALID_NPC_BELIEF_STATE_REQUEST',
  );

  const transitionBase = {
    world_id: 'world-a',
    adapter_id: 'adapter-st',
    actor_id: 'npc-race',
    recipient: 'model',
    purpose: 'npc_turn_context',
    expected_revision: 0,
    expected_commit_sequence: 0,
    proposition_ref: 'proposition:secret',
    proposition_value: 'secret',
    stance: 'believes_true',
    supporting_acquisition_ids: [],
    contradicting_acquisition_ids: [],
    reason_rule_ref: 'rule:belief-update-v1',
    idempotency_key: 'proxy-boundary-transition',
  };
  const nestedProxy = new Proxy({}, {
    getPrototypeOf() { trapCalls += 1; throw new Error('nested proxy trap must not execute'); },
  });
  assert.throws(
    () => engine.recordNpcBeliefTransition({ ...transitionBase, proposition_value: nestedProxy }),
    (error) => error.code === 'INVALID_NPC_BELIEF_TRANSITION',
  );

  const accessorTransition = { ...transitionBase };
  Object.defineProperty(accessorTransition, 'world_id', {
    enumerable: true,
    get() { getterCalls += 1; throw new Error('transition getter must not execute'); },
  });
  assert.throws(
    () => engine.recordNpcBeliefTransition(accessorTransition),
    (error) => error.code === 'INVALID_NPC_BELIEF_TRANSITION',
  );

  const stateBase = {
    world_id: 'world-a',
    adapter_id: 'adapter-st',
    actor_id: 'npc-race',
    recipient: 'model',
    purpose: 'npc_turn_context',
    expected_revision: 0,
    expected_commit_sequence: 0,
    proposition_ref: 'proposition:secret',
  };
  const accessorState = { ...stateBase };
  Object.defineProperty(accessorState, 'actor_id', {
    enumerable: true,
    get() { getterCalls += 1; throw new Error('state getter must not execute'); },
  });
  assert.throws(
    () => engine.getNpcBeliefState(accessorState),
    (error) => error.code === 'INVALID_NPC_BELIEF_STATE_REQUEST',
  );

  assert.equal(trapCalls, 0);
  assert.equal(getterCalls, 0);
});


test('belief transition revalidates visibility immediately before the Core commit', (t) => {
  const store = new SQLiteStore(':memory:');
  t.after(() => store.close());
  let visibilityAllowed = true;
  let visibilityCalls = 0;
  const engine = new LogicEngine(store, {
    trustedInitialKnowledgeSources: trustedSources,
    npcKnowledgeReadAuthorizer: readAuthorization,
    npcKnowledgeVisibilityAuthorizer: (scope) => {
      visibilityCalls += 1;
      return {
        status: visibilityAllowed ? 'allowed' : 'denied',
        world_id: scope.world_id,
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

  engine.createWorld({
    world_id: 'world-belief-commit-boundary',
    world_pack_id: 'test.belief-state-race',
    world_pack_version: '1',
    game_time: '2026-01-01T00:00:00Z',
  });
  engine.commitEvent('world-belief-commit-boundary', {
    event_id: 'belief-commit-boundary-seed',
    idempotency_key: 'belief-commit-boundary-seed',
    turn_id: 'belief-commit-boundary-seed',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [
      { kind: 'entity.create', entity_id: 'npc-race', entity_type: 'character' },
      { kind: 'fact.set', fact_id: 'fact-race', predicate: 'secret', value: 'private-value' },
    ],
  });
  engine.recordTrustedInitialKnowledgeSource({
    world_id: 'world-belief-commit-boundary',
    source_bytes: sourceBytes,
    idempotency_key: 'belief-commit-boundary-acquisition',
    expected_revision: 1,
    expected_commit_sequence: 1,
  });

  const snapshot = engine.getSnapshot('world-belief-commit-boundary');
  const readRequest = {
    world_id: 'world-belief-commit-boundary',
    adapter_id: 'adapter-st',
    actor_id: 'npc-race',
    recipient: 'model',
    purpose: 'npc_turn_context',
    expected_revision: snapshot.world_revision,
    expected_commit_sequence: snapshot.commit_sequence,
    limit: 20,
  };
  const acquired = engine.readNpcKnowledge(readRequest);
  const request = {
    ...readRequest,
    proposition_ref: 'proposition:fact/fact-race',
    proposition_value: 'private-value',
    stance: 'believes_true',
    supporting_acquisition_ids: [acquired.items[0].acquisition_id],
    contradicting_acquisition_ids: [],
    reason_rule_ref: 'rule:belief-update-v1',
    idempotency_key: 'belief-commit-boundary-transition',
  };

  const originalPrepare = engine.prepareNpcBeliefContext.bind(engine);
  let preparationCalls = 0;
  engine.prepareNpcBeliefContext = (...args) => {
    preparationCalls += 1;
    const result = originalPrepare(...args);
    if (preparationCalls === 1) visibilityAllowed = false;
    return result;
  };

  assert.throws(
    () => engine.recordNpcBeliefTransition(request),
    (error) => error.code === 'NPC_BELIEF_TRANSITION_NOT_READY',
    'revocation after initial context preparation must block the Core belief commit',
  );
  assert.equal(preparationCalls, 2);
  assert.equal(visibilityCalls, 2);
  assert.equal(store.db.prepare(
    'SELECT COUNT(*) AS count FROM npc_belief_transitions WHERE world_id=?',
  ).get('world-belief-commit-boundary').count, 0);

  // Once visibility is restored, the final revalidation and the Core write
  // must execute under one coordinator lease, not in the gap before store.tx.
  visibilityAllowed = true;
  preparationCalls = 0;
  let leaseDepthAtCommit = null;
  const originalTx = store.tx.bind(store);
  store.tx = (callback) => {
    leaseDepthAtCommit = store.coordinatorLeaseDepth;
    return originalTx(callback);
  };
  const committed = engine.recordNpcBeliefTransition(request);
  assert.equal(committed.status, 'ready');
  assert.equal(leaseDepthAtCommit, 1,
    'the shared coordinator lease must already be held when the Core transaction starts');
  assert.equal(preparationCalls, 2);
});
