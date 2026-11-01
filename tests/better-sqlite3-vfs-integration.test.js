import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const require = createRequire(import.meta.url);

const packageRoot = process.env.BETTER_SQLITE3_PACKAGE_DIR;
const extensionPath = process.env.LOGIC_ENGINE_VFS_PROBE_PATH;
const vfsName = 'logic-engine-vfs-registration-probe';

test('stock better-sqlite3 selects the secure VFS through SQLite URI in its own engine', {
  skip: !packageRoot || !extensionPath,
}, (t) => {
  console.error('[better-sqlite3-uri-vfs] require-before');
  const Database = require(packageRoot);
  console.error('[better-sqlite3-uri-vfs] require-after');
  const resolvedExtension = path.resolve(extensionPath);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'logic-engine-better-sqlite3-vfs-'));
  const filename = path.join(directory, 'vectors.sqlite');
  const databaseUri = pathToFileURL(filename);
  databaseUri.searchParams.set('vfs', vfsName);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  // Confirm URI VFS selection is enabled in this exact better-sqlite3 SQLite build.
  console.error('[better-sqlite3-uri-vfs] bootstrap-before');
  const bootstrap = new Database(':memory:');
  console.error('[better-sqlite3-uri-vfs] bootstrap-after');
  try {
    const compileOptions = bootstrap.pragma('compile_options').map((row) => row.compile_options);
    assert.ok(compileOptions.includes('USE_URI'), 'embedded SQLite must enable URI filenames');
    // Register the extension in better-sqlite3's embedded engine, not node:sqlite.
    console.error('[better-sqlite3-uri-vfs] extension-before');
    bootstrap.loadExtension(resolvedExtension, 'sqlite3_secure_vfs_probe_init');
    console.error('[better-sqlite3-uri-vfs] extension-after');
  } finally {
    bootstrap.close();
  }

  // SQLite's URI vfs= parameter selects the named VFS without patching better-sqlite3.
  console.error('[better-sqlite3-uri-vfs] target-before');
  const db = new Database(databaseUri.href);
  console.error('[better-sqlite3-uri-vfs] target-after');
  try {
    assert.equal(db.pragma('journal_mode = WAL', { simple: true }), 'wal');
    db.exec('CREATE TABLE vfs_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    db.prepare('INSERT INTO vfs_probe (value) VALUES (?)').run('same-engine');
    assert.deepEqual(db.prepare('SELECT value FROM vfs_probe').pluck().all(), ['same-engine']);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
    assert.ok(
      db.prepare('SELECT logic_engine_vfs_probe_open_count() AS count').get().count > 0,
      'the named VFS must receive the main database open',
    );
    assert.ok(
      db.prepare('SELECT logic_engine_vfs_probe_wal_open_count() AS count').get().count > 0,
      'the named VFS must receive the WAL open',
    );
  } finally {
    db.close();
  }

  const reopened = new Database(databaseUri.href, { readonly: true, fileMustExist: true });
  try {
    assert.deepEqual(reopened.prepare('SELECT value FROM vfs_probe').pluck().all(), ['same-engine']);
    assert.equal(reopened.pragma('integrity_check', { simple: true }), 'ok');
    assert.ok(
      reopened.prepare('SELECT logic_engine_vfs_probe_open_count() AS count').get().count > 0,
      'reopen must continue through the named VFS',
    );
  } finally {
    reopened.close();
  }
});
