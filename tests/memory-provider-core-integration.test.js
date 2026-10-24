import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { ActorBindingService } from '../src/application/actor-bindings.js';
import { AuthorizedReadService } from '../src/application/authorized-read-service.js';
import { MemoryNpcConsumer } from '../src/application/memory-npc-consumer.js';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';

function setup(t, { twoRecords = false } = {}) {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  const bindings = new ActorBindingService(engine);
  const worldId = 'provider-e2e-world';
  const adapterId = 'provider-e2e-adapter';
  const actorId = 'npc-provider-e2e';
  const sources = twoRecords ? ['source-a', 'source-b'] : ['source-a'];
  engine.createWorld({
    world_id: worldId, world_pack_id: 'test.provider-e2e', world_pack_version: '1',
    game_time: '2026-01-01T00:00:00Z',
  });
  engine.commitEvent(worldId, {
    event_id: 'provider-e2e-seed', idempotency_key: 'provider-e2e-seed', turn_id: 'provider-e2e-seed',
    event_type: 'action.completed', expected_revision: 0,
    effects: [
      { kind: 'entity.create', entity_id: actorId, entity_type: 'character', attributes: { name: 'NPC' } },
      ...sources.map((id) => ({ kind: 'entity.create', entity_id: id, entity_type: 'character',
        attributes: { public_note: 'visible ' + id, private_note: 'never disclose ' + id } })),
    ],
  });
  bindings.bind(worldId, adapterId, actorId);
  let provider;
  let triggerRace = false;
  const snapshotReader = async (id) => {
    const snapshot = engine.getSnapshot(id);
    return { world_revision: snapshot.world_revision, commit_sequence: snapshot.commit_sequence };
  };
  const sourceVersionValidator = async (record) => {
    if (record.source_version !== 'fixture-source-v1') return false;
    if (triggerRace && record.record_ref === 'memory:record-b') {
      triggerRace = false;
      provider.revokeRecord(scope, 'memory:record-a', 'record-v1');
    }
    try {
      const snapshot = engine.getSnapshot(record.world_id, { entityIds: [record.source_entity_id] });
      return snapshot.entities.length === 1 && snapshot.entities[0].entity_id === record.source_entity_id;
    } catch { return false; }
  };
  provider = new SQLiteMemoryProvider({
    path: ':memory:',
    getSnapshot: snapshotReader,
    validateSourceVersion: sourceVersionValidator,
    validateInventory: async () => true,
  });
  const scope = { world_id: worldId, subject_id: actorId, purpose: 'npc_decision' };
  provider.grantQuery(scope, true);
  const records = sources.map((sourceId, index) => ({
    ...scope,
    record_ref: index === 0 ? 'memory:record-a' : 'memory:record-b',
    record_version: 'record-v1',
    source_kind: 'canonical_entity',
    source_entity_id: sourceId,
    source_version: 'fixture-source-v1',
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer_kind: 'memory-index',
    content_disposition: 'usable',
    evidence_assessment: 'unassessed',
    lineage: [{ source_kind: 'canonical_entity', entity_id: sourceId, source_version: 'fixture-source-v1' }],
  }));
  for (const record of records) {
    provider.putRecord(record);
    provider.grantRecord(scope, record.record_ref, record.record_version, true);
  }
  const authorizedReadService = new AuthorizedReadService(engine, bindings,
    (context, entity, field) => field === 'entity_id'
      || (field === 'attributes.public_note' && entity.entity_id.startsWith('source-')));
  const consumer = new MemoryNpcConsumer({
    authorizedReadService, actorBindingService: bindings, memoryProvider: provider,
    contentFields: ['attributes.public_note'],
  });
  t.after(() => { provider.close(); store.close(); });
  return {
    engine, provider, consumer, scope, records,
    async prepare() {
      await provider.rebuildIndex(worldId);
      return provider.reconcile(worldId);
    },
    triggerRace() { triggerRace = true; },
  };
}

test('real SQLite provider flows through Core authorized read and NPC admission', async (t) => {
  const s = setup(t);
  assert.equal((await s.prepare()).status, 'current');
  const result = await s.consumer.retrieveForNpc({
    worldId: s.scope.world_id, adapterId: 'provider-e2e-adapter', actorEntityId: s.scope.subject_id,
  });
  assert.equal(result.status, 'ready');
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].record_ref, 'memory:record-a');
  assert.deepEqual(result.candidates[0].content, { 'attributes.public_note': 'visible source-a' });
  assert.equal(JSON.stringify(result).includes('never disclose'), false);
});

test('real provider revocation during candidate B authorization excludes previously allowed A', async (t) => {
  const s = setup(t, { twoRecords: true });
  assert.equal((await s.prepare()).status, 'current');
  s.triggerRace();
  const result = await s.consumer.retrieveForNpc({
    worldId: s.scope.world_id, adapterId: 'provider-e2e-adapter', actorEntityId: s.scope.subject_id,
  });
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.candidates.map((candidate) => candidate.record_ref), ['memory:record-b']);
  assert.equal(JSON.stringify(result).includes('visible source-a'), false);
});
test('Core rollback with unchanged commit_sequence invalidates provider currentness', async (t) => {
  const s = setup(t);
  assert.equal((await s.prepare()).status, 'current');
  const before = s.engine.getSnapshot(s.scope.world_id);
  const rollback = s.engine.rollbackEvent(s.scope.world_id, {
    root_event_id: 'provider-e2e-seed',
    idempotency_key: 'provider-e2e-rollback',
  });
  assert.equal(rollback.accepted, true);
  const after = s.engine.getSnapshot(s.scope.world_id);
  assert.equal(after.world_revision, before.world_revision + 1);
  assert.equal(after.commit_sequence, before.commit_sequence);
  await assert.rejects(() => s.provider.retrieveCandidates(s.scope), /MEMORY_SNAPSHOT_STALE/);
});

test('real Core entity existence does not substitute for an approved source-version proof', async (t) => {
  const s = setup(t);
  const existing = s.engine.getSnapshot(s.scope.world_id, { entityIds: ['source-a'] });
  assert.equal(existing.entities.length, 1, 'the canonical entity exists in the real Core store');

  // The current Core contract has no authoritative durable per-entity source
  // version. Model that missing proof explicitly instead of treating the
  // fixture-source-v1 token or composite snapshot as source authority.
  s.provider.validateSourceVersion = async () => false;
  assert.equal((await s.prepare()).status, 'stale');

  const result = await s.consumer.retrieveForNpc({
    worldId: s.scope.world_id, adapterId: 'provider-e2e-adapter', actorEntityId: s.scope.subject_id,
  });
  assert.equal(result.status, 'non_ready');
  assert.deepEqual(result.candidates, []);
});

test('real SQLite provider stays non-current when the source inventory boundary cannot attest completeness', async (t) => {
  const s = setup(t);
  s.provider.validateInventory = async () => false;
  assert.equal((await s.prepare()).status, 'stale');

  const result = await s.consumer.retrieveForNpc({
    worldId: s.scope.world_id, adapterId: 'provider-e2e-adapter', actorEntityId: s.scope.subject_id,
  });
  assert.equal(result.status, 'non_ready');
  assert.deepEqual(result.candidates, []);
});

test('source version becoming unverifiable after indexing invalidates prior provider currentness', async (t) => {
  const s = setup(t);
  assert.equal((await s.prepare()).status, 'current');

  // The current host cannot provide an authoritative durable version proof;
  // when revalidation can no longer establish validity, old readiness is revoked.
  s.provider.validateSourceVersion = async () => false;
  assert.equal((await s.provider.reconcile(s.scope.world_id)).status, 'stale');
  await assert.rejects(() => s.provider.retrieveCandidates(s.scope), /MEMORY_INDEX_NOT_READY/);
  const result = await s.consumer.retrieveForNpc({
    worldId: s.scope.world_id, adapterId: 'provider-e2e-adapter', actorEntityId: s.scope.subject_id,
  });
  assert.equal(result.status, 'non_ready');
  assert.deepEqual(result.candidates, []);
});

test('inventory completeness becoming unavailable invalidates previously current reconciliation', async (t) => {
  const s = setup(t);
  assert.equal((await s.prepare()).status, 'current');

  s.provider.validateInventory = async () => false;
  assert.equal((await s.provider.reconcile(s.scope.world_id)).status, 'stale');
  await assert.rejects(() => s.provider.retrieveCandidates(s.scope), /MEMORY_INDEX_NOT_READY/);
  const result = await s.consumer.retrieveForNpc({
    worldId: s.scope.world_id, adapterId: 'provider-e2e-adapter', actorEntityId: s.scope.subject_id,
  });
  assert.equal(result.status, 'non_ready');
  assert.deepEqual(result.candidates, []);
});

test('query denial is non-ready and does not disclose candidate identities or content', async (t) => {
  const s = setup(t);
  assert.equal((await s.prepare()).status, 'current');
  s.provider.grantQuery(s.scope, false);

  const result = await s.consumer.retrieveForNpc({
    worldId: s.scope.world_id, adapterId: 'provider-e2e-adapter', actorEntityId: s.scope.subject_id,
  });
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'query_access_unconfirmed');
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.admitted, []);
  assert.equal(JSON.stringify(result).includes('memory:record-a'), false);
  assert.equal(JSON.stringify(result).includes('visible source-a'), false);
});

test('per-record denial is filtered without leaking denied record identity or content', async (t) => {
  const s = setup(t, { twoRecords: true });
  assert.equal((await s.prepare()).status, 'current');
  s.provider.revokeRecord(s.scope, 'memory:record-a', 'record-v1');

  const result = await s.consumer.retrieveForNpc({
    worldId: s.scope.world_id, adapterId: 'provider-e2e-adapter', actorEntityId: s.scope.subject_id,
  });
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.admitted.map((item) => item.record_ref), ['memory:record-b']);
  assert.deepEqual(result.candidates.map((item) => item.record_ref), ['memory:record-b']);
  assert.equal(JSON.stringify(result).includes('memory:record-a'), false);
  assert.equal(JSON.stringify(result).includes('visible source-a'), false);
  assert.equal(JSON.stringify(result).includes('never disclose source-a'), false);
});

test('retrieval and context inclusion do not persist delivery, receipt, acquisition, or belief side effects', async (t) => {
  const s = setup(t);
  assert.equal((await s.prepare()).status, 'current');

  const counts = () => Object.fromEntries([
    'memory_records', 'memory_index_entries', 'memory_query_grants',
    'memory_record_grants', 'memory_index_state',
  ].map((table) => [table, s.provider.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));
  const before = counts();
  const first = await s.consumer.retrieveForNpc({
    worldId: s.scope.world_id, adapterId: 'provider-e2e-adapter', actorEntityId: s.scope.subject_id,
  });
  const second = await s.consumer.retrieveForNpc({
    worldId: s.scope.world_id, adapterId: 'provider-e2e-adapter', actorEntityId: s.scope.subject_id,
  });
  assert.equal(first.status, 'ready');
  assert.equal(second.status, 'ready');
  assert.deepEqual(counts(), before);
  const tables = s.provider.db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all()
    .map((row) => row.name);
  assert.equal(tables.some((name) => /delivery|receipt|acquisition|belief/i.test(name)), false);
});

test('source validator outage makes the real Core/NPC consumer non-ready instead of ready-empty', async (t) => {
  const s = setup(t);
  assert.equal((await s.prepare()).status, 'current');
  s.provider.validateSourceVersion = async () => { throw new Error('private host validator details'); };

  const result = await s.consumer.retrieveForNpc({
    worldId: s.scope.world_id, adapterId: 'provider-e2e-adapter', actorEntityId: s.scope.subject_id,
  });
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'memory_record_authorization_unavailable');
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.admitted, []);
  assert.equal(JSON.stringify(result).includes('private host validator details'), false);
  assert.equal(JSON.stringify(result).includes('visible source-a'), false);
});

test('query authorization outage is non-ready and does not become complete-empty', async (t) => {
  const s = setup(t);
  assert.equal((await s.prepare()).status, 'current');
  s.provider.authorizeQuery = async () => { throw new Error('private query authorization detail'); };

  const result = await s.consumer.retrieveForNpc({
    worldId: s.scope.world_id, adapterId: 'provider-e2e-adapter', actorEntityId: s.scope.subject_id,
  });
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'query_access_unconfirmed');
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.admitted, []);
  assert.equal(JSON.stringify(result).includes('private query authorization detail'), false);
});

test('source becoming stale after reconciliation is non-ready, not a filtered ready-empty result', async (t) => {
  const s = setup(t);
  assert.equal((await s.prepare()).status, 'current');
  s.provider.validateSourceVersion = async () => false;

  const result = await s.consumer.retrieveForNpc({
    worldId: s.scope.world_id, adapterId: 'provider-e2e-adapter', actorEntityId: s.scope.subject_id,
  });
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'memory_record_authorization_unavailable');
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.admitted, []);
  assert.equal(JSON.stringify(result).includes('visible source-a'), false);
});
