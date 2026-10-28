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

test('summary records remain rejected until a lineage-complete summary contract is approved', (t) => {
  const provider = setup(t);
  assert.throws(
    () => provider.putRecord(sourceRecord({ record_ref: 'memory:summary-1', content_kind: 'summary' })),
    /Invalid direct-source Memory record/,
  );
});
