import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const extensionPath = process.env.LOGIC_ENGINE_VFS_PROBE_PATH;

test('Node 22.13 node:sqlite keeps a loadable default VFS registered after bootstrap closes', {
  // The full npm test suite runs in a separate job without the native probe artifact.
  // This test is exercised explicitly by the Linux/Windows VFS probe workflow jobs.
  skip: !extensionPath,
}, (t) => {
  assert.equal(typeof extensionPath, 'string', 'workflow must build the platform VFS probe first');
  assert.equal(process.versions.node, '22.13.0', 'the private SQLite VFS ABI probe is pinned to Node 22.13.0');

  const directory = mkdtempSync(join(tmpdir(), 'logic-engine-vfs-probe-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const bootstrap = new DatabaseSync(':memory:', { allowExtension: true });
  try {
    bootstrap.loadExtension(extensionPath, 'sqlite3_secure_vfs_probe_init');
    bootstrap.enableLoadExtension(false);
  } finally {
    bootstrap.close();
  }

  const corePath = join(directory, 'core.sqlite');
  const first = new DatabaseSync(corePath);
  let reader;
  try {
    assert.equal(first.prepare('SELECT sqlite_version() AS version').get().version, '3.47.2',
      'the native VFS ABI probe is pinned to the SQLite version bundled with Node 22.13.0');
    first.exec("PRAGMA journal_mode=WAL; CREATE TABLE probe(value TEXT); INSERT INTO probe VALUES('ok');");
    assert.equal(first.prepare('SELECT value FROM probe').get().value, 'ok');
    const opened = first.prepare('SELECT logic_engine_vfs_probe_open_count() AS count').get().count;
    assert.equal(opened, 1, 'the first file-backed DatabaseSync must pass through the registered VFS xOpen');

    // Keep a reader transaction open while the writer appends another WAL frame.
    // This makes the WAL and SHM sidecars observable before the connections close.
    reader = new DatabaseSync(corePath);
    reader.exec('BEGIN; SELECT value FROM probe;');
    first.exec("INSERT INTO probe VALUES('wal-sidecar');");
    assert.equal(existsSync(`${corePath}-wal`), true,
      'WAL sidecar must exist while concurrent connections are active');
    assert.equal(existsSync(`${corePath}-shm`), true,
      'SHM sidecar must exist while concurrent connections are active');
    reader.exec('ROLLBACK;');
    reader.close();
    reader = undefined;
  } finally {
    reader?.close();
    first.close();
  }

  // Exercise the rollback-journal sidecar independently of WAL mode.
  const journalPath = join(directory, 'journal.sqlite');
  const journalDb = new DatabaseSync(journalPath);
  try {
    journalDb.exec("PRAGMA journal_mode=DELETE; CREATE TABLE probe(value TEXT); BEGIN IMMEDIATE; INSERT INTO probe VALUES('pending');");
    assert.equal(existsSync(`${journalPath}-journal`), true,
      'rollback journal sidecar must exist before the transaction commits');
    journalDb.exec('ROLLBACK;');
  } finally {
    journalDb.close();
  }

  const second = new DatabaseSync(join(directory, 'coordinator.sqlite'));
  try {
    second.exec('CREATE TABLE probe(value TEXT);');
    const opened = second.prepare('SELECT logic_engine_vfs_probe_open_count() AS count').get().count;
    assert.equal(opened, 4,
      'the VFS must remain registered across the core, reader, journal and coordinator file connections');
  } finally {
    second.close();
  }
});
