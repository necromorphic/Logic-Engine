import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { ActorBindingService } from '../src/application/actor-bindings.js';
import { HostConversationWorldBindingService } from '../src/application/host-conversation-world-bindings.js';
import { AuthorizedReadService } from '../src/application/authorized-read-service.js';
import { MemoryNpcConsumer } from '../src/application/memory-npc-consumer.js';
import { runWithAuthenticatedHostSession } from '../src/application/host-session-context.js';

const HOST_SESSION_ID = '66666666-6666-4666-8666-666666666666';
const HOST_INSTALLATION_ID = '11111111-1111-4111-8111-111111111111';
const HOST_ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const HOST_CONVERSATION_UUID = '33333333-3333-4333-8333-333333333333';
const HOST_CONVERSATION_ID = HOST_INSTALLATION_ID + ':' + HOST_ACCOUNT_ID + ':' + HOST_CONVERSATION_UUID;
const hostRequest = {
  user: { profile: { handle: 'consumer-test-user' } },
  session: { handle: 'consumer-test-user', logicEngineSessionId: HOST_SESSION_ID, logicEngineSessionHandle: 'consumer-test-user' },
};
const authenticatedHostRequests = new WeakSet([hostRequest]);
const isAuthenticatedHostRequest = request => authenticatedHostRequests.has(request);
const trustedConversationIds = new WeakMap([[hostRequest, HOST_CONVERSATION_ID]]);
const resolveHostConversationId = request => trustedConversationIds.get(request) ?? null;
function setup(t, { allowContent = true, authorizeQuery = true, authorizeCoreQuery = true, authorizeCandidate = true, completeness = 'complete' } = {}) {
  let contentVisible = allowContent;
  let hostBindings = { world_id: 'memory-npc-world', actor_id: 'npc-a' };
  const resolveHostBindings = (_request, conversationId) => conversationId === HOST_CONVERSATION_ID ? hostBindings : null;
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
  const hostConversationWorldBindingService = new HostConversationWorldBindingService(engine);
  hostConversationWorldBindingService.bind({
    adapterId: 'adapter-a', conversationId: HOST_CONVERSATION_ID, worldId: 'memory-npc-world',
  });
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
    authorization_generation: 1,
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
    authorizeQuery: () => authorizeQuery,
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
    checkCandidateGrant: () => true,
  };
  const consumer = new MemoryNpcConsumer({
    authorizedReadService,
    actorBindingService: bindings,
    hostConversationWorldBindingService,
    adapterId: 'adapter-a',
    memoryProvider: provider,
    coreQueryAuthorizer: (_scope, context) => authorizeCoreQuery && context?.conversation_id === HOST_CONVERSATION_ID,
    contentFields: ['attributes.public_note'],
  });
  const authenticatedConsumer = new Proxy(consumer, {
    get(target, property) {
      if (property === 'retrieveForNpc') return (input) =>
        runWithAuthenticatedHostSession(hostRequest, HOST_CONVERSATION_ID, () => target.retrieveForNpc(input), isAuthenticatedHostRequest, resolveHostConversationId, resolveHostBindings);
      if (property === 'revalidateForFinalDispatch') return (input, prepared) =>
        runWithAuthenticatedHostSession(hostRequest, HOST_CONVERSATION_ID, () => target.revalidateForFinalDispatch(input, prepared), isAuthenticatedHostRequest, resolveHostConversationId, resolveHostBindings);
      return Reflect.get(target, property, target);
    },
  });
  t.after(() => store.close());
  return {
    store, engine, bindings, consumer: authenticatedConsumer, provider, authorizedReadService, scope, snapshot,
    setCandidates(next) { candidateList = next; },
    getLastCandidateAuthorization() { return lastCandidateAuthorization; },
    setHostBindings(next) { hostBindings = next; },
    revokeContent() { contentVisible = false; },
    candidate,
  };
}

const request = () => ({
  worldId: 'memory-npc-world',
  actorEntityId: 'npc-a',
  conversationId: HOST_CONVERSATION_ID,
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
    authorization_generation: 1,
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

test('initial/imported knowledge requires the Core assignment authority path', async (t) => {
  // Check each marker independently: provider metadata must not be able to
  // relabel an initial/imported assignment as an ordinary claim or vice versa.
  for (const overrides of [
    { content_kind: 'author_initial', epistemic_kind: 'authored_initial' },
    { content_kind: 'author_initial', epistemic_kind: 'canonical' },
    { content_kind: 'imported', epistemic_kind: 'imported' },
    { content_kind: 'imported', epistemic_kind: 'acquired_report' },
    { content_kind: 'claim', epistemic_kind: 'authored_initial' },
    { content_kind: 'claim', epistemic_kind: 'imported' },
  ]) {
    const { consumer, setCandidates, candidate } = setup(t);
    setCandidates([candidate(overrides)]);
    const result = await consumer.retrieveForNpc(request());

    assert.equal(result.status, 'non_ready');
    assert.deepEqual(result.admitted, []);
    assert.deepEqual(result.candidates, []);
    assert.equal(result.reason, 'memory_result_incomplete_or_unavailable');
  }
});

test('Core query authorization denial blocks Provider retrieval', async (t) => {
  const { consumer, provider } = setup(t, { authorizeCoreQuery: false });
  let retrievalCalled = false;
  provider.retrieveCandidates = async () => {
    retrievalCalled = true;
    throw new Error('must not retrieve');
  };
  const result = await consumer.retrieveForNpc(request());
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'query_access_unconfirmed');
  assert.equal(retrievalCalled, false);
  assert.deepEqual(result.candidates, []);
});

test('query denial and incomplete Memory results fail closed without returning candidates', async (t) => {
  const denied = setup(t, { authorizeQuery: false });
  assert.equal((await denied.consumer.retrieveForNpc(request())).status, 'non_ready');

  const partial = setup(t, { completeness: 'partial' });
  const result = await partial.consumer.retrieveForNpc(request());
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'memory_result_partial');
  assert.deepEqual(result.candidates, []);
});

test('query access revoked during retrieval prevents ready-empty and content-bearing results', async (t) => {
  const empty = setup(t);
  empty.setCandidates([]);
  let emptyChecks = 0;
  empty.provider.authorizeQuery = () => ++emptyChecks === 1;

  const emptyResult = await empty.consumer.retrieveForNpc(request());

  assert.equal(emptyChecks, 2);
  assert.equal(emptyResult.status, 'non_ready');
  assert.equal(emptyResult.reason, 'query_access_unconfirmed');
  assert.deepEqual(emptyResult.admitted, []);
  assert.deepEqual(emptyResult.candidates, []);

  const nonEmpty = setup(t);
  let nonEmptyChecks = 0;
  nonEmpty.provider.authorizeQuery = () => ++nonEmptyChecks === 1;

  const contentResult = await nonEmpty.consumer.retrieveForNpc(request());

  assert.equal(nonEmptyChecks, 2);
  assert.equal(contentResult.status, 'non_ready');
  assert.equal(contentResult.reason, 'query_access_unconfirmed');
  assert.deepEqual(contentResult.admitted, []);
  assert.deepEqual(contentResult.candidates, []);
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

test('authorized candidate with missing or unknown semantic metadata is non-ready, not authorized-empty', async (t) => {
  const { consumer, setCandidates, candidate } = setup(t);

  setCandidates([candidate({ producer: undefined })]);
  const missingProducer = await consumer.retrieveForNpc(request());
  assert.equal(missingProducer.status, 'non_ready');
  assert.equal(missingProducer.reason, 'memory_candidate_metadata_incomplete');
  assert.deepEqual(missingProducer.candidates, []);

  setCandidates([candidate({ epistemic_kind: 'unrecognized-kind' })]);
  const unknownEpistemicKind = await consumer.retrieveForNpc(request());
  assert.equal(unknownEpistemicKind.status, 'non_ready');
  assert.equal(unknownEpistemicKind.reason, 'memory_candidate_metadata_incomplete');
  assert.deepEqual(unknownEpistemicKind.candidates, []);

  setCandidates([candidate({ lifecycle: { source_reconciliation: 'current', index_health: 'ready' } })]);
  const missingLifecycle = await consumer.retrieveForNpc(request());
  assert.equal(missingLifecycle.status, 'non_ready');
  assert.equal(missingLifecycle.reason, 'memory_candidate_metadata_incomplete');
  assert.deepEqual(missingLifecycle.candidates, []);
});

test('complete authorized empty retrieval is ready-empty only with a matching current Core snapshot', async (t) => {
  const empty = setup(t);
  empty.setCandidates([]);

  const result = await empty.consumer.retrieveForNpc(request());

  assert.equal(result.status, 'ready');
  assert.equal(result.reason, null);
  assert.deepEqual(result.admitted, []);
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.snapshot, {
    world_revision: empty.snapshot.world_revision,
    commit_sequence: empty.snapshot.commit_sequence,
  });
  assert.equal(JSON.stringify(result).includes('memory-npc-world'), false);
});

test('empty retrieval is non-ready when the current Core snapshot cannot be verified', async (t) => {
  const empty = setup(t);
  empty.setCandidates([]);
  empty.consumer.authorizedReadService.readEntityFields = () => {
    throw new Error('private Core diagnostic');
  };

  const result = await empty.consumer.retrieveForNpc(request());

  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'authorized_source_read_unavailable');
  assert.deepEqual(result.admitted, []);
  assert.deepEqual(result.candidates, []);
  assert.equal(JSON.stringify(result).includes('private Core diagnostic'), false);
});

test('empty retrieval with a stale Memory snapshot is non-ready, not proof of absence', async (t) => {
  const empty = setup(t);
  empty.setCandidates([]);
  empty.provider.retrieveCandidates = async () => ({
    completeness: 'complete',
    index_health: 'ready',
    source_reconciliation: 'current',
    scope: empty.scope,
    snapshot: {
      world_revision: empty.snapshot.world_revision - 1,
      commit_sequence: empty.snapshot.commit_sequence,
    },
    candidates: [],
  });

  const result = await empty.consumer.retrieveForNpc(request());

  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'memory_snapshot_stale');
  assert.deepEqual(result.admitted, []);
  assert.deepEqual(result.candidates, []);
});

test('empty retrieval that is denied, incomplete, or unavailable is non-ready, not proof of absence', async (t) => {
  const deniedQuery = setup(t, { authorizeQuery: false });
  deniedQuery.setCandidates([]);
  const denied = await deniedQuery.consumer.retrieveForNpc(request());
  assert.equal(denied.status, 'non_ready');
  assert.deepEqual(denied.admitted, []);
  assert.deepEqual(denied.candidates, []);

  const incomplete = setup(t, { completeness: 'partial' });
  incomplete.setCandidates([]);
  const partial = await incomplete.consumer.retrieveForNpc(request());
  assert.equal(partial.status, 'non_ready');
  assert.deepEqual(partial.admitted, []);
  assert.deepEqual(partial.candidates, []);

  const unavailable = setup(t);
  unavailable.setCandidates([]);
  unavailable.provider.retrieveCandidates = async () => {
    throw new Error('private provider diagnostic');
  };
  const failed = await unavailable.consumer.retrieveForNpc(request());
  assert.equal(failed.status, 'non_ready');
  assert.deepEqual(failed.admitted, []);
  assert.deepEqual(failed.candidates, []);
  assert.equal(JSON.stringify(failed).includes('private provider diagnostic'), false);
});

test('a returned Provider candidate that fails record authorization makes the whole result non-ready', async (t) => {
  const denied = setup(t, { authorizeCandidate: false });
  const result = await denied.consumer.retrieveForNpc(request());
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'memory_record_authorization_unconfirmed');
  assert.deepEqual(result.admitted, []);
  assert.deepEqual(result.candidates, []);

  const genuinelyEmpty = setup(t);
  genuinelyEmpty.setCandidates([]);
  const emptyResult = await genuinelyEmpty.consumer.retrieveForNpc(request());
  assert.equal(emptyResult.status, 'ready');
  assert.deepEqual(emptyResult.admitted, []);
  assert.deepEqual(emptyResult.candidates, []);

  denied.setCandidates([denied.candidate({
    freshness: { status: 'stale' },
  })]);
  const staleButDenied = await denied.consumer.retrieveForNpc(request());
  assert.equal(staleButDenied.status, 'non_ready');
  assert.equal(staleButDenied.reason, 'memory_record_authorization_unconfirmed');
  assert.deepEqual(staleButDenied.admitted, []);
  assert.deepEqual(staleButDenied.candidates, []);
});

test('duplicate canonical entity identities in an authorized read fail closed', async (t) => {
  const { consumer } = setup(t);
  const originalRead = consumer.authorizedReadService.readEntityFields.bind(consumer.authorizedReadService);
  consumer.authorizedReadService.readEntityFields = (args) => {
    const result = originalRead(args);
    if (Array.isArray(result?.entities) && args.fields.includes('attributes.public_note')) {
      const source = result.entities.find((entity) => entity.entity_id === 'source-a');
      if (source) {
        return {
          ...result,
          entities: [...result.entities, { ...source, 'attributes.public_note': 'conflicting duplicate content' }],
        };
      }
    }
    return result;
  };

  const result = await consumer.retrieveForNpc(request());

  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'authorized_source_read_invalid');
  assert.deepEqual(result.candidates, []);
});

test('authorized Memory record with missing canonical source is non-ready, not empty', async (t) => {
  const { consumer } = setup(t);
  const originalRead = consumer.authorizedReadService.readEntityFields.bind(consumer.authorizedReadService);
  consumer.authorizedReadService.readEntityFields = (input) => ({
    ...originalRead(input),
    entities: [],
  });

  const result = await consumer.retrieveForNpc(request());
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'authorized_source_missing');
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

test('stale unsupported candidate cannot be filtered into a ready-empty result', async (t) => {
  const { consumer, setCandidates, candidate, snapshot } = setup(t);
  setCandidates([candidate({
    content_kind: 'summary',
    snapshot: {
      world_revision: snapshot.world_revision - 1,
      commit_sequence: snapshot.commit_sequence,
    },
  })]);

  const result = await consumer.retrieveForNpc(request());
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'memory_snapshot_stale');
  assert.deepEqual(result.admitted, []);
  assert.deepEqual(result.candidates, []);
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
  consumer.actorBindingService.resolveForAdapter = () => { throw new Error('binding revoked'); };
  const result = await consumer.retrieveForNpc(request());
  assert.equal(result.status, 'non_ready');
  assert.deepEqual(result.candidates, []);
});

test('Memory provider must supply all trusted host callbacks; no default policy exists', (t) => {
  const { consumer } = setup(t);
  assert.ok(consumer);
  assert.throws(() => new MemoryNpcConsumer({
    authorizedReadService: { readEntityFields() {} },
    actorBindingService: { resolveForAdapter() {} },
    hostConversationWorldBindingService: { resolve() {} },
    adapterId: 'adapter-a',
    coreQueryAuthorizer: () => true,
    memoryProvider: { retrieveCandidates() {} },
    contentFields: ['attributes.public_note'],
  }), /trusted Memory query, retrieval, and record authorization functions/);
});


test('content field configuration must match fields the Core read boundary can disclose', (t) => {
  const { consumer } = setup(t);
  assert.ok(consumer);
  assert.throws(() => new MemoryNpcConsumer({
    authorizedReadService: { readEntityFields() {} },
    actorBindingService: { resolveForAdapter() {} },
    hostConversationWorldBindingService: { resolve() {} },
    adapterId: 'adapter-a',
    coreQueryAuthorizer: () => true,
    memoryProvider: {
      authorizeQuery() {},
      retrieveCandidates() {},
      authorizeCandidate() {},
      checkCandidateGrant() {},
    },
    contentFields: ['display_name'],
  }), /trusted field allowlist/);
  assert.throws(() => new MemoryNpcConsumer({
    authorizedReadService: { readEntityFields() {} },
    actorBindingService: { resolveForAdapter() {} },
    hostConversationWorldBindingService: { resolve() {} },
    adapterId: 'adapter-a',
    coreQueryAuthorizer: () => true,
    memoryProvider: {
      authorizeQuery() {},
      retrieveCandidates() {},
      authorizeCandidate() {},
      checkCandidateGrant() {},
    },
    contentFields: ['attributes.'],
  }), /trusted field allowlist/);
});

test('actor binding is checked before query authorization even for complete-empty results', async (t) => {
  const { consumer, provider, setCandidates } = setup(t);
  setCandidates([]);
  consumer.actorBindingService.resolveForAdapter = () => { throw new Error('binding revoked'); };
  let queryAuthorizationCalled = false;
  provider.authorizeQuery = async () => {
    queryAuthorizationCalled = true;
    return true;
  };

  const result = await consumer.retrieveForNpc(request());
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


test('duplicate record identity with conflicting semantic metadata fails closed', async (t) => {
  const { consumer, setCandidates, candidate } = setup(t);
  setCandidates([
    candidate(),
    candidate({ epistemic_kind: 'rumor' }),
  ]);

  const result = await consumer.retrieveForNpc(request());
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'memory_record_identity_conflict');
  assert.deepEqual(result.admitted, []);
  assert.deepEqual(result.candidates, []);
});

test('repeated identical Memory identity/version pairs are all excluded rather than first-wins admitted', async (t) => {
  const { consumer, setCandidates, candidate } = setup(t);
  setCandidates([candidate(), candidate()]);

  const result = await consumer.retrieveForNpc(request());
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.admitted, []);
  assert.deepEqual(result.candidates, []);
  assert.equal(JSON.stringify(result).includes('authorized source text'), false);
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



test('actor binding revoked during asynchronous Memory retrieval cannot disclose canonical source', async (t) => {
  const { consumer, provider, bindings } = setup(t);
  const originalRetrieve = provider.retrieveCandidates;
  provider.retrieveCandidates = async (scope) => {
    const result = await originalRetrieve(scope);
    const revoked = bindings.revoke('memory-npc-world', 'adapter-a', 'npc-a');
    assert.equal(revoked.changed, true);
    return result;
  };

  const result = await consumer.retrieveForNpc(request());
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'authorized_source_read_unavailable');
  assert.deepEqual(result.admitted, []);
  assert.deepEqual(result.candidates, []);
  assert.equal(JSON.stringify(result).includes('authorized source text'), false);
});


test('revoked actor binding cannot turn a complete-empty Memory result into ready', async (t) => {
  const { consumer, provider, bindings, setCandidates } = setup(t);
  setCandidates([]);
  const originalRetrieve = provider.retrieveCandidates;
  provider.retrieveCandidates = async (scope) => {
    const result = await originalRetrieve(scope);
    const revoked = bindings.revoke('memory-npc-world', 'adapter-a', 'npc-a');
    assert.equal(revoked.changed, true);
    return result;
  };

  const result = await consumer.retrieveForNpc(request());
  assert.equal(result.status, 'non_ready');
  assert.deepEqual(result.admitted, []);
  assert.deepEqual(result.candidates, []);
  assert.equal(JSON.stringify(result).includes('memory-npc-world'), false);
});

test('Core mutation during asynchronous Memory authorization invalidates the captured snapshot', async (t) => {
  const { consumer, provider, engine, snapshot } = setup(t);
  let mutated = false;
  provider.authorizeCandidate = async () => {
    if (!mutated) {
      mutated = true;
      const current = engine.getState('memory-npc-world').world_revision;
      const committed = engine.commitEvent('memory-npc-world', {
        idempotency_key: 'mutate-during-memory-npc-read',
        turn_id: 'mutate-during-memory-npc-read',
        event_type: 'action.completed',
        expected_revision: current,
        effects: [{ kind: 'entity.create', entity_id: 'during-read', entity_type: 'object' }],
      });
      assert.equal(committed.accepted, true);
    }
    return true;
  };

  const result = await consumer.retrieveForNpc(request());
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'memory_snapshot_stale');
  assert.deepEqual(result.admitted, []);
  assert.deepEqual(result.candidates, []);
  assert.notEqual(engine.getState('memory-npc-world').world_revision, snapshot.world_revision);
  assert.equal(JSON.stringify(result).includes('authorized source text'), false);
});

test('Core mutation during the final record authorization check invalidates content-bearing results', async (t) => {
  const { consumer, provider, engine } = setup(t);
  let checks = 0;
  provider.authorizeCandidate = async () => {
    checks += 1;
    if (checks === 3) {
      const current = engine.getState('memory-npc-world').world_revision;
      const committed = engine.commitEvent('memory-npc-world', {
        idempotency_key: 'mutate-during-final-npc-auth',
        turn_id: 'mutate-during-final-npc-auth',
        event_type: 'action.completed',
        expected_revision: current,
        effects: [{ kind: 'entity.create', entity_id: 'during-final-auth', entity_type: 'object' }],
      });
      assert.equal(committed.accepted, true);
    }
    return true;
  };

  const result = await consumer.retrieveForNpc(request());

  assert.equal(checks, 3);
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'memory_snapshot_stale');
  assert.deepEqual(result.admitted, []);
  assert.deepEqual(result.candidates, []);
  assert.equal(JSON.stringify(result).includes('authorized source text'), false);
});

test('Core mutation during final query recheck invalidates complete-empty results', async (t) => {
  const { consumer, provider, engine, setCandidates } = setup(t);
  setCandidates([]);
  let queryChecks = 0;
  provider.authorizeQuery = async () => {
    queryChecks += 1;
    if (queryChecks === 2) {
      const current = engine.getState('memory-npc-world').world_revision;
      const committed = engine.commitEvent('memory-npc-world', {
        idempotency_key: 'mutate-during-final-empty-query-auth',
        turn_id: 'mutate-during-final-empty-query-auth',
        event_type: 'action.completed',
        expected_revision: current,
        effects: [{ kind: 'entity.create', entity_id: 'during-empty-final-auth', entity_type: 'object' }],
      });
      assert.equal(committed.accepted, true);
    }
    return true;
  };

  const result = await consumer.retrieveForNpc(request());

  assert.equal(queryChecks, 2);
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'memory_snapshot_stale');
  assert.deepEqual(result.admitted, []);
  assert.deepEqual(result.candidates, []);
});

test('missing or non-object host request fails closed without throwing or calling Memory', async (t) => {
  const { consumer, provider } = setup(t);
  let queryCalled = false;
  provider.authorizeQuery = async () => {
    queryCalled = true;
    return true;
  };

  for (const invalid of [null, undefined, [], 'not-a-request', { ...request(), conversationId: ' invalid-conversation' }]) {
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
  assert.equal(rebuilding.reason, 'memory_index_rebuilding');
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

test('filtered-empty result still validates the current Core snapshot after record denial', async (t) => {
  const { consumer, engine, setCandidates } = setup(t);
  setCandidates([]);
  const rollback = engine.rollbackEvent('memory-npc-world', {
    root_event_id: 'unrelated-memory-npc',
    idempotency_key: 'rollback-denied-memory-npc',
  });
  assert.equal(rollback.accepted, true);

  const result = await consumer.retrieveForNpc(request());
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'memory_snapshot_stale');
  assert.deepEqual(result.admitted, []);
  assert.deepEqual(result.candidates, []);
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


test('mutable provider candidate cannot rebind its source during asynchronous record authorization', async (t) => {
  const { consumer, provider, setCandidates } = setup(t);
  const original = candidateForMutation(provider, setCandidates);
  provider.authorizeCandidate = async () => {
    original.source.entity_id = 'unapproved-source';
    return true;
  };

  const result = await consumer.retrieveForNpc(request());
  assert.equal(result.status, 'ready');
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].source_entity_id, 'source-a');
  assert.equal(result.candidates[0].content['attributes.public_note'], 'authorized source text');
});

test('record revoked during Core source read is not returned to NPC', async (t) => {
  const { consumer, provider, revokeContent, authorizedReadService } = setup(t);
  let candidateChecks = 0;
  provider.authorizeCandidate = async () => {
    candidateChecks += 1;
    // The record remains allowed during the initial checks, then is revoked
    // while Core is returning the canonical source. The final NPC check must
    // reject the result before candidate content is returned.
    return candidateChecks <= 2;
  };

  const originalRead = authorizedReadService.readEntityFields.bind(authorizedReadService);
  authorizedReadService.readEntityFields = (input) => {
    const result = originalRead(input);
    if (input.fields.includes('attributes.public_note')) revokeContent();
    return result;
  };

  const result = await consumer.retrieveForNpc(request());

  assert.equal(candidateChecks, 3);
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'memory_record_authorization_unconfirmed');
  assert.deepEqual(result.admitted, []);
  assert.deepEqual(result.candidates, []);
  assert.equal(JSON.stringify(result).includes('authorized source text'), false);
});

test('rechecks earlier Memory candidates after a later async authorization revokes access', async (t) => {
  const { consumer, provider, setCandidates, candidate } = setup(t);
  setCandidates([
    candidate(),
    candidate({ record: { ref: 'memory:claim-2', version: 'v1' } }),
  ]);

  const access = new Map([
    ['memory:claim-1', true],
    ['memory:claim-2', true],
  ]);
  const calls = new Map();
  provider.authorizeCandidate = async ({ record_ref }) => {
    const count = (calls.get(record_ref) ?? 0) + 1;
    calls.set(record_ref, count);

    // Candidate A passed its first check. While candidate B's first check is
    // awaiting, simulate a Memory-side revocation of A. The final authorization
    // sweep must not return A based on its stale earlier allow.
    if (record_ref === 'memory:claim-2' && count === 1) {
      access.set('memory:claim-1', false);
    }
    return access.get(record_ref) === true;
  };

  const result = await consumer.retrieveForNpc(request());
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'memory_record_authorization_unconfirmed');
  assert.deepEqual(result.admitted, []);
  assert.deepEqual(result.candidates, []);
  assert.equal(calls.get('memory:claim-1'), 2);
  assert.equal(calls.get('memory:claim-2'), 1);
});

function candidateForMutation(provider, setCandidates) {
  const result = provider.retrieveCandidates;
  let candidate;
  provider.retrieveCandidates = async () => {
    const retrieved = await result();
    candidate = retrieved.candidates[0];
    return retrieved;
  };
  return {
    get source() { return candidate.source; },
  };
}


test('record identities with control characters fail closed before identity joining', async (t) => {
  const { consumer, setCandidates, candidate } = setup(t);
  setCandidates([candidate({ record: { ref: 'memory:\u0000claim', version: 'v1' } })]);
  const result = await consumer.retrieveForNpc(request());
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'memory_candidate_invalid_or_scope_mismatch');
  assert.deepEqual(result.admitted, []);
  assert.deepEqual(result.candidates, []);
});


test('Memory query and retrieval failures fail closed without leaking provider errors', async (t) => {
  const { consumer, provider } = setup(t);
  provider.authorizeQuery = async () => {
    throw new Error('private query policy failure');
  };
  const queryFailure = await consumer.retrieveForNpc(request());
  assert.equal(queryFailure.status, 'non_ready');
  assert.equal(queryFailure.reason, 'query_access_unconfirmed');
  assert.equal(JSON.stringify(queryFailure).includes('private query policy failure'), false);

  provider.authorizeQuery = async () => true;
  provider.retrieveCandidates = async () => {
    throw new Error('private index backend failure');
  };
  const retrievalFailure = await consumer.retrieveForNpc(request());
  assert.equal(retrievalFailure.status, 'non_ready');
  assert.equal(retrievalFailure.reason, 'memory_retrieval_unavailable');
  assert.equal(JSON.stringify(retrievalFailure).includes('private index backend failure'), false);

  provider.retrieveCandidates = async () => ({
    completeness: 'complete',
    index_health: 'ready',
    source_reconciliation: 'current',
    scope: { world_id: 'memory-npc-world', subject_id: 'npc-a', purpose: 'npc_decision' },
    snapshot: { world_revision: 1, commit_sequence: 1 },
    candidates: [],
    unsupported_function: () => 'must not escape',
  });
  const invalidClone = await consumer.retrieveForNpc(request());
  assert.equal(invalidClone.status, 'non_ready');
  assert.equal(invalidClone.reason, 'memory_retrieval_unavailable');
  assert.equal(JSON.stringify(invalidClone).includes('must not escape'), false);
});


test('typed Provider retrieval failures remain distinct at the Core consumer boundary', async (t) => {
  const { consumer, provider } = setup(t);
  const cases = [
    ['MEMORY_QUERY_DENIED', 'memory_query_denied'],
    ['MEMORY_RECORDS_WITHHELD', 'memory_records_withheld'],
    ['MEMORY_SNAPSHOT_STALE', 'memory_snapshot_stale'],
    ['MEMORY_SNAPSHOT_UNAVAILABLE', 'memory_snapshot_unavailable'],
    ['MEMORY_INDEX_NOT_READY', 'memory_index_not_ready'],
    ['MEMORY_LINEAGE_INVALID', 'memory_lineage_invalid'],
    ['MEMORY_SOURCE_VALIDATION_UNAVAILABLE', 'memory_source_validation_unavailable'],
    ['MEMORY_SOURCE_VERSION_UNVERIFIABLE', 'memory_source_version_unverifiable'],
    ['MEMORY_AUTHORIZATION_CHANGED', 'memory_authorization_changed'],
    ['MEMORY_RECORD_ACCESS_REVOKED', 'memory_record_access_revoked'],
  ];
  for (const [code, reason] of cases) {
    provider.retrieveCandidates = async () => { throw new Error(code); };
    const result = await consumer.retrieveForNpc(request());
    assert.equal(result.status, 'non_ready', code);
    assert.equal(result.reason, reason, code);
    assert.deepEqual(result.candidates, [], code);
    assert.equal(JSON.stringify(result).includes(code), false, 'internal error codes are not returned verbatim');
  }

  const diagnosticCases = [
    [{ index_health: 'rebuilding', source_reconciliation: 'stale' }, 'memory_index_rebuilding'],
    [{ index_health: 'stale', source_reconciliation: 'stale' }, 'memory_index_stale'],
    [{ index_health: 'unavailable', source_reconciliation: 'stale' }, 'memory_index_unavailable'],
    [{ index_health: 'ready', source_reconciliation: 'stale' }, 'memory_reconciliation_stale'],
    [{ index_health: 'ready', source_reconciliation: 'unavailable' }, 'memory_reconciliation_unavailable'],
  ];
  provider.retrieveCandidates = async () => { throw new Error('MEMORY_INDEX_NOT_READY'); };
  for (const [diagnostics, reason] of diagnosticCases) {
    provider.getIndexStatusForDiagnostics = () => diagnostics;
    const result = await consumer.retrieveForNpc(request());
    assert.equal(result.status, 'non_ready');
    assert.equal(result.reason, reason);
    assert.deepEqual(result.candidates, []);
  }
});

test('mismatched Core actor binding result fails before Memory query', async (t) => {
  const { consumer, provider } = setup(t);
  let queryCalled = false;
  provider.authorizeQuery = async () => {
    queryCalled = true;
    return true;
  };
  consumer.actorBindingService.resolveForAdapter = () => ({
    world_id: 'memory-npc-world',
    adapter_id: 'adapter-a',
    actor: { entity_id: 'different-actor' },
  });

  const result = await consumer.retrieveForNpc(request());
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'actor_binding_unavailable');
  assert.deepEqual(result.admitted, []);
  assert.equal(queryCalled, false);
});


test('request accessors that throw fail closed without invoking Memory', async (t) => {
  const { consumer, provider } = setup(t);
  let queryCalled = false;
  provider.authorizeQuery = async () => {
    queryCalled = true;
    return true;
  };
  const malformed = Object.defineProperty({}, 'worldId', {
    enumerable: true,
    get() { throw new Error('private request getter'); },
  });
  const result = await consumer.retrieveForNpc(malformed);
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'trusted_scope_incomplete');
  assert.equal(queryCalled, false);
  assert.equal(JSON.stringify(result).includes('private request getter'), false);
});


test('malformed Memory snapshot cursor values are non-ready, including matching invalid cursors', async (t) => {
  const { consumer, provider, setCandidates, snapshot } = setup(t);
  setCandidates([]);
  const originalRetrieve = provider.retrieveCandidates;

  for (const malformedSnapshot of [
    { world_revision: -1, commit_sequence: snapshot.commit_sequence },
    { world_revision: snapshot.world_revision + 0.5, commit_sequence: snapshot.commit_sequence },
    { world_revision: Number.MAX_SAFE_INTEGER + 1, commit_sequence: snapshot.commit_sequence },
    { world_revision: String(snapshot.world_revision), commit_sequence: snapshot.commit_sequence },
    { world_revision: snapshot.world_revision, commit_sequence: String(snapshot.commit_sequence) },
  ]) {
    provider.retrieveCandidates = async () => ({
      ...(await originalRetrieve()),
      snapshot: malformedSnapshot,
    });

    const result = await consumer.retrieveForNpc(request());
    assert.equal(result.status, 'non_ready');
    assert.equal(result.reason, 'memory_result_incomplete_or_scope_mismatch');
    assert.deepEqual(result.admitted, []);
    assert.deepEqual(result.candidates, []);
    assert.equal(JSON.stringify(result).includes(JSON.stringify(malformedSnapshot)), false);
  }
});


test('final dispatch revalidation returns fresh content and fails closed after access revocation or source mutation', async (t) => {
  const accessCase = setup(t);
  const prepared = await accessCase.consumer.retrieveForNpc(request());
  assert.equal(prepared.status, 'ready');
  const current = await accessCase.consumer.revalidateForFinalDispatch(request(), prepared);
  assert.equal(current.status, 'ready');
  assert.deepEqual(current, prepared);

  accessCase.provider.authorizeCandidate = async () => false;
  const revoked = await accessCase.consumer.revalidateForFinalDispatch(request(), prepared);
  assert.equal(revoked.status, 'non_ready');
  assert.equal(revoked.reason, 'final_dispatch_source_not_current');
  assert.deepEqual(revoked.candidates, []);

  const sourceCase = setup(t);
  const sourcePrepared = await sourceCase.consumer.retrieveForNpc(request());
  sourceCase.engine.commitEvent('memory-npc-world', {
    idempotency_key: 'mutate-source-before-final-dispatch',
    turn_id: 'mutate-source-before-final-dispatch',
    event_type: 'action.completed',
    expected_revision: sourceCase.engine.getState('memory-npc-world').world_revision,
    causal_links: [{ relation: 'REQUIRES', predicate: { kind: 'entity_exists', entity_id: 'source-a' } }],
    effects: [{ kind: 'entity.update', entity_id: 'source-a', attributes: { public_note: 'new source value' } }],
  });
  const stale = await sourceCase.consumer.revalidateForFinalDispatch(request(), sourcePrepared);
  assert.equal(stale.status, 'non_ready');
});

test('final dispatch revalidation rejects forged or malformed prepared results', async (t) => {
  const { consumer } = setup(t);
  assert.equal((await consumer.revalidateForFinalDispatch(request(), { status: 'ready', admitted: [], candidates: [] })).status, 'non_ready');
  const prepared = await consumer.retrieveForNpc(request());
  const tampered = { ...prepared, candidates: [] };
  assert.equal((await consumer.revalidateForFinalDispatch(request(), tampered)).status, 'non_ready');
});


test('consumer fails closed on Object.prototype pollution without invoking inherited getters', async (t) => {
  const { consumer } = setup(t);
  let invoked = false;
  Object.defineProperty(Object.prototype, 'npcInjectedWorldId', {
    configurable: true,
    get() { invoked = true; return 'memory-npc-world'; },
  });
  let result;
  try {
    result = await consumer.retrieveForNpc(request());
  } finally {
    delete Object.prototype.npcInjectedWorldId;
  }
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'memory_result_incomplete_or_scope_mismatch');
  assert.equal(invoked, false);
});

test('consumer fails closed when Array.prototype iterator is replaced', async (t) => {
  const { consumer } = setup(t);
  const original = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
  let result;
  try {
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      configurable: true,
      writable: true,
      value: function* pollutedIterator() { throw new Error('iterator invoked'); },
    });
    result = await consumer.retrieveForNpc(request());
  } finally {
    Object.defineProperty(Array.prototype, Symbol.iterator, original);
  }
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'memory_result_incomplete_or_scope_mismatch');
});


test('Core derives world and actor from trusted conversation and unique adapter bindings', async (t) => {
  const s = setup(t);
  const result = await s.consumer.retrieveForNpc({
    ...request(),
    worldId: 'caller-selected-world',
    actorEntityId: 'caller-selected-actor',
  });
  assert.equal(result.status, 'ready');
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].source_entity_id, 'source-a');

  const before = s.engine.getSnapshot('memory-npc-world');
  const created = s.engine.commitEvent('memory-npc-world', {
    event_id: 'create-second-bound-actor',
    idempotency_key: 'create-second-bound-actor',
    turn_id: 'create-second-bound-actor',
    event_type: 'action.completed',
    expected_revision: before.world_revision,
    effects: [{ kind: 'entity.create', entity_id: 'npc-b', entity_type: 'character' }],
  });
  assert.equal(created.accepted, true);
  s.bindings.bind('memory-npc-world', 'adapter-a', 'npc-b');

  const ambiguous = await s.consumer.retrieveForNpc(request());
  assert.equal(ambiguous.status, 'non_ready');
  assert.equal(ambiguous.reason, 'actor_binding_unavailable');
  assert.deepEqual(ambiguous.candidates, []);
});


test('Core reapplies field visibility after asynchronous Provider authorization and before disclosure', async (t) => {
  const s = setup(t);
  const authorizeCandidate = s.provider.authorizeCandidate.bind(s.provider);
  const readEntityFields = s.authorizedReadService.readEntityFields.bind(s.authorizedReadService);
  let calls = 0;
  let reads = 0;
  let finalReadEntity;
  s.authorizedReadService.readEntityFields = (input) => {
    reads += 1;
    const result = readEntityFields(input);
    if (reads === 2) finalReadEntity = result.entities[0];
    return result;
  };
  s.provider.authorizeCandidate = async (input) => {
    calls += 1;
    if (calls === 3) {
      s.revokeContent();
      assert.equal(s.authorizedReadService._fieldAllowed(
        {}, { entity_id: 'source-a' }, 'attributes.public_note',
      ), false);
    }
    return authorizeCandidate(input);
  };

  const result = await s.consumer.retrieveForNpc(request());
  assert.equal(calls, 3);
  assert.equal(reads, 2);
  assert.equal(Object.hasOwn(finalReadEntity, 'attributes.public_note'), false);
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'authorized_source_read_unavailable');
  assert.deepEqual(result.candidates, []);
  assert.equal(JSON.stringify(result).includes('authorized source text'), false);
});

test('Memory NPC retrieval fails closed when authenticated Host World/Actor bindings differ from Core', async t => {
  const f = setup(t);
  f.setHostBindings({ world_id: 'memory-npc-world', actor_id: 'different-actor' });
  const result = await f.consumer.retrieveForNpc({ conversationId: HOST_CONVERSATION_ID });
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'query_access_unconfirmed');
  assert.equal(f.getLastCandidateAuthorization(), null);
});


test('filtered-empty disclosure rechecks query authorization after the final Core snapshot read', async (t) => {
  const { consumer, provider, setCandidates, candidate } = setup(t);
  // A complete, well-formed summary row is intentionally outside the
  // canonical_entity disclosure lane and produces the filtered-empty path.
  setCandidates([candidate({ content_kind: 'summary' })]);
  let checks = 0;
  provider.authorizeQuery = () => ++checks < 2;

  const result = await consumer.retrieveForNpc(request());

  assert.equal(checks, 2);
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'query_access_unconfirmed');
  assert.deepEqual(result.admitted, []);
  assert.deepEqual(result.candidates, []);
  assert.equal(JSON.stringify(result).includes('authorized source text'), false);
});
