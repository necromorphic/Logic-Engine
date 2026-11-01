import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const strictExtensionPath = process.env.LOGIC_ENGINE_VFS_STRICT_PROBE_PATH;

test('strict Linux VFS build requires broker role enrollment', {
  skip: process.platform !== 'linux' || !strictExtensionPath,
}, () => {
  const db = new DatabaseSync(':memory:', { allowExtension: true });
  try {
    db.loadExtension(strictExtensionPath, 'sqlite3_secure_vfs_probe_init');
    db.enableLoadExtension(false);

    assert.throws(
      () => db.prepare(
        'SELECT logic_engine_vfs_probe_register_database_role(?, ?)'
      ).get('/var/lib/logic-engine/roles/core/core.sqlite', 'core'),
      /no such function/i,
      'strict Linux builds must not expose path-only role enrollment',
    );

    assert.throws(
      () => db.prepare(
        'SELECT logic_engine_vfs_probe_bind_broker(?, ?)'
      ).get('not-enrolled', '/run/logic-engine-broker/broker.sock'),
      /role missing/i,
      'strict Linux builds retain the broker-binding API',
    );
  } finally {
    db.close();
  }
});
