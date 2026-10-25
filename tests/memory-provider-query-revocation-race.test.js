import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';

test('query authorization revoked during source validation is denied', async (t) => {
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
