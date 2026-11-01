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
        'SELECT logic_engine_vfs_probe_main_db_open_count() AS count'
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
