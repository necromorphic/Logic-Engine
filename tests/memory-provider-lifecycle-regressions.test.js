import test from 'node:test';
import { createProviderTestDb } from './helpers/provider-test-db.js';
import assert from 'node:assert/strict';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';

function setup(t, options = {}) {
  let snapshot = { world_revision: 10, commit_sequence: 5 };
  let sourceVersion = 'source-v1';
  const provider = new SQLiteMemoryProvider({
    path: testDb.path,
    coordinatorPath: `${testDb.path}.coordinator.sqlite`,
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
  s.provider.grantQuery(s.scope, true);
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

  s.db.prepare('UPDATE memory_records SET lineage_json=? WHERE world_id=? AND record_ref=?')
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
  s.db.prepare('UPDATE memory_records SET lineage_json=? WHERE world_id=? AND record_ref=?')
    .run('[]', s.scope.world_id, s.record.record_ref);
  const missing = await s.provider.reconcile(s.scope.world_id);
  assert.deepEqual(missing, { status: 'stale', reason: 'LINEAGE_INVALID' });
  await assert.rejects(() => s.provider.retrieveCandidates(s.scope), /MEMORY_INDEX_NOT_READY/);
});


test('reconciliation rechecks Provider record inventory after the final awaited snapshot read', async (t) => {
  let provider;
  let snapshotReads = 0;
  let injected = false;
  const scope = { world_id: 'world-final-await', subject_id: 'npc-final-await', purpose: 'npc_decision' };
  const record = (ref, entity) => ({
    ...scope,
    record_ref: ref,
    record_version: 'v1',
    source_kind: 'canonical_entity',
    source_entity_id: entity,
    source_version: 'source-v1',
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer_kind: 'memory-index',
    content_disposition: 'usable',
    evidence_assessment: 'unassessed',
    lineage: [{ source_kind: 'canonical_entity', entity_id: entity, source_version: 'source-v1' }],
  });
  const first = record('memory:first-final', 'entity-first-final');
  const second = record('memory:second-final', 'entity-second-final');
  provider = new SQLiteMemoryProvider({
    getSnapshot: async () => {
      snapshotReads += 1;
      if (snapshotReads === 2 && !injected) {
        injected = true;
        provider.putRecord(second);
        provider.grantRecord(scope, second.record_ref, second.record_version, true);
      }
      return { world_revision: 12, commit_sequence: 6 };
    },
    validateSourceVersion: async (candidate) => candidate.source_version === 'source-v1',
    validateInventory: async () => true,
  });
  t.after(() => provider.close());

  provider.grantQuery(scope, true);
  provider.putRecord(first);
  provider.grantRecord(scope, first.record_ref, first.record_version, true);
  await provider.rebuildIndex(scope.world_id);

  assert.equal((await provider.reconcile(scope.world_id)).status, 'stale',
    'an ingest during the final snapshot await must invalidate the reconciliation pass');
  await assert.rejects(() => provider.retrieveCandidates(scope), /MEMORY_INDEX_NOT_READY/);
  assert.equal((await provider.reconcile(scope.world_id)).status, 'current');
  assert.equal((await provider.retrieveCandidates(scope)).candidates.length, 2);
});


test('older concurrent reconciliation cannot overwrite a newer stale result', async (t) => {
  let validationCalls = 0;
  let signalFirstValidation;
  let releaseFirstValidation;
  const firstValidationStarted = new Promise((resolve) => { signalFirstValidation = resolve; });
  const firstValidationGate = new Promise((resolve) => { releaseFirstValidation = resolve; });
  const provider = new SQLiteMemoryProvider({
    getSnapshot: async () => ({ world_revision: 10, commit_sequence: 5 }),
    validateSourceVersion: async () => {
      validationCalls += 1;
      if (validationCalls === 1) {
        signalFirstValidation();
        await firstValidationGate;
        return true;
      }
      return false;
    },
    validateInventory: async () => true,
  });
  t.after(() => provider.close());

  const scope = { world_id: 'world-concurrent-reconcile', subject_id: 'npc-concurrent-reconcile', purpose: 'npc_decision' };
  const record = {
    ...scope,
    record_ref: 'memory:concurrent-reconcile',
    record_version: 'v1',
    source_kind: 'canonical_entity',
    source_entity_id: 'entity-concurrent-reconcile',
    source_version: 'source-v1',
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer_kind: 'memory-index',
    content_disposition: 'usable',
    evidence_assessment: 'unassessed',
    lineage: [{ source_kind: 'canonical_entity', entity_id: 'entity-concurrent-reconcile', source_version: 'source-v1' }],
  };
  provider.grantQuery(scope, true);
  provider.putRecord(record);
  provider.grantRecord(scope, record.record_ref, record.record_version, true);
  await provider.rebuildIndex(scope.world_id);

  const olderRun = provider.reconcile(scope.world_id);
  await firstValidationStarted;
  const newerRun = await provider.reconcile(scope.world_id);
  assert.deepEqual(newerRun, { status: 'stale', reason: 'SOURCE_VALIDATION_FAILED' });
  assert.notEqual(provider.getIndexStatusForDiagnostics(scope.world_id).source_reconciliation, 'current');

  releaseFirstValidation();
  assert.deepEqual(await olderRun, { status: 'stale', reason: 'RECONCILIATION_SUPERSEDED' });
  assert.notEqual(provider.getIndexStatusForDiagnostics(scope.world_id).source_reconciliation, 'current');
  await assert.rejects(() => provider.retrieveCandidates(scope), /MEMORY_INDEX_NOT_READY/);
});


test('reconciliation refuses current when persisted scope or semantic metadata changes during validation', async (t) => {
  let releaseValidation;
  let startedValidation;
  const started = new Promise((resolve) => { startedValidation = resolve; });
  const blocked = new Promise((resolve) => { releaseValidation = resolve; });
  const s = setup(t, {
    validateSourceVersion: async (record) => {
      startedValidation();
      await blocked;
      return record.source_version === 'source-v1';
    },
  });
  s.provider.grantQuery(s.scope, true);
  s.provider.putRecord(s.record);
  await s.provider.rebuildIndex(s.scope.world_id);

  const reconciliation = s.provider.reconcile(s.scope.world_id);
  await started;
  // Simulate an out-of-band/corrupt mutation while the trusted validator is awaited.
  s.db.prepare(`UPDATE memory_records SET content_disposition='withheld'
    WHERE world_id=? AND record_ref=? AND record_version=?`)
    .run(s.scope.world_id, s.record.record_ref, s.record.record_version);
  releaseValidation();

  const result = await reconciliation;
  assert.equal(result.status, 'stale');
  assert.notEqual(s.provider.getIndexStatusForDiagnostics(s.scope.world_id).source_reconciliation, 'current');
  await assert.rejects(() => s.provider.retrieveCandidates(s.scope), /MEMORY_INDEX_NOT_READY/);
});
