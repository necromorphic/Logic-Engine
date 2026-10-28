import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { ActorBindingService } from '../src/application/actor-bindings.js';
import { InitialKnowledgeReadService } from '../src/application/initial-knowledge-read-service.js';

function setup(t, knowledgePolicy = () => true) {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  const bindings = new ActorBindingService(engine);
  engine.createWorld({
    world_id: 'knowledge-read-world',
    world_pack_id: 'test.world',
    world_pack_version: '1',
    game_time: '2026-01-01T00:00:00Z',
  });
  engine.commitEvent('knowledge-read-world', {
    idempotency_key: 'seed-knowledge-read-world',
    turn_id: 'seed-knowledge-read-world',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [
      { kind: 'entity.create', entity_id: 'actor-a', entity_type: 'character' },
      { kind: 'entity.create', entity_id: 'actor-b', entity_type: 'character' },
      { kind: 'fact.set', fact_id: 'secret-fact', subject_ref: 'actor-a', predicate: 'knows_secret', value: { text: 'private payload' } },
      { kind: 'fact.set', fact_id: 'public-fact', subject_ref: 'actor-a', predicate: 'knows_public', value: true },
    ],
  });
  engine.assignInitialKnowledge('knowledge-read-world', {
    idempotency_key: 'assign-secret-to-a',
    expected_revision: 1,
    expected_commit_sequence: 1,
    subject_id: 'actor-a',
    fact_id: 'secret-fact',
    acquisition_kind: 'author_initial',
    source_ref: 'test-pack:actor-a/initial',
    source_content: '{"fixture":"trusted test"}',
  });
  engine.assignInitialKnowledge('knowledge-read-world', {
    idempotency_key: 'assign-public-to-a',
    expected_revision: 2,
    expected_commit_sequence: 2,
    subject_id: 'actor-a',
    fact_id: 'public-fact',
    acquisition_kind: 'imported',
    source_ref: 'test-import:actor-a/knowledge',
    source_content: '{"fixture":"trusted import"}',
  });
  bindings.bind('knowledge-read-world', 'adapter-a', 'actor-a');
  bindings.bind('knowledge-read-world', 'adapter-b', 'actor-b');
  t.after(() => store.close());
  return { engine, store, bindings, service: new InitialKnowledgeReadService(engine, bindings, knowledgePolicy) };
}

function request(engine, overrides = {}) {
  const snapshot = engine.getSnapshot('knowledge-read-world', { entityIds: ['actor-a'] });
  return {
    worldId: 'knowledge-read-world',
    adapterId: 'adapter-a',
    actorEntityId: 'actor-a',
    recipient: 'model',
    purpose: 'npc_decision',
    expectedWorldRevision: snapshot.world_revision,
    expectedCommitSequence: snapshot.commit_sequence,
    ...overrides,
  };
}

test('initial knowledge read returns only policy-approved active facts with the composite cursor', (t) => {
  const { engine, store, service } = setup(t, (_context, acquisition, fact) =>
    acquisition.acquisition_kind === 'imported' && fact.fact_id === 'public-fact');
  const before = {
    revision: engine.getState('knowledge-read-world').world_revision,
    sequence: store.currentCommitSequence('knowledge-read-world'),
    events: engine.getEvents('knowledge-read-world', true).length,
    audit: engine.getAudit('knowledge-read-world').length,
  };

  const result = service.read(request(engine));
  assert.deepEqual(result, {
    world_id: 'knowledge-read-world',
    world_revision: before.revision,
    commit_sequence: before.sequence,
    facts: [{ fact_id: 'public-fact', subject_ref: 'actor-a', predicate: 'knows_public', value: true }],
  });
  assert.equal(JSON.stringify(result).includes('private payload'), false);
  assert.equal(JSON.stringify(result).includes('test-import'), false);
  assert.equal(engine.getState('knowledge-read-world').world_revision, before.revision);
  assert.equal(store.currentCommitSequence('knowledge-read-world'), before.sequence);
  assert.equal(engine.getEvents('knowledge-read-world', true).length, before.events);
  assert.equal(engine.getAudit('knowledge-read-world').length, before.audit);
});

test('missing, throwing, or non-true policy decisions disclose no item metadata', (t) => {
  const { engine, service } = setup(t, () => { throw new Error('policy unavailable'); });
  const result = service.read(request(engine));
  assert.deepEqual(result.facts, []);
  assert.equal(JSON.stringify(result).includes('secret-fact'), false);
  assert.equal(JSON.stringify(result).includes('test-pack'), false);
});

test('construction requires a trusted knowledge policy and request cannot nominate a subject or fact', (t) => {
  const { engine, bindings } = setup(t);
  assert.throws(() => new InitialKnowledgeReadService(engine, bindings), /explicit trusted knowledge policy/);
  assert.throws(() => serviceForBadRequest(engine), /not used/);
  function serviceForBadRequest() {
    const service = new InitialKnowledgeReadService(engine, bindings, () => true);
    return service.read(request(engine, { subjectId: 'actor-b', factIds: ['secret-fact'] }));
  }
});

test('actor identity binding prevents reading another subject’s assignments', (t) => {
  const { engine, service } = setup(t);
  assert.throws(() => service.read(request(engine, {
    actorEntityId: 'actor-b',
    adapterId: 'adapter-a',
  })), (error) => error.code === 'READ_NOT_AVAILABLE' && error.status === 404);
});

test('stale composite cursor is rejected before any fact is disclosed', (t) => {
  const { engine, service } = setup(t);
  const staleRequest = request(engine);
  engine.commitEvent('knowledge-read-world', {
    idempotency_key: 'change-after-cursor',
    turn_id: 'change-after-cursor',
    event_type: 'action.completed',
    expected_revision: staleRequest.expectedWorldRevision,
    effects: [{ kind: 'fact.set', fact_id: 'new-fact', subject_ref: 'actor-a', predicate: 'changed', value: true }],
  });
  assert.throws(() => service.read(staleRequest),
    (error) => error.code === 'STALE_INITIAL_KNOWLEDGE_SNAPSHOT' && error.status === 409);
});

test('rollback invalidates an acquisition without exposing its fact', (t) => {
  const { engine, service } = setup(t);
  const acquisition = engine.getEvents('knowledge-read-world', true)
    .find((event) => event.effects?.some((effect) => effect.kind === 'knowledge.acquire'
      && effect.fact_id === 'secret-fact'));
  const rollback = engine.rollbackEvent('knowledge-read-world', {
    root_event_id: acquisition.event_id,
    idempotency_key: 'rollback-secret-acquisition',
  });
  assert.ok(rollback.invalidated_event_ids.includes(acquisition.event_id));
  const result = service.read(request(engine));
  assert.equal(result.facts.some((fact) => fact.fact_id === 'secret-fact'), false);
});

test('canonical mutation during policy evaluation rejects the whole disclosure', (t) => {
  let engineRef;
  let changed = false;
  const { engine, service } = setup(t, () => {
    if (!changed) {
      changed = true;
      const revision = engineRef.getState('knowledge-read-world').world_revision;
      engineRef.commitEvent('knowledge-read-world', {
        idempotency_key: 'mutate-during-knowledge-read',
        turn_id: 'mutate-during-knowledge-read',
        event_type: 'action.completed',
        expected_revision: revision,
        effects: [{ kind: 'fact.set', fact_id: 'policy-race-fact', subject_ref: 'actor-a', predicate: 'race', value: true }],
      });
    }
    return true;
  });
  engineRef = engine;
  assert.throws(() => service.read(request(engine)),
    (error) => error.code === 'STALE_INITIAL_KNOWLEDGE_SNAPSHOT' && error.status === 409);
});
