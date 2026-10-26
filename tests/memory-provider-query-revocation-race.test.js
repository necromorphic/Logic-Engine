import test from 'node:test';
import { createProviderTestDb } from './helpers/provider-test-db.js';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  t.after(() => { provider.close(); testDb.close(); testDb.cleanup(); });

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


test('candidate authorization fails closed when a grant is revoked and re-granted during validation', async (t) => {
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

  const scope = { world_id: 'grant-cycle-world', subject_id: 'grant-cycle-npc', purpose: 'npc_decision' };
  const record = {
    ...scope,
    record_ref: 'grant-cycle-record',
    record_version: 'v1',
    source_kind: 'canonical_entity',
    source_entity_id: 'grant-cycle-entity',
    source_version: 'source-v1',
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer_kind: 'test',
    content_disposition: 'usable',
    evidence_assessment: 'unassessed',
    lineage: [{ source_kind: 'canonical_entity', entity_id: 'grant-cycle-entity', source_version: 'source-v1' }],
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
  provider.revokeRecord(scope, record.record_ref, record.record_version);
  provider.grantRecord(scope, record.record_ref, record.record_version, true);
  release();
  await assert.rejects(pending, /MEMORY_AUTHORIZATION_CHANGED/);
});


test('retrieval fails closed when query permission is revoked and re-granted during snapshot lookup', async (t) => {
  let releaseSnapshot;
  let signalSnapshot;
  const snapshotStarted = new Promise((resolve) => { signalSnapshot = resolve; });
  const snapshotGate = new Promise((resolve) => { releaseSnapshot = resolve; });
  let holdSnapshot = false;
  const scope = { world_id: 'query-grant-cycle-world', subject_id: 'query-grant-cycle-npc', purpose: 'npc_decision' };
  const record = {
    ...scope,
    record_ref: 'query-grant-cycle-record',
    record_version: 'v1',
    source_kind: 'canonical_entity',
    source_entity_id: 'query-grant-cycle-entity',
    source_version: 'source-v1',
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer_kind: 'test',
    content_disposition: 'usable',
    evidence_assessment: 'unassessed',
    lineage: [{ source_kind: 'canonical_entity', entity_id: 'query-grant-cycle-entity', source_version: 'source-v1' }],
  };
  const provider = new SQLiteMemoryProvider({
    getSnapshot: async () => {
      if (holdSnapshot) {
        signalSnapshot();
        await snapshotGate;
      }
      return { world_revision: 1, commit_sequence: 1 };
    },
    validateSourceVersion: async () => true,
    validateInventory: async () => true,
  });
  t.after(() => provider.close());

  provider.grantQuery(scope, true);
  provider.putRecord(record);
  provider.grantRecord(scope, record.record_ref, record.record_version, true);
  await provider.rebuildIndex(scope.world_id);
  assert.equal((await provider.reconcile(scope.world_id)).status, 'current');

  holdSnapshot = true;
  const pending = provider.retrieveCandidates(scope);
  await snapshotStarted;
  provider.grantQuery(scope, false);
  provider.grantQuery(scope, true);
  releaseSnapshot();

  await assert.rejects(pending, /MEMORY_AUTHORIZATION_CHANGED/);
});


test('retrieval fails closed when a record grant is revoked and re-granted during snapshot lookup', async (t) => {
  let releaseSnapshot;
  let signalSnapshot;
  const snapshotStarted = new Promise((resolve) => { signalSnapshot = resolve; });
  const snapshotGate = new Promise((resolve) => { releaseSnapshot = resolve; });
  let holdSnapshot = false;
  const scope = { world_id: 'record-grant-cycle-retrieve-world', subject_id: 'record-grant-cycle-npc', purpose: 'npc_decision' };
  const record = {
    ...scope,
    record_ref: 'record-grant-cycle-retrieve-record',
    record_version: 'v1',
    source_kind: 'canonical_entity',
    source_entity_id: 'record-grant-cycle-retrieve-entity',
    source_version: 'source-v1',
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer_kind: 'test',
    content_disposition: 'usable',
    evidence_assessment: 'unassessed',
    lineage: [{
      source_kind: 'canonical_entity',
      entity_id: 'record-grant-cycle-retrieve-entity',
      source_version: 'source-v1',
    }],
  };
  const provider = new SQLiteMemoryProvider({
    getSnapshot: async () => {
      if (holdSnapshot) {
        signalSnapshot();
        await snapshotGate;
      }
      return { world_revision: 1, commit_sequence: 1 };
    },
    validateSourceVersion: async () => true,
    validateInventory: async () => true,
  });
  t.after(() => provider.close());

  provider.grantQuery(scope, true);
  provider.putRecord(record);
  provider.grantRecord(scope, record.record_ref, record.record_version, true);
  await provider.rebuildIndex(scope.world_id);
  assert.equal((await provider.reconcile(scope.world_id)).status, 'current');

  holdSnapshot = true;
  const pending = provider.retrieveCandidates(scope);
  await snapshotStarted;
  provider.revokeRecord(scope, record.record_ref, record.record_version);
  provider.grantRecord(scope, record.record_ref, record.record_version, true);
  releaseSnapshot();

  await assert.rejects(pending, /MEMORY_AUTHORIZATION_CHANGED/);
});


test('reconciliation cannot publish current after a concurrent index rebuild changes Provider state', async (t) => {
  let holdValidation = false;
  let releaseValidation;
  let signalValidation;
  const validationStarted = new Promise((resolve) => { signalValidation = resolve; });
  const validationGate = new Promise((resolve) => { releaseValidation = resolve; });
  const provider = new SQLiteMemoryProvider({
    getSnapshot: async () => ({ world_revision: 1, commit_sequence: 1 }),
    validateSourceVersion: async () => {
      if (holdValidation) {
        signalValidation();
        await validationGate;
      }
      return true;
    },
    validateInventory: async () => true,
  });
  t.after(() => provider.close());

  const scope = { world_id: 'reconcile-provider-state-race-world', subject_id: 'reconcile-provider-state-race-npc', purpose: 'npc_decision' };
  const record = {
    ...scope,
    record_ref: 'reconcile-provider-state-race-record',
    record_version: 'v1',
    source_kind: 'canonical_entity',
    source_entity_id: 'reconcile-provider-state-race-entity',
    source_version: 'source-v1',
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer_kind: 'test',
    content_disposition: 'usable',
    evidence_assessment: 'unassessed',
    lineage: [{
      source_kind: 'canonical_entity',
      entity_id: 'reconcile-provider-state-race-entity',
      source_version: 'source-v1',
    }],
  };
  provider.grantQuery(scope, true);
  provider.grantRecord(scope, record.record_ref, record.record_version, true);
  provider.putRecord(record);
  await provider.rebuildIndex(scope.world_id);
  assert.equal((await provider.reconcile(scope.world_id)).status, 'current');

  holdValidation = true;
  const pending = provider.reconcile(scope.world_id);
  await validationStarted;
  await provider.rebuildIndex(scope.world_id);
  releaseValidation();

  assert.deepEqual(await pending, {
    status: 'stale',
    reason: 'PROVIDER_STATE_CHANGED',
  });
  assert.notEqual(provider.getIndexStatusForDiagnostics(scope.world_id).source_reconciliation, 'current');
});


test('reconciliation refuses current when index inventory changes outside its Provider instance', async (t) => {
  const testDb = createProviderTestDb(t, { prefix: 'logic-memory-index-inventory-race-' });
  let holdValidation = false;
  let releaseValidation;
  let signalValidation;
  const validationStarted = new Promise((resolve) => { signalValidation = resolve; });
  const validationGate = new Promise((resolve) => { releaseValidation = resolve; });
  const provider = new SQLiteMemoryProvider({
    path: testDb.path,
    coordinatorPath: `${testDb.path}.coordinator.sqlite`,
    getSnapshot: async () => ({ world_revision: 1, commit_sequence: 1 }),
    validateSourceVersion: async () => {
      if (holdValidation) {
        signalValidation();
        await validationGate;
      }
      return true;
    },
    validateInventory: async () => true,
  });
  t.after(() => provider.close());

  const scope = { world_id: 'reconcile-index-inventory-race-world', subject_id: 'reconcile-index-inventory-race-npc', purpose: 'npc_decision' };
  const record = {
    ...scope,
    record_ref: 'reconcile-index-inventory-race-record',
    record_version: 'v1',
    source_kind: 'canonical_entity',
    source_entity_id: 'reconcile-index-inventory-race-entity',
    source_version: 'source-v1',
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer_kind: 'test',
    content_disposition: 'usable',
    evidence_assessment: 'unassessed',
    lineage: [{
      source_kind: 'canonical_entity',
      entity_id: 'reconcile-index-inventory-race-entity',
      source_version: 'source-v1',
    }],
  };
  provider.grantQuery(scope, true);
  provider.grantRecord(scope, record.record_ref, record.record_version, true);
  provider.putRecord(record);
  await provider.rebuildIndex(scope.world_id);
  assert.equal((await provider.reconcile(scope.world_id)).status, 'current');

  holdValidation = true;
  const pending = provider.reconcile(scope.world_id);
  await validationStarted;
  // Simulate an out-of-band durable index mutation that bypasses Provider
  // methods and therefore does not advance this instance's in-memory generation.
  testDb.db.prepare('DELETE FROM memory_index_entries WHERE world_id=? AND record_ref=?')
    .run(scope.world_id, record.record_ref);
  releaseValidation();

  assert.deepEqual(await pending, {
    status: 'stale',
    reason: 'INDEX_INVENTORY_MISMATCH',
  });
  assert.notEqual(provider.getIndexStatusForDiagnostics(scope.world_id).source_reconciliation, 'current');
});


test('failed index rebuild rolls back index deletion instead of leaving a partial index', async (t) => {
  const testDb = createProviderTestDb(t, { prefix: 'logic-memory-index-rebuild-failure-' });
  const provider = new SQLiteMemoryProvider({
    path: testDb.path,
    coordinatorPath: `${testDb.path}.coordinator.sqlite`,
    getSnapshot: async () => ({ world_revision: 1, commit_sequence: 1 }),
    validateSourceVersion: async () => true,
    validateInventory: async () => true,
  });
  t.after(() => provider.close());

  const scope = { world_id: 'atomic-index-rebuild-world', subject_id: 'atomic-index-rebuild-npc', purpose: 'npc_decision' };
  const record = {
    ...scope,
    record_ref: 'atomic-index-rebuild-record',
    record_version: 'v1',
    source_kind: 'canonical_entity',
    source_entity_id: 'atomic-index-rebuild-entity',
    source_version: 'source-v1',
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer_kind: 'test',
    content_disposition: 'usable',
    evidence_assessment: 'unassessed',
    lineage: [{
      source_kind: 'canonical_entity',
      entity_id: 'atomic-index-rebuild-entity',
      source_version: 'source-v1',
    }],
  };
  provider.putRecord(record);
  assert.equal(testDb.db.prepare('SELECT COUNT(*) AS count FROM memory_index_entries WHERE world_id=?')
    .get(scope.world_id).count, 1);

  testDb.db.exec(`CREATE TRIGGER fail_index_rebuild BEFORE INSERT ON memory_index_entries
    BEGIN SELECT RAISE(ABORT, 'injected index write failure'); END;`);
  await assert.rejects(() => provider.rebuildIndex(scope.world_id), /injected index write failure/);

  assert.equal(testDb.db.prepare('SELECT COUNT(*) AS count FROM memory_index_entries WHERE world_id=?')
    .get(scope.world_id).count, 1, 'the pre-existing index entry must survive transaction rollback');
  assert.equal(provider.getIndexStatusForDiagnostics(scope.world_id).index_health, 'unavailable');
  assert.equal(provider.getIndexStatusForDiagnostics(scope.world_id).source_reconciliation, 'stale');
});


test('retrieval fails closed when another Provider connection revokes and re-grants query access', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-provider-cross-connection-'));
  const path = join(dir, 'provider.sqlite');
  let releaseSnapshot;
  let signalSnapshot;
  const snapshotStarted = new Promise((resolve) => { signalSnapshot = resolve; });
  const snapshotGate = new Promise((resolve) => { releaseSnapshot = resolve; });
  let holdSnapshot = false;
  const options = {
    path,
    getSnapshot: async () => {
      if (holdSnapshot) {
        signalSnapshot();
        await snapshotGate;
      }
      return { world_revision: 1, commit_sequence: 1 };
    },
    validateSourceVersion: async () => true,
    validateInventory: async () => true,
  };
  const provider = new SQLiteMemoryProvider(options);
  const otherProvider = new SQLiteMemoryProvider({
    ...options,
    getSnapshot: async () => ({ world_revision: 1, commit_sequence: 1 }),
  });
  t.after(() => provider.close());
  t.after(() => otherProvider.close());
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const scope = { world_id: 'cross-connection-query-world', subject_id: 'cross-connection-query-npc', purpose: 'npc_decision' };
  const record = {
    ...scope,
    record_ref: 'cross-connection-query-record',
    record_version: 'v1',
    source_kind: 'canonical_entity',
    source_entity_id: 'cross-connection-query-entity',
    source_version: 'source-v1',
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer_kind: 'test',
    content_disposition: 'usable',
    evidence_assessment: 'unassessed',
    lineage: [{
      source_kind: 'canonical_entity',
      entity_id: 'cross-connection-query-entity',
      source_version: 'source-v1',
    }],
  };
  provider.grantQuery(scope, true);
  provider.grantRecord(scope, record.record_ref, record.record_version, true);
  provider.putRecord(record);
  await provider.rebuildIndex(scope.world_id);
  assert.equal((await provider.reconcile(scope.world_id)).status, 'current');

  holdSnapshot = true;
  const pending = provider.retrieveCandidates(scope);
  await snapshotStarted;
  otherProvider.grantQuery(scope, false);
  otherProvider.grantQuery(scope, true);
  releaseSnapshot();

  await assert.rejects(pending, /MEMORY_AUTHORIZATION_CHANGED|MEMORY_INDEX_NOT_READY/);
});


test('candidate authorization detects record grant ABA from another Provider connection', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-provider-cross-record-grant-'));
  const path = join(dir, 'provider.sqlite');
  let releaseValidation;
  let signalValidation;
  const validationStarted = new Promise((resolve) => { signalValidation = resolve; });
  const validationGate = new Promise((resolve) => { releaseValidation = resolve; });
  let holdValidation = false;
  const options = {
    path,
    getSnapshot: async () => ({ world_revision: 1, commit_sequence: 1 }),
    validateSourceVersion: async () => {
      if (holdValidation) {
        signalValidation();
        await validationGate;
      }
      return true;
    },
    validateInventory: async () => true,
  };
  const provider = new SQLiteMemoryProvider(options);
  const otherProvider = new SQLiteMemoryProvider(options);
  t.after(() => provider.close());
  t.after(() => otherProvider.close());
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const scope = { world_id: 'cross-connection-record-world', subject_id: 'cross-connection-record-npc', purpose: 'npc_decision' };
  const record = {
    ...scope,
    record_ref: 'cross-connection-record-grant-record',
    record_version: 'v1',
    source_kind: 'canonical_entity',
    source_entity_id: 'cross-connection-record-grant-entity',
    source_version: 'source-v1',
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer_kind: 'test',
    content_disposition: 'usable',
    evidence_assessment: 'unassessed',
    lineage: [{
      source_kind: 'canonical_entity',
      entity_id: 'cross-connection-record-grant-entity',
      source_version: 'source-v1',
    }],
  };
  provider.grantQuery(scope, true);
  provider.grantRecord(scope, record.record_ref, record.record_version, true);
  provider.putRecord(record);
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
  otherProvider.revokeRecord(scope, record.record_ref, record.record_version);
  otherProvider.grantRecord(scope, record.record_ref, record.record_version, true);
  releaseValidation();

  await assert.rejects(pending, /MEMORY_AUTHORIZATION_CHANGED/);
});


test('candidate authorization detects query grant ABA from another Provider connection', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-provider-cross-query-grant-'));
  const path = join(dir, 'provider.sqlite');
  let releaseValidation;
  let signalValidation;
  const validationStarted = new Promise((resolve) => { signalValidation = resolve; });
  const validationGate = new Promise((resolve) => { releaseValidation = resolve; });
  let holdValidation = false;
  const options = {
    path,
    getSnapshot: async () => ({ world_revision: 1, commit_sequence: 1 }),
    validateSourceVersion: async () => {
      if (holdValidation) {
        signalValidation();
        await validationGate;
      }
      return true;
    },
    validateInventory: async () => true,
  };
  const provider = new SQLiteMemoryProvider(options);
  const otherProvider = new SQLiteMemoryProvider(options);
  t.after(() => provider.close());
  t.after(() => otherProvider.close());
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const scope = { world_id: 'cross-connection-query-world', subject_id: 'cross-connection-query-npc', purpose: 'npc_decision' };
  const record = {
    ...scope,
    record_ref: 'cross-connection-query-grant-record',
    record_version: 'v1',
    source_kind: 'canonical_entity',
    source_entity_id: 'cross-connection-query-grant-entity',
    source_version: 'source-v1',
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer_kind: 'test',
    content_disposition: 'usable',
    evidence_assessment: 'unassessed',
    lineage: [{
      source_kind: 'canonical_entity',
      entity_id: 'cross-connection-query-grant-entity',
      source_version: 'source-v1',
    }],
  };
  provider.grantQuery(scope, true);
  provider.grantRecord(scope, record.record_ref, record.record_version, true);
  provider.putRecord(record);
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
  otherProvider.grantQuery(scope, false);
  otherProvider.grantQuery(scope, true);
  releaseValidation();

  await assert.rejects(pending, /MEMORY_AUTHORIZATION_CHANGED|MEMORY_QUERY_DENIED/);
});

test('retrieval fails closed when another Provider connection revokes and re-grants record access', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-provider-cross-record-retrieval-'));
  const path = join(dir, 'provider.sqlite');
  let provider;
  let otherProvider;
  t.after(() => {
    try { provider?.close(); } catch {}
    try { otherProvider?.close(); } catch {}
    rmSync(dir, { recursive: true, force: true });
  });

  let releaseSnapshot;
  let signalSnapshot;
  const snapshotStarted = new Promise((resolve) => { signalSnapshot = resolve; });
  const snapshotGate = new Promise((resolve) => { releaseSnapshot = resolve; });
  let holdSnapshot = false;
  const options = {
    path,
    getSnapshot: async () => {
      if (holdSnapshot) {
        signalSnapshot();
        await snapshotGate;
      }
      return { world_revision: 1, commit_sequence: 1 };
    },
    validateSourceVersion: async () => true,
    validateInventory: async () => true,
  };
  provider = new SQLiteMemoryProvider(options);
  otherProvider = new SQLiteMemoryProvider(options);

  const scope = { world_id: 'cross-connection-record-retrieval-world', subject_id: 'cross-connection-record-retrieval-npc', purpose: 'npc_decision' };
  const record = {
    ...scope,
    record_ref: 'cross-connection-record-retrieval-record',
    record_version: 'v1',
    source_kind: 'canonical_entity',
    source_entity_id: 'cross-connection-record-retrieval-entity',
    source_version: 'source-v1',
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer_kind: 'test',
    content_disposition: 'usable',
    evidence_assessment: 'unassessed',
    lineage: [{
      source_kind: 'canonical_entity',
      entity_id: 'cross-connection-record-retrieval-entity',
      source_version: 'source-v1',
    }],
  };
  provider.grantQuery(scope, true);
  provider.grantRecord(scope, record.record_ref, record.record_version, true);
  provider.putRecord(record);
  await provider.rebuildIndex(scope.world_id);
  assert.equal((await provider.reconcile(scope.world_id)).status, 'current');

  holdSnapshot = true;
  const pending = provider.retrieveCandidates(scope);
  await snapshotStarted;
  otherProvider.revokeRecord(scope, record.record_ref, record.record_version);
  otherProvider.grantRecord(scope, record.record_ref, record.record_version, true);
  releaseSnapshot();

  await assert.rejects(pending, /MEMORY_INDEX_NOT_READY|MEMORY_AUTHORIZATION_CHANGED/);
});

test('retrieval fails closed when another Provider connection starts a record ingest during snapshot lookup', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-provider-cross-ingest-retrieval-'));
  const path = join(dir, 'provider.sqlite');
  let provider;
  let otherProvider;
  t.after(() => {
    try { provider?.close(); } catch {}
    try { otherProvider?.close(); } catch {}
    rmSync(dir, { recursive: true, force: true });
  });

  let releaseSnapshot;
  let signalSnapshot;
  const snapshotStarted = new Promise((resolve) => { signalSnapshot = resolve; });
  const snapshotGate = new Promise((resolve) => { releaseSnapshot = resolve; });
  let holdSnapshot = false;
  const options = {
    path,
    getSnapshot: async () => {
      if (holdSnapshot) {
        signalSnapshot();
        await snapshotGate;
      }
      return { world_revision: 1, commit_sequence: 1 };
    },
    validateSourceVersion: async () => true,
    validateInventory: async () => true,
  };
  provider = new SQLiteMemoryProvider(options);
  otherProvider = new SQLiteMemoryProvider(options);

  const scope = { world_id: 'cross-connection-ingest-world', subject_id: 'cross-connection-ingest-npc', purpose: 'npc_decision' };
  const record = {
    ...scope,
    record_ref: 'cross-connection-ingest-initial-record',
    record_version: 'v1',
    source_kind: 'canonical_entity',
    source_entity_id: 'cross-connection-ingest-initial-entity',
    source_version: 'source-v1',
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer_kind: 'test',
    content_disposition: 'usable',
    evidence_assessment: 'unassessed',
    lineage: [{
      source_kind: 'canonical_entity',
      entity_id: 'cross-connection-ingest-initial-entity',
      source_version: 'source-v1',
    }],
  };
  provider.grantQuery(scope, true);
  provider.grantRecord(scope, record.record_ref, record.record_version, true);
  provider.putRecord(record);
  await provider.rebuildIndex(scope.world_id);
  assert.equal((await provider.reconcile(scope.world_id)).status, 'current');

  holdSnapshot = true;
  const pending = provider.retrieveCandidates(scope);
  await snapshotStarted;
  otherProvider.putRecord({
    ...scope,
    record_ref: 'cross-connection-ingest-new-record',
    record_version: 'v1',
    source_kind: 'canonical_entity',
    source_entity_id: 'cross-connection-ingest-new-entity',
    source_version: 'source-v1',
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer_kind: 'test',
    content_disposition: 'usable',
    evidence_assessment: 'unassessed',
    lineage: [{
      source_kind: 'canonical_entity',
      entity_id: 'cross-connection-ingest-new-entity',
      source_version: 'source-v1',
    }],
  });
  releaseSnapshot();

  await assert.rejects(pending, /MEMORY_INDEX_NOT_READY|MEMORY_AUTHORIZATION_CHANGED/);
});
