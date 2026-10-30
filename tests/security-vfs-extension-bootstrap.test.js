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
    const openSyscall = process.platform === 'win32' ? 'CreateFileW' : 'open';
    assert.equal(
      first.prepare('SELECT logic_engine_vfs_probe_has_syscall(?) AS available').get(openSyscall).available,
      1,
      `the pinned ${process.platform} SQLite VFS must expose its native file-open syscall hook for feasibility review`
    );
    assert.ok(
      first.prepare('SELECT logic_engine_vfs_probe_native_open_count() AS count').get().count > 0,
      'the native syscall wrapper must observe the actual OS file-open calls made by node:sqlite'
    );
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
    assert.ok(
      first.prepare('SELECT logic_engine_vfs_probe_wal_open_count() AS count').get().count > 0,
      'the WAL sidecar must be opened through the registered VFS'
    );
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
    assert.ok(
      journalDb.prepare('SELECT logic_engine_vfs_probe_journal_open_count() AS count').get().count > 0,
      'the rollback journal must be opened through the registered VFS'
    );
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

    // Establish the expected OS identity, then replace the path with a hardlink
    // after SQLite has reached xOpen but immediately before the native OS open.
    const aliasPath = join(directory, 'alias.sqlite');
    const aliasDb = new DatabaseSync(aliasPath);
    try {
      aliasDb.exec('CREATE TABLE alias(value TEXT);');
      const racePath = join(directory, 'race.sqlite');
      second.prepare('SELECT logic_engine_vfs_probe_configure_race(?, ?, 0)')
        .get(racePath, aliasPath);
      const baseline = new DatabaseSync(racePath);
      try {
        baseline.exec('CREATE TABLE baseline(value TEXT);');
      } finally {
        baseline.close();
      }

      second.prepare('SELECT logic_engine_vfs_probe_configure_race(?, ?, 1)')
        .get(racePath, aliasPath);
      assert.throws(() => new DatabaseSync(racePath),
        'opening a database path replaced by a hardlink to another database must fail closed');
      assert.equal(
        second.prepare('SELECT logic_engine_vfs_probe_race_injection_count() AS count').get().count,
        1,
        'the deterministic replacement must occur exactly once inside the VFS open boundary'
      );
      assert.ok(
        second.prepare('SELECT logic_engine_vfs_probe_identity_reject_count() AS count').get().count > 0,
        'the OS handle identity check must reject the substituted hardlink'
      );
    } finally {
      aliasDb.close();
    }
  } finally {
    second.close();
  }
});
