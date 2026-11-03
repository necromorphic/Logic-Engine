import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { beginCoordinatorLock, openCoordinatorDatabase } from '../src/storage/coordinator-lock.js';
import {
  HostAssertionNonceStore,
  HostSessionRevocationReader,
} from '../src/application/host-assertion-nonce-store.js';
import { createHostSessionAssertionRunner } from '../src/application/host-session-context.js';

const identity = Object.freeze({
  host_installation_id: '11111111-1111-4111-8111-111111111111',
  authenticated_account_id: '22222222-2222-4222-8222-222222222222',
  host_session_id: '33333333-3333-4333-8333-333333333333',
});

test('Host session revocation is durable and visible to a read-only Gateway reader', () => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-engine-host-revocation-'));
  const corePath = join(directory, 'core.sqlite');
  const coordinatorPath = join(directory, 'coordinator.sqlite');
  const providerPath = join(directory, 'provider.sqlite');
  const noncePath = join(directory, 'host-assertion-nonces.sqlite');
  let store;
  let reader;
  try {
    store = new HostAssertionNonceStore({
      path: noncePath,
      coreDatabasePath: corePath,
      coordinatorPath,
      providerDatabasePath: providerPath,
    });
    reader = new HostSessionRevocationReader({ path: noncePath });
    assert.equal(reader.isSessionRevoked('st-adapter', identity), false);
    assert.equal(await store.revokeSession(
      'st-adapter', identity,
      '44444444-4444-4444-8444-444444444444',
      1_800_000_000,
      'logout',
    ), true);
    assert.equal(reader.isSessionRevoked('st-adapter', identity), true);
    assert.equal(await store.revokeSession(
      'st-adapter', identity,
      '44444444-4444-4444-8444-444444444444',
      1_800_000_001,
      'logout',
    ), false);
    assert.equal(reader.isSessionRevoked('st-adapter', identity), true);
  } finally {
    try { reader?.close(); } finally {
      try { store?.close(); } finally { rmSync(directory, { recursive: true, force: true }); }
    }
  }
});

test('Host session revocation reader treats malformed identity as revoked', () => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-engine-host-revocation-invalid-'));
  const corePath = join(directory, 'core.sqlite');
  const coordinatorPath = join(directory, 'coordinator.sqlite');
  const noncePath = join(directory, 'host-assertion-nonces.sqlite');
  let store;
  let reader;
  try {
    store = new HostAssertionNonceStore({ path: noncePath, coreDatabasePath: corePath, coordinatorPath });
    reader = new HostSessionRevocationReader({ path: noncePath });
    assert.equal(reader.isSessionRevoked('st-adapter', { ...identity, host_session_id: 'invalid' }), true);
  } finally {
    try { reader?.close(); } finally {
      try { store?.close(); } finally { rmSync(directory, { recursive: true, force: true }); }
    }
  }
});

test('Host session revocation waits for an in-flight shared Coordinator lease', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-engine-host-revocation-race-'));
  const corePath = join(directory, 'core.sqlite');
  const coordinatorPath = join(directory, 'coordinator.sqlite');
  const providerPath = join(directory, 'provider.sqlite');
  const noncePath = join(directory, 'host-assertion-nonces.sqlite');
  const setup = new HostAssertionNonceStore({
    path: noncePath,
    coreDatabasePath: corePath,
    coordinatorPath,
    providerDatabasePath: providerPath,
  });
  const moduleUrl = pathToFileURL(resolve('src/application/host-assertion-nonce-store.js')).href;
  const script = `
    import { HostAssertionNonceStore } from ${JSON.stringify(moduleUrl)};
    const store = new HostAssertionNonceStore({
      path: process.env.TEST_NONCE_PATH,
      coreDatabasePath: process.env.TEST_CORE_PATH,
      coordinatorPath: process.env.TEST_COORDINATOR_PATH,
      providerDatabasePath: process.env.TEST_PROVIDER_PATH,
    });
    process.stdout.write('READY\\n');
    process.stdin.setEncoding('utf8').once('data', async chunk => {
      if (chunk.trim() !== 'REVOKE') process.exit(2);
      const result = await store.revokeSession(
        'st-adapter',
        {"host_installation_id":"11111111-1111-4111-8111-111111111111","authenticated_account_id":"22222222-2222-4222-8222-222222222222","host_session_id":"33333333-3333-4333-8333-333333333333"},
        '55555555-5555-4555-8555-555555555555',
        1800000010,
        'logout',
      );
      process.stdout.write('REVOKED:' + result);
      store.close();
    });
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    env: {
      ...process.env,
      TEST_NONCE_PATH: noncePath,
      TEST_CORE_PATH: corePath,
      TEST_COORDINATOR_PATH: coordinatorPath,
      TEST_PROVIDER_PATH: providerPath,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let exited = false;
  const exitPromise = once(child, 'exit').then(result => { exited = true; return result; });
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  let coordinator;
  let release;
  try {
    await Promise.race([
      once(child.stdout, 'data'),
      exitPromise.then(() => { throw new Error('Revocation worker exited before initialization.'); }),
    ]);
    assert.match(stdout, /READY/);
    coordinator = openCoordinatorDatabase(coordinatorPath);
    release = beginCoordinatorLock(coordinator);
    child.stdin.end('REVOKE\\n');
    await new Promise(resolveTimer => setTimeout(resolveTimer, 150));
    assert.doesNotMatch(stdout, /REVOKED/);
    assert.equal(exited, false);
    release();
    const [code] = await exitPromise;
    assert.equal(code, 0, stderr);
    assert.match(stdout, /REVOKED:true/);
  } finally {
    try { release?.(); } catch {}
    try { coordinator?.close(); } catch {}
    try { child.kill(); } catch {}
    setup.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Host assertion nonce replay remains denied across store restart and independent connections', () => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-engine-host-nonce-restart-'));
  const corePath = join(directory, 'core.sqlite');
  const coordinatorPath = join(directory, 'coordinator.sqlite');
  const noncePath = join(directory, 'host-assertion-nonces.sqlite');
  let first;
  let second;
  try {
    const nonce = '66666666-6666-4666-8666-666666666666';
    first = new HostAssertionNonceStore({ path: noncePath, coreDatabasePath: corePath, coordinatorPath });
    assert.equal(first.consume('st-adapter', nonce, 1_800_000_030, 1_800_000_000), true);
    first.close();
    first = null;

    // A new Core/server process opens the same durable ledger after restart.
    second = new HostAssertionNonceStore({ path: noncePath, coreDatabasePath: corePath, coordinatorPath });
    assert.equal(second.consume('st-adapter', nonce, 1_800_000_030, 1_800_000_001), false);

    // A separate live connection cannot consume the same adapter/nonce tuple.
    const third = new HostAssertionNonceStore({ path: noncePath, coreDatabasePath: corePath, coordinatorPath });
    try {
      assert.equal(third.consume('st-adapter', nonce, 1_800_000_030, 1_800_000_002), false);
      assert.equal(third.consume('other-adapter', nonce, 1_800_000_030, 1_800_000_002), true);
    } finally {
      third.close();
    }
  } finally {
    try { second?.close(); } finally {
      try { first?.close(); } finally { rmSync(directory, { recursive: true, force: true }); }
    }
  }
});

test('signed Host assertion replay is rejected by a fresh runner after durable ledger restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-engine-host-assertion-restart-'));
  const corePath = join(directory, 'core.sqlite');
  const coordinatorPath = join(directory, 'coordinator.sqlite');
  const noncePath = join(directory, 'host-assertion-nonces.sqlite');
  const secret = 'durable-host-assertion-replay-test-secret';
  const nowSeconds = 1_800_000_000;
  const assertion = {
    protocol_version: 1,
    host_installation_id: identity.host_installation_id,
    authenticated_account_id: identity.authenticated_account_id,
    host_session_id: identity.host_session_id,
    conversation_id: identity.host_session_id + ':' + identity.host_installation_id + ':44444444-4444-4444-8444-444444444444',
    world_id: 'durable-replay-world',
    actor_id: 'durable-replay-actor',
    issued_at: nowSeconds,
    nonce: '77777777-7777-4777-8777-777777777777',
  };
  const signature = createHmac('sha256', secret).update(JSON.stringify([
    assertion.protocol_version,
    assertion.host_installation_id,
    assertion.authenticated_account_id,
    assertion.host_session_id,
    assertion.conversation_id,
    assertion.world_id,
    assertion.actor_id,
    assertion.issued_at,
    assertion.nonce,
  ]), 'utf8').digest('hex');
  let store;
  try {
    store = new HostAssertionNonceStore({ path: noncePath, coreDatabasePath: corePath, coordinatorPath });
    const firstRunner = createHostSessionAssertionRunner({
      secret,
      now: () => nowSeconds * 1000,
      adapterId: 'st-adapter',
      consumeNonce: (nonce, expiresAt, currentSeconds) =>
        store.consume('st-adapter', nonce, expiresAt, currentSeconds),
      isSessionRevoked: (adapterId, sessionIdentity) => store.isSessionRevoked(adapterId, sessionIdentity),
    });
    assert.equal(firstRunner.run(assertion, signature, () => true), true);
    store.close();
    store = null;

    // A new runner and new SQLite connection represent a restarted Core process.
    store = new HostAssertionNonceStore({ path: noncePath, coreDatabasePath: corePath, coordinatorPath });
    const restartedRunner = createHostSessionAssertionRunner({
      secret,
      now: () => nowSeconds * 1000,
      adapterId: 'st-adapter',
      consumeNonce: (nonce, expiresAt, currentSeconds) =>
        store.consume('st-adapter', nonce, expiresAt, currentSeconds),
      isSessionRevoked: (adapterId, sessionIdentity) => store.isSessionRevoked(adapterId, sessionIdentity),
    });
    assert.throws(
      () => restartedRunner.run(assertion, signature, () => true),
      /HOST_SESSION_ASSERTION_REPLAYED/,
    );
  } finally {
    try { store?.close(); } finally { rmSync(directory, { recursive: true, force: true }); }
  }
});

