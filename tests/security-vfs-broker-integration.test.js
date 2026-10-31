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
  const broker = spawn(python, [brokerScript, socketPath, databasePath, logPath], {
    stdio: 'ignore',
  });
  t.after(async () => {
    if (broker.exitCode === null && !broker.killed) {
      broker.kill('SIGTERM');
      await Promise.race([once(broker, 'exit'), delay(1000)]);
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

  const bootstrap = new DatabaseSync(':memory:', { allowExtension: true });
  try {
    bootstrap.loadExtension(extensionPath, 'sqlite3_secure_vfs_probe_init');
    bootstrap.enableLoadExtension(false);
  } finally {
    bootstrap.close();
  }

  const registrar = new DatabaseSync(':memory:');
  t.after(() => registrar.close());
  registrar.prepare(
    'SELECT logic_engine_vfs_probe_register_database_role(?, ?) AS registered'
  ).get(databasePath, 'core');
  assert.equal(
    registrar.prepare(
      'SELECT logic_engine_vfs_probe_bind_broker(?, ?) AS bound'
    ).get('core', socketPath).bound,
    1,
    'role binding must complete a broker-authenticated main-file identity handshake',
  );

  const writer = new DatabaseSync(databasePath);
  let reader;
  try {
    writer.exec('CREATE TABLE broker_probe(value TEXT);');
    assert.equal(writer.prepare('PRAGMA journal_mode=WAL').get().journal_mode, 'wal');
    writer.exec("INSERT INTO broker_probe VALUES('first');");
    reader = new DatabaseSync(databasePath);
    reader.exec('BEGIN; SELECT value FROM broker_probe;');
    writer.exec("INSERT INTO broker_probe VALUES('second');");
    assert.equal(
      writer.prepare('SELECT count(*) AS count FROM broker_probe').get().count,
      2,
    );
    assert.equal(existsSync(databasePath + '-wal'), true);
    assert.equal(existsSync(databasePath + '-shm'), true);
    assert.equal(
      writer.prepare('SELECT logic_engine_vfs_probe_wal_open_count() AS count').get().count > 0,
      true,
      'WAL must be opened through the broker descriptor path',
    );
  } finally {
    reader?.exec('ROLLBACK;');
    reader?.close();
    writer.close();
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
