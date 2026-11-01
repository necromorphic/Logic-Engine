import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, openSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const packageRoot = process.env.BETTER_SQLITE3_PACKAGE_DIR;
const extensionPath = process.env.LOGIC_ENGINE_VFS_PROBE_PATH;
const databasePath = process.env.LOGIC_ENGINE_DATABASE_PATH;
const socketPath = process.env.LOGIC_ENGINE_BROKER_SOCKET;
const protectedRoleParent = process.env.LOGIC_ENGINE_PROTECTED_ROLE_PARENT;

test('distinct-UID broker protects better-sqlite3 main, journal, WAL and SHM files', {
  skip: process.platform !== 'linux' || !packageRoot || !extensionPath
    || !databasePath || !socketPath || !protectedRoleParent,
}, async () => {
  const Database = require(packageRoot);
  assert.equal(Number(process.versions.napi) >= 10, true);
  assert.equal(process.getuid(), Number(process.env.LOGIC_ENGINE_APP_UID));
  assert.notEqual(process.getuid(), Number(process.env.LOGIC_ENGINE_BROKER_UID));
  assert.equal(process.getgid(), Number(process.env.LOGIC_ENGINE_APP_GID));

  assert.equal(existsSync(path.dirname(databasePath)), true,
    'better-sqlite3 requires an app-visible directory for its JS constructor check');
  assert.equal(existsSync(databasePath), false,
    'the app-visible logical DB alias must not contain a database file');
  assert.throws(() => openSync(databasePath, 'w'), { code: 'EACCES' },
    'the application UID must not create or replace the logical DB alias');

  // The app receives file descriptors only. It cannot open, enumerate, or
  // mutate the broker-owned role directory through a pathname, and the broker
  // protocol no longer has an operation that exports a parent directory FD.
  assert.throws(() => openSync(protectedRoleParent, 'r'), { code: 'EACCES' },
    'the application UID must not obtain a role-parent directory descriptor');
  assert.throws(() => mkdirSync(path.join(protectedRoleParent, 'app-created')),
    { code: 'EACCES' },
    'the application UID must not create entries in the protected role namespace');
  assert.throws(() => openSync(path.join(protectedRoleParent, 'vectors.sqlite'), 'w'),
    { code: 'EACCES' },
    'the application UID must not open the protected main DB by pathname');
  assert.throws(() => unlinkSync(path.join(protectedRoleParent, 'vectors.sqlite')),
    { code: 'EACCES' },
    'the application UID must not unlink the protected main DB by pathname');
  assert.throws(() => renameSync(path.join(protectedRoleParent, 'vectors.sqlite'),
    path.join(protectedRoleParent, 'renamed.sqlite')),
    { code: 'EACCES' },
    'the application UID must not rename files in the protected role namespace');

  const bootstrap = new Database(':memory:');
  try {
    bootstrap.loadExtension(extensionPath, 'sqlite3_secure_vfs_probe_init');
  } finally {
    bootstrap.close();
  }

  const registrar = new Database(':memory:');
  try {
    assert.throws(
      () => registrar.prepare(
        'SELECT logic_engine_vfs_probe_register_broker_role(?, ?, ?) AS registered',
      ),
      /no such function/,
      'production VFS must not expose caller-controlled SQL role/path/socket enrollment',
    );
    const registerRole = registrar.prepare(
      'SELECT logic_engine_vfs_probe_register_broker_role_from_host() AS registered',
    );
    const expectedBrokerUid = process.env.LOGIC_ENGINE_BROKER_UID;
    assert.ok(expectedBrokerUid, 'Host must provide the trusted broker UID');

    // A caller-controlled broker socket owned by another UID must not be
    // accepted even if it has a matching filesystem layout and protocol.
    process.env.LOGIC_ENGINE_BROKER_UID = process.env.LOGIC_ENGINE_APP_UID;
    assert.throws(
      () => registerRole.get(),
      /broker role enrollment handshake failed/,
      'VFS must reject a broker whose SO_PEERCRED UID differs from Host-pinned identity',
    );
    process.env.LOGIC_ENGINE_BROKER_UID = expectedBrokerUid;

    assert.equal(
      registerRole.get().registered,
      1,
      'broker enrollment must return the main DB identity without application path access',
    );
  } finally {
    registrar.close();
  }

  const writer = new Database(databasePath);
  assert.equal(existsSync(databasePath), false,
    'secure VFS open must not create a plaintext file at the logical alias path');
  let reader;
  let readerTransactionActive = false;
  try {
    // Mirror the actual ST-VectorService startup PRAGMAs and SQLite schema.
    assert.equal(writer.pragma('journal_mode = WAL', { simple: true }), 'wal');
    writer.pragma('synchronous = NORMAL');
    writer.pragma('busy_timeout = 10000');
    writer.pragma('temp_store = MEMORY');
    writer.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        source TEXT NOT NULL,
        collection_id TEXT NOT NULL,
        model TEXT NOT NULL,
        id TEXT NOT NULL,
        hash REAL,
        text TEXT,
        item_index INTEGER,
        metadata TEXT NOT NULL,
        vector TEXT NOT NULL,
        PRIMARY KEY (source, collection_id, model, id)
      );
      CREATE INDEX IF NOT EXISTS idx_vectors_hash
        ON vectors(source, collection_id, model, hash);
      CREATE TABLE IF NOT EXISTS migration_state (
        name TEXT PRIMARY KEY,
        completed INTEGER NOT NULL
      );
      CREATE TABLE broker_probe(value TEXT);
    `);
    writer.prepare(`
      INSERT INTO vectors
        (source, collection_id, model, id, hash, text, item_index, metadata, vector)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('memory', 'default', 'bge-m3', 'item-1', 0.25, 'ST vector row', 0, '{}', '[0.1,0.2]');
    assert.equal(writer.prepare(
      'SELECT text FROM vectors WHERE source = ? AND collection_id = ? AND model = ? AND id = ?'
    ).get('memory', 'default', 'bge-m3', 'item-1').text, 'ST vector row');
    assert.ok(
      writer.prepare('SELECT logic_engine_vfs_probe_broker_backend_io_count() AS count').get().count > 0,
      'main DB byte I/O must use broker-returned descriptors',
    );
    assert.ok(
      writer.prepare('SELECT logic_engine_vfs_probe_journal_open_count() AS count').get().count > 0,
      'rollback journal must be opened through the secure VFS',
    );

    const ioBeforeWal = writer.prepare(
      'SELECT logic_engine_vfs_probe_broker_backend_io_count() AS count',
    ).get().count;
    assert.equal(writer.pragma('journal_mode = WAL', { simple: true }), 'wal');
    writer.prepare('INSERT INTO broker_probe VALUES (?)').run('first');
    assert.ok(
      writer.prepare('SELECT logic_engine_vfs_probe_broker_backend_io_count() AS count').get().count
        > ioBeforeWal,
      'WAL byte I/O must use broker-returned descriptors',
    );

    reader = new Database(databasePath);
    reader.exec('BEGIN;');
    reader.prepare('SELECT value FROM broker_probe').all();
    readerTransactionActive = true;
    writer.prepare('INSERT INTO broker_probe VALUES (?)').run('second');
    assert.equal(reader.prepare('SELECT count(*) AS count FROM broker_probe').get().count, 1);
    assert.equal(writer.prepare('SELECT count(*) AS count FROM broker_probe').get().count, 2);
    reader.exec('COMMIT;');
    readerTransactionActive = false;
    assert.equal(reader.prepare('SELECT count(*) AS count FROM broker_probe').get().count, 2);

    const shm = writer.prepare(
      'SELECT logic_engine_vfs_probe_broker_shm_diagnostics() AS value',
    ).get().value;
    assert.ok(Math.floor(shm / 1_000_000) > 0, 'SQLite must map the protected SHM file');
    assert.equal(Math.floor((shm % 1_000_000) / 1_000), 0, 'SHM map must not fail');
    assert.ok(shm % 1_000 > 0, 'SHM open must use the broker descriptor path');
    const locks = writer.prepare(
      'SELECT logic_engine_vfs_probe_broker_shm_lock_diagnostics() AS value',
    ).get().value;
    assert.ok(Math.floor(locks / 1_000) > 0, 'WAL shared-memory locks must be exercised');
    assert.equal(locks % 1_000, 0, 'broker-backed SHM locks must succeed');
  } finally {
    if (readerTransactionActive) reader?.exec('ROLLBACK;');
    reader?.close();
    writer.close();
  }

  const crashScript = `
    const Database = require(process.env.BETTER_SQLITE3_PACKAGE_DIR);
    const bootstrap = new Database(':memory:');
    bootstrap.loadExtension(process.env.LOGIC_ENGINE_VFS_PROBE_PATH, 'sqlite3_secure_vfs_probe_init');
    bootstrap.close();
    const registrar = new Database(':memory:');
    const registered = registrar.prepare(
      'SELECT logic_engine_vfs_probe_register_broker_role(?, ?, ?) AS registered'
    ).get(process.env.LOGIC_ENGINE_DATABASE_PATH, 'vectors',
      process.env.LOGIC_ENGINE_BROKER_SOCKET).registered;
    if (registered !== 1) process.exit(21);
    const db = new Database(process.env.LOGIC_ENGINE_DATABASE_PATH);
    db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; PRAGMA cache_size=1; BEGIN IMMEDIATE;');
    const ioBefore = db.prepare(
      'SELECT logic_engine_vfs_probe_broker_backend_io_count() AS count'
    ).get().count;
    const insert = db.prepare('INSERT INTO broker_probe VALUES (?)');
    for (let i = 0; i < 64; i += 1) {
      insert.run('uncommitted-crash-row-' + i + '-' + 'x'.repeat(512));
    }
    const ioAfter = db.prepare(
      'SELECT logic_engine_vfs_probe_broker_backend_io_count() AS count'
    ).get().count;
    if (ioAfter <= ioBefore) process.exit(22);
    if (db.prepare('SELECT logic_engine_vfs_probe_wal_open_count() AS count').get().count < 1) {
      process.exit(23);
    }
    process.exit(0);
  `;
  const crashed = spawn(process.execPath, ['-e', crashScript], {
    stdio: 'ignore',
    env: process.env,
  });
  const [exitCode] = await once(crashed, 'exit');
  assert.equal(exitCode, 0, 'app child must exit abruptly with uncommitted broker-backed WAL frames');
});
