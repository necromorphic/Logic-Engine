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

test('Windows secure VFS keeps main DB and SQLite sidecars anchored after parent-path replacement', {
  skip: process.platform !== 'win32' || !packageRoot || !extensionPath,
}, (t) => {
  const Database = require(packageRoot);
  const tempBase = process.env.RUNNER_TEMP || os.tmpdir();
  const root = fs.mkdtempSync(path.join(tempBase, 'logic-engine-win-handle-relative-'));
  const protectedDir = path.join(root, 'protected');
  const attackerSeedDir = path.join(root, 'attacker-seed');
  const pinnedRoot = root + '-pinned';
  const attackerDir = path.join(root, 'protected');
  fs.mkdirSync(protectedDir);
  fs.mkdirSync(attackerSeedDir);
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(pinnedRoot, { recursive: true, force: true });
  });

  const databasePath = path.join(protectedDir, 'vectors.sqlite');
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
  const pinnedAttackerSeedPath = path.join(pinnedRoot, 'attacker-seed', 'vectors.sqlite');

  const childSource = String.raw`
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const path = require('node:path');
    const Database = require(process.env.BETTER_SQLITE3_PACKAGE_DIR);
    const databasePath = process.env.LOGIC_ENGINE_TEST_DATABASE_PATH;
    const pinnedRoot = process.env.LOGIC_ENGINE_TEST_PINNED_ROOT;
    const attackerDir = process.env.LOGIC_ENGINE_TEST_ATTACKER_DIR;
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

    // Replace an ancestor of the pinned DB directory. The retained parent
    // HANDLE points into the renamed tree; the old absolute path now resolves
    // to a newly-created attacker directory containing a decoy DB.
    const root = path.dirname(path.dirname(databasePath));
    fs.renameSync(root, pinnedRoot);
    fs.mkdirSync(root);
    fs.mkdirSync(attackerDir);
    const attackerPath = path.join(attackerDir, path.basename(databasePath));
    fs.copyFileSync(attackerSeedPath, attackerPath);
    assert.equal(
      require('node:crypto').createHash('sha256').update(fs.readFileSync(attackerPath)).digest('hex'),
      attackerHash,
      'the replacement path must contain the attacker decoy before SQLite opens',
    );

    const writer = new Database(databasePath);
    let reader;
    try {
      assert.deepEqual(
        writer.prepare('SELECT value FROM origin').pluck().all(),
        ['trusted-before-swap'],
        'SQLite must open the original DB through the pinned directory HANDLE, not the replacement directory',
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
    assert.equal(fs.existsSync(path.join(attackerDir, 'vectors.sqlite-wal')), false);
    assert.equal(fs.existsSync(path.join(attackerDir, 'vectors.sqlite-shm')), false);
    assert.equal(fs.existsSync(path.join(attackerDir, 'vectors.sqlite-journal')), false);
    registrar.close();
  `;

  const result = spawnSync(process.execPath, ['-e', childSource], {
    encoding: 'utf8',
    env: {
      ...process.env,
      BETTER_SQLITE3_PACKAGE_DIR: packageRoot,
      LOGIC_ENGINE_VFS_PROBE_PATH: extensionPath,
      LOGIC_ENGINE_TEST_DATABASE_PATH: databasePath,
      LOGIC_ENGINE_TEST_PINNED_ROOT: pinnedRoot,
      LOGIC_ENGINE_TEST_ATTACKER_DIR: attackerDir,
      LOGIC_ENGINE_TEST_ATTACKER_SEED_PATH: pinnedAttackerSeedPath,
      LOGIC_ENGINE_TEST_ATTACKER_HASH: attackerHash,
    },
    timeout: 120000,
  });
  assert.equal(result.status, 0,
    `Windows handle-relative child failed (status=${result.status}, signal=${result.signal})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);

  const attackerPath = path.join(attackerDir, 'vectors.sqlite');
  assert.equal(sha256(attackerPath), attackerHash,
    'attacker decoy DB must remain byte-for-byte unchanged');
  const pinned = new Database(path.join(pinnedRoot, 'protected', 'vectors.sqlite'));
  try {
    assert.deepEqual(
      pinned.prepare('SELECT value FROM origin ORDER BY rowid').pluck().all(),
      ['trusted-before-swap', 'trusted-after-swap'],
      'all writes must land in the original pinned database directory',
    );
  } finally {
    pinned.close();
  }
});
