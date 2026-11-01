import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const packageRoot = process.env.BETTER_SQLITE3_PACKAGE_DIR;
const extensionPath = process.env.LOGIC_ENGINE_VFS_PROBE_PATH;

test('better-sqlite3 uses brokered main, journal, WAL and SHM descriptors with crash recovery', {
  skip: process.platform !== 'linux' || !packageRoot || !extensionPath,
}, async (t) => {
  const Database = require(packageRoot);
  const directory = mkdtempSync(path.join(os.tmpdir(), 'logic-engine-better-sqlite3-broker-'));
  chmodSync(directory, 0o700);
  const databasePath = path.join(directory, 'core.sqlite');
  const socketPath = path.join(directory, 'broker.sock');
  const logPath = path.join(directory, 'broker.log');
  const python = process.env.PYTHON ?? 'python3';
  const brokerScript = path.resolve('native/posix-namespace-broker/test_vfs_fake_server.py');
  const broker = spawn(python, [
    brokerScript, socketPath, databasePath, logPath,
    String(process.getuid()), String(process.getgid()),
  ], { stdio: 'ignore' });

  t.after(async () => {
    if (broker.exitCode === null && !broker.killed) {
      const exited = once(broker, 'exit');
      broker.kill('SIGTERM');
      await Promise.race([exited, delay(1000)]);
      if (broker.exitCode === null) {
        const forcedExit = once(broker, 'exit');
        broker.kill('SIGKILL');
        await forcedExit;
      }
    }
    rmSync(directory, { recursive: true, force: true });
  });

  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (existsSync(socketPath)) {
      ready = true;
      break;
    }
    if (broker.exitCode !== null) {
      throw new Error('test broker exited before creating its socket (' + broker.exitCode + ')');
    }
    await delay(20);
  }
  assert.equal(ready, true, 'test broker must create its Unix seqpacket socket');

  // The fake broker runs under this test process UID. Production Host
  // configuration supplies the distinct service UID; pin the expected peer
  // explicitly so SO_PEERCRED is never accepted implicitly.
  const previousBrokerUid = process.env.LOGIC_ENGINE_BROKER_UID;
  process.env.LOGIC_ENGINE_BROKER_UID = String(process.getuid());
  t.after(() => {
    if (previousBrokerUid === undefined) delete process.env.LOGIC_ENGINE_BROKER_UID;
    else process.env.LOGIC_ENGINE_BROKER_UID = previousBrokerUid;
  });

  const bootstrap = new Database(':memory:');
  try {
    bootstrap.loadExtension(path.resolve(extensionPath), 'sqlite3_secure_vfs_probe_init');
  } finally {
    bootstrap.close();
  }

  const registrar = new Database(':memory:');
  t.after(() => { if (registrar.open) registrar.close(); });
  const enroll = () => registrar.prepare(
    'SELECT logic_engine_vfs_probe_register_broker_role(?, ?, ?) AS registered',
  ).get(databasePath, 'core', socketPath).registered;
  assert.equal(enroll(), 1, 'broker-first enrollment must validate the main DB before any local path open');

  assert.throws(
    () => registrar.prepare(
      'SELECT logic_engine_vfs_probe_delete_registered_role(?)',
    ).get(databasePath),
    /SQLITE_IOERR_DELETE|disk I\/O error|unable to delete/i,
    'the application VFS must not delete a main DB through runtime xDelete',
  );
  assert.equal(existsSync(databasePath), true,
    'main DB deletion must remain available only through the offline broker-identity lifecycle');

  const writer = new Database(databasePath);
  let reader;
  let readerTransactionActive = false;
  try {
    writer.exec('CREATE TABLE broker_probe(value TEXT);');
    assert.ok(
      writer.prepare('SELECT logic_engine_vfs_probe_broker_backend_io_count() AS count').get().count > 0,
      'main database byte I/O must use the broker-returned descriptor backend',
    );
    assert.ok(
      writer.prepare('SELECT logic_engine_vfs_probe_journal_open_count() AS count').get().count > 0,
      'rollback-journal open must use the registered secure VFS',
    );

    const brokerIoBeforeWal = writer.prepare(
      'SELECT logic_engine_vfs_probe_broker_backend_io_count() AS count',
    ).get().count;
    assert.equal(writer.pragma('journal_mode = WAL', { simple: true }), 'wal');
    writer.prepare('INSERT INTO broker_probe VALUES (?)').run('first');
    assert.ok(
      writer.prepare('SELECT logic_engine_vfs_probe_broker_backend_io_count() AS count').get().count
        > brokerIoBeforeWal,
      'WAL byte I/O must use broker-returned descriptors, not only broker-mediated xOpen',
    );

    reader = new Database(databasePath);
    reader.exec('BEGIN;');
    reader.prepare('SELECT value FROM broker_probe').all();
    readerTransactionActive = true;
    writer.prepare('INSERT INTO broker_probe VALUES (?)').run('second');
    assert.equal(
      reader.prepare('SELECT count(*) AS count FROM broker_probe').get().count,
      1,
      'the WAL reader must retain its snapshot while a concurrent writer commits',
    );
    assert.equal(writer.prepare('SELECT count(*) AS count FROM broker_probe').get().count, 2);
    reader.exec('COMMIT;');
    readerTransactionActive = false;
    assert.equal(
      reader.prepare('SELECT count(*) AS count FROM broker_probe').get().count,
      2,
      'the reader must observe the committed row after releasing its WAL read lock',
    );

    const shmDiagnostics = writer.prepare(
      'SELECT logic_engine_vfs_probe_broker_shm_diagnostics() AS value',
    ).get().value;
    assert.ok(Math.floor(shmDiagnostics / 1_000_000) > 0,
      'SQLite must map the broker-provisioned SHM file');
    assert.equal(Math.floor((shmDiagnostics % 1_000_000) / 1_000), 0,
      'SHM mapping must not fail');
    assert.ok(shmDiagnostics % 1_000 > 0,
      'the SHM file must be opened through the broker syscall hook');
    const shmLockDiagnostics = writer.prepare(
      'SELECT logic_engine_vfs_probe_broker_shm_lock_diagnostics() AS value',
    ).get().value;
    assert.ok(Math.floor(shmLockDiagnostics / 1_000) > 0,
      'SQLite WAL read/write locks must exercise the SHM locking interface');
    assert.equal(shmLockDiagnostics % 1_000, 0,
      'delegated SQLite SHM lock operations must succeed');
    assert.equal(existsSync(databasePath + '-wal'), true);
    assert.equal(existsSync(databasePath + '-shm'), true);
    assert.ok(
      writer.prepare('SELECT logic_engine_vfs_probe_wal_open_count() AS count').get().count > 0,
      'WAL must be opened through the broker descriptor path',
    );
  } catch (error) {
    const failureDiagnostics = registrar.prepare(
      'SELECT logic_engine_vfs_probe_failure_diagnostics() AS value',
    ).get().value;
    const parentOpenDiagnostics = registrar.prepare(
      'SELECT logic_engine_vfs_probe_parent_xopen_diagnostics() AS value',
    ).get().value;
    const shmDiagnostics = registrar.prepare(
      'SELECT logic_engine_vfs_probe_broker_shm_diagnostics() AS value',
    ).get().value;
    throw new Error(String(error?.message ?? error) + '\\nFailure diagnostics: ' +
      failureDiagnostics + '\\nParent xOpen diagnostics: ' + parentOpenDiagnostics +
      '\\nSHM diagnostics: ' + shmDiagnostics + '\\nBroker operations:\\n' +
      (existsSync(logPath) ? readFileSync(logPath, 'utf8') : '<no broker log>'));
  } finally {
    if (readerTransactionActive) reader?.exec('ROLLBACK;');
    reader?.close();
    writer.close();
  }

  const reopened = new Database(databasePath);
  try {
    assert.equal(reopened.pragma('journal_mode = DELETE', { simple: true }), 'delete');
    assert.equal(reopened.pragma('journal_mode = WAL', { simple: true }), 'wal');
    reopened.prepare('INSERT INTO broker_probe VALUES (?)').run('after-recreate');
  } finally {
    reopened.close();
  }

  // Crash a separate process with an uncommitted WAL transaction, then
  // reopen through the same broker and verify SQLite discards uncommitted rows.
  const crashScript = `
    const Database = require(process.env.BETTER_SQLITE3_PACKAGE_DIR);
    const { statSync } = require('node:fs');
    const bootstrap = new Database(':memory:');
    bootstrap.loadExtension(process.env.LOGIC_ENGINE_VFS_PROBE_PATH, 'sqlite3_secure_vfs_probe_init');
    bootstrap.close();
    const registrar = new Database(':memory:');
    const registered = registrar.prepare(
      'SELECT logic_engine_vfs_probe_register_broker_role(?, ?, ?) AS registered'
    ).get(${JSON.stringify(databasePath)}, 'core', ${JSON.stringify(socketPath)}).registered;
    if (registered !== 1) process.exit(21);
    const db = new Database(${JSON.stringify(databasePath)});
    db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; PRAGMA cache_size=1; BEGIN IMMEDIATE;');
    const insert = db.prepare('INSERT INTO broker_probe VALUES (?)');
    for (let i = 0; i < 64; i += 1) {
      insert.run('uncommitted-crash-row-' + i + '-' + 'x'.repeat(512));
    }
    const wal = statSync(${JSON.stringify(databasePath + '-wal')});
    if (wal.size <= 32) process.exit(22);
    process.exit(0);
  `;
  const crashed = spawn(process.execPath, ['-e', crashScript], {
    stdio: 'ignore',
    env: {
      ...process.env,
      BETTER_SQLITE3_PACKAGE_DIR: packageRoot,
      LOGIC_ENGINE_VFS_PROBE_PATH: path.resolve(extensionPath),
    },
  });
  const [crashCode] = await once(crashed, 'exit');
  assert.equal(crashCode, 0, 'child must exit abruptly after writing uncommitted WAL frames');

  const recovered = new Database(databasePath);
  try {
    assert.equal(
      recovered.prepare('SELECT count(*) AS count FROM broker_probe').get().count,
      3,
      'crash recovery must discard the uncommitted row and preserve committed transactions',
    );
    assert.equal(recovered.pragma('integrity_check', { simple: true }), 'ok',
      'the recovered broker-backed database must pass integrity_check');
  } finally {
    recovered.close();
  }

  const operations = readFileSync(logPath, 'utf8');
  assert.match(operations, /open:core:main/,
    'the broker must provide the main database descriptor');
  assert.match(operations, /open-or-create:core:wal/,
    'the broker must durably provision the WAL sidecar');
  assert.match(operations, /open-or-create:core:shm/,
    'the broker must provision the SHM sidecar used by SQLite locking');
  assert.match(operations, /delete:core:(wal|shm)/,
    'SQLite sidecar teardown must be mediated by the broker');
});
