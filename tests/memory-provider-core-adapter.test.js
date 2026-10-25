import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { ActorBindingService } from '../src/application/actor-bindings.js';
import { AuthorizedReadService } from '../src/application/authorized-read-service.js';
import { MemoryNpcConsumer } from '../src/application/memory-npc-consumer.js';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';

/**
 * Real in-process adapter integration: SQLiteMemoryProvider -> MemoryNpcConsumer
 * -> Core AuthorizedReadService -> NPC admission oracle.
 *
 * The source-version and inventory callbacks below are deliberately test
 * fixtures. They exercise the approved in-process seam but are NOT production
 * source authority, complete Host inventory, or a production-ready adapter.
 */
function setup(t, { sourceValidatorAvailable = true } = {}) {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  const bindings = new ActorBindingService(engine);
  engine.createWorld({
    world_id: 'provider-adapter-world',
    world_pack_id: 'test.provider-adapter',
    world_pack_version: '1',
    game_time: '2026-01-01T00:00:00Z',
  });
  engine.commitEvent('provider-adapter-world', {
    idempotency_key: 'seed-provider-adapter-world',
    turn_id: 'seed-provider-adapter-world',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [
      { kind: 'entity.create', entity_id: 'npc-a', entity_type: 'character' },
      { kind: 'entity.create', entity_id: 'source-a', entity_type: 'character',
        attributes: { public_note: 'source value', private_note: 'never disclose' } },
    ],
  });
  bindings.bind('provider-adapter-world', 'adapter-a', 'npc-a');
  const authorizedReadService = new AuthorizedReadService(
    engine, bindings,
    (_context, _entity, field) => field === 'entity_id' || field === 'attributes.public_note',
  );
  const scope = {
    world_id: 'provider-adapter-world',
    subject_id: 'npc-a',
    purpose: 'npc_decision',
  };
  const sourceVersion = 'fixture-source-version-1';
  const provider = new SQLiteMemoryProvider({
    getSnapshot: async (worldId) => engine.getSnapshot(worldId),
    validateSourceVersion: async (record) => {
      if (!sourceValidatorAvailable) throw new Error('fixture source validator unavailable');
      return record.source_entity_id === 'source-a' && record.source_version === sourceVersion
        && Boolean(engine.getState(record.world_id)?.entities?.some((entity) => entity.entity_id === 'source-a'));
    },
    validateInventory: async () => true,
  });
  provider.grantQuery(scope, true);
  provider.putRecord({
    ...scope,
    record_ref: 'memory:claim-a',
    record_version: 'v1',
    source_kind: 'canonical_entity',
    source_entity_id: 'source-a',
    source_version: sourceVersion,
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer_kind: 'memory-index',
    content_disposition: 'usable',
    evidence_assessment: 'unassessed',
    lineage: [{
      source_kind: 'canonical_entity',
      entity_id: 'source-a',
      source_version: sourceVersion,
    }],
  });
  provider.grantRecord(scope, 'memory:claim-a', 'v1', true);
  const consumer = new MemoryNpcConsumer({
    authorizedReadService,
    actorBindingService: bindings,
    memoryProvider: provider,
    contentFields: ['attributes.public_note'],
  });
  t.after(() => {
    provider.close();
    store.close();
  });
  return { engine, store, provider, consumer, scope };
}

const request = () => ({
  worldId: 'provider-adapter-world',
  adapterId: 'adapter-a',
  actorEntityId: 'npc-a',
});

test('real SQLite provider adapter reaches Core consumer and returns only Core-authorized source fields', async (t) => {
  const s = setup(t);
  assert.deepEqual(await s.provider.rebuildIndex(s.scope.world_id), { status: 'rebuilt', count: 1 });
  assert.equal((await s.provider.reconcile(s.scope.world_id)).status, 'current');

  const result = await s.consumer.retrieveForNpc(request());
  assert.equal(result.status, 'ready', JSON.stringify(result));
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].record_ref, 'memory:claim-a');
  assert.deepEqual(result.candidates[0].content, { 'attributes.public_note': 'source value' });
  assert.equal(JSON.stringify(result).includes('never disclose'), false);
  assert.equal(JSON.stringify(result).includes('private_note'), false);

  // Retrieval/admission is not delivery, receipt, acquisition, or belief.
  assert.equal(s.store.events(s.scope.world_id, true).length, 1);
  assert.equal(s.store.audit(s.scope.world_id).length, 0);
});

test('real provider record revocation is honored by the Core consumer on the next retrieval', async (t) => {
  const s = setup(t);
  await s.provider.rebuildIndex(s.scope.world_id);
  assert.equal((await s.provider.reconcile(s.scope.world_id)).status, 'current');
  assert.equal((await s.consumer.retrieveForNpc(request())).candidates.length, 1);

  s.provider.revokeRecord(s.scope, 'memory:claim-a', 'v1');
  const result = await s.consumer.retrieveForNpc(request());
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.admitted, []);
  assert.deepEqual(result.candidates, []);
});

test('source-validator outage on the real provider path is non-ready, not ready-empty', async (t) => {
  const s = setup(t, { sourceValidatorAvailable: false });
  await s.provider.rebuildIndex(s.scope.world_id);
  assert.equal((await s.provider.reconcile(s.scope.world_id)).status, 'stale');
  const result = await s.consumer.retrieveForNpc(request());
  assert.equal(result.status, 'non_ready');
  assert.deepEqual(result.candidates, []);
  assert.equal(JSON.stringify(result).includes('fixture source validator unavailable'), false);
});
