import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';

const filePath = fileURLToPath(import.meta.url);
const scope = { world_id: 'process-world', subject_id: 'process-npc', purpose: 'npc_decision' };
const record = {
  ...scope,
  record_ref: 'memory:process-record',
  record_version: 'record-v1',
  source_kind: 'canonical_entity',
  source_entity_id: 'entity-process-a',
  source_version: 'source-v1',
  content_kind: 'claim',
  epistemic_kind: 'acquired_report',
  producer_kind: 'memory-index',
  content_disposition: 'usable',
  evidence_assessment: 'unassessed',
  lineage: [{ source_kind: 'canonical_entity', entity_id: 'entity-process-a', source_version: 'source-v1' }],
};

function runChild(mode, directory) {
  const child = spawnSync(process.execPath, [filePath, '--provider-child-' + mode, directory], {
    encoding: 'utf8',
    timeout: 15000,
    windowsHide: true,
  });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.status, 0, 'child ' + mode + ' failed: ' + child.stderr + '\n' + child.stdout);
  return JSON.parse(child.stdout.trim());
}

async function runChildMode(mode, directory) {
  const path = join(directory, 'provider.sqlite');
  const provider = new SQLiteMemoryProvider({
    path,
    coordinatorPath: join(directory, 'coordinator.sqlite'),
    getSnapshot: async () => ({ world_revision: 4, commit_sequence: 2 }),
    validateSourceVersion: async (candidate) => candidate.source_version === 'source-v1'
      && candidate.source_entity_id === 'entity-process-a',
    validateInventory: async () => true,
  });

  try {
    if (mode === 'write-and-exit') {
      provider.grantQuery(scope, true);
      provider.grantRecord(scope, record.record_ref, record.record_version, true);
      const ingest = provider.putRecord(record);
      const rebuild = await provider.rebuildIndex(scope.world_id);
      const reconciliation = await provider.reconcile(scope.world_id);
      if (ingest.status !== 'stored' || rebuild.status !== 'rebuilt' || reconciliation.status !== 'current') {
        throw new Error('PROCESS_WRITE_NOT_READY');
      }
      // Exit without Provider.close() to exercise OS process termination after committed writes.
      process.stdout.write(JSON.stringify({ ingest: ingest.status, rebuild: rebuild.status, reconciliation: reconciliation.status }), () => {
        process.exit(0);
      });
      return;
    }

    if (mode === 'revoke') {
      const revoked = provider.revokeRecord(scope, record.record_ref, record.record_version);
      process.stdout.write(JSON.stringify({ revoked: revoked ?? null }));
      return;
    }

    if (mode === 'read') {
      const rebuild = await provider.rebuildIndex(scope.world_id);
      const reconciliation = await provider.reconcile(scope.world_id);
      try {
        const result = await provider.retrieveCandidates(scope);
        process.stdout.write(JSON.stringify({
          rebuild: rebuild.status,
          reconciliation: reconciliation.status,
          completeness: result.completeness,
          candidates: result.candidates.map((candidate) => ({
            ref: candidate.record.ref,
            version: candidate.record.version,
            sourceEntityId: candidate.source.entity_id,
            })),
        }));
      } catch (error) {
        if (error?.message !== 'MEMORY_RECORDS_WITHHELD') throw error;
        process.stdout.write(JSON.stringify({
          rebuild: rebuild.status,
          reconciliation: reconciliation.status,
          withheld: true,
          error: error.message,
        }));
      }
      return;
    }

    throw new Error('UNKNOWN_CHILD_MODE');
  } finally {
    // The write-and-exit case deliberately exits before this cleanup runs.
    if (mode !== 'write-and-exit') {
      try { provider.close(); } catch {}
    }
  }
}

const childMode = process.argv[2];
if (childMode?.startsWith('--provider-child-')) {
  await runChildMode(childMode.slice('--provider-child-'.length), process.argv[3]);
} else {
  test('file-backed Provider survives OS process exit and keeps revocation across a fresh process', (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'logic-provider-process-restart-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));

    const written = runChild('write-and-exit', directory);
    assert.deepEqual(written, {
      ingest: 'stored',
      rebuild: 'rebuilt',
      reconciliation: 'current',
    });

    const beforeRevoke = runChild('read', directory);
    assert.equal(beforeRevoke.completeness, 'complete');
    assert.deepEqual(beforeRevoke.candidates, [{
      ref: 'memory:process-record',
      version: 'record-v1',
      sourceEntityId: 'entity-process-a',
    }]);

    runChild('revoke', directory);

    const afterRevoke = runChild('read', directory);
    assert.equal(afterRevoke.withheld, true);
    assert.equal(afterRevoke.error, 'MEMORY_RECORDS_WITHHELD');
  });
}
