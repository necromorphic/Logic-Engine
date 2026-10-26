import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';

test('query authorization revoked during source validation is denied', async (t) => {
  let release;
  let started;
  const validationStarted = new Promise((resolve) => { started = resolve; });
  const validationGate = new Promise((resolve) => { release = resolve; });
  let holdValidation = false;
  const provider = new SQLiteMemoryProvider({
    getSnapshot: async () => ({ world_revision: 1, commit_sequence: 1 }),
    validateSourceVersion: async () => {
      if (holdValidation) {
        started();
        await validationGate;
      }
      return true;
    },
    validateInventory: async () => true,
  });
  t.after(() => provider.close());

  const scope = { world_id: 'race-world', subject_id: 'race-npc', purpose: 'npc_decision' };
  const record = {
    ...scope,
    record_ref: 'race-record',
    record_version: 'v1',
    source_kind: 'canonical_entity',
    source_entity_id: 'entity-race',
    source_version: 'source-v1',
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer_kind: 'test',
    content_disposition: 'usable',
    evidence_assessment: 'unassessed',
    lineage: [{ source_kind: 'canonical_entity', entity_id: 'entity-race', source_version: 'source-v1' }],
  };
  provider.grantQuery(scope, true);
  provider.putRecord(record);
  provider.grantRecord(scope, record.record_ref, record.record_version, true);
  await provider.rebuildIndex(scope.world_id);
  assert.equal((await provider.reconcile(scope.world_id)).status, 'current');
  holdValidation = true;

  const pending = provider.authorizeCandidate({
    ...scope,
    record_ref: record.record_ref,
    record_version: record.record_version,
    source_kind: record.source_kind,
    source_entity_id: record.source_entity_id,
  });
  await validationStarted;
  provider.grantQuery(scope, false);
  release();
  await assert.rejects(pending, /MEMORY_QUERY_DENIED/);
});


test('query authorization revoked during retrieval snapshot lookup is denied', async (t) => {
  let holdSnapshot = false;
  let release;
  let started;
  const snapshotStarted = new Promise((resolve) => { started = resolve; });
  const snapshotGate = new Promise((resolve) => { release = resolve; });
  const provider = new SQLiteMemoryProvider({
    getSnapshot: async () => {
      if (holdSnapshot) {
        started();
        await snapshotGate;
      }
      return { world_revision: 1, commit_sequence: 1 };
    },
    validateSourceVersion: async () => true,
    validateInventory: async () => true,
  });
  t.after(() => provider.close());

  const scope = { world_id: 'retrieve-race-world', subject_id: 'retrieve-race-npc', purpose: 'npc_decision' };
  const record = {
    ...scope,
    record_ref: 'retrieve-race-record',
    record_version: 'v1',
    source_kind: 'canonical_entity',
    source_entity_id: 'retrieve-race-entity',
    source_version: 'source-v1',
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer_kind: 'test',
    content_disposition: 'usable',
    evidence_assessment: 'unassessed',
    lineage: [{ source_kind: 'canonical_entity', entity_id: 'retrieve-race-entity', source_version: 'source-v1' }],
  };
  provider.grantQuery(scope, true);
  provider.putRecord(record);
  provider.grantRecord(scope, record.record_ref, record.record_version, true);
  await provider.rebuildIndex(scope.world_id);
  assert.equal((await provider.reconcile(scope.world_id)).status, 'current');

  holdSnapshot = true;
  const pending = provider.retrieveCandidates(scope);
  await snapshotStarted;
  provider.grantQuery(scope, false);
  release();
  await assert.rejects(pending, /MEMORY_QUERY_DENIED/);
});


test('Provider record ingest during retrieval snapshot lookup invalidates readiness', async (t) => {
  let holdSnapshot = false;
  let release;
  let started;
  const snapshotStarted = new Promise((resolve) => { started = resolve; });
  const snapshotGate = new Promise((resolve) => { release = resolve; });
  const provider = new SQLiteMemoryProvider({
    getSnapshot: async () => {
      if (holdSnapshot) {
        started();
        await snapshotGate;
      }
      return { world_revision: 1, commit_sequence: 1 };
    },
    validateSourceVersion: async () => true,
    validateInventory: async () => true,
  });
  t.after(() => provider.close());

  const scope = { world_id: 'retrieve-ingest-race-world', subject_id: 'retrieve-ingest-race-npc', purpose: 'npc_decision' };
  const record = {
    ...scope,
    record_ref: 'retrieve-ingest-race-record-1',
    record_version: 'v1',
    source_kind: 'canonical_entity',
    source_entity_id: 'retrieve-ingest-race-entity-1',
    source_version: 'source-v1',
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer_kind: 'test',
    content_disposition: 'usable',
    evidence_assessment: 'unassessed',
    lineage: [{ source_kind: 'canonical_entity', entity_id: 'retrieve-ingest-race-entity-1', source_version: 'source-v1' }],
  };
  provider.grantQuery(scope, true);
  provider.putRecord(record);
  provider.grantRecord(scope, record.record_ref, record.record_version, true);
  await provider.rebuildIndex(scope.world_id);
  assert.equal((await provider.reconcile(scope.world_id)).status, 'current');

  holdSnapshot = true;
  const pending = provider.retrieveCandidates(scope);
  await snapshotStarted;

  // This write invalidates the readiness marker while retrieveCandidates is awaiting Core snapshot state.
  provider.putRecord({
    ...record,
    record_ref: 'retrieve-ingest-race-record-2',
    source_entity_id: 'retrieve-ingest-race-entity-2',
    lineage: [{ source_kind: 'canonical_entity', entity_id: 'retrieve-ingest-race-entity-2', source_version: 'source-v1' }],
  });
  release();

  await assert.rejects(pending, /MEMORY_INDEX_NOT_READY/);
  assert.notEqual(provider.getIndexStatusForDiagnostics(scope.world_id).source_reconciliation, 'current');
});


test('record grant revoked during source validation is a non-ready authorization failure', async (t) => {
  let release;
  let started;
  const validationStarted = new Promise((resolve) => { started = resolve; });
  const validationGate = new Promise((resolve) => { release = resolve; });
  const provider = new SQLiteMemoryProvider({
    getSnapshot: async () => ({ world_revision: 1, commit_sequence: 1 }),
    validateSourceVersion: async () => {
      started();
      await validationGate;
      return true;
    },
    validateInventory: async () => true,
  });
  t.after(() => provider.close());

  const scope = { world_id: 'record-race-world', subject_id: 'record-race-npc', purpose: 'npc_decision' };
  const record = {
    ...scope,
    record_ref: 'record-race-record',
    record_version: 'v1',
    source_kind: 'canonical_entity',
    source_entity_id: 'record-race-entity',
    source_version: 'source-v1',
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer_kind: 'test',
    content_disposition: 'usable',
    evidence_assessment: 'unassessed',
    lineage: [{ source_kind: 'canonical_entity', entity_id: 'record-race-entity', source_version: 'source-v1' }],
  };
  provider.grantQuery(scope, true);
  provider.putRecord(record);
  provider.grantRecord(scope, record.record_ref, record.record_version, true);

  const pending = provider.authorizeCandidate({
    ...scope,
    record_ref: record.record_ref,
    record_version: record.record_version,
    source_kind: record.source_kind,
    source_entity_id: record.source_entity_id,
  });
  await validationStarted;
  provider.revokeRecord(scope, record.record_ref, record.record_version);
  release();
  await assert.rejects(pending, /MEMORY_RECORD_ACCESS_REVOKED/);
});


test('candidate authorization fails non-ready if Provider index changes during source validation', async (t) => {
  let release;
  let started;
  const validationStarted = new Promise((resolve) => { started = resolve; });
  const validationGate = new Promise((resolve) => { release = resolve; });
  let holdValidation = false;
  const provider = new SQLiteMemoryProvider({
    getSnapshot: async () => ({ world_revision: 1, commit_sequence: 1 }),
    validateSourceVersion: async () => {
      if (holdValidation) {
        started();
        await validationGate;
      }
      return true;
    },
    validateInventory: async () => true,
  });
  t.after(() => provider.close());

  const scope = { world_id: 'record-state-race-world', subject_id: 'record-state-race-npc', purpose: 'npc_decision' };
  const record = {
    ...scope,
    record_ref: 'record-state-race-record',
    record_version: 'v1',
    source_kind: 'canonical_entity',
    source_entity_id: 'record-state-race-entity',
    source_version: 'source-v1',
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer_kind: 'test',
    content_disposition: 'usable',
    evidence_assessment: 'unassessed',
    lineage: [{ source_kind: 'canonical_entity', entity_id: 'record-state-race-entity', source_version: 'source-v1' }],
  };
  provider.grantQuery(scope, true);
  provider.putRecord(record);
  provider.grantRecord(scope, record.record_ref, record.record_version, true);
  await provider.rebuildIndex(scope.world_id);
  assert.equal((await provider.reconcile(scope.world_id)).status, 'current');
  holdValidation = true;

  const pending = provider.authorizeCandidate({
    ...scope,
    record_ref: record.record_ref,
    record_version: record.record_version,
    source_kind: record.source_kind,
    source_entity_id: record.source_entity_id,
  });
  await validationStarted;
  provider.putRecord({
    ...record,
    record_ref: 'record-state-race-record-2',
    record_version: 'v1',
    source_entity_id: 'record-state-race-entity-2',
    lineage: [{ source_kind: 'canonical_entity', entity_id: 'record-state-race-entity-2', source_version: 'source-v1' }],
  });
  release();
  await assert.rejects(pending, /MEMORY_INDEX_NOT_READY/);
});
