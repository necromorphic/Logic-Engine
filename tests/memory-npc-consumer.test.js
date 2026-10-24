import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { ActorBindingService } from '../src/application/actor-bindings.js';
import { AuthorizedReadService } from '../src/application/authorized-read-service.js';
import { MemoryNpcConsumer } from '../src/application/memory-npc-consumer.js';

function setup(t, { allowContent = true, authorizeQuery = true, authorizeCandidate = true, completeness = 'complete' } = {}) {
  let contentVisible = allowContent;
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
  engine.commitEvent('memory-npc-world', {
    event_id: 'unrelated-memory-npc',
    idempotency_key: 'unrelated-memory-npc',
    turn_id: 'unrelated-memory-npc',
    event_type: 'action.completed',
    expected_revision: 1,
    effects: [{ kind: 'entity.create', entity_id: 'unrelated-a', entity_type: 'object' }],
  });
  const authorizedReadService = new AuthorizedReadService(
    engine,
    bindings,
    (context, entity, field) => field === 'entity_id'
      || (field === 'attributes.public_note' && contentVisible),
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
      source_reconciliation: 'current',
      evidence_assessment: 'unassessed',
      access_outcome: 'deny',
      index_health: 'ready',
    },
    freshness: { status: 'current' },
    snapshot: { world_revision: snapshot.world_revision, commit_sequence: snapshot.commit_sequence },
    ...overrides,
  });
  let candidateList = [candidate()];
  let lastCandidateAuthorization = null;
  const provider = {
    authorizeQuery: async () => authorizeQuery,
    retrieveCandidates: async () => ({
      completeness,
      index_health: 'ready',
      source_reconciliation: 'current',
      scope,
      snapshot: { world_revision: snapshot.world_revision, commit_sequence: snapshot.commit_sequence },
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
    revokeContent() { contentVisible = false; },
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
  assert.equal(result.candidates.length, 1, JSON.stringify(result));
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

test('malformed records in a complete Memory result are non-ready, not authorized-empty', async (t) => {
  const { consumer, setCandidates, candidate } = setup(t);

  setCandidates([candidate({
    record: { ref: 'memory:claim-1', version: '  ' },
  })]);
  const malformedIdentity = await consumer.retrieveForNpc(request());
  assert.equal(malformedIdentity.status, 'non_ready');
  assert.equal(malformedIdentity.reason, 'memory_candidate_invalid_or_scope_mismatch');
  assert.deepEqual(malformedIdentity.candidates, []);

  setCandidates([candidate({
    subject_id: 'another-npc',
  })]);
  const wrongScope = await consumer.retrieveForNpc(request());
  assert.equal(wrongScope.status, 'non_ready');
  assert.equal(wrongScope.reason, 'memory_candidate_invalid_or_scope_mismatch');
  assert.deepEqual(wrongScope.candidates, []);
});

test('Memory record denial is indistinguishable from an authorized empty candidate set, including stale hidden records', async (t) => {
  const denied = setup(t, { authorizeCandidate: false });
  const result = await denied.consumer.retrieveForNpc(request());
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.admitted, []);
  assert.deepEqual(result.candidates, []);

  denied.setCandidates([denied.candidate({
    freshness: { status: 'stale' },
  })]);
  const staleButDenied = await denied.consumer.retrieveForNpc(request());
  assert.equal(staleButDenied.status, 'ready');
  assert.deepEqual(staleButDenied.admitted, []);
  assert.deepEqual(staleButDenied.candidates, []);
  assert.deepEqual(staleButDenied, result);
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
  const { consumer, provider, setCandidates, candidate, snapshot } = setup(t);
  setCandidates([
    candidate(),
    candidate({
      record: { ref: 'memory:claim-2', version: 'v1' },
      snapshot: {
        world_revision: snapshot.world_revision - 1,
        commit_sequence: snapshot.commit_sequence,
      },
    }),
  ]);
  const stale = await consumer.retrieveForNpc(request());
  assert.equal(stale.status, 'non_ready');
  assert.equal(stale.reason, 'memory_snapshot_stale');
  assert.deepEqual(stale.admitted, []);
  assert.deepEqual(stale.candidates, []);

  // Result-level snapshot is authoritative for complete-empty and non-empty
  // results alike; a fresh candidate cannot override a stale result marker.
  setCandidates([candidate()]);
  const originalRetrieve = provider.retrieveCandidates;
  provider.retrieveCandidates = async () => ({
    ...(await originalRetrieve()),
    snapshot: { world_revision: snapshot.world_revision - 1, commit_sequence: snapshot.commit_sequence },
  });
  const staleResultSnapshot = await consumer.retrieveForNpc(request());
  assert.equal(staleResultSnapshot.status, 'non_ready');
  assert.equal(staleResultSnapshot.reason, 'memory_snapshot_stale');
  assert.deepEqual(staleResultSnapshot.admitted, []);
  assert.deepEqual(staleResultSnapshot.candidates, []);
  provider.retrieveCandidates = originalRetrieve;

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

  // A matching Core cursor does not authorize Memory to relabel its own stale
  // index/reconciliation or freshness state as current.
  setCandidates([candidate({
    lifecycle: { ...candidate().lifecycle, source_reconciliation: 'stale' },
  })]);
  const staleLifecycle = await consumer.retrieveForNpc(request());
  assert.equal(staleLifecycle.status, 'non_ready');
  assert.equal(staleLifecycle.reason, 'memory_source_not_current');
  assert.deepEqual(staleLifecycle.admitted, []);
  assert.deepEqual(staleLifecycle.candidates, []);

  setCandidates([candidate({ freshness: { status: 'stale' } })]);
  const staleFreshness = await consumer.retrieveForNpc(request());
  assert.equal(staleFreshness.status, 'non_ready');
  assert.equal(staleFreshness.reason, 'memory_source_not_current');
  assert.deepEqual(staleFreshness.admitted, []);
  assert.deepEqual(staleFreshness.candidates, []);
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


test('rollback-only revision change invalidates a prior candidate without sequence growth', async (t) => {
  const { consumer, engine, store, snapshot } = setup(t);
  const beforeSequence = store.currentCommitSequence('memory-npc-world');
  const beforeRevision = engine.getState('memory-npc-world').world_revision;
  assert.equal(beforeRevision, snapshot.world_revision);

  const before = await consumer.retrieveForNpc(request());
  assert.equal(before.status, 'ready');
  assert.equal(before.candidates.length, 1);

  const rollback = engine.rollbackEvent('memory-npc-world', {
    root_event_id: 'unrelated-memory-npc',
    idempotency_key: 'rollback-unrelated-memory-npc',
  });
  assert.equal(rollback.accepted, true);
  assert.equal(store.currentCommitSequence('memory-npc-world'), beforeSequence);
  assert.notEqual(engine.getState('memory-npc-world').world_revision, beforeRevision);

  const after = await consumer.retrieveForNpc(request());
  assert.equal(after.status, 'non_ready');
  assert.equal(after.reason, 'memory_snapshot_stale');
  assert.deepEqual(after.admitted, []);
  assert.deepEqual(after.candidates, []);
});


test('missing or non-object host request fails closed without throwing or calling Memory', async (t) => {
  const { consumer, provider } = setup(t);
  let queryCalled = false;
  provider.authorizeQuery = async () => {
    queryCalled = true;
    return true;
  };

  for (const invalid of [null, undefined, [], 'not-a-request', { ...request(), actorEntityId: ' npc-a' }]) {
    const result = await consumer.retrieveForNpc(invalid);
    assert.equal(result.status, 'non_ready');
    assert.equal(result.reason, 'trusted_scope_incomplete');
    assert.deepEqual(result.admitted, []);
    assert.deepEqual(result.candidates, []);
  }
  assert.equal(queryCalled, false);
});


test('Memory record authorization failure is non-ready, not a complete-empty result', async (t) => {
  const { consumer, provider } = setup(t);
  provider.authorizeCandidate = async () => {
    throw new Error('memory authorization backend unavailable');
  };

  const result = await consumer.retrieveForNpc(request());
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'memory_record_authorization_unavailable');
  assert.deepEqual(result.admitted, []);
  assert.deepEqual(result.candidates, []);
  assert.equal(JSON.stringify(result).includes('memory authorization backend unavailable'), false);
});


test('stale Memory-owned freshness and rebuilding index state are non-ready, not complete-empty', async (t) => {
  const { consumer, setCandidates, candidate } = setup(t);
  for (const stale of [
    candidate({ freshness: { status: 'stale' } }),
    candidate({ lifecycle: { ...candidate().lifecycle, source_reconciliation: 'stale' } }),
    candidate({ lifecycle: { ...candidate().lifecycle, index_health: 'rebuilding' } }),
  ]) {
    setCandidates([stale]);
    const result = await consumer.retrieveForNpc(request());
    assert.equal(result.status, 'non_ready');
    assert.equal(result.reason, 'memory_source_not_current');
    assert.deepEqual(result.admitted, []);
    assert.deepEqual(result.candidates, []);
  }
});


test('complete-empty is ready only when the Memory index explicitly reports ready', async (t) => {
  const { consumer, provider, setCandidates, snapshot } = setup(t);
  setCandidates([]);
  const originalRetrieve = provider.retrieveCandidates;
  provider.retrieveCandidates = async () => ({
    ...(await originalRetrieve()),
    index_health: 'rebuilding',
  });

  const rebuilding = await consumer.retrieveForNpc(request());
  assert.equal(rebuilding.status, 'non_ready');
  assert.equal(rebuilding.reason, 'memory_index_not_ready');
  assert.deepEqual(rebuilding.admitted, []);
  assert.deepEqual(rebuilding.candidates, []);

  provider.retrieveCandidates = async () => {
    const result = await originalRetrieve();
    delete result.index_health;
    return result;
  };
  const unknownHealth = await consumer.retrieveForNpc(request());
  assert.equal(unknownHealth.status, 'non_ready');
  assert.equal(unknownHealth.reason, 'memory_index_not_ready');
  assert.deepEqual(unknownHealth.admitted, []);
  assert.deepEqual(unknownHealth.candidates, []);

  provider.retrieveCandidates = async () => ({
    ...(await originalRetrieve()),
    index_health: 'ready',
    source_reconciliation: 'reconciling',
  });
  const reconciling = await consumer.retrieveForNpc(request());
  assert.equal(reconciling.status, 'non_ready');
  assert.equal(reconciling.reason, 'memory_reconciliation_not_current');
  assert.deepEqual(reconciling.admitted, []);
  assert.deepEqual(reconciling.candidates, []);

  provider.retrieveCandidates = async () => ({
    ...(await originalRetrieve()),
    index_health: 'ready',
    source_reconciliation: 'current',
  });
  const empty = await consumer.retrieveForNpc(request());
  assert.equal(empty.status, 'ready');
  assert.equal(empty.reason, null);
  assert.deepEqual(empty.admitted, []);
  assert.deepEqual(empty.candidates, []);
  assert.deepEqual(empty.snapshot, {
    world_revision: snapshot.world_revision,
    commit_sequence: snapshot.commit_sequence,
  });

  provider.retrieveCandidates = async () => ({
    completeness: 'complete',
    index_health: 'ready',
    source_reconciliation: 'current',
    scope: { world_id: 'memory-npc-world', subject_id: 'npc-a', purpose: 'npc_decision' },
    snapshot: { world_revision: snapshot.world_revision - 1, commit_sequence: snapshot.commit_sequence },
    candidates: [],
  });
  const staleEmpty = await consumer.retrieveForNpc(request());
  assert.equal(staleEmpty.status, 'non_ready');
  assert.equal(staleEmpty.reason, 'memory_snapshot_stale');
  assert.deepEqual(staleEmpty.admitted, []);
  assert.deepEqual(staleEmpty.candidates, []);
});


test('Core source-field revocation after a prior admission is rechecked on the next Memory-to-NPC read', async (t) => {
  const { consumer, revokeContent } = setup(t);
  const first = await consumer.retrieveForNpc(request());
  assert.equal(first.status, 'ready');
  assert.equal(first.candidates.length, 1);
  assert.equal(first.candidates[0].content['attributes.public_note'], 'authorized source text');

  revokeContent();
  const revoked = await consumer.retrieveForNpc(request());
  assert.equal(revoked.status, 'ready');
  assert.deepEqual(revoked.admitted, []);
  assert.deepEqual(revoked.candidates, []);
  assert.equal(JSON.stringify(revoked).includes('authorized source text'), false);
  assert.equal(JSON.stringify(revoked).includes('must never leak'), false);
});


test('malformed and cross-scope candidate rows cannot be silently converted to complete-empty', async (t) => {
  const { consumer, setCandidates, candidate } = setup(t);
  setCandidates([candidate({ record: { ref: '', version: 'v1' } })]);
  const malformed = await consumer.retrieveForNpc(request());
  assert.equal(malformed.status, 'non_ready');
  assert.equal(malformed.reason, 'memory_candidate_invalid_or_scope_mismatch');
  assert.deepEqual(malformed.admitted, []);
  assert.deepEqual(malformed.candidates, []);

  setCandidates([candidate({ world_id: 'another-world' })]);
  const crossScope = await consumer.retrieveForNpc(request());
  assert.equal(crossScope.status, 'non_ready');
  assert.equal(crossScope.reason, 'memory_candidate_invalid_or_scope_mismatch');
  assert.deepEqual(crossScope.admitted, []);
  assert.deepEqual(crossScope.candidates, []);
});

test('complete-empty result becomes non-ready when Core changes after the indexed snapshot', async (t) => {
  const { consumer, setCandidates, engine, store, snapshot } = setup(t);
  setCandidates([]);
  const beforeSequence = store.currentCommitSequence('memory-npc-world');
  const before = await consumer.retrieveForNpc(request());
  assert.equal(before.status, 'ready');
  assert.deepEqual(before.admitted, []);
  assert.deepEqual(before.snapshot, {
    world_revision: snapshot.world_revision,
    commit_sequence: snapshot.commit_sequence,
  });

  const rollback = engine.rollbackEvent('memory-npc-world', {
    root_event_id: 'unrelated-memory-npc',
    idempotency_key: 'rollback-empty-memory-npc',
  });
  assert.equal(rollback.accepted, true);
  assert.equal(store.currentCommitSequence('memory-npc-world'), beforeSequence);
  assert.notEqual(engine.getState('memory-npc-world').world_revision, snapshot.world_revision);

  const after = await consumer.retrieveForNpc(request());
  assert.equal(after.status, 'non_ready');
  assert.equal(after.reason, 'memory_snapshot_stale');
  assert.deepEqual(after.admitted, []);
  assert.deepEqual(after.candidates, []);
});
