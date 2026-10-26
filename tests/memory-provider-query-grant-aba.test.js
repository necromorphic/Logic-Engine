import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';

test('query grant revoke/re-grant through a second Provider connection invalidates in-flight retrieval', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-memory-query-aba-'));
  const path = join(directory, 'provider.sqlite');
  let holdSnapshot = false;
  let snapshotStarted;
  let releaseSnapshot;
  const started = new Promise((resolve) => { snapshotStarted = resolve; });
  const blockedSnapshot = new Promise((resolve) => { releaseSnapshot = resolve; });
  const getSnapshot = async () => {
    if (holdSnapshot) {
      snapshotStarted();
      await blockedSnapshot;
    }
    return { world_revision: 1, commit_sequence: 1 };
  };
  const options = {
    path,
    getSnapshot,
    validateSourceVersion: async (record) => record.source_version === 'source-v1'
      && record.source_entity_id === 'source-entity',
    // Test fixture only; does not establish production Host inventory authority.
    validateInventory: async () => true,
  };
  let first = new SQLiteMemoryProvider(options);
  let second = new SQLiteMemoryProvider(options);
  t.after(() => {
    try { first?.close(); } catch {}
    try { second?.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });

  const scope = { world_id: 'world-query-aba', subject_id: 'npc-query-aba', purpose: 'npc_decision' };
  const record = {
    ...scope,
    record_ref: 'memory:query-aba',
    record_version: 'record-v1',
    source_kind: 'canonical_entity',
    source_entity_id: 'source-entity',
    source_version: 'source-v1',
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer_kind: 'memory-index',
    content_disposition: 'usable',
    evidence_assessment: 'unassessed',
    lineage: [{ source_kind: 'canonical_entity', entity_id: 'source-entity', source_version: 'source-v1' }],
  };

  first.grantQuery(scope, true);
  first.grantRecord(scope, record.record_ref, record.record_version, true);
  first.putRecord(record);
  assert.deepEqual(await first.rebuildIndex(scope.world_id), { status: 'rebuilt', count: 1 });
  assert.equal((await first.reconcile(scope.world_id)).status, 'current');
  assert.equal((await first.retrieveCandidates(scope)).candidates.length, 1);

  holdSnapshot = true;
  const retrieval = first.retrieveCandidates(scope);
  await started;

  // The second connection performs a complete revoke/re-grant ABA while the
  // first request is suspended. Its local generation maps cannot observe this;
  // the durable SQLite cross-connection epoch must invalidate the request.
  second.grantQuery(scope, false);
  second.grantQuery(scope, true);
  releaseSnapshot();

  await assert.rejects(retrieval, (error) =>
    // Retrieval may detect the shared SQLite epoch first and mark the world
    // non-ready before candidate authorization can emit its narrower reason.
    ['MEMORY_AUTHORIZATION_CHANGED', 'MEMORY_INDEX_NOT_READY'].includes(error.message));
});
