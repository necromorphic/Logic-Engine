import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';

function setup(t, options = {}) {
  let snapshot = { world_revision: 10, commit_sequence: 5 };
  let sourceVersion = 'source-v1';
  const provider = new SQLiteMemoryProvider({
    getSnapshot: async () => ({ ...snapshot }),
    validateSourceVersion: async (record) => record.source_version === sourceVersion,
    validateInventory: async () => true,
    ...options,
  });
  t.after(() => provider.close());
  const scope = { world_id: 'world-a', subject_id: 'npc-a', purpose: 'npc_decision' };
  const record = {
    ...scope,
    record_ref: 'memory:record-a',
    record_version: 'record-v1',
    source_kind: 'canonical_entity',
    source_entity_id: 'entity-source-a',
    source_version: 'source-v1',
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer_kind: 'memory-index',
    content_disposition: 'usable',
    evidence_assessment: 'unassessed',
    lineage: [{ source_kind: 'canonical_entity', entity_id: 'entity-source-a', source_version: 'source-v1' }],
  };
  return {
    provider, scope, record,
    setSnapshot(value) { snapshot = value; },
    setSourceVersion(value) { sourceVersion = value; },
  };
}

test('known dependent raw copies are invalidated on exact source tombstone and alternate versions remain selectable', async (t) => {
  const s = setup(t);
  const base = { world_id: 'world-a', conversation_id: 'chat-a', message_id: 'message-a' };
  s.provider.captureRawMessage({ ...base, version_id: 'v1', role: 'assistant', content: 'first version' });
  s.provider.captureRawMessage({ ...base, version_id: 'v2', role: 'assistant', content: 'second version' });
  s.provider.selectActiveRawVersion({ ...base, version_id: 'v1' });
  s.provider.registerRawDerivedCopy({
    ...base, source_version_id: 'v1', copy_ref: 'episode-a', copy_version: '1',
    copy_kind: 'episode', content: 'derived from first version',
  });

  const deletion = s.provider.markRawSourceDeleted({ ...base, version_id: 'v1' });
  assert.deepEqual(deletion, { status: 'deleted', invalidated_copies: 1 });
  assert.equal(s.provider.db.prepare(
    'SELECT status FROM memory_raw_derived_copies WHERE world_id=? AND copy_ref=?',
  ).get('world-a', 'episode-a').status, 'invalidated');
  assert.equal(s.provider.db.prepare(
    'SELECT COUNT(*) AS count FROM memory_raw_active_versions WHERE world_id=? AND message_id=?',
  ).get('world-a', 'message-a').count, 0);

  assert.deepEqual(s.provider.selectActiveRawVersion({ ...base, version_id: 'v2' }),
    { status: 'active', version_id: 'v2' });
  assert.equal(s.provider.db.prepare(
    'SELECT version_id FROM memory_raw_active_versions WHERE world_id=? AND message_id=?',
  ).get('world-a', 'message-a').version_id, 'v2');
  assert.throws(() => s.provider.selectActiveRawVersion({ ...base, version_id: 'v1' }),
    /MEMORY_RAW_VERSION_UNAVAILABLE/);
});

test('reconciliation refuses to publish current if the provider record set changes while validation awaits', async (t) => {
  let releaseValidation;
  let startedValidation;
  const started = new Promise((resolve) => { startedValidation = resolve; });
  const blocked = new Promise((resolve) => { releaseValidation = resolve; });
  const s = setup(t, {
    validateSourceVersion: async (record) => {
      if (record.record_ref === 'memory:record-a') {
        startedValidation();
        await blocked;
      }
      return record.source_version === 'source-v1';
    },
  });
  s.provider.putRecord(s.record);
  await s.provider.rebuildIndex(s.scope.world_id);

  const reconciliation = s.provider.reconcile(s.scope.world_id);
  await started;
  s.provider.putRecord({
    ...s.record,
    record_ref: 'memory:record-b',
    record_version: 'record-v1',
  });
  releaseValidation();

  const result = await reconciliation;
  assert.equal(result.status, 'stale');
  assert.notEqual(s.provider.getIndexStatusForDiagnostics(s.scope.world_id).source_reconciliation, 'current');
  await assert.rejects(() => s.provider.retrieveCandidates(s.scope), /MEMORY_INDEX_NOT_READY/);
});

test('rollback is stale even when commit_sequence does not increase', async (t) => {
  const s = setup(t);
  s.provider.grantQuery(s.scope, true);
  s.provider.putRecord(s.record);
  s.provider.grantRecord(s.scope, s.record.record_ref, s.record.record_version, true);
  await s.provider.rebuildIndex(s.scope.world_id);
  assert.equal((await s.provider.reconcile(s.scope.world_id)).status, 'current');

  // Simulate rollback to an earlier world revision while commit_sequence stays equal.
  s.setSnapshot({ world_revision: 4, commit_sequence: 5 });
  await assert.rejects(() => s.provider.retrieveCandidates(s.scope), /MEMORY_SNAPSHOT_STALE/);
  assert.notEqual(s.provider.getIndexStatusForDiagnostics(s.scope.world_id).source_reconciliation, 'current');
});

test('corrupted or missing persisted direct-source lineage fails closed at authorization and reconciliation', async (t) => {
  const s = setup(t);
  s.provider.grantQuery(s.scope, true);
  s.provider.putRecord(s.record);
  s.provider.grantRecord(s.scope, s.record.record_ref, s.record.record_version, true);
  await s.provider.rebuildIndex(s.scope.world_id);
  assert.equal((await s.provider.reconcile(s.scope.world_id)).status, 'current');

  s.provider.db.prepare('UPDATE memory_records SET lineage_json=? WHERE world_id=? AND record_ref=?')
    .run('{broken-json', s.scope.world_id, s.record.record_ref);
  await assert.rejects(() => s.provider.authorizeCandidate({
    ...s.scope,
    record_ref: s.record.record_ref,
    record_version: s.record.record_version,
    source_kind: 'canonical_entity',
    source_entity_id: s.record.source_entity_id,
  }), /MEMORY_LINEAGE_INVALID/);
  const corrupt = await s.provider.reconcile(s.scope.world_id);
  assert.deepEqual(corrupt, { status: 'stale', reason: 'LINEAGE_INVALID' });
  await assert.rejects(() => s.provider.retrieveCandidates(s.scope), /MEMORY_INDEX_NOT_READY/);

  // Restore syntactically valid JSON but remove required ancestry: it is still invalid.
  s.provider.db.prepare('UPDATE memory_records SET lineage_json=? WHERE world_id=? AND record_ref=?')
    .run('[]', s.scope.world_id, s.record.record_ref);
  const missing = await s.provider.reconcile(s.scope.world_id);
  assert.deepEqual(missing, { status: 'stale', reason: 'LINEAGE_INVALID' });
  await assert.rejects(() => s.provider.retrieveCandidates(s.scope), /MEMORY_INDEX_NOT_READY/);
});
