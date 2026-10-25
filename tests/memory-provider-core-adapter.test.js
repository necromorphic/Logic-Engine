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

test('revocation of candidate A while candidate B authorization is awaited is caught before Core disclosure', async (t) => {
  const s = setup(t);
  const second = {
    ...s.scope,
    record_ref: 'memory:claim-b',
    record_version: 'v1',
    source_kind: 'canonical_entity',
    source_entity_id: 'source-a',
    source_version: 'fixture-source-version-1',
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer_kind: 'memory-index',
    content_disposition: 'usable',
    evidence_assessment: 'unassessed',
    lineage: [{
      source_kind: 'canonical_entity',
      entity_id: 'source-a',
      source_version: 'fixture-source-version-1',
    }],
  };
  s.provider.putRecord(second);
  s.provider.grantRecord(s.scope, 'memory:claim-b', 'v1', true);
  await s.provider.rebuildIndex(s.scope.world_id);
  assert.equal((await s.provider.reconcile(s.scope.world_id)).status, 'current');

  const authorize = s.provider.authorizeCandidate.bind(s.provider);
  let releaseB;
  let startedB;
  const waitingForB = new Promise((resolve) => { startedB = resolve; });
  const blockB = new Promise((resolve) => { releaseB = resolve; });
  let bCalls = 0;
  s.provider.authorizeCandidate = async (input) => {
    if (input.record_ref === 'memory:claim-b' && bCalls++ === 0) {
      startedB();
      await blockB;
    }
    return authorize(input);
  };

  const pending = s.consumer.retrieveForNpc(request());
  await waitingForB;
  s.provider.revokeRecord(s.scope, 'memory:claim-a', 'v1');
  releaseB();

  const result = await pending;
  assert.equal(result.status, 'ready', JSON.stringify(result));
  assert.deepEqual(result.candidates.map((candidate) => candidate.record_ref), ['memory:claim-b']);
  assert.equal(JSON.stringify(result).includes('source value'), true);
});
