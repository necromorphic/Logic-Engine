import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const strictExtensionPath = process.env.LOGIC_ENGINE_VFS_STRICT_PROBE_PATH;

test('strict Linux VFS build requires broker role enrollment', {
  skip: process.platform !== 'linux' || !strictExtensionPath,
}, async () => {
  const bootstrap = new DatabaseSync(':memory:', { allowExtension: true });
  try {
    bootstrap.loadExtension(strictExtensionPath, 'sqlite3_secure_vfs_probe_init');
    bootstrap.enableLoadExtension(false);
  } finally {
    bootstrap.close();
  }
  const db = new DatabaseSync(':memory:');
  try {
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
    );\n\n    const directory = mkdtempSync(join(tmpdir(), 'logic-engine-strict-broker-socket-'));\n    const socketPath = join(directory, 'app-owned.sock');\n    const server = createServer();\n    try {\n      await new Promise((resolve, reject) => {\n        server.once('error', reject);\n        server.listen(socketPath, resolve);\n      });\n      const before = db.prepare(\n        'SELECT logic_engine_vfs_probe_broker_socket_policy_reject_count() AS count'\n      ).get().count;\n      assert.throws(\n        () => db.prepare(\n          'SELECT logic_engine_vfs_probe_register_broker_role(?, ?, ?)'\n        ).get(join(directory, 'core.sqlite'), 'core', socketPath),\n        /broker role enrollment handshake failed/i,\n        'strict Linux builds must reject an app-owned fake broker socket',\n      );\n      const after = db.prepare(\n        'SELECT logic_engine_vfs_probe_broker_socket_policy_reject_count() AS count'\n      ).get().count;\n      assert.equal(after, before + 1,\n        'the strict socket-owner policy must reject the app-owned endpoint before connect');\n    } finally {\n      await new Promise(resolve => server.close(resolve));\n      rmSync(directory, { recursive: true, force: true });\n    }
  } finally {
    db.close();
  }
});
