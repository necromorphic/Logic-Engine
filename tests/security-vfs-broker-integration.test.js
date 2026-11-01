import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  chmodSync, existsSync, mkdtempSync, readFileSync, rmSync
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';

const extensionPath = process.env.LOGIC_ENGINE_VFS_PROBE_PATH
  ? resolve(process.env.LOGIC_ENGINE_VFS_PROBE_PATH)
  : null;

test('Linux SQLite VFS obtains main and sidecar descriptors from the authenticated broker', {
  skip: process.platform !== 'linux' || !extensionPath,
}, async (t) => {
  const directory = mkdtempSync(join(homedir(), '.logic-engine-vfs-broker-'));
  chmodSync(directory, 0o700);
  const databasePath = join(directory, 'core.sqlite');
  const socketPath = join(directory, 'broker.sock');
  const logPath = join(directory, 'broker.log');
  const python = process.env.PYTHON ?? 'python3';
  const brokerScript = resolve('native/posix-namespace-broker/test_vfs_fake_server.py');
  const broker = spawn(python, [brokerScript, socketPath, databasePath, logPath, String(process.getuid()), String(process.getgid())], {
    stdio: 'ignore',
  });
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

  const bootstrap = new DatabaseSync(':memory:', { allowExtension: true });
  try {
    bootstrap.loadExtension(extensionPath, 'sqlite3_secure_vfs_probe_init');
    bootstrap.enableLoadExtension(false);
  } finally {
    bootstrap.close();
  }

  const registrar = new DatabaseSync(':memory:');
  t.after(() => registrar.close());
  const registerBrokerRole = () => registrar.prepare(
    'SELECT logic_engine_vfs_probe_register_broker_role(?, ?, ?) AS registered'
  ).get(databasePath, 'core', socketPath).registered;
  const expectedBrokerUid = String(process.getuid());
  delete process.env.LOGIC_ENGINE_BROKER_UID;
  assert.throws(
    registerBrokerRole,
    /expected service UID/i,
    'broker authentication must fail closed when the expected service UID is absent',
  );
  process.env.LOGIC_ENGINE_BROKER_UID = String(process.getuid() + 1);
  assert.throws(
    registerBrokerRole,
    /broker role enrollment handshake failed/i,
    'broker authentication must reject a peer whose UID differs from trusted Host configuration',
  );
  process.env.LOGIC_ENGINE_BROKER_UID = expectedBrokerUid;
  assert.equal(
    registerBrokerRole(),
    1,
    'broker-first enrollment must validate the manifest-owned main file without a local path open',
  );

  const writer = new DatabaseSync(databasePath);
  let reader;
  let readerTransactionActive = false;
  try {
    writer.exec('CREATE TABLE broker_probe(value TEXT);');
    assert.equal(
      writer.prepare('SELECT logic_engine_vfs_probe_broker_backend_io_count() AS count').get().count > 0,
      true,
      'main database byte I/O must use the broker-returned descriptor backend',
    );
    const brokerIoBeforeWal = writer.prepare(
      'SELECT logic_engine_vfs_probe_broker_backend_io_count() AS count'
    ).get().count;
    assert.equal(writer.prepare('PRAGMA journal_mode=WAL').get().journal_mode, 'wal');
    try {
      writer.exec("INSERT INTO broker_probe VALUES('first');");
      assert.equal(
        writer.prepare('SELECT logic_engine_vfs_probe_broker_backend_io_count() AS count').get().count
          > brokerIoBeforeWal,
        true,
        'WAL byte I/O must use the broker-returned descriptor backend, not only broker-mediated xOpen',
      );
    } catch (error) {
      const backendFailures = registrar.prepare(
        'SELECT logic_engine_vfs_probe_broker_backend_open_fail_count() AS count'
      ).get().count;
      const shmDiagnostics = registrar.prepare('SELECT logic_engine_vfs_probe_broker_shm_diagnostics() AS value').get().value;
      const failureDiagnostics = registrar.prepare('SELECT logic_engine_vfs_probe_failure_diagnostics() AS value').get().value;
      const parentOpenDiagnostics = registrar.prepare('SELECT logic_engine_vfs_probe_parent_xopen_diagnostics() AS value').get().value;
      throw new Error(String(error?.message ?? error) + "\\nFailure diagnostics: " +
        failureDiagnostics + "\\nParent xOpen diagnostics: " + parentOpenDiagnostics + "\\nBackend open failures: " + backendFailures +
        "\\nSHM diagnostics: " + shmDiagnostics + "\\nBroker operations:\\n" +
        (existsSync(logPath) ? readFileSync(logPath, 'utf8') : '<no broker log>'));
    }
    reader = new DatabaseSync(databasePath);
    reader.exec('BEGIN; SELECT value FROM broker_probe;');
    readerTransactionActive = true;
    writer.exec("INSERT INTO broker_probe VALUES('second');");
    assert.equal(
      reader.prepare('SELECT count(*) AS count FROM broker_probe').get().count,
      1,
      'the WAL reader must retain its snapshot while a concurrent writer commits',
    );
    assert.equal(
      writer.prepare('SELECT count(*) AS count FROM broker_probe').get().count,
      2,
    );
    reader.exec('COMMIT;');
    readerTransactionActive = false;
    assert.equal(
      reader.prepare('SELECT count(*) AS count FROM broker_probe').get().count,
      2,
      'the reader must observe the committed row after releasing its WAL read lock',
    );
    const shmDiagnostics = writer.prepare(
      'SELECT logic_engine_vfs_probe_broker_shm_diagnostics() AS value'
    ).get().value;
    assert.equal(Math.floor(shmDiagnostics / 1_000_000) > 0, true,
      'SQLite must map the broker-provisioned SHM file');
    assert.equal(Math.floor((shmDiagnostics % 1_000_000) / 1_000), 0,
      'SHM mapping must not fail');
    assert.equal(shmDiagnostics % 1_000 > 0, true,
      'the SHM file must be opened through the broker syscall hook');
    const shmLockDiagnostics = writer.prepare(
      'SELECT logic_engine_vfs_probe_broker_shm_lock_diagnostics() AS value'
    ).get().value;
    assert.equal(Math.floor(shmLockDiagnostics / 1_000) > 0, true,
      'SQLite WAL read/write locks must exercise the SHM locking interface');
    assert.equal(shmLockDiagnostics % 1_000, 0,
      'the delegated SQLite SHM lock operations must succeed');
    assert.equal(existsSync(databasePath + '-wal'), true);
    assert.equal(existsSync(databasePath + '-shm'), true);
    assert.equal(
      writer.prepare('SELECT logic_engine_vfs_probe_wal_open_count() AS count').get().count > 0,
      true,
      'WAL must be opened through the broker descriptor path',
    );
  } finally {
    if (readerTransactionActive) reader?.exec('ROLLBACK;');
    reader?.close();
    writer.close();
  }

  const reopened = new DatabaseSync(databasePath);
  try {
    try {
      assert.equal(reopened.prepare('PRAGMA journal_mode=DELETE').get().journal_mode, 'delete');
    } catch (error) {
      const shmDiagnostics = registrar.prepare(
        'SELECT logic_engine_vfs_probe_broker_shm_diagnostics() AS value'
      ).get().value;
      const failureDiagnostics = registrar.prepare(
        'SELECT logic_engine_vfs_probe_failure_diagnostics() AS value'
      ).get().value;
      throw new Error(String(error?.message ?? error) + "\\nSHM diagnostics: " +
        shmDiagnostics + "\\nFailure diagnostics: " + failureDiagnostics + "\\nBroker operations:\\n" +
        (existsSync(logPath) ? readFileSync(logPath, 'utf8') : '<no broker log>'));
    }
    assert.equal(reopened.prepare('PRAGMA journal_mode=WAL').get().journal_mode, 'wal');
    reopened.exec("INSERT INTO broker_probe VALUES('after-recreate');");
  } finally {
    reopened.close();
  }

  // Crash a separate process with an uncommitted WAL transaction, then
  // reopen through the same broker and verify SQLite recovery preserves only
  // committed rows. process.exit intentionally bypasses DatabaseSync.close().
  const crashScript = `
    const { DatabaseSync } = require('node:sqlite');
    const { statSync } = require('node:fs');
    const bootstrap = new DatabaseSync(':memory:', { allowExtension: true });
    bootstrap.loadExtension(${JSON.stringify(extensionPath)}, 'sqlite3_secure_vfs_probe_init');
    bootstrap.enableLoadExtension(false);
    bootstrap.close();
    const registrar = new DatabaseSync(':memory:');
    const registered = registrar.prepare(
      'SELECT logic_engine_vfs_probe_register_broker_role(?, ?, ?) AS registered'
    ).get(${JSON.stringify(databasePath)}, 'core', ${JSON.stringify(socketPath)}).registered;
    if (registered !== 1) process.exit(21);
    const db = new DatabaseSync(${JSON.stringify(databasePath)});
    db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; PRAGMA cache_size=1; BEGIN IMMEDIATE;');
    const insert = db.prepare('INSERT INTO broker_probe VALUES (?)');
    for (let i = 0; i < 64; i += 1) {
      insert.run('uncommitted-crash-row-' + i + '-' + 'x'.repeat(512));
    }
    const wal = statSync(${JSON.stringify(databasePath + '-wal')});
    if (wal.size <= 32) process.exit(22);
    process.exit(0);
  `;
  const crashed = spawn(process.execPath, ['--experimental-sqlite', '-e', crashScript], {
    stdio: 'ignore',
  });
  const [crashCode] = await once(crashed, 'exit');
  assert.equal(crashCode, 0, 'child must exit abruptly after writing uncommitted WAL frames');

  const recovered = new DatabaseSync(databasePath);
  try {
    assert.equal(
      recovered.prepare('SELECT count(*) AS count FROM broker_probe').get().count,
      3,
      'crash recovery must discard the uncommitted row and preserve committed transactions',
    );
    assert.equal(
      recovered.prepare('PRAGMA integrity_check').get().integrity_check,
      'ok',
      'the recovered broker-backed database must pass integrity_check',
    );
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
