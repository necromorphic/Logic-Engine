import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);

const packageRoot = process.env.BETTER_SQLITE3_PACKAGE_DIR;
const extensionPath = process.env.LOGIC_ENGINE_VFS_PROBE_PATH;

test('stock better-sqlite3 uses the registered default VFS in its own engine', {
  skip: !packageRoot || !extensionPath,
}, (t) => {
  console.error('[better-sqlite3-default-vfs] require-before');
  const Database = require(packageRoot);
  console.error('[better-sqlite3-default-vfs] require-after');
  const resolvedExtension = path.resolve(extensionPath);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'logic-engine-better-sqlite3-vfs-'));
  const filename = path.join(directory, 'vectors.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  // Load the extension into this exact better-sqlite3 engine before opening a protected DB.
  console.error('[better-sqlite3-default-vfs] bootstrap-before');
  const bootstrap = new Database(':memory:');
  console.error('[better-sqlite3-default-vfs] bootstrap-after');
  try {
    // Register the VFS as the default in better-sqlite3's embedded engine, not node:sqlite.
    console.error('[better-sqlite3-default-vfs] extension-before');
    bootstrap.loadExtension(resolvedExtension, 'sqlite3_secure_vfs_probe_init');
    console.error('[better-sqlite3-default-vfs] extension-after');
  } finally {
    bootstrap.close();
  }

  // The extension registered its VFS as SQLite's default; better-sqlite3 opens
  // this ordinary filename with vfs=NULL, so no URI support or binding patch is needed.
  console.error('[better-sqlite3-default-vfs] target-before');
  const db = new Database(filename);
  console.error('[better-sqlite3-default-vfs] target-after');
  try {
    assert.equal(db.pragma('journal_mode = WAL', { simple: true }), 'wal');
    db.exec('CREATE TABLE vfs_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    db.prepare('INSERT INTO vfs_probe (value) VALUES (?)').run('same-engine');
    assert.deepEqual(db.prepare('SELECT value FROM vfs_probe').pluck().all(), ['same-engine']);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
    assert.ok(
      db.prepare('SELECT logic_engine_vfs_probe_open_count() AS count').get().count > 0,
      'the registered default VFS must receive the main database open',
    );
    assert.ok(
      db.prepare('SELECT logic_engine_vfs_probe_wal_open_count() AS count').get().count > 0,
      'the registered default VFS must receive the WAL open',
    );
  } finally {
    db.close();
  }

  const reopened = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    assert.deepEqual(reopened.prepare('SELECT value FROM vfs_probe').pluck().all(), ['same-engine']);
    assert.equal(reopened.pragma('integrity_check', { simple: true }), 'ok');
    assert.ok(
      reopened.prepare('SELECT logic_engine_vfs_probe_open_count() AS count').get().count > 0,
      'reopen must continue through the registered default VFS',
    );
  } finally {
    reopened.close();
  }
});
