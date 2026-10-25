import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';

test('restart after interruption during source validation never reuses a rebuilding marker as current', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-memory-reconcile-crash-'));
  const path = join(directory, 'memory-provider.sqlite');
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  let releaseValidation;
  let signalValidationStarted;
  const validationStarted = new Promise((resolve) => { signalValidationStarted = resolve; });
  const pendingValidation = new Promise((resolve) => { releaseValidation = resolve; });
  const snapshot = async () => ({ world_revision: 7, commit_sequence: 3 });
  const validSource = async (record) => record.source_version === 'source-v1'
    && record.source_entity_id === 'entity-source-a';
  const inventoryComplete = async () => true;

  let provider = new SQLiteMemoryProvider({
    path, getSnapshot: snapshot,
    validateSourceVersion: async (record) => {
      signalValidationStarted();
      await pendingValidation;
      return validSource(record);
    },
    validateInventory: inventoryComplete,
  });
  const scope = { world_id: 'world-a', subject_id: 'npc-a', purpose: 'npc_decision' };
  const record = {
    ...scope, record_ref: 'memory:record-a', record_version: 'record-v1',
    source_kind: 'canonical_entity', source_entity_id: 'entity-source-a', source_version: 'source-v1',
    content_kind: 'claim', epistemic_kind: 'acquired_report', producer_kind: 'memory-index',
    content_disposition: 'usable', evidence_assessment: 'unassessed',
    lineage: [{ source_kind: 'canonical_entity', entity_id: 'entity-source-a', source_version: 'source-v1' }],
  };
  provider.grantQuery(scope, true);
  provider.putRecord(record);
  provider.grantRecord(scope, record.record_ref, record.record_version, true);
  await provider.rebuildIndex(scope.world_id);

  const interruptedReconciliation = provider.reconcile(scope.world_id);
  await validationStarted;

  // Simulate process loss while a trusted host callback is in flight.
  // The durable state was already marked rebuilding before validation began.
  provider.close();
  releaseValidation();
  await assert.rejects(interruptedReconciliation);

  provider = new SQLiteMemoryProvider({
    path, getSnapshot: snapshot, validateSourceVersion: validSource,
    validateInventory: inventoryComplete,
  });
  t.after(() => provider.close());

  await assert.rejects(
    () => provider.retrieveCandidates(scope),
    /MEMORY_INDEX_NOT_READY/,
    'restart must not treat an interrupted reconciliation as current',
  );

  assert.equal((await provider.reconcile(scope.world_id)).status, 'current');
  assert.equal((await provider.retrieveCandidates(scope)).candidates.length, 1);
});
