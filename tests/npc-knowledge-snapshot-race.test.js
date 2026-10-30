import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';

test('raw NPC knowledge read fails closed if the world cursor changes during authorization', (t) => {
  const store = new SQLiteStore(':memory:');
  t.after(() => store.close());

  let engine;
  let mutated = false;
  engine = new LogicEngine(store, {
    npcKnowledgeReadAuthorizer: (scope) => {
      if (!mutated) {
        mutated = true;
        engine.commitEvent(scope.world_id, {
          event_id: 'commit-during-npc-read-authorization',
          idempotency_key: 'commit-during-npc-read-authorization',
          turn_id: 'commit-during-npc-read-authorization',
          event_type: 'action.completed',
          expected_revision: scope.world_revision,
          effects: [],
        });
      }
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
        authorization_ref: 'rule:npc-read-race-test',
      };
    },
  });

  engine.createWorld({
    world_id: 'world-read-race',
    world_pack_id: 'test.read-race',
    world_pack_version: '1',
    game_time: '2026-01-01T00:00:00Z',
  });
  engine.commitEvent('world-read-race', {
    event_id: 'create-read-race-npc',
    idempotency_key: 'create-read-race-npc',
    turn_id: 'create-read-race-npc',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [{ kind: 'entity.create', entity_id: 'npc-race', entity_type: 'character' }],
  });

  const world = store.world('world-read-race');
  const request = {
    world_id: 'world-read-race',
    conversation_id: 'conversation-read-race',
    actor_id: 'npc-race',
    purpose: 'npc_turn_context',
    expected_revision: world.world_revision,
    expected_commit_sequence: store.currentCommitSequence('world-read-race'),
    limit: 20,
  };

  assert.throws(
    () => engine.readNpcKnowledge(request),
    (error) => error.code === 'NPC_KNOWLEDGE_READ_NOT_READY'
      || error.code === 'NPC_KNOWLEDGE_READ_SNAPSHOT_STALE',
    'reader must not return ready when the cursor changes after authorization but before the read completes',
  );
});

test('raw NPC knowledge read rejects rollback between the SQL read and final cursor check', (t) => {
  const store = new SQLiteStore(':memory:');
  t.after(() => store.close());

  const engine = new LogicEngine(store, {
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
      authorization_ref: 'rule:npc-read-rollback-race-test',
    }),
  });

  engine.createWorld({
    world_id: 'world-read-rollback-race',
    world_pack_id: 'test.read-rollback-race',
    world_pack_version: '1',
    game_time: '2026-01-01T00:00:00Z',
  });
  engine.commitEvent('world-read-rollback-race', {
    event_id: 'create-read-rollback-race-npc',
    idempotency_key: 'create-read-rollback-race-npc',
    turn_id: 'create-read-rollback-race-npc',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [{ kind: 'entity.create', entity_id: 'npc-rollback-race', entity_type: 'character' }],
  });

  const originalGetSnapshot = engine.getSnapshot.bind(engine);
  const before = originalGetSnapshot('world-read-rollback-race');
  const request = {
    world_id: 'world-read-rollback-race',
    conversation_id: 'conversation-read-rollback-race',
    adapter_id: 'adapter-st',
    actor_id: 'npc-rollback-race',
    recipient: 'model',
    purpose: 'npc_turn_context',
    expected_revision: before.world_revision,
    expected_commit_sequence: before.commit_sequence,
    limit: 20,
  };

  let snapshotCalls = 0;
  engine.getSnapshot = (worldId, options) => {
    snapshotCalls += 1;
    if (snapshotCalls === 2) {
      const rollback = engine.rollbackEvent(worldId, {
        root_event_id: 'create-read-rollback-race-npc',
        idempotency_key: 'rollback-read-rollback-race-npc',
      });
      assert.equal(rollback.rollback_outcome, 'resolved');
      assert.equal(store.currentCommitSequence(worldId), before.commit_sequence,
        'rollback must not advance the event commit sequence');
      assert.ok(store.world(worldId).world_revision > before.world_revision,
        'rollback must advance the world revision');
    }
    return originalGetSnapshot(worldId, options);
  };

  assert.throws(
    () => engine.readNpcKnowledge(request),
    (error) => error.code === 'NPC_KNOWLEDGE_READ_NOT_READY',
    'the reader must reject when rollback changes the revision but leaves commit_sequence unchanged',
  );
});
