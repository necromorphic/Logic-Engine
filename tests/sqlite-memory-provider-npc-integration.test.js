import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { ActorBindingService } from '../src/application/actor-bindings.js';
import { AuthorizedReadService } from '../src/application/authorized-read-service.js';
import { MemoryNpcConsumer } from '../src/application/memory-npc-consumer.js';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';

const worldId = 'provider-npc-world';
const adapterId = 'adapter-a';
const actorId = 'npc-a';
const purpose = 'npc_decision';

function canonicalInventory(rows) {
  return rows.map((row) => ({
    record_ref: row.record_ref,
    record_version: row.record_version,
    source_kind: row.source_kind,
    source_entity_id: row.source_entity_id,
    source_version: row.source_version,
  })).sort((a, b) => a.record_ref.localeCompare(b.record_ref)
    || a.record_version.localeCompare(b.record_version));
}

function setup(t) {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  const actorBindings = new ActorBindingService(engine);
  engine.createWorld({
    world_id: worldId,
    world_pack_id: 'test.provider-npc',
    world_pack_version: '1',
    game_time: '2026-01-01T00:00:00Z',
  });
  engine.commitEvent(worldId, {
    idempotency_key: 'seed-provider-npc-world',
    turn_id: 'seed-provider-npc-world',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [
      { kind: 'entity.create', entity_id: actorId, entity_type: 'character', attributes: { name: 'NPC' } },
      { kind: 'entity.create', entity_id: 'source-a', entity_type: 'character', attributes: {
        public_note: 'authorized source A', private_note: 'private A',
      } },
      { kind: 'entity.create', entity_id: 'source-b', entity_type: 'character', attributes: {
        public_note: 'authorized source B', private_note: 'private B',
      } },
    ],
  });
  actorBindings.bind(worldId, adapterId, actorId);
  const authorizedReadService = new AuthorizedReadService(
    engine,
    actorBindings,
    (_context, _entity, field) => field === 'entity_id' || field === 'attributes.public_note',
  );

  const sourceVersions = new Map([['source-a', 'source-v1'], ['source-b', 'source-v1']]);
  const expectedInventory = new Map();
  let pauseValidation = null;
  const provider = new SQLiteMemoryProvider({
    path: ':memory:',
    getSnapshot: async (requestedWorldId) => engine.getSnapshot(requestedWorldId),
    validateSourceVersion: async (record) => {
      // Use the real Core binding/authorized-read boundary to confirm the source
      // still exists and the actor context is valid. The per-source version map
      // is test authority only, not a production source-version contract.
      authorizedReadService.readEntityFields({
        worldId: record.world_id,
        adapterId,
        actorEntityId: actorId,
        recipient: 'model',
        purpose,
        entityIds: [record.source_entity_id],
        fields: ['entity_id'],
      });
      if (pauseValidation?.recordRef === record.record_ref) {
        pauseValidation.entered();
        await pauseValidation.releasePromise;
      }
      return sourceVersions.get(record.source_entity_id) === record.source_version;
    },
    validateInventory: async (requestedWorldId, rows) => requestedWorldId === worldId
      && isDeepStrictEqual(canonicalInventory(rows), canonicalInventory([...expectedInventory.values()])),
  });

  const scope = { world_id: worldId, subject_id: actorId, purpose };
  provider.grantQuery(scope, true);

  const addRecord = (recordRef, sourceEntityId) => {
    const record = {
      ...scope,
      record_ref: recordRef,
      record_version: 'v1',
      source_kind: 'canonical_entity',
      source_entity_id: sourceEntityId,
      source_version: sourceVersions.get(sourceEntityId),
      content_kind: 'claim',
      epistemic_kind: 'acquired_report',
      producer_kind: 'memory-index',
      content_disposition: 'usable',
      evidence_assessment: 'unassessed',
      lineage: [{
        source_kind: 'canonical_entity',
        entity_id: sourceEntityId,
        source_version: sourceVersions.get(sourceEntityId),
      }],
    };
    provider.grantRecord(scope, record.record_ref, record.record_version, true);
    assert.equal(provider.putRecord(record).status, 'stored');
    expectedInventory.set(record.record_ref, {
      record_ref: record.record_ref,
      record_version: record.record_version,
      source_kind: record.source_kind,
      source_entity_id: record.source_entity_id,
      source_version: record.source_version,
    });
    return record;
  };

  const consumer = new MemoryNpcConsumer({
    authorizedReadService,
    actorBindingService: actorBindings,
    memoryProvider: provider,
    contentFields: ['attributes.public_note'],
  });
  t.after(() => {
    try { provider.close(); } catch {}
    try { store.close(); } catch {}
  });

  return {
    engine, store, actorBindings, authorizedReadService, provider, consumer, scope, addRecord,
    setValidationPause(value) { pauseValidation = value; },
    setSourceVersion(sourceEntityId, version) { sourceVersions.set(sourceEntityId, version); },
  };
}

const request = () => ({ worldId, adapterId, actorEntityId: actorId });

async function prepareReady(s, refs) {
  for (const [ref, sourceId] of refs) s.addRecord(ref, sourceId);
  assert.deepEqual(await s.provider.rebuildIndex(worldId), { status: 'rebuilt', count: refs.length });
  assert.equal((await s.provider.reconcile(worldId)).status, 'current');
}

test('real SQLite Provider → Core AuthorizedReadService → NPC consumer returns only authorized canonical content', async (t) => {
  const s = setup(t);
  await prepareReady(s, [['memory:claim-a', 'source-a']]);
  const before = {
    revision: s.engine.getState(worldId).world_revision,
    sequence: s.store.currentCommitSequence(worldId),
    events: s.store.events(worldId, true).length,
    audit: s.store.audit(worldId).length,
  };

  const result = await s.consumer.retrieveForNpc(request());

  assert.equal(result.status, 'ready', JSON.stringify(result));
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].record_ref, 'memory:claim-a');
  assert.deepEqual(result.candidates[0].content, { 'attributes.public_note': 'authorized source A' });
  assert.equal(JSON.stringify(result).includes('private A'), false);
  assert.equal(JSON.stringify(result).includes('private_note'), false);
  assert.deepEqual(result.snapshot, {
    world_revision: before.revision,
    commit_sequence: before.sequence,
  });
  assert.equal(s.engine.getState(worldId).world_revision, before.revision);
  assert.equal(s.store.currentCommitSequence(worldId), before.sequence);
  assert.equal(s.store.events(worldId, true).length, before.events);
  assert.equal(s.store.audit(worldId).length, before.audit);
});

test('real Provider revalidates candidate A after candidate B authorization awaits and A is revoked', async (t) => {
  const s = setup(t);
  await prepareReady(s, [
    ['memory:claim-a', 'source-a'],
    ['memory:claim-b', 'source-b'],
  ]);

  let entered;
  let release;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const releasePromise = new Promise((resolve) => { release = resolve; });
  s.setValidationPause({
    recordRef: 'memory:claim-b',
    entered,
    releasePromise,
  });

  const pending = s.consumer.retrieveForNpc(request());
  await enteredPromise;
  s.provider.revokeRecord(s.scope, 'memory:claim-a', 'v1');
  release();
  s.setValidationPause(null);

  const result = await pending;
  assert.equal(result.status, 'ready', JSON.stringify(result));
  assert.deepEqual(result.candidates.map((candidate) => candidate.record_ref), ['memory:claim-b']);
  assert.deepEqual(result.candidates[0].content, { 'attributes.public_note': 'authorized source B' });
  assert.equal(JSON.stringify(result).includes('authorized source A'), false);
  assert.equal(JSON.stringify(result).includes('private B'), false);
});

test('real Provider fails closed when its Core snapshot changes after reconciliation', async (t) => {
  const s = setup(t);
  await prepareReady(s, [['memory:claim-a', 'source-a']]);

  s.engine.commitEvent(worldId, {
    idempotency_key: 'change-core-snapshot',
    turn_id: 'change-core-snapshot',
    event_type: 'action.completed',
    expected_revision: s.engine.getState(worldId).world_revision,
    effects: [{ kind: 'entity.create', entity_id: 'unrelated-after-index', entity_type: 'object' }],
  });

  const result = await s.consumer.retrieveForNpc(request());
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'memory_retrieval_unavailable');
  assert.equal(s.provider.getIndexStatusForDiagnostics(worldId).source_reconciliation, 'stale');
});
