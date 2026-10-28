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
  actor_id: scope.actor_id,
  purpose: scope.purpose,
  world_revision: scope.world_revision,
  commit_sequence: scope.commit_sequence,
  authorization_ref: 'rule:npc-read-v1',
});
const visibilityAuthorization = (scope) => ({
  status: 'allowed',
  world_id: scope.world_id,
  actor_id: scope.actor_id,
  purpose: scope.purpose,
  world_revision: scope.world_revision,
  commit_sequence: scope.commit_sequence,
  acquisition_id: scope.acquisition_id,
  authorization_ref: 'rule:npc-visibility-v1',
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
    actor_id: 'npc-race',
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
