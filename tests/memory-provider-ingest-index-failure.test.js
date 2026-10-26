import test from 'node:test';
import { createProviderTestDb } from './helpers/provider-test-db.js';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';

test('record persistence survives index-write failure and retrieval stays closed until rebuild and reconciliation', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-memory-ingest-index-failure-'));
  const path = join(directory, 'provider.sqlite');
  const scope = { world_id: 'world-ingest-failure', subject_id: 'npc-ingest-failure', purpose: 'npc_decision' };
  const record = {
    ...scope,
    record_ref: 'memory:ingest-failure-record',
    record_version: 'v1',
    source_kind: 'canonical_entity',
    source_entity_id: 'entity-ingest-failure',
    source_version: 'source-v1',
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer_kind: 'provider-test',
    content_disposition: 'usable',
    evidence_assessment: 'unassessed',
    lineage: [{ source_kind: 'canonical_entity', entity_id: 'entity-ingest-failure', source_version: 'source-v1' }],
  };
  const options = {
    path,
    getSnapshot: async () => ({ world_revision: 3, commit_sequence: 2 }),
    validateSourceVersion: async () => true,
    validateInventory: async () => true,
  };
  let provider = new SQLiteMemoryProvider(options);
  const testDb = createProviderTestDb(t, { path });
  t.after(() => {
    try { provider.close(); } catch {}
    testDb.close();
    rmSync(directory, { recursive: true, force: true });
  });

  provider.grantQuery(scope, true);
  provider.grantRecord(scope, record.record_ref, record.record_version, true);
  testDb.db.exec(`CREATE TRIGGER fail_ingest_index BEFORE INSERT ON memory_index_entries
    BEGIN SELECT RAISE(ABORT, 'injected ingest index failure'); END;`);

  assert.throws(() => provider.putRecord(record), /injected ingest index failure/);
  assert.equal(testDb.db.prepare('SELECT COUNT(*) AS n FROM memory_records WHERE world_id=? AND record_ref=? AND record_version=?')
    .get(scope.world_id, record.record_ref, record.record_version).n, 1,
  'the durable Provider record is retained even though its derived index write failed');
  assert.equal(testDb.db.prepare('SELECT COUNT(*) AS n FROM memory_index_entries WHERE world_id=? AND record_ref=? AND record_version=?')
    .get(scope.world_id, record.record_ref, record.record_version).n, 0);
  assert.equal(provider.getIndexStatusForDiagnostics(scope.world_id).index_health, 'unavailable');
  await assert.rejects(() => provider.retrieveCandidates(scope), /MEMORY_INDEX_NOT_READY/);

  // Restart must preserve the durable record and the fail-closed readiness marker.
  provider.close();
  provider = new SQLiteMemoryProvider(options);
  assert.equal(testDb.db.prepare('SELECT COUNT(*) AS n FROM memory_records WHERE world_id=? AND record_ref=? AND record_version=?')
    .get(scope.world_id, record.record_ref, record.record_version).n, 1);
  assert.equal(provider.getIndexStatusForDiagnostics(scope.world_id).index_health, 'unavailable');
  await assert.rejects(() => provider.retrieveCandidates(scope), /MEMORY_INDEX_NOT_READY/);

  testDb.db.exec('DROP TRIGGER fail_ingest_index');
  const replay = provider.putRecord(record);
  assert.deepEqual(replay, {
    status: 'duplicate',
    record_ref: record.record_ref,
    record_version: record.record_version,
    index_repaired: true,
    reconciliation_required: true,
  });
  assert.equal(testDb.db.prepare('SELECT COUNT(*) AS n FROM memory_index_entries WHERE world_id=? AND record_ref=? AND record_version=?')
    .get(scope.world_id, record.record_ref, record.record_version).n, 1);
  assert.equal(provider.getIndexStatusForDiagnostics(scope.world_id).index_health, 'rebuilding',
    'repairing one missing derived entry must not restore readiness by itself');
  assert.deepEqual(await provider.rebuildIndex(scope.world_id), { status: 'rebuilt', count: 1 });
  assert.equal((await provider.reconcile(scope.world_id)).status, 'current');
  const recovered = await provider.retrieveCandidates(scope);
  assert.equal(recovered.completeness, 'complete');
  assert.equal(recovered.candidates.length, 1);
  assert.equal(recovered.candidates[0].record.ref, record.record_ref);
  assert.equal(recovered.candidates[0].record.version, record.record_version);
});
