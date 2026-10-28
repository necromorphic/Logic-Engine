import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { validateNpcKnowledgeRead } from '../src/application/npc-knowledge-read.js';

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
  const engine = new LogicEngine(store, {
    trustedInitialKnowledgeSources: trustedRegistry,
    npcKnowledgeReadAuthorizer: authorizer,
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


test('untrusted reader requests with getters and proxies fail before access', () => {
  let invoked = false;
  const unsafe = request({
    world: () => ({ world_revision: 1 }),
  });
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
