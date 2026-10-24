import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';

test('reconciliation refuses to publish current when a provider record is ingested during awaited validation', async (t) => {
  let provider;
  let injected = false;
  const scope = { world_id: 'world-race', subject_id: 'npc-race', purpose: 'npc_decision' };
  const snapshot = async () => ({ world_revision: 11, commit_sequence: 5 });
  const record = (ref, entity) => ({
    ...scope,
    record_ref: ref,
    record_version: 'v1',
    source_kind: 'canonical_entity',
    source_entity_id: entity,
    source_version: 'source-v1',
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer_kind: 'memory-index',
    content_disposition: 'usable',
    evidence_assessment: 'unassessed',
    lineage: [{ source_kind: 'canonical_entity', entity_id: entity, source_version: 'source-v1' }],
  });
  const first = record('memory:first', 'entity-first');
  const second = record('memory:second', 'entity-second');
  provider = new SQLiteMemoryProvider({
    getSnapshot: snapshot,
    validateSourceVersion: async (candidate) => {
      if (candidate.record_ref === first.record_ref && !injected) {
        injected = true;
        provider.putRecord(second);
        provider.grantRecord(scope, second.record_ref, second.record_version, true);
      }
      return candidate.source_version === 'source-v1';
    },
    validateInventory: async () => true,
  });
  t.after(() => provider.close());

  provider.grantQuery(scope, true);
  provider.putRecord(first);
  provider.grantRecord(scope, first.record_ref, first.record_version, true);
  await provider.rebuildIndex(scope.world_id);

  const firstReconciliation = await provider.reconcile(scope.world_id);
  assert.equal(firstReconciliation.status, 'stale',
    'the provider record set changed after the reconciliation snapshot was captured');
  await assert.rejects(
    () => provider.retrieveCandidates(scope),
    /MEMORY_INDEX_NOT_READY/,
    'concurrent ingest must not be marked current by an older reconciliation pass',
  );

  assert.equal((await provider.reconcile(scope.world_id)).status, 'current');
  assert.equal((await provider.retrieveCandidates(scope)).candidates.length, 2);
});
