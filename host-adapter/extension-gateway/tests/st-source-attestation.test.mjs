import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  HOST_INVENTORY_COVERAGE_ID,
  PINNED_HOST_COMMIT,
  PINNED_PATCH_BUNDLE_SHA256,
  PINNED_HOST_HANDLER_GIT_BLOB_SHA,
  SOURCE_FILE_PATHS,
  createSignedRootInventoryAttestation,
  verifyPinnedSourceIdentity,
} from '../server-plugin/st-source-attestation.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);

test('pinned source manifest covers every installed Gateway helper', () => {
  assert.ok(SOURCE_FILE_PATHS.includes('plugins/package.json'),
    'source manifest must pin the SillyTavern plugin-root package manifest');
  assert.ok(SOURCE_FILE_PATHS.includes('public/scripts/extensions.js'),
    'source manifest must pin the SillyTavern browser extension loader');
  for (const name of [
    'index.mjs',
    'package.json',
    'host-adapter.mjs',
    'host-data-inventory.mjs',
    'st-host-identity-store.mjs',
    'st-host-inventory-handler.mjs',
    'st-host-lifecycle-receipt-store.mjs',
    'st-mutation-route-contract.mjs',
    'st-host-session-revocation.mjs',
    'st-server-digest-proxy.mjs',
    'st-source-attestation.mjs',
    'st-source-inventory.mjs',
    'filesystem-reconciliation.mjs',
    'fs-inventory.js',
    'windows-vss-snapshot.mjs',
  ]) {
    assert.ok(SOURCE_FILE_PATHS.includes('plugins/logic-engine-extension-gateway/' + name),
      'source manifest omits installed Gateway helper: ' + name);
  }
});

async function createManifestRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'host-source-attestation-'));
  const files = [];
  for (const relative of SOURCE_FILE_PATHS) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    const bytes = Buffer.from('pinned fixture:' + relative);
    await writeFile(target, bytes);
    files.push({ path: relative, sha256: sha256(bytes) });
  }
  await writeFile(path.join(root, 'plugins/.gitkeep'), '');
  await writeFile(path.join(root, 'public/scripts/extensions/third-party/.gitkeep'), '');
  const proof = {
    protocol_version: 1,
    pinned_host_commit: PINNED_HOST_COMMIT,
    coverage_id: HOST_INVENTORY_COVERAGE_ID,
    patch_blob_sha: PINNED_PATCH_BUNDLE_SHA256,
    host_handler_blob_sha: PINNED_HOST_HANDLER_GIT_BLOB_SHA,
    files,
  };
  const manifest = { ...proof, manifest_sha256: sha256(Buffer.from(canonical(proof), 'utf8')) };
  const manifestPath = path.join(root, 'plugins/logic-engine-extension-gateway/pinned-source-manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest));
  return { root, manifestPath };
}

test('pinned source verifier accepts only the exact manifest and matching deployed files', async t => {
  const fixture = await createManifestRoot();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const verified = await verifyPinnedSourceIdentity({ installRoot: fixture.root });
  assert.equal(verified.status, 'CURRENT_IDENTITIES_VERIFIED');
  assert.equal(verified.pinned_host_commit, PINNED_HOST_COMMIT);
  assert.equal(verified.patch_blob_sha, PINNED_PATCH_BUNDLE_SHA256);
  assert.equal(verified.host_handler_blob_sha, PINNED_HOST_HANDLER_GIT_BLOB_SHA);
  const tamperedPath = path.join(fixture.root, SOURCE_FILE_PATHS[0]);
  await writeFile(tamperedPath, 'modified after manifest');
  const rejected = await verifyPinnedSourceIdentity({ installRoot: fixture.root });
  assert.equal(rejected.status, 'NON_READY');
  assert.equal(rejected.code, 'HOST_SOURCE_FILE_DIGEST_MISMATCH');
});

test('pinned source verifier rejects mutation-route contract drift', async t => {
  const fixture = await createManifestRoot();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const routeContract = path.join(
    fixture.root,
    'plugins/logic-engine-extension-gateway/st-mutation-route-contract.mjs',
  );
  await writeFile(routeContract, 'tampered route coverage contract');
  const rejected = await verifyPinnedSourceIdentity({ installRoot: fixture.root });
  assert.equal(rejected.status, 'NON_READY');
  assert.equal(rejected.code, 'HOST_SOURCE_FILE_DIGEST_MISMATCH');
});

test('pinned source verifier does not accept a caller-selected manifest outside the installed Gateway', async t => {
  const fixture = await createManifestRoot();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const rejected = await verifyPinnedSourceIdentity({
    installRoot: fixture.root,
    manifestPath: path.join(fixture.root, 'attacker-controlled-manifest.json'),
  });
  assert.equal(rejected.status, 'NON_READY');
  assert.equal(rejected.code, 'HOST_SOURCE_MANIFEST_PATH_INVALID');
});

test('pinned source verifier rejects unmanifested installed Gateway files', async t => {
  const fixture = await createManifestRoot();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const extra = path.join(fixture.root, 'plugins/logic-engine-extension-gateway/unmanifested-helper.mjs');
  await writeFile(extra, 'not covered by the deployment manifest');
  const rejected = await verifyPinnedSourceIdentity({ installRoot: fixture.root });
  assert.equal(rejected.status, 'NON_READY');
  assert.equal(rejected.code, 'HOST_SOURCE_DIRECTORY_CONTENT_MISMATCH');
});

test('pinned source verifier rejects user-local third-party extensions', async t => {
  const fixture = await createManifestRoot();
  const userExtensionsPath = path.join(fixture.root, 'user-data/extensions');
  await mkdir(userExtensionsPath, { recursive: true });
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const clean = await verifyPinnedSourceIdentity({
    installRoot: fixture.root,
    userExtensionsPath,
  });
  assert.equal(clean.status, 'CURRENT_IDENTITIES_VERIFIED');
  await mkdir(path.join(userExtensionsPath, 'unreviewed-local-extension'));
  const rejected = await verifyPinnedSourceIdentity({
    installRoot: fixture.root,
    userExtensionsPath,
  });
  assert.equal(rejected.status, 'NON_READY');
  assert.equal(rejected.code, 'HOST_UNREVIEWED_USER_EXTENSION_PRESENT');
});

test('pinned source verifier rejects an unattested server plugin', async t => {
  const fixture = await createManifestRoot();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await mkdir(path.join(fixture.root, 'plugins/unreviewed-plugin'), { recursive: true });
  const rejected = await verifyPinnedSourceIdentity({ installRoot: fixture.root });
  assert.equal(rejected.status, 'NON_READY');
  assert.equal(rejected.code, 'HOST_SOURCE_DIRECTORY_CONTENT_MISMATCH');
});

test('pinned source verifier rejects an unattested third-party browser extension', async t => {
  const fixture = await createManifestRoot();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await mkdir(path.join(fixture.root, 'public/scripts/extensions/third-party/unreviewed-extension'), { recursive: true });
  const rejected = await verifyPinnedSourceIdentity({ installRoot: fixture.root });
  assert.equal(rejected.status, 'NON_READY');
  assert.equal(rejected.code, 'HOST_SOURCE_DIRECTORY_CONTENT_MISMATCH');
});

test('root inventory attestation signs the exact accepted snapshot envelope', async t => {
  const adapterToken = 'test-adapter-secret-at-least-16';
  const sourceIdentity = {
    status: 'CURRENT_IDENTITIES_VERIFIED',
    manifest_sha256: 'a'.repeat(64),
    patch_blob_sha: PINNED_PATCH_BUNDLE_SHA256,
    host_handler_blob_sha: PINNED_HOST_HANDLER_GIT_BLOB_SHA,
  };
  const input = {
    adapterId: 'test-adapter',
    adapterToken,
    identity: {
      host_installation_id: '11111111-1111-4111-8111-111111111111',
      authenticated_account_id: '22222222-2222-4222-8222-222222222222',
      root_id: 'a'.repeat(64),
    },
    reconciliation: {
      integrity_status: 'INTEGRITY_OK',
      sequence: 4,
      manifest_sha256: 'b'.repeat(64),
      journal_head_sha256: 'c'.repeat(64),
      delta_sha256: 'd'.repeat(64),
      lifecycle_sequence: 7,
      lifecycle_head_sha256: 'e'.repeat(64),
    },
    snapshotAlignment: 'SHARED_VSS_SNAPSHOT',
    snapshotSha256: 'f'.repeat(64),
    sourceIdentity,
    now: () => 1700000000000,
    createNonce: () => '33333333-3333-4333-8333-333333333333',
  };
  const attestation = createSignedRootInventoryAttestation(input);
  assert.throws(() => createSignedRootInventoryAttestation({
    ...input,
    reconciliation: { ...input.reconciliation, lifecycle_sequence: 0 },
  }), /HOST_ROOT_INVENTORY_ATTESTATION_INPUT_NON_READY/);
  const { signature, ...proof } = attestation;
  const expected = createHmac('sha256', adapterToken).update(canonical(proof), 'utf8').digest('hex');
  assert.equal(signature, expected);
  assert.equal(attestation.covered_delta_sha256, 'd'.repeat(64));
  assert.equal(attestation.source_manifest_sha256, 'a'.repeat(64));
  assert.equal(attestation.snapshot_alignment, 'SHARED_VSS_SNAPSHOT');
  assert.equal(attestation.source_identity_status, 'CURRENT_IDENTITIES_VERIFIED');
});
