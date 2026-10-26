import test from 'node:test';
import { createProviderTestDb } from './helpers/provider-test-db.js';
import assert from 'node:assert/strict';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';
import { createInternalMemoryImportFacadeForTest } from '../src/application/memory-provider-import-internal.js';

function setup(t) {
  const scope = { world_id: 'world-import-test', subject_id: 'npc-import-test', purpose: 'npc_decision' };
  const testDb = createProviderTestDb(t, { prefix: 'logic-memory-import-internal-' });
  const provider = new SQLiteMemoryProvider({
    path: testDb.path,
    coordinatorPath: `${testDb.path}.coordinator.sqlite`,
    getSnapshot: async () => ({ world_revision: 1, commit_sequence: 1 }),
    validateSourceVersion: async (record) => record.source_version === 'source-v1',
    validateInventory: async () => true,
  });
  t.after(() => provider.close());
  const record = {
    ...scope,
    record_ref: 'memory:import-test',
    record_version: 'record-v1',
    source_kind: 'canonical_entity',
    source_entity_id: 'entity-import-test',
    source_version: 'source-v1',
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer_kind: 'test-import',
    content_disposition: 'usable',
    evidence_assessment: 'unassessed',
    lineage: [{
      source_kind: 'canonical_entity',
      entity_id: 'entity-import-test',
      source_version: 'source-v1',
    }],
  };
  return { provider, record, scope, db: testDb.db };
}

test('internal import facade exposes only one-record import and preserves provider idempotency', (t) => {
  const { provider, record } = setup(t);
  const importer = createInternalMemoryImportFacadeForTest(provider);

  assert.deepEqual(Object.keys(importer), ['importRecord']);
  assert.deepEqual(importer.importRecord(record), {
    status: 'stored',
    record_ref: record.record_ref,
    record_version: record.record_version,
  });
  assert.deepEqual(importer.importRecord(record), {
    status: 'duplicate',
    record_ref: record.record_ref,
    record_version: record.record_version,
  });
});

test('internal import facade does not bypass provider source/lineage validation', (t) => {
  const { provider, record } = setup(t);
  const importer = createInternalMemoryImportFacadeForTest(provider);

  assert.throws(
    () => importer.importRecord({ ...record, content_kind: 'summary' }),
    /Invalid direct-source Memory record/,
  );
});

test('internal import facade refuses an object without the provider import operation', () => {
  assert.throws(
    () => createInternalMemoryImportFacadeForTest({ retrieveCandidates() {} }),
    /requires a provider with putRecord/,
  );
});

test('internal import facade does not grant query or record access', (t) => {
  const { provider, record, scope, db } = setup(t);
  const importer = createInternalMemoryImportFacadeForTest(provider);

  assert.equal(importer.importRecord(record).status, 'stored');
  assert.equal(provider.authorizeQuery(scope), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM memory_record_grants WHERE world_id=?')
    .get(scope.world_id).count, 0);
});

test('rejected import leaves no record behind', (t) => {
  const { provider, record, scope } = setup(t);
  const importer = createInternalMemoryImportFacadeForTest(provider);

  assert.throws(
    () => importer.importRecord({
      ...record,
      lineage: [{ source_kind: 'canonical_entity', entity_id: 'different-entity', source_version: 'source-v1' }],
    }),
    /Invalid direct-source Memory record/,
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM memory_records WHERE world_id=?')
    .get(scope.world_id).count, 0);
});
