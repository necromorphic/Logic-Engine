import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HOST_BUNDLE_ACCEPTED_IDENTITIES, verifyLegacyHostBundle } from '../scripts/verify-legacy-host-bundle.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);

async function makeLegacyInstall() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'logic-engine-legacy-bundle-'));
  const loader = Buffer.from('trusted previous Host plugin loader\n');
  const gateway = Buffer.from('trusted previous Gateway source\n');
  await mkdir(path.join(root, 'plugins/logic-engine-extension-gateway'), { recursive: true });
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src/plugin-loader.js'), loader);
  await writeFile(path.join(root, 'plugins/logic-engine-extension-gateway/gateway.mjs'), gateway);
  const proof = {
    protocol_version: 1,
    pinned_host_commit: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
    coverage_id: 'test-coverage',
    patch_blob_sha: 'a'.repeat(64),
    host_handler_blob_sha: 'b'.repeat(40),
    files: [
      { path: 'src/plugin-loader.js', sha256: sha256(loader) },
      { path: 'plugins/logic-engine-extension-gateway/gateway.mjs', sha256: sha256(gateway) },
    ],
  };
  const manifestSha = sha256(Buffer.from(canonical(proof), 'utf8'));
  await writeFile(
    path.join(root, 'plugins/logic-engine-extension-gateway/pinned-source-manifest.json'),
    JSON.stringify({ ...proof, manifest_sha256: manifestSha }),
  );
  return { root, manifestSha };
}

test('legacy Host bundle is accepted only when its pinned manifest and every file verify', async () => {
  const fixture = await makeLegacyInstall();
  try {
    const result = await verifyLegacyHostBundle({
      installRoot: fixture.root,
      expectedCommit: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
      expectedPatchBlobSha: 'a'.repeat(64),
      expectedManifestSha256: fixture.manifestSha,
    });
    assert.equal(result.verified, true);
    assert.equal(result.files.has('src/plugin-loader.js'), true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('legacy Host bundle is rejected if any previously pinned file has drifted', async () => {
  const fixture = await makeLegacyInstall();
  try {
    await writeFile(path.join(fixture.root, 'src/plugin-loader.js'), 'unreviewed change\n');
    const result = await verifyLegacyHostBundle({
      installRoot: fixture.root,
      expectedCommit: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
      expectedPatchBlobSha: 'a'.repeat(64),
      expectedManifestSha256: fixture.manifestSha,
    });
    assert.equal(result.verified, false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('legacy Host bundle accepts only an exact independently reconstructed Host overlay', async () => {
  const fixture = await makeLegacyInstall();
  try {
    const overlay = Buffer.from('reviewed current Host overlay\\n');
    await writeFile(path.join(fixture.root, 'src/plugin-loader.js'), overlay);
    const result = await verifyLegacyHostBundle({
      installRoot: fixture.root,
      expectedPredecessors: [{
        commit: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
        patchBlobSha: 'a'.repeat(64),
        manifestSha256: fixture.manifestSha,
      }],
      expectedOverlayFiles: new Map([
        ['src/plugin-loader.js', sha256(overlay)],
      ]),
    });
    assert.equal(result.verified, true);
    assert.equal(result.files.get('src/plugin-loader.js'), sha256(overlay));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('legacy Host bundle accepts the exact reconstructed Host overlay with Windows CRLF line endings', async () => {
  const fixture = await makeLegacyInstall();
  try {
    const overlay = Buffer.from('reviewed current Host overlay\r\n');
    await writeFile(path.join(fixture.root, 'src/plugin-loader.js'), overlay);
    const result = await verifyLegacyHostBundle({
      installRoot: fixture.root,
      expectedPredecessors: [{
        commit: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
        patchBlobSha: 'a'.repeat(64),
        manifestSha256: fixture.manifestSha,
      }],
      expectedOverlayFiles: new Map([
        ['src/plugin-loader.js', sha256(Buffer.from('reviewed current Host overlay\n'))],
      ]),
    });
    assert.equal(result.verified, true);
    assert.equal(result.files.get('src/plugin-loader.js'), sha256(Buffer.from('reviewed current Host overlay\n')));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('legacy Host bundle rejects an overlay that differs from the reconstructed output', async () => {
  const fixture = await makeLegacyInstall();
  try {
    await writeFile(path.join(fixture.root, 'src/plugin-loader.js'), 'unreviewed overlay\\n');
    const result = await verifyLegacyHostBundle({
      installRoot: fixture.root,
      expectedPredecessors: [{
        commit: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
        patchBlobSha: 'a'.repeat(64),
        manifestSha256: fixture.manifestSha,
      }],
      expectedOverlayFiles: new Map([
        ['src/plugin-loader.js', sha256(Buffer.from('different reviewed output\\n'))],
      ]),
    });
    assert.equal(result.verified, false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('legacy Host bundle is rejected when its manifest pin is not the expected predecessor', async () => {
  const fixture = await makeLegacyInstall();
  try {
    const result = await verifyLegacyHostBundle({
      installRoot: fixture.root,
      expectedCommit: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
      expectedPatchBlobSha: 'c'.repeat(64),
      expectedManifestSha256: fixture.manifestSha,
    });
    assert.equal(result.verified, false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});


test('current Host bundle identity is pinned for idempotent repeat installation', () => {
  assert.ok(HOST_BUNDLE_ACCEPTED_IDENTITIES.some(pin =>
    pin.commit === '06bde939fb1e9c4c8d8641d810f0a916b5bce127'
    && pin.patchBlobSha === '27f65e72e691f779806104df45e49b155a65545234c1e9accdc00a11c6cc1e5d'
    && pin.manifestSha256 === '069b75d60b256d4b5e98dce164e614fee8422af3f54a110b4e8dcd5b47143792'),
  'the exact current bundle and source manifest digests must be accepted');
});

test('current identity pin still requires the manifest and every installed file to verify', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'logic-engine-current-bundle-'));
  try {
    const relativePath = 'public/script.js';
    const bytes = Buffer.from("export const host = 'current';\\n", 'utf8');
    const patchBlobSha = '27f65e72e691f779806104df45e49b155a65545234c1e9accdc00a11c6cc1e5d';
    const proof = {
      pinned_host_commit: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
      patch_blob_sha: patchBlobSha,
      protocol_version: 1,
      files: [{ path: relativePath, sha256: sha256(bytes) }],
    };
    const manifest = {
      ...proof,
      manifest_sha256: sha256(Buffer.from(canonical(proof), 'utf8')),
    };
    await mkdir(path.join(root, 'plugins/logic-engine-extension-gateway'), { recursive: true });
    await mkdir(path.join(root, 'public'), { recursive: true });
    await writeFile(path.join(root, relativePath), bytes);
    await writeFile(
      path.join(root, 'plugins/logic-engine-extension-gateway/pinned-source-manifest.json'),
      JSON.stringify(manifest),
    );
    const pin = {
      commit: proof.pinned_host_commit,
      patchBlobSha,
      manifestSha256: manifest.manifest_sha256,
    };

    const verified = await verifyLegacyHostBundle({
      installRoot: root,
      expectedPredecessors: [pin],
    });
    assert.equal(verified.verified, true);

    await writeFile(path.join(root, relativePath), "export const host = 'unreviewed';\\n");
    const drifted = await verifyLegacyHostBundle({
      installRoot: root,
      expectedPredecessors: [pin],
    });
    assert.equal(drifted.verified, false, 'a local edit must invalidate the previously trusted bundle');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
