import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHostRootInventoryPersistence } from '../server-plugin/st-server-digest-proxy.mjs';
import {
  PINNED_PATCH_BUNDLE_SHA256,
  PINNED_HOST_HANDLER_GIT_BLOB_SHA,
} from '../server-plugin/st-source-attestation.mjs';

const sha256 = value => createHash('sha256').update(value, 'utf8').digest('hex');
const canonical = value => Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);

function fakeResponse(status, payload) {
  return { status, ok: status >= 200 && status < 300, json: async () => payload };
}

test('root inventory proxy signs a VSS-aligned pinned-source attestation after Core baseline acceptance', async t => {
  const previousDataRoot = globalThis.DATA_ROOT;
  globalThis.DATA_ROOT = path.resolve(tmpdir(), 'logic-engine-global-data-root');
  t.after(() => {
    if (previousDataRoot === undefined) delete globalThis.DATA_ROOT;
    else globalThis.DATA_ROOT = previousDataRoot;
  });
  const env = {
    LOGIC_ENGINE_CORE_URL: 'http://127.0.0.1:8080',
    LOGIC_ENGINE_API_TOKEN: 'core-api-token-at-least-16',
    LOGIC_ENGINE_ADAPTER_ID: 'test-adapter',
    LOGIC_ENGINE_ADAPTER_TOKEN: 'adapter-secret-at-least-16',
  };
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: new URL(url), options });
    if (new URL(url).pathname === '/v1/host-root-inventory/baseline') {
      return fakeResponse(200, { inventory_status: 'REVIEW_ONLY', reconciliation: {
        status: 'BASELINED_REVIEW_ONLY',
        integrity_status: 'INTEGRITY_OK',
        authority_status: 'REVIEW_ONLY',
        sequence: 1,
        manifest_sha256: 'a'.repeat(64),
        journal_head_sha256: 'b'.repeat(64),
        lifecycle_sequence: 1,
        lifecycle_head_sha256: 'c'.repeat(64),
      } });
    }
    if (new URL(url).pathname === '/v1/host-root-inventory/attest') {
      return fakeResponse(200, { inventory_status: 'AUTHORITATIVE_COMPLETE', reconciliation: {
        status: 'AUTHORITATIVE_COMPLETE',
        integrity_status: 'INTEGRITY_OK',
        sequence: 1,
        manifest_sha256: 'a'.repeat(64),
        journal_head_sha256: 'b'.repeat(64),
        lifecycle_sequence: 1,
        lifecycle_head_sha256: '0'.repeat(64),
        source_manifest_sha256: 'e'.repeat(64),
      } });
    }
    throw new Error('unexpected Core path');
  };
  const identityStore = {
    directory: path.resolve(tmpdir(), 'host-identity-store'),
    assertOutsideRoot: async () => {},
    resolveAuthenticatedAccount: async handle => ({
      host_installation_id: '11111111-1111-4111-8111-111111111111',
      authenticated_account_id: '22222222-2222-4222-8222-222222222222',
    }),
  };
  const persist = createHostRootInventoryPersistence({ env, fetchImpl, identityStore });
  const result = await persist({
    userHandle: 'alice',
    rootPath: path.resolve(tmpdir(), 'st-account-data'),
    entries: [{
      path: 'data/file.json',
      identity: { dev: '1', ino: '2', mode: 33188, size: 4, mtimeMs: 1, ctimeMs: 1 },
      sha256: 'c'.repeat(64),
    }],
    snapshotAlignment: 'SHARED_VSS_SNAPSHOT',
    snapshotSha256: 'd'.repeat(64),
    sourceIdentity: {
      status: 'CURRENT_IDENTITIES_VERIFIED',
      patch_blob_sha: PINNED_PATCH_BUNDLE_SHA256,
      host_handler_blob_sha: PINNED_HOST_HANDLER_GIT_BLOB_SHA,
      manifest_sha256: 'e'.repeat(64),
    },
  });
  assert.equal(result.status, 'AUTHORITATIVE_COMPLETE');
  assert.equal(result.integrity_status, 'INTEGRITY_OK');
  assert.equal(result.source_manifest_sha256, 'e'.repeat(64));
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url.pathname, '/v1/host-root-inventory/attest');
  assert.equal(JSON.parse(calls[0].options.body).source_manifest_sha256, 'e'.repeat(64));
  const body = JSON.parse(calls[1].options.body);
  assert.equal(body.attestation.snapshot_alignment, 'SHARED_VSS_SNAPSHOT');
  assert.equal(body.attestation.snapshot_sha256, 'd'.repeat(64));
  assert.equal(body.attestation.covered_delta_sha256, null);
  assert.equal(body.attestation.source_manifest_sha256, 'e'.repeat(64));
  const { signature, ...proof } = body.attestation;
  const expected = createHmac('sha256', env.LOGIC_ENGINE_ADAPTER_TOKEN)
    .update(canonical(proof), 'utf8').digest('hex');
  assert.equal(signature, expected);
  assert.equal(body.attestation.patch_blob_sha, PINNED_PATCH_BUNDLE_SHA256);
  assert.equal(body.attestation.host_handler_blob_sha, PINNED_HOST_HANDLER_GIT_BLOB_SHA);
});

test('root inventory proxy does not attest an independent scan or unverified source identity', async t => {
  const previousDataRoot = globalThis.DATA_ROOT;
  globalThis.DATA_ROOT = path.resolve(tmpdir(), 'logic-engine-global-data-root');
  t.after(() => {
    if (previousDataRoot === undefined) delete globalThis.DATA_ROOT;
    else globalThis.DATA_ROOT = previousDataRoot;
  });
  const env = {
    LOGIC_ENGINE_CORE_URL: 'http://127.0.0.1:8080',
    LOGIC_ENGINE_API_TOKEN: 'core-api-token-at-least-16',
    LOGIC_ENGINE_ADAPTER_ID: 'test-adapter',
    LOGIC_ENGINE_ADAPTER_TOKEN: 'adapter-secret-at-least-16',
  };
  const paths = [];
  const persist = createHostRootInventoryPersistence({
    env,
    identityStore: {
      assertOutsideRoot: async () => {},
      resolveAuthenticatedAccount: async () => ({
        host_installation_id: '11111111-1111-4111-8111-111111111111',
        authenticated_account_id: '22222222-2222-4222-8222-222222222222',
      }),
    },
    fetchImpl: async url => {
      paths.push(new URL(url).pathname);
      return fakeResponse(200, { inventory_status: 'REVIEW_ONLY', reconciliation: {
        status: 'BASELINED_REVIEW_ONLY',
        integrity_status: 'INTEGRITY_OK',
        sequence: 1,
        manifest_sha256: 'a'.repeat(64),
        journal_head_sha256: 'b'.repeat(64),
        lifecycle_sequence: 0,
        lifecycle_head_sha256: '0'.repeat(64),
      } });
    },
  });
  const result = await persist({
    userHandle: 'alice',
    rootPath: path.resolve(tmpdir(), 'st-account-data'),
    entries: [{
      path: 'data/file.json',
      identity: { dev: '1', ino: '2', mode: 33188, size: 4, mtimeMs: 1, ctimeMs: 1 },
      sha256: 'c'.repeat(64),
    }],
    snapshotAlignment: 'INDEPENDENT_DOUBLE_SCAN',
    snapshotSha256: 'd'.repeat(64),
    sourceIdentity: { status: 'NON_READY' },
  });
  assert.equal(result.status, 'BASELINED_REVIEW_ONLY');
  assert.deepEqual(paths, ['/v1/host-root-inventory/baseline']);
});
