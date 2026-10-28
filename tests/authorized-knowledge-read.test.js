import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { ActorBindingService } from '../src/application/actor-bindings.js';
import { AuthorizedReadService } from '../src/application/authorized-read-service.js';

function setup(knowledgePolicy = null) {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  engine.createWorld({ world_id: 'w', world_pack_id: 'test.world', world_pack_version: '1.0.0', game_time: '2005-12-29T10:00:00Z' });
  engine.commitEvent('w', {
    event_id: 'npc-created', idempotency_key: 'npc-created', turn_id: 'npc-created',
    event_type: 'seed', expected_revision: 0, effects: [
      { kind: 'entity.create', entity_id: 'npc-1', entity_type: 'character' },
      { kind: 'entity.create', entity_id: 'npc-2', entity_type: 'character' },
    ],
  });
  engine.assignKnowledge('w', {
    assignment_id: 'a-1', subject_id: 'npc-1', item_id: 'location-secret',
    source_kind: 'author_initial', source_ref: 'world_pack:test.world@1.0.0',
    source_version: '1.0.0', authorization_ref: 'authoring-1', expected_revision: 1,
  });
  const bindings = new ActorBindingService(engine);
  bindings.bind('w', 'adapter-1', 'npc-1');
  const reads = new AuthorizedReadService(engine, bindings, () => true, knowledgePolicy);
  return { store, engine, bindings, reads };
}

test('authorized knowledge read is actor-bound and explicitly incomplete', (t) => {
  const h = setup((_context, assignment) => assignment.item_id === 'location-secret');
  t.after(() => h.store.close());
  const cursor = h.engine.getSnapshot('w');
  const result = h.reads.readKnowledgeAssignments({
    worldId: 'w', adapterId: 'adapter-1', actorEntityId: 'npc-1',
    recipient: 'model', purpose: 'npc_decision',
    expectedWorldRevision: cursor.world_revision, expectedCommitSequence: cursor.commit_sequence,
  });
  assert.equal(result.status, 'incomplete');
  assert.equal(result.coverage, 'initial_assignments_only');
  assert.deepEqual(result.assignments, [{
    assignment_id: 'a-1', item_id: 'location-secret', source_kind: 'author_initial', source_version: '1.0.0',
  }]);
});

test('knowledge read defaults to deny when no trusted knowledge policy is configured', (t) => {
  const h = setup();
  t.after(() => h.store.close());
  const cursor = h.engine.getSnapshot('w');
  const result = h.reads.readKnowledgeAssignments({
    worldId: 'w', adapterId: 'adapter-1', actorEntityId: 'npc-1',
    recipient: 'model', purpose: 'npc_decision',
    expectedWorldRevision: cursor.world_revision, expectedCommitSequence: cursor.commit_sequence,
  });
  assert.deepEqual(result.assignments, []);
  assert.equal(result.status, 'incomplete');
});

test('knowledge read rejects an actor without an active adapter binding', (t) => {
  const h = setup((_context, assignment) => assignment.item_id === 'location-secret');
  t.after(() => h.store.close());
  const cursor = h.engine.getSnapshot('w');
  assert.throws(() => h.reads.readKnowledgeAssignments({
    worldId: 'w', adapterId: 'adapter-1', actorEntityId: 'npc-2',
    recipient: 'model', purpose: 'npc_decision',
    expectedWorldRevision: cursor.world_revision, expectedCommitSequence: cursor.commit_sequence,
  }), (error) => error.code === 'ACTOR_NOT_AUTHORIZED');
});

test('knowledge read rejects stale snapshot cursors', (t) => {
  const h = setup((_context, assignment) => assignment.item_id === 'location-secret');
  t.after(() => h.store.close());
  const cursor = h.engine.getSnapshot('w');
  h.engine.commitEvent('w', {
    idempotency_key: 'later-event', turn_id: 'later-event', event_type: 'later',
    expected_revision: cursor.world_revision, effects: [],
  });
  assert.throws(() => h.reads.readKnowledgeAssignments({
    worldId: 'w', adapterId: 'adapter-1', actorEntityId: 'npc-1',
    recipient: 'model', purpose: 'npc_decision',
    expectedWorldRevision: cursor.world_revision, expectedCommitSequence: cursor.commit_sequence,
  }), (error) => error.code === 'STALE_AUTHORIZED_READ_SNAPSHOT');
});
