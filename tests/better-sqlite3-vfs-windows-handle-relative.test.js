import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const packageRoot = process.env.BETTER_SQLITE3_PACKAGE_DIR;
const extensionPath = process.env.LOGIC_ENGINE_VFS_PROBE_PATH;

function sha256(filename) {
  return createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

test('Windows VFS opens SQLite main/journal/WAL/SHM relative to pinned parent and rejects replaced DB identity', {
  skip: process.platform !== 'win32' || !packageRoot || !extensionPath,
}, (t) => {
  const Database = require(packageRoot);
  const tempBase = process.env.RUNNER_TEMP || os.tmpdir();
  const root = fs.mkdtempSync(path.join(tempBase, 'logic-engine-win-handle-relative-'));
  const protectedDir = path.join(root, 'protected');
  const attackerSeedDir = path.join(root, 'attacker-seed');
  fs.mkdirSync(protectedDir);
  fs.mkdirSync(attackerSeedDir);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const databasePath = path.join(protectedDir, 'vectors.sqlite');
  const pinnedDatabasePath = databasePath + '.trusted';
  const attackerSeedPath = path.join(attackerSeedDir, 'vectors.sqlite');
  const trusted = new Database(databasePath);
  try {
    trusted.exec('CREATE TABLE origin (value TEXT NOT NULL)');
    trusted.prepare('INSERT INTO origin VALUES (?)').run('trusted-before-swap');
  } finally {
    trusted.close();
  }
  const attacker = new Database(attackerSeedPath);
  try {
    attacker.exec('CREATE TABLE origin (value TEXT NOT NULL)');
    attacker.prepare('INSERT INTO origin VALUES (?)').run('attacker-decoy');
  } finally {
    attacker.close();
  }
  const attackerHash = sha256(attackerSeedPath);

  const childSource = String.raw`
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const path = require('node:path');
    const crypto = require('node:crypto');
    const Database = require(process.env.BETTER_SQLITE3_PACKAGE_DIR);
    const databasePath = process.env.LOGIC_ENGINE_TEST_DATABASE_PATH;
    const pinnedDatabasePath = process.env.LOGIC_ENGINE_TEST_PINNED_DATABASE_PATH;
    const attackerSeedPath = process.env.LOGIC_ENGINE_TEST_ATTACKER_SEED_PATH;
    const attackerHash = process.env.LOGIC_ENGINE_TEST_ATTACKER_HASH;
    const extensionPath = process.env.LOGIC_ENGINE_VFS_PROBE_PATH;

    const bootstrap = new Database(':memory:');
    bootstrap.loadExtension(extensionPath, 'sqlite3_secure_vfs_probe_init');
    bootstrap.close();

    const registrar = new Database(':memory:');
    const identity = JSON.parse(registrar.prepare(
      'SELECT logic_engine_vfs_probe_capture_manifest_identity(?) AS identity'
    ).get(databasePath).identity);
    const registered = registrar.prepare(
      'SELECT logic_engine_vfs_probe_register_database_role_alias(?, ?, ?, ?, ?, ?, ?, ?) AS registered'
    ).get(
      databasePath,
      'core',
      identity.databaseIdentity.volumeSerial,
      identity.databaseIdentity.fileId,
      identity.parentIdentity.volumeSerial,
      identity.parentIdentity.fileId,
      path.basename(databasePath),
      databasePath,
    ).registered;
    assert.equal(registered, 1, 'role must be anchored to the opened parent HANDLE');

    const writer = new Database(databasePath);
    let reader;
    try {
      assert.deepEqual(
        writer.prepare('SELECT value FROM origin').pluck().all(),
        ['trusted-before-swap'],
        'main DB must open relative to the pinned parent HANDLE',
      );
      writer.exec('CREATE TABLE rollback_probe (value TEXT NOT NULL)');
      writer.prepare('INSERT INTO rollback_probe VALUES (?)').run('rollback-journal-path');
      assert.equal(writer.pragma('journal_mode = WAL', { simple: true }), 'wal');

      reader = new Database(databasePath);
      reader.exec('BEGIN');
      const snapshot = reader.prepare('SELECT COUNT(*) FROM origin').pluck().get();
      writer.prepare('INSERT INTO origin VALUES (?)').run('trusted-after-swap');
      assert.equal(reader.prepare('SELECT COUNT(*) FROM origin').pluck().get(), snapshot,
        'WAL reader snapshot must remain isolated while the writer commits');
      reader.exec('COMMIT');
      assert.equal(writer.prepare('SELECT COUNT(*) FROM origin').pluck().get(), snapshot + 1);

      assert.ok(registrar.prepare(
        'SELECT logic_engine_vfs_probe_open_count() AS count'
      ).get().count > 0);
      assert.ok(registrar.prepare(
        'SELECT logic_engine_vfs_probe_journal_open_count() AS count'
      ).get().count > 0);
      assert.ok(registrar.prepare(
        'SELECT logic_engine_vfs_probe_wal_open_count() AS count'
      ).get().count > 0);
      assert.ok(registrar.prepare(
        'SELECT logic_engine_vfs_probe_shm_open_count() AS count'
      ).get().count > 0, 'SHM must also open relative to the pinned parent HANDLE');

      reader.close();
      reader = null;
      writer.pragma('wal_checkpoint(TRUNCATE)');
      assert.equal(writer.pragma('journal_mode = DELETE', { simple: true }), 'delete');
    } finally {
      if (reader) reader.close();
      writer.close();
    }

    // Exercise abrupt process termination and SQLite WAL recovery on Windows.
    // Each process re-enrolls the same opened file identity; this proves SQLite
    // recovery through the handle-relative probe, not durable manifest recovery.
    const { spawnSync } = require('node:child_process');
    const crashScript = [
      "const Database = require(process.env.BETTER_SQLITE3_PACKAGE_DIR);",
      "const path = require('node:path');",
      "const fs = require('node:fs');",
      "const bootstrap = new Database(':memory:');",
      "bootstrap.loadExtension(process.env.LOGIC_ENGINE_VFS_PROBE_PATH, 'sqlite3_secure_vfs_probe_init');",
      "bootstrap.close();",
      "const dbPath = process.env.LOGIC_ENGINE_TEST_DATABASE_PATH;",
      "const registrar = new Database(':memory:');",
      "const identity = JSON.parse(registrar.prepare('SELECT logic_engine_vfs_probe_capture_manifest_identity(?) AS identity').get(dbPath).identity);",
      "const registered = registrar.prepare('SELECT logic_engine_vfs_probe_register_database_role_alias(?, ?, ?, ?, ?, ?, ?, ?) AS registered').get(dbPath, 'core', identity.databaseIdentity.volumeSerial, identity.databaseIdentity.fileId, identity.parentIdentity.volumeSerial, identity.parentIdentity.fileId, path.basename(dbPath), dbPath).registered;",
      "if (registered !== 1) process.exit(31);",
      "const db = new Database(dbPath);",
      "db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; PRAGMA cache_size=1; BEGIN IMMEDIATE;');",
      "const insert = db.prepare('INSERT INTO origin VALUES (?)');",
      "for (let i = 0; i < 64; i += 1) insert.run('uncommitted-' + i + '-' + 'x'.repeat(512));",
      "if (fs.statSync(dbPath + '-wal').size <= 32) process.exit(32);",
      "process.exit(0);"
    ].join('\n');
    const crashed = spawnSync(process.execPath, ['-e', crashScript], { encoding: 'utf8', env: process.env, timeout: 60000 });
    assert.equal(crashed.status, 0, 'writer process must terminate abruptly after persisting uncommitted WAL frames: ' + String(crashed.stderr || crashed.error || crashed.status));
    const recoveryScript = [
      "const assert = require('node:assert/strict');",
      "const Database = require(process.env.BETTER_SQLITE3_PACKAGE_DIR);",
      "const path = require('node:path');",
      "const bootstrap = new Database(':memory:');",
      "bootstrap.loadExtension(process.env.LOGIC_ENGINE_VFS_PROBE_PATH, 'sqlite3_secure_vfs_probe_init');",
      "bootstrap.close();",
      "const dbPath = process.env.LOGIC_ENGINE_TEST_DATABASE_PATH;",
      "const registrar = new Database(':memory:');",
      "const identity = JSON.parse(registrar.prepare('SELECT logic_engine_vfs_probe_capture_manifest_identity(?) AS identity').get(dbPath).identity);",
      "const registered = registrar.prepare('SELECT logic_engine_vfs_probe_register_database_role_alias(?, ?, ?, ?, ?, ?, ?, ?) AS registered').get(dbPath, 'core', identity.databaseIdentity.volumeSerial, identity.databaseIdentity.fileId, identity.parentIdentity.volumeSerial, identity.parentIdentity.fileId, path.basename(dbPath), dbPath).registered;",
      "assert.equal(registered, 1);",
      "const db = new Database(dbPath);",
      "try { assert.equal(db.prepare('SELECT COUNT(*) AS count FROM origin').get().count, 2, 'recovery must discard uncommitted rows'); assert.equal(db.pragma('integrity_check', { simple: true }), 'ok'); db.pragma('wal_checkpoint(TRUNCATE)'); assert.equal(db.pragma('journal_mode = DELETE', { simple: true }), 'delete'); } finally { db.close(); registrar.close(); }"
    ].join('\n');
    const recovered = spawnSync(process.execPath, ['-e', recoveryScript], { encoding: 'utf8', env: process.env, timeout: 60000 });
    assert.equal(recovered.status, 0, 'a new process must recover the handle-relative WAL cleanly: ' + String(recovered.stderr || recovered.error || recovered.status));
    assert.ok(registrar.prepare(
      'SELECT logic_engine_vfs_probe_delete_file_hook_count() AS count'
    ).get().count > 0, 'SQLite sidecar deletion must use the handle-relative delete hook');
    for (const suffix of ['-journal', '-wal', '-shm']) {
      assert.equal(fs.existsSync(databasePath + suffix), false,
        'sidecars should be retired before the main-file replacement test');
    }

    // Replace the main DB name after the VFS pinned the original parent and
    // recorded the original file identity. The replacement is a valid but
    // attacker-controlled SQLite DB at the same pathname.
    fs.renameSync(databasePath, pinnedDatabasePath);
    fs.copyFileSync(attackerSeedPath, databasePath);
    assert.equal(
      crypto.createHash('sha256').update(fs.readFileSync(databasePath)).digest('hex'),
      attackerHash,
      'the replacement pathname must contain the attacker decoy before SQLite reopens',
    );
    assert.throws(
      () => new Database(databasePath),
      (error) => /^SQLITE_CANTOPEN/.test(String(error.code)),
      'the VFS must reject the replacement file because its file identity differs from the manifest-bound identity',
    );
    assert.equal(
      crypto.createHash('sha256').update(fs.readFileSync(databasePath)).digest('hex'),
      attackerHash,
      'failed secure open must not modify the attacker decoy',
    );
    registrar.close();
  `;

  const result = spawnSync(process.execPath, ['-e', childSource], {
    encoding: 'utf8',
    env: {
      ...process.env,
      BETTER_SQLITE3_PACKAGE_DIR: packageRoot,
      LOGIC_ENGINE_VFS_PROBE_PATH: extensionPath,
      LOGIC_ENGINE_TEST_DATABASE_PATH: databasePath,
      LOGIC_ENGINE_TEST_PINNED_DATABASE_PATH: pinnedDatabasePath,
      LOGIC_ENGINE_TEST_ATTACKER_SEED_PATH: attackerSeedPath,
      LOGIC_ENGINE_TEST_ATTACKER_HASH: attackerHash,
    },
    timeout: 120000,
  });
  assert.equal(result.status, 0,
    `Windows handle-relative child failed (status=${result.status}, signal=${result.signal})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);

  assert.equal(sha256(databasePath), attackerHash,
    'attacker decoy DB must remain byte-for-byte unchanged');
  const pinned = new Database(pinnedDatabasePath);
  try {
    assert.deepEqual(
      pinned.prepare('SELECT value FROM origin ORDER BY rowid').pluck().all(),
      ['trusted-before-swap', 'trusted-after-swap'],
      'all writes must remain in the original identity-pinned database file',
    );
  } finally {
    pinned.close();
  }
});
