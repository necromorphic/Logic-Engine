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
      /no such function/i,
      'strict Linux builds must not expose caller-controlled broker rebinding',
    );
    assert.throws(
      () => db.prepare(
        'SELECT logic_engine_vfs_probe_register_broker_role_from_host()'
      ).get(),
      /trusted Host VFS role path\/name and broker socket configuration are required/i,
      'strict enrollment must require Host-owned process configuration',
    );

    const directory = mkdtempSync(join(tmpdir(), 'logic-engine-strict-broker-socket-'));
    const socketPath = join(directory, 'app-owned.sock');
    const server = createServer();
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(socketPath, resolve);
      });
      const priorEnvironment = {
        path: process.env.LOGIC_ENGINE_VFS_ROLE_PATH,
        role: process.env.LOGIC_ENGINE_VFS_ROLE_NAME,
        socket: process.env.LOGIC_ENGINE_BROKER_SOCKET,
        uid: process.env.LOGIC_ENGINE_BROKER_UID,
      };
      process.env.LOGIC_ENGINE_VFS_ROLE_PATH = join(directory, 'app-writable-alias.sqlite');
      process.env.LOGIC_ENGINE_VFS_ROLE_NAME = 'core';
      process.env.LOGIC_ENGINE_BROKER_SOCKET = socketPath;
      process.env.LOGIC_ENGINE_BROKER_UID = String(process.getuid() + 1);
      const beforeWritableAlias = db.prepare(
        'SELECT logic_engine_vfs_probe_broker_socket_policy_reject_count() AS count'
      ).get().count;
      assert.throws(
        () => db.prepare(
          'SELECT logic_engine_vfs_probe_register_broker_role_from_host()'
        ).get(),
        /broker role enrollment handshake failed/i,
        'strict Linux enrollment must reject an application-writable logical alias parent',
      );
      const afterWritableAlias = db.prepare(
        'SELECT logic_engine_vfs_probe_broker_socket_policy_reject_count() AS count'
      ).get().count;
      assert.equal(afterWritableAlias, beforeWritableAlias,
        'an application-writable alias parent must be rejected before broker IPC');
      // /var/lib is root-owned and non-writable by the runner UID; the
      // fake socket remains app-owned and must be rejected at the broker boundary.
      process.env.LOGIC_ENGINE_VFS_ROLE_PATH = '/var/lib/logic-engine-strict-probe.sqlite';
      process.env.LOGIC_ENGINE_VFS_ROLE_NAME = 'core';
      process.env.LOGIC_ENGINE_BROKER_SOCKET = socketPath;
      process.env.LOGIC_ENGINE_BROKER_UID = String(process.getuid() + 1);
      const before = db.prepare(
        'SELECT logic_engine_vfs_probe_broker_socket_policy_reject_count() AS count'
      ).get().count;
      assert.throws(
        () => db.prepare(
          'SELECT logic_engine_vfs_probe_register_broker_role_from_host()'
        ).get(),
        /broker role enrollment handshake failed/i,
        'strict Linux builds must reject an app-owned fake broker socket',
      );
      const after = db.prepare(
        'SELECT logic_engine_vfs_probe_broker_socket_policy_reject_count() AS count'
      ).get().count;
      if (priorEnvironment.path === undefined) delete process.env.LOGIC_ENGINE_VFS_ROLE_PATH;
      else process.env.LOGIC_ENGINE_VFS_ROLE_PATH = priorEnvironment.path;
      if (priorEnvironment.role === undefined) delete process.env.LOGIC_ENGINE_VFS_ROLE_NAME;
      else process.env.LOGIC_ENGINE_VFS_ROLE_NAME = priorEnvironment.role;
      if (priorEnvironment.socket === undefined) delete process.env.LOGIC_ENGINE_BROKER_SOCKET;
      else process.env.LOGIC_ENGINE_BROKER_SOCKET = priorEnvironment.socket;
      if (priorEnvironment.uid === undefined) delete process.env.LOGIC_ENGINE_BROKER_UID;
      else process.env.LOGIC_ENGINE_BROKER_UID = priorEnvironment.uid;
      assert.equal(after, before + 1,
        'the strict socket-owner policy must reject the app-owned endpoint before connect');
    } finally {
      await new Promise(resolve => server.close(resolve));
      rmSync(directory, { recursive: true, force: true });
    }
  } finally {
    db.close();
  }
});
