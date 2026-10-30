import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
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

  const first = new DatabaseSync(join(directory, 'core.sqlite'));
  try {
    first.exec('PRAGMA journal_mode=WAL; CREATE TABLE probe(value TEXT); INSERT INTO probe VALUES(\'ok\');');
    assert.equal(first.prepare('SELECT value FROM probe').get().value, 'ok');
    const opened = first.prepare('SELECT logic_engine_vfs_probe_open_count() AS count').get().count;
    assert.equal(opened, 1, 'the first file-backed DatabaseSync must pass through the registered VFS xOpen');
  } finally {
    first.close();
  }

  const second = new DatabaseSync(join(directory, 'coordinator.sqlite'));
  try {
    second.exec('CREATE TABLE probe(value TEXT);');
    const opened = second.prepare('SELECT logic_engine_vfs_probe_open_count() AS count').get().count;
    assert.equal(opened, 2, 'the VFS registration must persist process-wide across subsequent DatabaseSync connections');
  } finally {
    second.close();
  }
});
