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
  const Database = require(packageRoot);
  const resolvedExtension = path.resolve(extensionPath);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'logic-engine-better-sqlite3-vfs-'));
  const filename = path.join(directory, 'vectors.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  // Load the extension into this exact better-sqlite3 engine before opening a protected DB.
  const bootstrap = new Database(':memory:');
  try {
    // Register the VFS as the default in better-sqlite3's embedded engine, not node:sqlite.
    bootstrap.loadExtension(resolvedExtension, 'sqlite3_secure_vfs_probe_init');
  } finally {
    bootstrap.close();
  }

  // sqlite3_auto_extension installs the role-registration function on subsequent
  // connections. Enroll the path before the first file-backed open; the role
  // registry is process-global and survives closing this registrar connection.
  const registrar = new Database(':memory:');
  const registration = registrar.prepare(
    'SELECT logic_engine_vfs_probe_register_database_role(?, ?) AS registered',
  ).get(filename, 'better-sqlite3-vfs-probe');
  assert.equal(registration.registered, 1, 'the main DB role must be enrolled before open');

  // The extension registered its VFS as SQLite's default; better-sqlite3 opens
  // this ordinary filename with vfs=NULL, so no URI support or binding patch is needed.
  let db;
  try {
    db = new Database(filename);
  } catch (error) {
    const diagnostics = registrar.prepare(`
      SELECT
        logic_engine_vfs_probe_open_count() AS mainOpens,
        logic_engine_vfs_probe_journal_open_count() AS journalOpens,
        logic_engine_vfs_probe_wal_open_count() AS walOpens,
        logic_engine_vfs_probe_shm_open_count() AS shmOpens,
        logic_engine_vfs_probe_native_open_count() AS nativeOpens,
        logic_engine_vfs_probe_identity_reject_count() AS identityRejects,
        logic_engine_vfs_probe_reused_descriptor_accept_count() AS acceptedMainOpens
    `).get();
    error.message += `; VFS diagnostics: ${JSON.stringify(diagnostics)}`;
    throw error;
  } finally {
    registrar.close();
  }
  try {
    // Exercise rollback-journal create/open/delete before switching to WAL.
    assert.equal(db.pragma('journal_mode = DELETE', { simple: true }), 'delete');
    db.exec('CREATE TABLE vfs_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    assert.ok(
      db.prepare('SELECT logic_engine_vfs_probe_journal_open_count() AS count').get().count > 0,
      'the registered default VFS must receive the rollback-journal open',
    );

    // A pathname swap between identity capture and quarantine rename must not
    // unlink the substituted object or silently remove it from its original name.
    const replacementPath = path.join(directory, 'replacement.bin');
    const journalPath = `${filename}-journal`;
    fs.writeFileSync(replacementPath, 'replacement-object-must-survive');
    db.exec('BEGIN IMMEDIATE');
    db.prepare('INSERT INTO vfs_probe (value) VALUES (?)').run('race-case');
    const raceConfigured = db.prepare(
      'SELECT logic_engine_vfs_probe_configure_race(?, ?, 1) AS configured',
    ).get(journalPath, replacementPath).configured;
    assert.equal(raceConfigured, 1, 'the deterministic delete race must be armed');
    assert.throws(() => db.exec('COMMIT'), /disk I\/O error|SQLITE_IOERR/i);
    assert.equal(fs.readFileSync(replacementPath, 'utf8'), 'replacement-object-must-survive');
    assert.equal(fs.readFileSync(journalPath, 'utf8'), 'replacement-object-must-survive',
      'the mismatched moved entry must be restored without overwriting a concurrent creator');
    assert.equal(fs.statSync(journalPath).ino, fs.statSync(replacementPath).ino,
      'the original replacement inode must remain linked at both names');
    const quarantinePath = path.join(directory, '.logic-engine-vfs-quarantine');
    assert.deepEqual(fs.readdirSync(quarantinePath), [],
      'a successfully restored mismatch must not leave an orphaned quarantine entry');
    assert.equal(db.pragma('journal_mode = WAL', { simple: true }), 'wal');
    db.prepare('INSERT INTO vfs_probe (value) VALUES (?)').run('same-engine');
    assert.ok(
      db.prepare('SELECT logic_engine_vfs_probe_shm_open_count() AS count').get().count > 0,
      'the registered default VFS must receive the WAL shared-memory file open',
    );
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
