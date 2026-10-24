import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { ActorBindingService } from '../src/application/actor-bindings.js';
import { AuthorizedReadService } from '../src/application/authorized-read-service.js';
import { MemoryNpcConsumer } from '../src/application/memory-npc-consumer.js';

function setup(t, { allowContent = true, authorizeQuery = true, authorizeCandidate = true, completeness = 'complete' } = {}) {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  const bindings = new ActorBindingService(engine);
  engine.createWorld({
    world_id: 'memory-npc-world',
    world_pack_id: 'test.memory-npc',
    world_pack_version: '1',
    game_time: '2026-01-01T00:00:00Z',
  });
  engine.commitEvent('memory-npc-world', {
    idempotency_key: 'seed-memory-npc-world',
    turn_id: 'seed-memory-npc-world',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [
      { kind: 'entity.create', entity_id: 'npc-a', entity_type: 'character', attributes: { name: 'NPC' } },
      { kind: 'entity.create', entity_id: 'source-a', entity_type: 'character', attributes: { public_note: 'authorized source text', private_note: 'must never leak' } },
    ],
  });
  bindings.bind('memory-npc-world', 'adapter-a', 'npc-a');
  const authorizedReadService = new AuthorizedReadService(
    engine,
    bindings,
    (context, entity, field) => field === 'entity_id'
      || (field === 'attributes.public_note' && allowContent),
  );
  const scope = { world_id: 'memory-npc-world', subject_id: 'npc-a', purpose: 'npc_decision' };
  const snapshot = engine.getSnapshot('memory-npc-world');
  const candidate = (overrides = {}) => ({
    record: { ref: 'memory:claim-1', version: 'v1' },
    source: { kind: 'canonical_entity', entity_id: 'source-a' },
    world_id: scope.world_id,
    subject_id: scope.subject_id,
    purpose: scope.purpose,
    // These caller/provider labels are deliberately not accepted as authority.
    access: { outcome: 'deny', subject_id: scope.subject_id, purpose: scope.purpose },
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer: { kind: 'memory-index' },
    lifecycle: {
      content_disposition: 'usable',
      source_reconciliation: 'stale',
      evidence_assessment: 'unassessed',
      access_outcome: 'deny',
      index_health: 'ready',
    },
    freshness: { status: 'stale' },
    snapshot: { world_revision: snapshot.world_revision, commit_sequence: snapshot.commit_sequence },
    ...overrides,
  });
  let candidateList = [candidate()];
  let lastCandidateAuthorization = null;
  const provider = {
    authorizeQuery: async () => authorizeQuery,
    retrieveCandidates: async () => ({
      completeness,
      scope,
      candidates: candidateList,
    }),
    authorizeCandidate: async (input) => {
      lastCandidateAuthorization = input;
      return authorizeCandidate;
    },
  };
  const consumer = new MemoryNpcConsumer({
    authorizedReadService,
    actorBindingService: bindings,
    memoryProvider: provider,
    contentFields: ['attributes.public_note'],
  });
  t.after(() => store.close());
  return {
    store, engine, consumer, provider, scope, snapshot,
    setCandidates(next) { candidateList = next; },
    getLastCandidateAuthorization() { return lastCandidateAuthorization; },
    candidate,
  };
}

const request = () => ({
  worldId: 'memory-npc-world',
  adapterId: 'adapter-a',
  actorEntityId: 'npc-a',
});

test('joins trusted Memory record authorization, Core authorized source read, and NPC admission without exposing provider content', async (t) => {
  const { consumer, engine, store, getLastCandidateAuthorization } = setup(t);
  const before = {
    revision: engine.getState('memory-npc-world').world_revision,
    sequence: store.currentCommitSequence('memory-npc-world'),
    events: store.events('memory-npc-world', true).length,
    audit: store.audit('memory-npc-world').length,
  };

  const result = await consumer.retrieveForNpc(request());

  assert.equal(result.status, 'ready');
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.candidates[0].content, {
    'attributes.public_note': 'authorized source text',
  });
  assert.equal(result.candidates[0].record_ref, 'memory:claim-1');
  assert.deepEqual(getLastCandidateAuthorization(), {
    ...{ world_id: 'memory-npc-world', subject_id: 'npc-a', purpose: 'npc_decision' },
    record_ref: 'memory:claim-1',
    record_version: 'v1',
    source_kind: 'canonical_entity',
    source_entity_id: 'source-a',
  });
  assert.equal(JSON.stringify(result).includes('must never leak'), false);
  assert.equal(JSON.stringify(result).includes('private_note'), false);
  assert.deepEqual(result.snapshot, {
    world_revision: before.revision,
    commit_sequence: before.sequence,
  });
  assert.equal(engine.getState('memory-npc-world').world_revision, before.revision);
  assert.equal(store.currentCommitSequence('memory-npc-world'), before.sequence);
  assert.equal(store.events('memory-npc-world', true).length, before.events);
  assert.equal(store.audit('memory-npc-world').length, before.audit);
});

test('query denial and incomplete Memory results fail closed without returning candidates', async (t) => {
  const denied = setup(t, { authorizeQuery: false });
  assert.equal((await denied.consumer.retrieveForNpc(request())).status, 'non_ready');

  const partial = setup(t, { completeness: 'partial' });
  const result = await partial.consumer.retrieveForNpc(request());
  assert.equal(result.status, 'non_ready');
  assert.deepEqual(result.candidates, []);
});

test('Memory record denial is indistinguishable from an authorized empty candidate set', async (t) => {
  const denied = setup(t, { authorizeCandidate: false });
  const result = await denied.consumer.retrieveForNpc(request());
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.admitted, []);
  assert.deepEqual(result.candidates, []);
});

test('Core field denial removes the candidate content and does not disclose protected fields', async (t) => {
  const { consumer } = setup(t, { allowContent: false });
  const result = await consumer.retrieveForNpc(request());
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.admitted, []);
  assert.deepEqual(result.candidates, []);
  assert.equal(JSON.stringify(result).includes('authorized source text'), false);
});

test('stale snapshot candidates and derived summaries are never admitted', async (t) => {
  const { consumer, setCandidates, candidate, snapshot } = setup(t);
  setCandidates([candidate({
    snapshot: {
      world_revision: snapshot.world_revision - 1,
      commit_sequence: snapshot.commit_sequence,
    },
  })]);
  const stale = await consumer.retrieveForNpc(request());
  assert.equal(stale.status, 'ready');
  assert.deepEqual(stale.candidates, []);

  setCandidates([candidate({
    content_kind: 'summary',
    lineage: {
      status: 'complete',
      sources: [{ ref: 'entity:source-a', version: 'v1', world_id: 'memory-npc-world',
        access: { outcome: 'allow', subject_id: 'npc-a', purpose: 'npc_decision' },
        freshness: { status: 'current' } }],
    },
  })]);
  const summary = await consumer.retrieveForNpc(request());
  assert.equal(summary.status, 'ready');
  assert.deepEqual(summary.candidates, []);
});

test('actor binding failure and unavailable source reads never produce content', async (t) => {
  const { consumer } = setup(t);
  const result = await consumer.retrieveForNpc({ ...request(), adapterId: 'unbound-adapter' });
  assert.equal(result.status, 'non_ready');
  assert.deepEqual(result.candidates, []);
});

test('Memory provider must supply all trusted host callbacks; no default policy exists', (t) => {
  const { consumer } = setup(t);
  assert.ok(consumer);
  assert.throws(() => new MemoryNpcConsumer({
    authorizedReadService: { readEntityFields() {} },
    actorBindingService: { resolve() {} },
    memoryProvider: { retrieveCandidates() {} },
    contentFields: ['attributes.public_note'],
  }), /trusted Memory query, retrieval, and record authorization functions/);
});


test('actor binding is checked before query authorization even for complete-empty results', async (t) => {
  const { consumer, provider, setCandidates } = setup(t);
  setCandidates([]);
  let queryAuthorizationCalled = false;
  provider.authorizeQuery = async () => {
    queryAuthorizationCalled = true;
    return true;
  };

  const result = await consumer.retrieveForNpc({ ...request(), adapterId: 'unbound-adapter' });
  assert.equal(result.status, 'non_ready');
  assert.deepEqual(result.candidates, []);
  assert.equal(queryAuthorizationCalled, false);
});

test('duplicate Memory identity/version cannot be rebound to a different canonical source', async (t) => {
  const { consumer, setCandidates, candidate } = setup(t);
  setCandidates([
    candidate(),
    candidate({ source: { kind: 'canonical_entity', entity_id: 'source-b' } }),
  ]);

  const result = await consumer.retrieveForNpc(request());
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'memory_record_identity_conflict');
  assert.deepEqual(result.admitted, []);
  assert.deepEqual(result.candidates, []);
});
