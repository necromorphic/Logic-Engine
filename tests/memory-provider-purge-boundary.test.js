import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';

test('raw purge covers registered Provider copies, not copies in an external store', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-purge-boundary-'));
  const provider = new SQLiteMemoryProvider({ path: join(dir, 'provider.sqlite'),
    getSnapshot: async () => ({ world_revision: 1, commit_sequence: 1 }),
    validateSourceVersion: async () => true, validateInventory: async () => true });
  const external = new DatabaseSync(join(dir, 'external.sqlite'));
  t.after(() => { try { provider.close(); } catch {} try { external.close(); } catch {} rmSync(dir, { recursive: true, force: true }); });
  const source = { world_id: 'w', conversation_id: 'c', message_id: 'm', version_id: 'v' };
  provider.captureRawMessage({ ...source, role: 'assistant', content: 'source', metadata: {} });
  provider.registerRawDerivedCopy({ ...source, source_version_id: 'v', copy_ref: 'registered', copy_version: '1', copy_kind: 'summary', content: 'inside Provider' });
  external.exec('CREATE TABLE copies (copy_ref TEXT PRIMARY KEY, content TEXT NOT NULL)');
  external.prepare('INSERT INTO copies VALUES (?, ?)').run('unregistered-external', 'outside Provider');
  assert.deepEqual(provider.purgeRawSource(source), { status: 'purged', purged_copies: 1 });
  assert.equal(provider.db.prepare('SELECT COUNT(*) AS n FROM memory_raw_derived_copies').get().n, 0);
  assert.equal(external.prepare('SELECT content FROM copies WHERE copy_ref=?').get('unregistered-external').content, 'outside Provider');
});
