import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';

function setup() {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  engine.createWorld({
    world_id: 'knowledge-world',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2005-12-29T10:00:00Z',
  });
  return { store, engine };
}

const event = (overrides = {}) => ({
  idempotency_key: 'seed-key',
  turn_id: 'seed-turn',
  event_type: 'seed',
  expected_revision: 0,
  effects: [],
  caused_by: [],
  depends_on: [],
  read_set: [],
  ...overrides,
});

function createSubject(engine) {
  return engine.commitEvent('knowledge-world', event({
    event_id: 'subject-created',
    idempotency_key: 'subject-created',
    turn_id: 'subject-created',
    effects: [{ kind: 'entity.create', entity_id: 'npc-1', entity_type: 'character', attributes: { name: 'NPC 1' } }],
  }));
}

function assignment(overrides = {}) {
  return {
    assignment_id: 'assignment-1',
    subject_id: 'npc-1',
    item_id: 'secret-location',
    source_kind: 'author_initial',
    source_ref: 'world_pack:test.world@1.0.0',
    source_version: '1.0.0',
    authorization_ref: 'authoring-decision-1',
    expected_revision: 1,
    ...overrides,
  };
}

test('trusted initial assignment is event-sourced, projected, and exact replay is idempotent', (t) => {
  const h = setup();
  t.after(() => h.store.close());
  createSubject(h.engine);

  const first = h.engine.assignKnowledge('knowledge-world', assignment());
  const replay = h.engine.assignKnowledge('knowledge-world', assignment());

  assert.equal(first.idempotent_replay, false);
  assert.equal(replay.idempotent_replay, true);
  assert.equal(h.engine.listKnowledgeAssignments('knowledge-world').assignments.length, 1);
  assert.deepEqual(h.engine.listKnowledgeAssignments('knowledge-world').assignments[0], {
    assignment_id: 'assignment-1',
    subject_id: 'npc-1',
    item_id: 'secret-location',
    source_kind: 'author_initial',
    source_ref: 'world_pack:test.world@1.0.0',
    source_version: '1.0.0',
    authorization_ref: 'authoring-decision-1',
    event_id: first.event_id,
    committed_revision: 2,
    commit_sequence: 2,
  });
});

test('assignment identity cannot be reused for different content', (t) => {
  const h = setup();
  t.after(() => h.store.close());
  createSubject(h.engine);
  h.engine.assignKnowledge('knowledge-world', assignment());

  assert.throws(
    () => h.engine.assignKnowledge('knowledge-world', assignment({ item_id: 'different-item' })),
    (error) => error.code === 'IDEMPOTENCY_KEY_CONFLICT' || error.code === 'KNOWLEDGE_ASSIGNMENT_ID_CONFLICT',
  );
  assert.equal(h.engine.listKnowledgeAssignments('knowledge-world').assignments.length, 1);
});

test('source-event rollback invalidates only assignments supported by that source', (t) => {
  const h = setup();
  t.after(() => h.store.close());
  createSubject(h.engine);
  h.engine.assignKnowledge('knowledge-world', assignment());

  h.engine.commitEvent('knowledge-world', event({
    event_id: 'import-source',
    idempotency_key: 'import-source',
    turn_id: 'import-source',
    expected_revision: 2,
    effects: [{ kind: 'entity.create', entity_id: 'source-record', entity_type: 'source' }],
  }));
  h.engine.assignKnowledge('knowledge-world', assignment({
    assignment_id: 'assignment-2',
    item_id: 'rumor-about-haruka',
    source_kind: 'imported',
    source_ref: 'event:import-source',
    source_version: '3',
    authorization_ref: 'import-approval-1',
    expected_revision: 3,
  }));

  const before = h.engine.listKnowledgeAssignments('knowledge-world');
  assert.equal(before.assignments.length, 2);
  const rollback = h.engine.rollbackEvent('knowledge-world', {
    root_event_id: 'import-source',
    idempotency_key: 'rollback-import-source',
  });
  const after = h.engine.listKnowledgeAssignments('knowledge-world');

  assert.equal(rollback.rollback_outcome, 'resolved');
  assert.deepEqual(after.assignments.map((item) => item.assignment_id), ['assignment-1']);
});

test('untrusted generic event commit cannot create a knowledge assignment', (t) => {
  const h = setup();
  t.after(() => h.store.close());
  createSubject(h.engine);

  assert.throws(
    () => h.engine.commitEvent('knowledge-world', event({
      expected_revision: 1,
      effects: [{
        kind: 'knowledge.assignment',
        assignment_id: 'forged',
        subject_id: 'npc-1',
        item_id: 'secret-location',
        source_kind: 'author_initial',
        source_ref: 'world_pack:test.world@1.0.0',
        source_version: '1.0.0',
        authorization_ref: 'fake-approval',
      }],
    })),
    (error) => error.code === 'KNOWLEDGE_ASSIGNMENT_TRUSTED_PATH_REQUIRED',
  );
});
