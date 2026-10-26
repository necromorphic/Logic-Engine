import test from 'node:test';
import { createProviderTestDb } from './helpers/provider-test-db.js';
import assert from 'node:assert/strict';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';

test('corrupt stored lineage cannot publish a ready reconciliation state', async (t) => {
  const testDb = createProviderTestDb(t, { prefix: 'logic-memory-corrupt-lineage-' });
  const provider = new SQLiteMemoryProvider({
    path: testDb.path,
    coordinatorPath: `${testDb.path}.coordinator.sqlite`,
    getSnapshot: async () => ({ world_revision: 1, commit_sequence: 1 }),
    validateSourceVersion: async () => true,
    validateInventory: async () => true,
  });
  t.after(() => { provider.close(); testDb.close(); testDb.cleanup(); });

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
  testDb.db.prepare('UPDATE memory_records SET lineage_json=? WHERE world_id=?')
    .run('{broken-json', 'lineage-world');

  assert.equal((await provider.reconcile('lineage-world')).status, 'stale');
  const scope = { world_id: 'lineage-world', subject_id: 'lineage-npc', purpose: 'npc_decision' };
  provider.grantQuery(scope, true);
  await assert.rejects(
    () => provider.retrieveCandidates(scope),
    (error) => error.message === 'MEMORY_INDEX_NOT_READY',
  );
});
