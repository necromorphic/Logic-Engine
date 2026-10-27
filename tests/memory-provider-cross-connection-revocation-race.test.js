import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';

test('cross-connection revoke/re-grant during source validation invalidates in-flight candidate authorization', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-memory-cross-connection-revoke-'));
  const path = join(directory, 'provider.sqlite');
  const coordinatorPath = join(directory, 'coordinator.sqlite');

  let holdValidation = false;
  let releaseValidation;
  let signalValidation;
  const validationStarted = new Promise((resolve) => { signalValidation = resolve; });
  const validationGate = new Promise((resolve) => { releaseValidation = resolve; });

  const common = {
    path,
    coordinatorPath,
    getSnapshot: async () => ({ world_revision: 1, commit_sequence: 1 }),
    validateInventory: async () => true,
  };
  let provider;
  let secondProvider;
  t.after(() => {
    try { provider?.close(); } catch {}
    try { secondProvider?.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });

  provider = new SQLiteMemoryProvider({
    ...common,
    validateSourceVersion: async () => {
      if (holdValidation) {
        signalValidation();
        await validationGate;
      }
      return true;
    },
  });
  secondProvider = new SQLiteMemoryProvider({
    ...common,
    validateSourceVersion: async () => true,
  });

  const scope = {
    world_id: 'cross-connection-world',
    subject_id: 'cross-connection-npc',
    purpose: 'npc_decision',
  };
  const record = {
    ...scope,
    record_ref: 'memory:cross-connection-revoke',
    record_version: 'v1',
    source_kind: 'canonical_entity',
    source_entity_id: 'source-cross-connection',
    source_version: 'source-v1',
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer_kind: 'test',
    content_disposition: 'usable',
    evidence_assessment: 'unassessed',
    lineage: [{
      source_kind: 'canonical_entity',
      entity_id: 'source-cross-connection',
      source_version: 'source-v1',
    }],
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

  // The second connection performs a complete revoke/re-grant ABA transition.
  // The final grant value is true, so only the cross-connection epoch check can
  // distinguish this request from one whose authorization never changed.
  secondProvider.revokeRecord(scope, record.record_ref, record.record_version);
  secondProvider.grantRecord(scope, record.record_ref, record.record_version, true);
  releaseValidation();

  await assert.rejects(pending, /MEMORY_AUTHORIZATION_CHANGED/);
});
