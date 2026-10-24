import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';

test('interrupted reconciliation remains unavailable after restart until a full reconciliation succeeds', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-memory-reconcile-interrupt-'));
  const path = join(directory, 'memory-provider.sqlite');
  let pauseNextValidation = false;
  let validationStartedResolve;
  let releaseValidationResolve;
  const validationStarted = new Promise((resolve) => { validationStartedResolve = resolve; });
  const validationGate = new Promise((resolve) => { releaseValidationResolve = resolve; });
  const options = {
    path,
    getSnapshot: async () => ({ world_revision: 8, commit_sequence: 3 }),
    validateSourceVersion: async () => {
      if (pauseNextValidation) {
        pauseNextValidation = false;
        validationStartedResolve();
        await validationGate;
      }
      return true;
    },
    validateInventory: async () => true,
  };
  let provider = new SQLiteMemoryProvider(options);
  let restarted;
  let interruptedReconciliation;
  t.after(() => {
    try { provider?.close(); } catch {}
    try { restarted?.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });

  const scope = { world_id: 'interrupt-world', subject_id: 'interrupt-npc', purpose: 'npc_decision' };
  const record = {
    ...scope,
    record_ref: 'interrupt-record',
    record_version: 'record-v1',
    source_kind: 'canonical_entity',
    source_entity_id: 'interrupt-entity',
    source_version: 'source-v1',
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer_kind: 'test',
    content_disposition: 'usable',
    evidence_assessment: 'unassessed',
    lineage: [{
      source_kind: 'canonical_entity',
      entity_id: 'interrupt-entity',
      source_version: 'source-v1',
    }],
  };
  provider.grantQuery(scope, true);
  provider.putRecord(record);
  provider.grantRecord(scope, record.record_ref, record.record_version, true);
  await provider.rebuildIndex(scope.world_id);
  assert.equal((await provider.reconcile(scope.world_id)).status, 'current');

  // Stop at an awaited source-validation boundary after reconcile has persisted
  // rebuilding/stale. Closing the adapter models process loss; no success marker
  // may survive the restart until a new complete reconciliation succeeds.
  pauseNextValidation = true;
  interruptedReconciliation = provider.reconcile(scope.world_id);
  await validationStarted;
  provider.close();
  provider = null;

  restarted = new SQLiteMemoryProvider(options);
  await assert.rejects(
    () => restarted.retrieveCandidates(scope),
    (error) => error.message === 'MEMORY_INDEX_NOT_READY',
  );

  // Recovery is explicit: a full successful reconciliation is required before
  // retrieval becomes available again.
  assert.equal((await restarted.reconcile(scope.world_id)).status, 'current');
  const recovered = await restarted.retrieveCandidates(scope);
  assert.equal(recovered.completeness, 'complete');
  assert.equal(recovered.candidates.length, 1);

  releaseValidationResolve();
  await assert.rejects(interruptedReconciliation);
});
