import assert from 'node:assert/strict';
import { openSync, closeSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const packageRoot = process.env.BETTER_SQLITE3_PACKAGE_DIR;
const extensionPath = process.env.LOGIC_ENGINE_VFS_PROBE_PATH;
const databasePath = process.env.LOGIC_ENGINE_DATABASE_PATH;
const socketPath = process.env.LOGIC_ENGINE_BROKER_SOCKET;

test('restarted distinct-UID broker permits SQLite WAL crash recovery', {
  skip: process.platform !== 'linux' || !packageRoot || !extensionPath
    || !databasePath || !socketPath,
}, () => {
  const Database = require(packageRoot);
  assert.notEqual(process.getuid(), Number(process.env.LOGIC_ENGINE_BROKER_UID));
  assert.throws(() => {
    const fd = openSync(databasePath, 'r');
    closeSync(fd);
  }, { code: 'EACCES' }, 'the app must still be unable to open the DB pathname directly');

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
      'the restarted broker must revalidate the persisted role manifest',
    );
  } finally {
    registrar.close();
  }

  const recovered = new Database(databasePath);
  try {
    assert.equal(
      recovered.prepare('SELECT count(*) AS count FROM broker_probe').get().count,
      2,
      'SQLite recovery must discard uncommitted frames after app process crash',
    );
    assert.equal(recovered.pragma('integrity_check', { simple: true }), 'ok');
    assert.ok(
      recovered.prepare('SELECT logic_engine_vfs_probe_broker_backend_io_count() AS count').get().count > 0,
      'recovery reads must continue to use broker-returned descriptors after broker restart',
    );
  } finally {
    recovered.close();
  }
});
