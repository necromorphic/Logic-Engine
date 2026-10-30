import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviderTestDb } from './helpers/provider-test-db.js';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';

const record = (index = 0) => ({
  world_id: 'world-failure-matrix',
  subject_id: 'npc-failure-matrix',
  purpose: 'npc_decision',
  record_ref: `memory:failure-${index}`,
  record_version: 'v1',
  source_kind: 'canonical_entity',
  source_entity_id: `entity-${index}`,
  source_version: 'source-v1',
  content_kind: 'claim',
  epistemic_kind: 'acquired_report',
  producer_kind: 'test',
  content_disposition: 'usable',
  evidence_assessment: 'unassessed',
  lineage: [{
    source_kind: 'canonical_entity',
    entity_id: `entity-${index}`,
    source_version: 'source-v1',
  }],
});

function setup(t, overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'logic-memory-failure-matrix-'));
  const path = join(directory, 'provider.sqlite');
  let snapshot = { world_revision: 5, commit_sequence: 2 };
  let snapshotFailure = false;
  const options = {
    path,
    getSnapshot: async () => {
      if (snapshotFailure) throw new Error('private snapshot failure');
      return snapshot;
    },
    validateSourceVersion: async () => true,
    validateInventory: async () => true,
    ...overrides,
  };
  const provider = new SQLiteMemoryProvider(options);
  const testDb = createProviderTestDb(t, { path });
  t.after(() => {
    try { provider.close(); } catch {}
    testDb.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    provider,
    scope: { world_id: 'world-failure-matrix', subject_id: 'npc-failure-matrix', purpose: 'npc_decision' },
    grantQuery() { provider.grantQuery(this.scope, true); },
    async prepare() {
      await provider.rebuildIndex(this.scope.world_id);
      return provider.reconcile(this.scope.world_id);
    },
    setSnapshot(value) { snapshot = value; },
    setSnapshotFailure(value) { snapshotFailure = value; },
  };
}

test('failure matrix: authorized complete-empty is distinct from denied and withheld', async (t) => {
  const empty = setup(t);
  empty.grantQuery();
  assert.equal((await empty.prepare()).status, 'current');
  const result = await empty.provider.retrieveCandidates(empty.scope);
  assert.equal(result.completeness, 'complete');
  assert.deepEqual(result.candidates, []);

  const denied = setup(t);
  denied.provider.grantQuery(denied.scope, false);
  await assert.rejects(
    () => denied.provider.retrieveCandidates(denied.scope),
    (error) => error.message === 'MEMORY_QUERY_DENIED',
  );

  const withheld = setup(t);
  withheld.grantQuery();
  withheld.provider.putRecord(record());
  assert.equal((await withheld.prepare()).status, 'current');
  await assert.rejects(
    () => withheld.provider.retrieveCandidates(withheld.scope),
    (error) => error.message === 'MEMORY_RECORDS_WITHHELD',
  );
});

test('failure matrix: partial is explicit and never returned as complete', async (t) => {
  const s = setup(t);
  s.grantQuery();
  for (let index = 0; index < 51; index += 1) {
    const item = record(index);
    s.provider.putRecord(item);
    s.provider.grantRecord(s.scope, item.record_ref, item.record_version, true);
  }
  assert.equal((await s.prepare()).status, 'current');
  const result = await s.provider.retrieveCandidates(s.scope);
  assert.equal(result.candidates.length, 50);
  assert.equal(result.completeness, 'partial');
});

test('failure matrix: stale source snapshot is typed and does not become complete-empty', async (t) => {
  const s = setup(t);
  s.grantQuery();
  const item = record();
  s.provider.putRecord(item);
  s.provider.grantRecord(s.scope, item.record_ref, item.record_version, true);
  assert.equal((await s.prepare()).status, 'current');
  s.setSnapshot({ world_revision: 6, commit_sequence: 2 });
  await assert.rejects(
    () => s.provider.retrieveCandidates(s.scope),
    (error) => error.message === 'MEMORY_SNAPSHOT_STALE',
  );
  assert.equal(s.provider.getIndexStatusForDiagnostics(s.scope.world_id).index_health, 'stale');
});

test('failure matrix: unavailable Core snapshot remains unavailable and fail-closed', async (t) => {
  const s = setup(t);
  s.grantQuery();
  s.setSnapshotFailure(true);
  assert.deepEqual(await s.provider.reconcile(s.scope.world_id), {
    status: 'unavailable',
    reason: 'CORE_SNAPSHOT_UNAVAILABLE',
  });
  await assert.rejects(
    () => s.provider.retrieveCandidates(s.scope),
    (error) => error.message === 'MEMORY_INDEX_NOT_READY',
  );
  assert.equal(s.provider.getIndexStatusForDiagnostics(s.scope.world_id).index_health, 'unavailable');
});

test('failure matrix: rebuilding index is non-ready and never complete-empty', async (t) => {
  const s = setup(t);
  s.grantQuery();
  s.provider.putRecord(record());
  await assert.rejects(
    () => s.provider.retrieveCandidates(s.scope),
    (error) => error.message === 'MEMORY_INDEX_NOT_READY',
  );
  assert.equal(s.provider.getIndexStatusForDiagnostics(s.scope.world_id).index_health, 'rebuilding');
});
