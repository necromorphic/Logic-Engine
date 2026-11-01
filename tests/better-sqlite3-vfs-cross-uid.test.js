import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { openSync, closeSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const packageRoot = process.env.BETTER_SQLITE3_PACKAGE_DIR;
const extensionPath = process.env.LOGIC_ENGINE_VFS_PROBE_PATH;
const databasePath = process.env.LOGIC_ENGINE_DATABASE_PATH;
const socketPath = process.env.LOGIC_ENGINE_BROKER_SOCKET;

test('distinct-UID broker protects better-sqlite3 main, journal, WAL and SHM files', {
  skip: process.platform !== 'linux' || !packageRoot || !extensionPath
    || !databasePath || !socketPath,
}, async () => {
  const Database = require(packageRoot);
  assert.equal(Number(process.versions.napi) >= 10, true);
  assert.notEqual(process.getuid(), Number(process.env.LOGIC_ENGINE_BROKER_UID));
  assert.equal(process.getgid(), Number(process.env.LOGIC_ENGINE_APP_GID));

  assert.throws(() => {
    const fd = openSync(databasePath, 'r');
    closeSync(fd);
  }, { code: 'EACCES' }, 'the application UID must not open the protected DB by pathname');

  const bootstrap = new Database(':memory:');
  try {
    bootstrap.loadExtension(extensionPath, 'sqlite3_secure_vfs_probe_init');
  } finally {
    bootstrap.close();
  }

  const registrar = new Database(':memory:');
  try {
    assert.equal(
      registrar.prepare(
        'SELECT logic_engine_vfs_probe_register_broker_role(?, ?, ?) AS registered',
      ).get(databasePath, 'core', socketPath).registered,
      1,
      'broker enrollment must return the main DB identity without application path access',
    );
  } finally {
    registrar.close();
  }

  const writer = new Database(databasePath);
  let reader;
  let readerTransactionActive = false;
  try {
    writer.exec('CREATE TABLE broker_probe(value TEXT);');
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
    ).get(process.env.LOGIC_ENGINE_DATABASE_PATH, 'core',
      process.env.LOGIC_ENGINE_BROKER_SOCKET).registered;
    if (registered !== 1) process.exit(21);
    const db = new Database(process.env.LOGIC_ENGINE_DATABASE_PATH);
    db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; PRAGMA cache_size=1; BEGIN IMMEDIATE;');
    const insert = db.prepare('INSERT INTO broker_probe VALUES (?)');
    for (let i = 0; i < 64; i += 1) {
      insert.run('uncommitted-crash-row-' + i + '-' + 'x'.repeat(512));
    }
    if (db.prepare('SELECT logic_engine_vfs_probe_wal_open_count() AS count').get().count < 1) {
      process.exit(22);
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
