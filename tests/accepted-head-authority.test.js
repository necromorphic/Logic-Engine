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
  getAcceptedHeadsSync,
} from '../src/security/accepted-head-client-sync.js';

const coreToken = 'core-token-for-accepted-head-tests-00000000000000000000000000000001';
const providerToken = 'provider-token-for-accepted-head-tests-00000000000000000000000000000002';
const digestA = 'a'.repeat(64);
const digestB = 'b'.repeat(64);

function tempDir(prefix = 'logic-accepted-head-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

test('accepted-head authority advances monotonic per-domain heads and makes operation IDs idempotent', () => {
  const dir = tempDir();
  const path = join(dir, 'authority.sqlite');
  const authority = new AcceptedHeadAuthority({ path, installationId: 'test-installation' });
  try {
    assert.deepEqual(authority.getHeads(), { core: 0, provider: 0 });
    assert.deepEqual(authority.advance({ domain: 'core', operationId: 'core-op-1', operationDigest: digestA }), {
      domain: 'core', head: 1, operation_id: 'core-op-1', replayed: false,
    });
    assert.deepEqual(authority.advance({ domain: 'core', operationId: 'core-op-1', operationDigest: digestA }), {
      domain: 'core', head: 1, operation_id: 'core-op-1', replayed: true,
    });
    assert.deepEqual(authority.advance({ domain: 'provider', operationId: 'provider-op-1', operationDigest: digestA }), {
      domain: 'provider', head: 1, operation_id: 'provider-op-1', replayed: false,
    });
    assert.deepEqual(authority.advance({ domain: 'core', operationId: 'core-op-2', operationDigest: digestB }), {
      domain: 'core', head: 2, operation_id: 'core-op-2', replayed: false,
    });
    assert.deepEqual(authority.getHeads(), { core: 2, provider: 1 });
    assert.throws(
      () => authority.advance({ domain: 'provider', operationId: 'core-op-1', operationDigest: digestA }),
      /ACCEPTED_HEAD_OPERATION_ID_CONFLICT/,
    );
    assert.throws(
      () => authority.advance({ domain: 'core', operationId: 'core-op-1', operationDigest: digestB }),
      /ACCEPTED_HEAD_OPERATION_ID_CONFLICT/,
    );
    assert.throws(() => authority.advance({ domain: 'core', operationId: '  ', operationDigest: digestA }), /Invalid accepted-head/);
  } finally {
    authority.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('accepted-head authority persists across restart and rejects a different installation identity', () => {
  const dir = tempDir();
  const path = join(dir, 'authority.sqlite');
  const first = new AcceptedHeadAuthority({ path, installationId: 'installation-A' });
  first.advance({ domain: 'provider', operationId: 'provider-op-persisted', operationDigest: digestA });
  first.close();

  const reopened = new AcceptedHeadAuthority({ path, installationId: 'installation-A' });
  try {
    assert.deepEqual(reopened.getHeads(), { core: 0, provider: 1 });
    assert.deepEqual(reopened.advance({ domain: 'provider', operationId: 'provider-op-persisted', operationDigest: digestA }), {
      domain: 'provider', head: 1, operation_id: 'provider-op-persisted', replayed: true,
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
    'const server = createAcceptedHeadAuthorityServer({ authority, coreToken: args[1], providerToken: args[2] });',
    'server.listen(0, "127.0.0.1", () => process.stdout.write("LISTENING:" + server.address().port + "\\n"));',
    'process.stdin.on("data", () => server.close(() => { authority.close(); process.exit(0); }));',
  ].join('\n');
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, path, coreToken, providerToken], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const [chunk] = await once(child.stdout, 'data');
  const match = String(chunk).match(/LISTENING:(\\d+)/);
  if (!match) {
    child.kill();
    throw new Error('Accepted-head test service did not start.');
  }
  return { child, port: Number(match[1]) };
}

test('authority server exposes current heads and requires domain-specific token for advances', async () => {
  const dir = tempDir();
  const path = join(dir, 'authority.sqlite');
  const { child, port } = await startAuthorityProcess(path);
  try {
    assert.deepEqual(getAcceptedHeadsSync({ port }), { core: 0, provider: 0 });
    assert.deepEqual(advanceAcceptedHeadSync({
      domain: 'core', operationId: 'sync-core-op-1', operationDigest: digestA, token: coreToken, port,
    }), { domain: 'core', head: 1, operation_id: 'sync-core-op-1', replayed: false });
    assert.deepEqual(advanceAcceptedHeadSync({
      domain: 'provider', operationId: 'sync-provider-op-1', operationDigest: digestB, token: providerToken, port,
    }), { domain: 'provider', head: 1, operation_id: 'sync-provider-op-1', replayed: false });
    assert.deepEqual(getAcceptedHeadsSync({ port }), { core: 1, provider: 1 });

    assert.throws(() => advanceAcceptedHeadSync({
      domain: 'core', operationId: 'unauthorized-op', operationDigest: digestB, token: providerToken, port,
    }), /ACCEPTED_HEAD_AUTHORITY_UNAVAILABLE/);
    assert.throws(() => advanceAcceptedHeadSync({
      domain: 'core', operationId: 'invalid-op', token: 'too-short', port,
    }), /Invalid accepted-head client configuration/);
    assert.deepEqual(getAcceptedHeadsSync({ port }), { core: 1, provider: 1 });
  } finally {
    child.stdin.end('stop');
    await once(child, 'exit');
    rmSync(dir, { recursive: true, force: true });
  }
});

test('authority client fails closed when the service is unavailable', () => {
  assert.throws(() => getAcceptedHeadsSync({ port: 65534, timeoutMs: 200 }), /ACCEPTED_HEAD_AUTHORITY_UNAVAILABLE/);
  assert.throws(() => advanceAcceptedHeadSync({
    domain: 'provider',
    operationId: 'provider-op-offline',
    operationDigest: digestA,
    token: providerToken,
    port: 65534,
    timeoutMs: 200,
  }), /ACCEPTED_HEAD_AUTHORITY_UNAVAILABLE/);
});
