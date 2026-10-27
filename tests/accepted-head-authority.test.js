import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { AcceptedHeadAuthority } from '../src/security/accepted-head-authority.js';
import {
  advanceAcceptedHeadSync,
  enrollAcceptedHeadSync,
  finalizeAcceptedHeadSync,
  getAcceptedHeadStatusSync,
  getAcceptedHeadsSync,
} from '../src/security/accepted-head-client-sync.js';

const coreToken = 'core-token-for-accepted-head-tests-00000000000000000000000000000001';
const providerToken = 'provider-token-for-accepted-head-tests-00000000000000000000000000000002';
const digestA = 'a'.repeat(64);
const digestB = 'b'.repeat(64);
const digestC = 'c'.repeat(64);
const digestD = 'd'.repeat(64);

function tempDir(prefix = 'logic-accepted-head-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function enrollStoreDomain(authority, domain, operationId, digest) {
  const result = authority.enroll({ domain, operationId, operationDigest: digest, expectedHead: 0 });
  assert.equal(result.status, 'pending');
  return authority.finalize({ domain, operationId, operationDigest: digest });
}

test('authority requires explicit enrollment and then advances monotonic per-domain heads idempotently', () => {
  const dir = tempDir();
  const path = join(dir, 'authority.sqlite');
  const authority = new AcceptedHeadAuthority({ path, installationId: 'test-installation' });
  try {
    assert.deepEqual(authority.getHeads(), { core: 0, provider: 0 });
    assert.deepEqual(authority.getEnrollmentStatus(), { core: false, provider: false });
    assert.throws(
      () => authority.advance({ domain: 'core', operationId: 'core-op-1', operationDigest: digestA, expectedHead: 0 }),
      /ACCEPTED_HEAD_NOT_ENROLLED/,
    );

    enrollStoreDomain(authority, 'core', 'core-enroll', digestA);
    enrollStoreDomain(authority, 'provider', 'provider-enroll', digestB);
    assert.deepEqual(authority.getHeads(), { core: 1, provider: 1 });
    assert.deepEqual(authority.getEnrollmentStatus(), { core: true, provider: true });

    assert.deepEqual(authority.advance({ domain: 'core', operationId: 'core-op-1', operationDigest: digestC, expectedHead: 1 }), {
      domain: 'core', head: 2, operation_id: 'core-op-1', operation_digest: digestC, replayed: false, status: 'pending',
    });
    assert.throws(
      () => authority.advance({ domain: 'core', operationId: 'core-op-1', operationDigest: digestC, expectedHead: 1 }),
      /ACCEPTED_HEAD_OPERATION_PENDING/,
    );
    assert.equal(authority.getPendingDomains().core, true);
    assert.deepEqual(authority.finalize({ domain: 'core', operationId: 'core-op-1', operationDigest: digestC }), {
      domain: 'core', head: 2, operation_id: 'core-op-1', operation_digest: digestC, replayed: false, status: 'committed',
    });
    assert.deepEqual(authority.advance({ domain: 'core', operationId: 'core-op-1', operationDigest: digestC, expectedHead: 2 }), {
      domain: 'core', head: 2, operation_id: 'core-op-1', operation_digest: digestC, replayed: true, status: 'committed',
    });
    assert.deepEqual(authority.advance({ domain: 'provider', operationId: 'provider-op-1', operationDigest: digestD, expectedHead: 1 }), {
      domain: 'provider', head: 2, operation_id: 'provider-op-1', operation_digest: digestD, replayed: false, status: 'pending',
    });
    authority.finalize({ domain: 'provider', operationId: 'provider-op-1', operationDigest: digestD });
    assert.deepEqual(authority.advance({ domain: 'core', operationId: 'core-op-2', operationDigest: digestA, expectedHead: 2 }), {
      domain: 'core', head: 3, operation_id: 'core-op-2', operation_digest: digestA, replayed: false, status: 'pending',
    });
    authority.finalize({ domain: 'core', operationId: 'core-op-2', operationDigest: digestA });
    assert.deepEqual(authority.getHeads(), { core: 3, provider: 2 });
    assert.throws(
      () => authority.advance({ domain: 'provider', operationId: 'core-op-1', operationDigest: digestC, expectedHead: 2 }),
      /ACCEPTED_HEAD_OPERATION_ID_CONFLICT/,
    );
    assert.throws(
      () => authority.advance({ domain: 'core', operationId: 'core-op-1', operationDigest: digestB, expectedHead: 3 }),
      /ACCEPTED_HEAD_OPERATION_ID_CONFLICT/,
    );
    assert.throws(
      () => authority.finalize({ domain: 'core', operationId: 'core-op-1', operationDigest: digestB }),
      /ACCEPTED_HEAD_OPERATION_ID_CONFLICT/,
    );
    assert.throws(() => authority.advance({ domain: 'core', operationId: '  ', operationDigest: digestA, expectedHead: 3 }), /Invalid accepted-head/);
    assert.throws(() => authority.advance({ domain: 'core', operationId: 'stale-op', operationDigest: digestA, expectedHead: 0 }), /ACCEPTED_HEAD_HEAD_MISMATCH/);
  } finally {
    authority.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('authority persists enrollment and committed heads across restart and rejects a different installation identity', () => {
  const dir = tempDir();
  const path = join(dir, 'authority.sqlite');
  const first = new AcceptedHeadAuthority({ path, installationId: 'installation-A' });
  enrollStoreDomain(first, 'provider', 'provider-enroll', digestA);
  first.advance({ domain: 'provider', operationId: 'provider-op-persisted', operationDigest: digestB, expectedHead: 1 });
  first.finalize({ domain: 'provider', operationId: 'provider-op-persisted', operationDigest: digestB });
  first.close();

  const reopened = new AcceptedHeadAuthority({ path, installationId: 'installation-A' });
  try {
    assert.deepEqual(reopened.getHeads(), { core: 0, provider: 2 });
    assert.deepEqual(reopened.getEnrollmentStatus(), { core: false, provider: true });
    assert.deepEqual(reopened.advance({ domain: 'provider', operationId: 'provider-op-persisted', operationDigest: digestB, expectedHead: 2 }), {
      domain: 'provider', head: 2, operation_id: 'provider-op-persisted', operation_digest: digestB, replayed: true, status: 'committed',
    });
  } finally {
    reopened.close();
  }

  assert.throws(
    () => new AcceptedHeadAuthority({ path, installationId: 'installation-B' }),
    /ACCEPTED_HEAD_INSTALLATION_MISMATCH/,
  );
  rmSync(dir, { recursive: true, force: true });
});

async function startAuthorityProcess(path) {
  const authorityUrl = new URL('../src/security/accepted-head-authority.js', import.meta.url).href;
  const script = [
    'import { AcceptedHeadAuthority, createAcceptedHeadAuthorityServer } from ' + JSON.stringify(authorityUrl) + ';',
    'const args = process.argv.slice(1);',
    'const authority = new AcceptedHeadAuthority({ path: args[0], installationId: "server-test-installation" });',
    'const server = createAcceptedHeadAuthorityServer({ authority, coreToken: process.env.LE_TEST_CORE_TOKEN, providerToken: process.env.LE_TEST_PROVIDER_TOKEN });',
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

test('authority IPC requires explicit enrollment, enforces domain tokens, and fails closed while pending', async () => {
  const dir = tempDir();
  const path = join(dir, 'authority.sqlite');
  const { child, port } = await startAuthorityProcess(path);
  try {
    assert.deepEqual(getAcceptedHeadStatusSync({ port }), {
      heads: { core: 0, provider: 0 },
      pending: { core: false, provider: false },
      enrolled: { core: false, provider: false },
    });
    assert.throws(() => getAcceptedHeadsSync({ port }), /ACCEPTED_HEAD_AUTHORITY_UNAVAILABLE/);

    assert.deepEqual(enrollAcceptedHeadSync({
      domain: 'core', operationId: 'sync-core-enroll', operationDigest: digestA, token: coreToken, port,
    }), { domain: 'core', head: 1, operation_id: 'sync-core-enroll', operation_digest: digestA, replayed: false, status: 'pending' });
    assert.throws(() => getAcceptedHeadsSync({ port }), /ACCEPTED_HEAD_AUTHORITY_UNAVAILABLE/);
    assert.deepEqual(finalizeAcceptedHeadSync({
      domain: 'core', operationId: 'sync-core-enroll', operationDigest: digestA, token: coreToken, port,
    }), { domain: 'core', head: 1, operation_id: 'sync-core-enroll', operation_digest: digestA, replayed: false, status: 'committed' });

    assert.deepEqual(enrollAcceptedHeadSync({
      domain: 'provider', operationId: 'sync-provider-enroll', operationDigest: digestB, token: providerToken, port,
    }), { domain: 'provider', head: 1, operation_id: 'sync-provider-enroll', operation_digest: digestB, replayed: false, status: 'pending' });
    assert.deepEqual(finalizeAcceptedHeadSync({
      domain: 'provider', operationId: 'sync-provider-enroll', operationDigest: digestB, token: providerToken, port,
    }), { domain: 'provider', head: 1, operation_id: 'sync-provider-enroll', operation_digest: digestB, replayed: false, status: 'committed' });
    assert.deepEqual(getAcceptedHeadsSync({ port }), { core: 1, provider: 1 });

    assert.deepEqual(advanceAcceptedHeadSync({
      domain: 'core', operationId: 'sync-core-op-1', operationDigest: digestC, expectedHead: 1, token: coreToken, port,
    }), { domain: 'core', head: 2, operation_id: 'sync-core-op-1', operation_digest: digestC, replayed: false, status: 'pending' });
    assert.throws(() => getAcceptedHeadsSync({ port }), /ACCEPTED_HEAD_AUTHORITY_UNAVAILABLE/);
    assert.deepEqual(finalizeAcceptedHeadSync({
      domain: 'core', operationId: 'sync-core-op-1', operationDigest: digestC, token: coreToken, port,
    }), { domain: 'core', head: 2, operation_id: 'sync-core-op-1', operation_digest: digestC, replayed: false, status: 'committed' });
    assert.deepEqual(advanceAcceptedHeadSync({
      domain: 'core', operationId: 'sync-core-op-1', operationDigest: digestC, expectedHead: 2, token: coreToken, port,
    }), { domain: 'core', head: 2, operation_id: 'sync-core-op-1', operation_digest: digestC, replayed: true, status: 'committed' });

    assert.deepEqual(advanceAcceptedHeadSync({
      domain: 'provider', operationId: 'sync-provider-op-1', operationDigest: digestD, expectedHead: 1, token: providerToken, port,
    }), { domain: 'provider', head: 2, operation_id: 'sync-provider-op-1', operation_digest: digestD, replayed: false, status: 'pending' });
    assert.deepEqual(finalizeAcceptedHeadSync({
      domain: 'provider', operationId: 'sync-provider-op-1', operationDigest: digestD, token: providerToken, port,
    }), { domain: 'provider', head: 2, operation_id: 'sync-provider-op-1', operation_digest: digestD, replayed: false, status: 'committed' });
    assert.deepEqual(getAcceptedHeadsSync({ port }), { core: 2, provider: 2 });

    assert.throws(() => advanceAcceptedHeadSync({
      domain: 'core', operationId: 'unauthorized-op', operationDigest: digestD, expectedHead: 2, token: providerToken, port,
    }), /ACCEPTED_HEAD_AUTHORITY_UNAVAILABLE/);
    assert.throws(() => advanceAcceptedHeadSync({
      domain: 'core', operationId: 'invalid-op', operationDigest: digestA, expectedHead: 2, token: 'too-short', port,
    }), /Invalid accepted-head client configuration/);
    assert.deepEqual(getAcceptedHeadsSync({ port }), { core: 2, provider: 2 });
  } finally {
    child.stdin.end('stop');
    await once(child, 'exit');
    rmSync(dir, { recursive: true, force: true });
  }
});

test('authority client fails closed when the service is unavailable', () => {
  assert.throws(() => getAcceptedHeadStatusSync({ port: 65534, timeoutMs: 200 }), /ACCEPTED_HEAD_AUTHORITY_UNAVAILABLE/);
  assert.throws(() => advanceAcceptedHeadSync({
    domain: 'provider',
    operationId: 'provider-op-offline',
    operationDigest: digestA,
    expectedHead: 0,
    token: providerToken,
    port: 65534,
    timeoutMs: 200,
  }), /ACCEPTED_HEAD_AUTHORITY_UNAVAILABLE/);
});
