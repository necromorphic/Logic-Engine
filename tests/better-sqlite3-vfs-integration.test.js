import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);

const packageRoot = process.env.BETTER_SQLITE3_PACKAGE_DIR;
const extensionPath = process.env.LOGIC_ENGINE_VFS_PROBE_PATH;

test('patched better-sqlite3 registers and opens through its own named VFS', {
  skip: !packageRoot || !extensionPath,
}, (t) => {
  const Database = require(packageRoot);
  const resolvedExtension = path.resolve(extensionPath);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'logic-engine-better-sqlite3-vfs-'));
  const filename = path.join(directory, 'vectors.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  assert.throws(() => new Database(filename, { vfs: '' }), /non-empty SQLite VFS name/);
  assert.throws(() => new Database(filename, { vfs: 42 }), /non-empty SQLite VFS name/);
  assert.throws(() => new Database(filename, { vfs: 'bad' + String.fromCharCode(0) + 'vfs' }), /non-empty SQLite VFS name/);

  // Register in better-sqlite3's embedded engine, not node:sqlite.
  const bootstrap = new Database(':memory:');
  try { bootstrap.loadExtension(resolvedExtension); }
  finally { bootstrap.close(); }

  const db = new Database(filename, { vfs: 'logic-engine-vfs-registration-probe' });
  try {
    db.exec('CREATE TABLE vfs_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    db.prepare('INSERT INTO vfs_probe (value) VALUES (?)').run('same-engine');
    assert.deepEqual(db.prepare('SELECT value FROM vfs_probe').pluck().all(), ['same-engine']);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  } finally { db.close(); }

  const reopened = new Database(filename, { readonly: true, fileMustExist: true, vfs: 'logic-engine-vfs-registration-probe' });
  try {
    assert.deepEqual(reopened.prepare('SELECT value FROM vfs_probe').pluck().all(), ['same-engine']);
    assert.equal(reopened.pragma('integrity_check', { simple: true }), 'ok');
  } finally { reopened.close(); }
});