import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';

test('authorization rejects a locally matching source token after Core authority changes', async (t) => {
  let authoritativeSourceVersion = 'core-entity-v1:1';
  const provider = new SQLiteMemoryProvider({
    getSnapshot: async () => ({ world_revision: 7, commit_sequence: 4 }),
    validateSourceVersion: async (candidate) => candidate.source_version === authoritativeSourceVersion
      && candidate.source_kind === 'canonical_entity'
      && candidate.source_entity_id === 'entity-authority-race',
    validateInventory: async () => true,
  });
  t.after(() => provider.close());

  const scope = {
    world_id: 'authority-race-world',
    subject_id: 'authority-race-npc',
    purpose: 'npc_decision',
  };
  const record = {
    ...scope,
    record_ref: 'memory:authority-race-record',
    record_version: 'record-v1',
    source_kind: 'canonical_entity',
    source_entity_id: 'entity-authority-race',
    source_version: 'core-entity-v1:1',
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer_kind: 'test',
    content_disposition: 'usable',
    evidence_assessment: 'unassessed',
    lineage: [{
      source_kind: 'canonical_entity',
      entity_id: 'entity-authority-race',
      source_version: 'core-entity-v1:1',
    }],
  };

  provider.grantQuery(scope, true);
  provider.grantRecord(scope, record.record_ref, record.record_version, true);
  assert.equal(provider.putRecord(record).status, 'stored');
  await provider.rebuildIndex(scope.world_id);
  assert.equal((await provider.reconcile(scope.world_id)).status, 'current');

  const candidate = {
    ...scope,
    record_ref: record.record_ref,
    record_version: record.record_version,
    source_kind: record.source_kind,
    source_entity_id: record.source_entity_id,
    // Exact token still matches the persisted Provider record.
    source_version: record.source_version,
  };

  assert.equal(await provider.authorizeCandidate(candidate), true);

  // Simulate Core changing/revoking the authoritative source after Provider
  // reconciliation. The persisted token still matches locally, but Core no
  // longer accepts it. Provider must not rely on its local equality check.
  authoritativeSourceVersion = 'core-entity-v1:2';
  await assert.rejects(
    () => provider.authorizeCandidate(candidate),
    /MEMORY_SOURCE_VERSION_UNVERIFIABLE/,
  );
});


test('candidate authorization fails closed when Core snapshot changes during source validation', async (t) => {
  let snapshot = { world_revision: 4, commit_sequence: 2 };
  let mutateSnapshotDuringValidation = false;
  const provider = new SQLiteMemoryProvider({
    path: ':memory:',
    coordinatorPath: null,
    getSnapshot: async () => ({ ...snapshot }),
    validateSourceVersion: async (candidate) => {
      if (mutateSnapshotDuringValidation) {
        snapshot = { world_revision: 5, commit_sequence: 2 };
      }
      return candidate.source_version === 'core-entity-v1:1';
    },
    validateInventory: async () => true,
  });
  t.after(() => provider.close());

  const scope = {
    world_id: 'snapshot-race-world',
    subject_id: 'snapshot-race-npc',
    purpose: 'npc_decision',
  };
  const record = {
    ...scope,
    record_ref: 'memory:snapshot-race-record',
    record_version: 'record-v1',
    source_kind: 'canonical_entity',
    source_entity_id: 'snapshot-race-entity',
    source_version: 'core-entity-v1:1',
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer_kind: 'test',
    content_disposition: 'usable',
    evidence_assessment: 'unassessed',
    lineage: [{
      source_kind: 'canonical_entity',
      entity_id: 'snapshot-race-entity',
      source_version: 'core-entity-v1:1',
    }],
  };

  provider.grantQuery(scope, true);
  provider.grantRecord(scope, record.record_ref, record.record_version, true);
  assert.equal(provider.putRecord(record).status, 'stored');
  await provider.rebuildIndex(scope.world_id);
  assert.equal((await provider.reconcile(scope.world_id)).status, 'current');

  mutateSnapshotDuringValidation = true;
  await assert.rejects(
    () => provider.authorizeCandidate({
      ...scope,
      record_ref: record.record_ref,
      record_version: record.record_version,
      source_kind: record.source_kind,
      source_entity_id: record.source_entity_id,
      source_version: record.source_version,
    }),
    /MEMORY_SNAPSHOT_STALE/,
  );
  assert.notEqual(
    provider.getIndexStatusForDiagnostics(scope.world_id).source_reconciliation,
    'current',
  );
});
