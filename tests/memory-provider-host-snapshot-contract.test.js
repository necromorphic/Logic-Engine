import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';

const scope = {
  world_id: 'snapshot-contract-world',
  subject_id: 'snapshot-contract-npc',
  purpose: 'npc_decision',
};

const record = (version) => ({
  ...scope,
  record_ref: 'memory:canonical-entity-1',
  record_version: version,
  source_kind: 'canonical_entity',
  source_entity_id: 'canonical-entity-1',
  source_version: 'entity-version-1',
  content_kind: 'claim',
  epistemic_kind: 'acquired_report',
  producer_kind: 'provider-contract-test',
  content_disposition: 'usable',
  evidence_assessment: 'unassessed',
  lineage: [{
    source_kind: 'canonical_entity',
    entity_id: 'canonical-entity-1',
    source_version: 'entity-version-1',
  }],
});

function setup(t, { validateSourceVersion = async () => true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'logic-provider-snapshot-contract-'));
  const path = join(directory, 'provider.sqlite');
  let snapshot = { world_revision: 12, commit_sequence: 7 };
  let snapshotAvailable = true;
  const provider = new SQLiteMemoryProvider({
    path,
    coordinatorPath: join(directory, 'coordinator.sqlite'),
    getSnapshot: async () => {
      if (!snapshotAvailable) throw new Error('snapshot unavailable');
      return { ...snapshot };
    },
    validateSourceVersion,
    validateInventory: async () => true,
  });
  t.after(() => {
    try { provider.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    provider,
    setSnapshot(value) { snapshot = value; },
    setSnapshotAvailable(value) { snapshotAvailable = value; },
  };
}

test('replaying an identical canonical Provider record is idempotent and leaves reconciliation current', async (t) => {
  const s = setup(t);
  s.provider.grantQuery(scope, true);
  const item = record('record-v1');
  s.provider.putRecord(item);
  s.provider.grantRecord(scope, item.record_ref, item.record_version, true);

  await s.provider.rebuildIndex(scope.world_id);
  assert.equal((await s.provider.reconcile(scope.world_id)).status, 'current');
  // Re-delivery at the Provider boundary must not create a second record
  // or change its immutable identity. This does not simulate Host delivery.
  assert.deepEqual(s.provider.putRecord(item), {
    status: 'duplicate',
    record_ref: item.record_ref,
    record_version: item.record_version,
  });
  assert.equal((await s.provider.reconcile(scope.world_id)).status, 'current');

  const result = await s.provider.retrieveCandidates(scope);
  assert.equal(result.completeness, 'complete');
  assert.deepEqual(result.candidates.map((candidate) => candidate.record.version), ['record-v1']);
});

test('a changed or unavailable trusted source snapshot never reuses the previous current marker', async (t) => {
  const s = setup(t);
  s.provider.grantQuery(scope, true);
  const item = record('record-v1');
  s.provider.putRecord(item);
  s.provider.grantRecord(scope, item.record_ref, item.record_version, true);
  await s.provider.rebuildIndex(scope.world_id);
  assert.equal((await s.provider.reconcile(scope.world_id)).status, 'current');

  s.setSnapshot({ world_revision: 13, commit_sequence: 7 });
  await assert.rejects(
    () => s.provider.retrieveCandidates(scope),
    (error) => error.message === 'MEMORY_SNAPSHOT_STALE',
  );
  assert.equal(s.provider.getIndexStatusForDiagnostics(scope.world_id).index_health, 'stale');

  s.setSnapshotAvailable(false);
  assert.deepEqual(await s.provider.reconcile(scope.world_id), {
    status: 'unavailable',
    reason: 'CORE_SNAPSHOT_UNAVAILABLE',
  });
  await assert.rejects(
    () => s.provider.retrieveCandidates(scope),
    (error) => error.message === 'MEMORY_INDEX_NOT_READY',
  );
});

test('revoking one exact record version during awaited candidate authorization blocks it but preserves its sibling', async (t) => {
  let pause = false;
  let startedResolve;
  let releaseResolve;
  let timeoutId;
  const started = new Promise((resolve) => { startedResolve = resolve; });
  const gate = new Promise((resolve) => { releaseResolve = resolve; });
  const s = setup(t, {
    validateSourceVersion: async () => {
      if (pause) {
        pause = false;
        startedResolve();
        await gate;
      }
      return true;
    },
  });
  s.provider.grantQuery(scope, true);
  for (const version of ['record-v1', 'record-v2']) {
    const item = record(version);
    s.provider.putRecord(item);
    s.provider.grantRecord(scope, item.record_ref, item.record_version, true);
  }
  await s.provider.rebuildIndex(scope.world_id);
  assert.equal((await s.provider.reconcile(scope.world_id)).status, 'current');

  const candidateInput = (version) => ({
    ...scope,
    record_ref: 'memory:canonical-entity-1',
    record_version: version,
    source_kind: 'canonical_entity',
    source_entity_id: 'canonical-entity-1',
  });

  pause = true;
  const pendingOutcome = s.provider.authorizeCandidate(candidateInput('record-v1'))
    .then((value) => ({ value }), (error) => ({ error }));
  try {
    await Promise.race([
      started,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('source validation was not reached')), 2000);
      }),
    ]);
    s.provider.revokeRecord(scope, 'memory:canonical-entity-1', 'record-v1');
    releaseResolve();

    const outcome = await pendingOutcome;
    assert.equal(outcome.error?.message, 'MEMORY_RECORD_ACCESS_REVOKED');
    assert.equal(await s.provider.authorizeCandidate(candidateInput('record-v2')), true);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    releaseResolve();
  }
});
