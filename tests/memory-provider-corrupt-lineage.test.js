import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';

test('corrupt stored lineage cannot publish a ready reconciliation state', async (t) => {
  const provider = new SQLiteMemoryProvider({
    getSnapshot: async () => ({ world_revision: 1, commit_sequence: 1 }),
    validateSourceVersion: async () => true,
    validateInventory: async () => true,
  });
  t.after(() => provider.close());

  const record = {
    world_id: 'lineage-world',
    subject_id: 'lineage-npc',
    purpose: 'npc_decision',
    record_ref: 'lineage-record',
    record_version: 'v1',
    source_kind: 'canonical_entity',
    source_entity_id: 'lineage-entity',
    source_version: 'source-v1',
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer_kind: 'test',
    content_disposition: 'usable',
    evidence_assessment: 'unassessed',
    lineage: [{ source_kind: 'canonical_entity', entity_id: 'lineage-entity', source_version: 'source-v1' }],
  };
  provider.putRecord(record);
  await provider.rebuildIndex('lineage-world');
  provider.db.prepare('UPDATE memory_records SET lineage_json=? WHERE world_id=?')
    .run('{broken-json', 'lineage-world');

  await assert.rejects(() => provider.reconcile('lineage-world'));
  const scope = { world_id: 'lineage-world', subject_id: 'lineage-npc', purpose: 'npc_decision' };
  provider.grantQuery(scope, true);
  await assert.rejects(
    () => provider.retrieveCandidates(scope),
    (error) => error.message === 'MEMORY_INDEX_NOT_READY',
  );
});
