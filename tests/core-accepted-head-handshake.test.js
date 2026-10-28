import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { beginCoordinatorLock, openCoordinatorDatabase } from '../src/storage/coordinator-lock.js';
import {
  advanceAcceptedHeadSync,
  enrollAcceptedHeadSync,
  finalizeAcceptedHeadSync,
  getAcceptedHeadsSync,
} from '../src/security/accepted-head-client-sync.js';

const coreToken = 'core-token-for-core-handshake-tests-00000000000000000000000000000001';
const providerToken = 'provider-token-for-core-handshake-tests-00000000000000000000000000000002';
const readToken = 'gateway-read-token-for-core-handshake-tests-00000000000000000000000000000003';
const digestA = 'a'.repeat(64);
const digestB = 'b'.repeat(64);

async function startAuthorityProcess(path) {
  const authorityUrl = new URL('../src/security/accepted-head-authority.js', import.meta.url).href;
  const script = [
    'import { AcceptedHeadAuthority, createAcceptedHeadAuthorityServer } from ' + JSON.stringify(authorityUrl) + ';',
    'const args = process.argv.slice(1);',
    'const authority = new AcceptedHeadAuthority({ path: args[0], installationId: "core-handshake-test-installation" });',
    'const server = createAcceptedHeadAuthorityServer({ authority, coreToken: process.env.LE_TEST_CORE_TOKEN, providerToken: process.env.LE_TEST_PROVIDER_TOKEN, readToken: process.env.LE_TEST_READ_TOKEN });',
    'server.listen(0, "127.0.0.1", () => process.stdout.write("LISTENING:" + server.address().port + "\\n"));',
    'process.stdin.on("data", () => server.close(() => { authority.close(); process.exit(0); }));',
  ].join('\n');
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, path], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: {
      PATH: process.env.PATH || '',
      SystemRoot: process.env.SystemRoot || '',
      WINDIR: process.env.WINDIR || '',
      LE_TEST_CORE_TOKEN: coreToken,
      LE_TEST_PROVIDER_TOKEN: providerToken,
      LE_TEST_READ_TOKEN: readToken,
    },
  });
  const [chunk] = await once(child.stdout, 'data');
  const match = String(chunk).match(/LISTENING:(\d+)/);
  if (!match) {
    child.kill();
    throw new Error('Accepted-head test service did not start.');
  }
  return { child, port: Number(match[1]) };
}

function setEnv(name, value, previous) {
  previous[name] = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test('Core commits only when accepted-head authority is current and aborts mutations when authority is unavailable', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-core-accepted-head-'));
  const corePath = join(directory, 'core.sqlite');
  const coordinatorPath = join(directory, 'coordinator.sqlite');
  const authorityPath = join(directory, 'authority.sqlite');
  const previousEnv = {};
  let child;
  let store;
  try {
    setEnv('LOGIC_ENGINE_COORDINATOR_DB_PATH', coordinatorPath, previousEnv);
    setEnv('LOGIC_ENGINE_ACCEPTED_HEAD_REQUIRED', undefined, previousEnv);
    setEnv('LOGIC_ENGINE_ACCEPTED_HEAD_PORT', undefined, previousEnv);
    setEnv('LOGIC_ENGINE_ACCEPTED_HEAD_CORE_TOKEN', undefined, previousEnv);
    const bootstrap = new SQLiteStore(corePath);
    bootstrap.close();

    const service = await startAuthorityProcess(authorityPath);
    child = service.child;
    const port = service.port;

    const coordinatorDb = openCoordinatorDatabase(coordinatorPath);
    const release = beginCoordinatorLock(coordinatorDb);
    try {
      const enrolledCore = enrollAcceptedHeadSync({
        domain: 'core', operationId: 'core-baseline-enrollment', operationDigest: digestA, token: coreToken, port,
      });
      const db = new DatabaseSync(corePath);
      try {
        db.exec('BEGIN IMMEDIATE');
        db.prepare('UPDATE accepted_head_state SET head=?, enrolled=1, last_operation_id=?, last_operation_digest=? WHERE singleton=1')
          .run(enrolledCore.head, enrolledCore.operation_id, digestA);
        db.exec('COMMIT');
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch {}
        throw error;
      } finally {
        db.close();
      }
      finalizeAcceptedHeadSync({
        domain: 'core', operationId: enrolledCore.operation_id, operationDigest: digestA, token: coreToken, port,
      });

      const enrolledProvider = enrollAcceptedHeadSync({
        domain: 'provider', operationId: 'provider-baseline-enrollment', operationDigest: digestB, token: providerToken, port,
      });
      finalizeAcceptedHeadSync({
        domain: 'provider', operationId: enrolledProvider.operation_id, operationDigest: digestB, token: providerToken, port,
      });
    } finally {
      release();
      coordinatorDb.close();
    }

    setEnv('LOGIC_ENGINE_ACCEPTED_HEAD_PORT', String(port), previousEnv);
    setEnv('LOGIC_ENGINE_ACCEPTED_HEAD_CORE_TOKEN', coreToken, previousEnv);
    setEnv('LOGIC_ENGINE_ACCEPTED_HEAD_REQUIRED', '1', previousEnv);
    store = new SQLiteStore(corePath);

    const created = store.createWorld({
      world_id: 'accepted-head-world-one',
      world_pack_id: 'test-pack',
      world_pack_version: '1',
      game_time: '2026-01-01T00:00:00Z',
    });
    assert.equal(created.world_id, 'accepted-head-world-one');
    const firstOperation = store.db.prepare(
      'SELECT head,last_operation_id,last_operation_digest FROM accepted_head_state WHERE singleton=1',
    ).get();
    assert.equal(firstOperation.head, 2);
    assert.match(firstOperation.last_operation_digest, /^[a-f0-9]{64}$/);
    assert.equal(firstOperation.last_operation_id, 'core-' + firstOperation.last_operation_digest);

    store.createWorld({
      world_id: 'accepted-head-world-two',
      world_pack_id: 'test-pack',
      world_pack_version: '1',
      game_time: '2026-01-01T00:00:30Z',
    });
    const secondOperation = store.db.prepare(
      'SELECT head,last_operation_id,last_operation_digest FROM accepted_head_state WHERE singleton=1',
    ).get();
    assert.equal(secondOperation.head, 3);
    assert.match(secondOperation.last_operation_digest, /^[a-f0-9]{64}$/);
    assert.equal(secondOperation.last_operation_id, 'core-' + secondOperation.last_operation_digest);
    assert.notEqual(secondOperation.last_operation_digest, firstOperation.last_operation_digest);
    assert.deepEqual(getAcceptedHeadsSync({ port, token: coreToken }), { core: 3, provider: 1 });
    assert.equal(secondOperation.head, 3);

    // Simulate a crash after the local transaction committed but before
    // authority finalization. Startup may finalize only when durable local
    // operation identity, digest, and resulting head match the pending record.
    const recoveryDigest = 'e'.repeat(64);
    const pendingRecovery = advanceAcceptedHeadSync({
      domain: 'core',
      operationId: 'core-recovery-committed-operation',
      operationDigest: recoveryDigest,
      expectedHead: 3,
      token: coreToken,
      port,
    });
    assert.equal(pendingRecovery.status, 'pending');
    store.close();
    store = null;
    const recoveryDb = new DatabaseSync(corePath);
    try {
      recoveryDb.prepare(
        'UPDATE accepted_head_state SET head=?,last_operation_id=?,last_operation_digest=? WHERE singleton=1',
      ).run(4, pendingRecovery.operation_id, recoveryDigest);
    } finally {
      recoveryDb.close();
    }
    store = new SQLiteStore(corePath);
    assert.deepEqual(getAcceptedHeadsSync({ port, token: coreToken }), { core: 4, provider: 1 });
    assert.equal(store.db.prepare(
      'SELECT head,last_operation_id,last_operation_digest FROM accepted_head_state WHERE singleton=1',
    ).get().last_operation_id, pendingRecovery.operation_id);

    child.stdin.end('stop');
    await once(child, 'exit');
    child = null;

    assert.throws(() => store.createWorld({
      world_id: 'accepted-head-world-three',
      world_pack_id: 'test-pack',
      world_pack_version: '1',
      game_time: '2026-01-01T00:01:00Z',
    }), /ACCEPTED_HEAD_AUTHORITY_UNAVAILABLE/);
    assert.equal(store.world('accepted-head-world-three') ?? null, null);

    store.close();
    store = null;
    const damaged = new DatabaseSync(corePath);
    try {
      damaged.exec('DROP TABLE context_manifests');
    } finally {
      damaged.close();
    }
    assert.throws(() => new SQLiteStore(corePath), /CORE_SCHEMA_INCOMPLETE/);
    const verifySchema = new DatabaseSync(corePath);
    try {
      const missing = verifySchema.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='context_manifests'",
      ).get();
      assert.equal(missing, undefined);
    } finally {
      verifySchema.close();
    }
  } finally {
    try { store?.close(); } catch {}
    if (child) {
      child.stdin.end('stop');
      await once(child, 'exit');
    }
    for (const [name, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
