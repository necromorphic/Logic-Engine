import test from 'node:test';
import { createProviderTestDb } from './helpers/provider-test-db.js';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';

function setup(t, overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'logic-memory-typed-failure-'));
  const path = join(directory, 'provider.sqlite');
  const options = {
    path,
    getSnapshot: async () => ({ world_revision: 5, commit_sequence: 2 }),
    validateSourceVersion: async () => true,
    validateInventory: async () => true,
    ...overrides,
  };
  let provider = new SQLiteMemoryProvider(options);
  t.after(() => {
    try { provider?.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });
  const testDb = createProviderTestDb(t, { path });
  return {
    db: testDb.db,
    get provider() { return provider; },
    reopen() {
      provider.close();
      provider = new SQLiteMemoryProvider(options);
    },
  };
}

const record = {
  world_id: 'world-failures', subject_id: 'npc-failures', purpose: 'npc_decision',
  record_ref: 'memory:failure-record', record_version: 'v1',
  source_kind: 'canonical_entity', source_entity_id: 'entity-failure', source_version: 'source-v1',
  content_kind: 'claim', epistemic_kind: 'acquired_report', producer_kind: 'test',
  content_disposition: 'usable', evidence_assessment: 'unassessed',
  lineage: [{ source_kind: 'canonical_entity', entity_id: 'entity-failure', source_version: 'source-v1' }],
};

test('incomplete inventory persists a typed internal reason without exposing it in retrieval errors', async (t) => {
  const s = setup(t, { validateInventory: async () => false });
  s.provider.grantQuery({ world_id: record.world_id, subject_id: record.subject_id, purpose: record.purpose }, true);
  s.provider.putRecord(record);
  await s.provider.rebuildIndex(record.world_id);
  assert.deepEqual(await s.provider.reconcile(record.world_id), {
    status: 'stale', reason: 'INVENTORY_INCOMPLETE_OR_UNAVAILABLE',
  });
  assert.equal(s.provider.getIndexStatusForDiagnostics(record.world_id).failure_code,
    'INVENTORY_INCOMPLETE_OR_UNAVAILABLE');
  await assert.rejects(
    () => s.provider.retrieveCandidates({ world_id: record.world_id, subject_id: record.subject_id, purpose: record.purpose }),
    (error) => error.message === 'MEMORY_INDEX_NOT_READY' && !error.message.includes('INVENTORY'),
  );
  s.reopen();
  assert.equal(s.provider.getIndexStatusForDiagnostics(record.world_id).failure_code,
    'INVENTORY_INCOMPLETE_OR_UNAVAILABLE');
});

test('source validation failure and unavailable Core snapshot have distinct persisted reason codes', async (t) => {
  const stale = setup(t, { validateSourceVersion: async () => false });
  stale.provider.putRecord(record);
  await stale.provider.rebuildIndex(record.world_id);
  assert.deepEqual(await stale.provider.reconcile(record.world_id), {
    status: 'stale', reason: 'SOURCE_VALIDATION_FAILED',
  });
  assert.equal(stale.provider.getIndexStatusForDiagnostics(record.world_id).failure_code,
    'SOURCE_VALIDATION_FAILED');

  const unavailable = setup(t, { getSnapshot: async () => { throw new Error('private host detail'); } });
  assert.deepEqual(await unavailable.provider.reconcile(record.world_id), {
    status: 'unavailable', reason: 'CORE_SNAPSHOT_UNAVAILABLE',
  });
  assert.equal(unavailable.provider.getIndexStatusForDiagnostics(record.world_id).failure_code,
    'CORE_SNAPSHOT_UNAVAILABLE');
  assert.throws(() => unavailable.provider.getIndexStatusForDiagnostics(' '), /Invalid world_id/);
});

test('failed index rebuild reason survives restart and remains internal-only', async (t) => {
  const s = setup(t);
  s.provider.grantQuery({ world_id: record.world_id, subject_id: record.subject_id, purpose: record.purpose }, true);
  s.provider.putRecord(record);
  s.db.exec(`CREATE TRIGGER fail_rebuild BEFORE INSERT ON memory_index_entries
    BEGIN SELECT RAISE(ABORT, 'injected failure'); END;`);
  await assert.rejects(() => s.provider.rebuildIndex(record.world_id), /injected failure/);
  assert.equal(s.provider.getIndexStatusForDiagnostics(record.world_id).failure_code, 'INDEX_REBUILD_FAILED');
  s.reopen();
  assert.equal(s.provider.getIndexStatusForDiagnostics(record.world_id).failure_code, 'INDEX_REBUILD_FAILED');
  assert.deepEqual(await s.provider.retrieveCandidates({
    world_id: record.world_id, subject_id: record.subject_id, purpose: record.purpose,
  }).catch((error) => ({ error: error.message })), { error: 'MEMORY_INDEX_NOT_READY' });
});

test('provider migrates an existing readiness table to typed failure codes without losing state', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-memory-legacy-state-'));
  const path = join(directory, 'provider.sqlite');
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    CREATE TABLE memory_index_state (
      world_id TEXT PRIMARY KEY, index_health TEXT NOT NULL,
      source_reconciliation TEXT NOT NULL, snapshot_revision TEXT,
      snapshot_sequence TEXT, updated_at TEXT NOT NULL
    );
    INSERT INTO memory_index_state VALUES(
      'world-legacy','ready','current','4','2','2026-01-01T00:00:00.000Z'
    );
  `);
  legacy.close();
  const provider = new SQLiteMemoryProvider({
    path,
    getSnapshot: async () => ({ world_revision: 4, commit_sequence: 2 }),
    validateSourceVersion: async () => true,
    validateInventory: async () => true,
  });
  t.after(() => {
    try { provider.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });

  assert.deepEqual(provider.getIndexStatusForDiagnostics('world-legacy'), {
    index_health: 'ready',
    source_reconciliation: 'current',
    snapshot: { world_revision: '4', commit_sequence: '2' },
    failure_code: null,
  });
});
