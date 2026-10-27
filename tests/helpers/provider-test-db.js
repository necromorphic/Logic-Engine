import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Test-only observer/fault-injection connection, separate from Provider-owned handles. */
export function createProviderTestDb(t, { path = null, prefix = 'logic-memory-provider-test-' } = {}) {
  let ownedDirectory = null;
  if (path === null) {
    ownedDirectory = mkdtempSync(join(tmpdir(), prefix));
    path = join(ownedDirectory, 'provider.sqlite');
  }
  if (typeof path !== 'string' || path.length === 0 || path === ':memory:') {
    throw new TypeError('Provider test DB requires a file-backed path');
  }
  let db = null;
  return {
    path,
    close() {
      try { db?.close(); } catch {}
      db = null;
    },
    cleanup() {
      if (ownedDirectory) rmSync(ownedDirectory, { recursive: true, force: true });
    },
    get db() {
      if (!db) {
        db = new DatabaseSync(path);
        db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
      }
      return db;
    },
  };
}
