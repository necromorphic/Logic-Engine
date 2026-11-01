import test from 'node:test';
import { createProviderTestDb } from './helpers/provider-test-db.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';

const providerTestDbs = new WeakMap();
const testDbFor = (provider) => providerTestDbs.get(provider).db;

function setup(t, overrides = {}) {
  const testDb = createProviderTestDb(t, { prefix: 'logic-memory-source-separation-' });
  const provider = new SQLiteMemoryProvider({
    path: testDb.path,
    coordinatorPath: `${testDb.path}.coordinator.sqlite`,
    getSnapshot: async () => ({ world_revision: 7, commit_sequence: 3 }),
    validateSourceVersion: async () => true,
    validateInventory: async () => true,
    ...overrides,
  });
  t.after(() => { provider.close(); testDb.close(); testDb.cleanup(); });
  providerTestDbs.set(provider, testDb);
  return provider;
}

const scope = { world_id: 'world-a', subject_id: 'npc-a', purpose: 'npc_decision' };
const sourceRecord = (overrides = {}) => ({
  ...scope,
  record_ref: 'memory:fact-1',
  record_version: 'v1',
  source_kind: 'canonical_entity',
  source_entity_id: 'entity-a',
  source_version: 'source-v1',
  content_kind: 'claim',
  epistemic_kind: 'acquired_report',
  producer_kind: 'provider-test',
  content_disposition: 'usable',
  evidence_assessment: 'unassessed',
  lineage: [{ source_kind: 'canonical_entity', entity_id: 'entity-a', source_version: 'source-v1' }],
  ...overrides,
});

test('source archive rows stay separate from fact records and rebuildable search index', async (t) => {
  const provider = setup(t);
  const sceneText = 'Original scene: two people stood by the doorway; the glass was broken.';
  testDbFor(provider).prepare(`INSERT INTO memory_raw_captures
    (world_id,conversation_id,message_id,version_id,role,content_text,content_sha256,
     metadata_json,captured_at,deleted_at)
    VALUES(?,?,?,?,?,?,?,?,?,NULL)`).run(
      'world-a', 'chat-a', 'message-a', 'version-a', 'assistant', sceneText,
      createHash('sha256').update(sceneText, 'utf8').digest('hex'),
      JSON.stringify({ fixture: 'legacy-row-only' }), new Date().toISOString(),
    );

  provider.grantQuery(scope, true);
  provider.grantRecord(scope, 'memory:fact-1', 'v1', true);
  provider.putRecord(sourceRecord());
  await provider.rebuildIndex('world-a');
  assert.equal((await provider.reconcile('world-a')).status, 'current');

  assert.equal(testDbFor(provider).prepare('SELECT COUNT(*) AS n FROM memory_raw_captures').get().n, 1);
  assert.equal(testDbFor(provider).prepare('SELECT COUNT(*) AS n FROM memory_records').get().n, 1);
  assert.equal(testDbFor(provider).prepare('SELECT COUNT(*) AS n FROM memory_index_entries').get().n, 1);
  assert.deepEqual(
    testDbFor(provider).prepare('SELECT record_ref,record_version FROM memory_index_entries')
      .all().map((row) => ({ ...row })),
    [{ record_ref: 'memory:fact-1', record_version: 'v1' }],
  );

  const result = await provider.retrieveCandidates(scope);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].record.ref, 'memory:fact-1');
  assert.equal(JSON.stringify(result).includes(sceneText), false);
});

test('Provider record/version identity is immutable in the file-backed database', (t) => {
  const provider = setup(t);
  const db = testDbFor(provider);
  const record = sourceRecord();
  assert.equal(provider.putRecord(record).status, 'stored');

  assert.throws(
    () => db.prepare(`UPDATE memory_records SET source_version=? WHERE world_id=? AND record_ref=? AND record_version=?`)
      .run('source-v2', scope.world_id, record.record_ref, record.record_version),
    /MEMORY_RECORD_IMMUTABLE/,
  );
  assert.throws(
    () => provider.putRecord(sourceRecord({ source_version: 'source-v2', lineage: [
      { source_kind: 'canonical_entity', entity_id: 'entity-a', source_version: 'source-v2' },
    ] })),
    /MEMORY_IDENTITY_CONFLICT/,
  );

  const persisted = db.prepare(`SELECT source_version,lineage_json FROM memory_records
    WHERE world_id=? AND record_ref=? AND record_version=?`)
    .get(scope.world_id, record.record_ref, record.record_version);
  assert.equal(persisted.source_version, 'source-v1');
  assert.deepEqual(JSON.parse(persisted.lineage_json), record.lineage);
});

test('Host message-version tuples are rejected as semantic Provider records', (t) => {
  const provider = setup(t);
  const hostTuple = {
    ...scope,
    record_ref: 'host:conversation-a:message-a:version-a',
    record_version: 'version-a',
    source_kind: 'host_message_version',
    source_entity_id: 'message-a',
    source_version: 'version-a',
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer_kind: 'host',
    content_disposition: 'usable',
    evidence_assessment: 'unassessed',
    lineage: [{
      source_kind: 'host_message_version',
      entity_id: 'message-a',
      source_version: 'version-a',
    }],
  };
  assert.throws(() => provider.putRecord(hostTuple), /Invalid direct-source Memory record/);
  assert.equal(testDbFor(provider).prepare('SELECT COUNT(*) AS n FROM memory_records').get().n, 0);
  assert.equal(testDbFor(provider).prepare('SELECT COUNT(*) AS n FROM memory_index_entries').get().n, 0);
});

test('Provider accepts only exact single canonical-entity lineage', (t) => {
  const provider = setup(t);
  const invalidRecords = [
    sourceRecord({ lineage: [
      { source_kind: 'canonical_entity', entity_id: 'entity-a', source_version: 'source-v1' },
      { source_kind: 'canonical_entity', entity_id: 'entity-b', source_version: 'source-v2' },
    ] }),
    sourceRecord({ lineage: [
      { source_kind: 'canonical_entity', entity_id: 'different-entity', source_version: 'source-v1' },
    ] }),
    sourceRecord({ lineage: [
      { source_kind: 'canonical_entity', entity_id: 'entity-a', source_version: 'different-version' },
    ] }),
    sourceRecord({ source_kind: 'derived_summary', lineage: [
      { source_kind: 'derived_summary', entity_id: 'entity-a', source_version: 'source-v1' },
    ] }),
  ];

  for (const record of invalidRecords) {
    assert.throws(() => provider.putRecord(record), /Invalid direct-source Memory record/);
  }
  assert.equal(testDbFor(provider).prepare('SELECT COUNT(*) AS n FROM memory_records').get().n, 0);
  assert.equal(testDbFor(provider).prepare('SELECT COUNT(*) AS n FROM memory_index_entries').get().n, 0);
});

test('summary records remain rejected until a lineage-complete summary contract is approved', (t) => {
  const provider = setup(t);
  assert.throws(
    () => provider.putRecord(sourceRecord({ record_ref: 'memory:summary-1', content_kind: 'summary' })),
    /Invalid direct-source Memory record/,
  );
});
