import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  PINNED_PATCH_BUNDLE_SHA256,
  PINNED_HOST_HANDLER_GIT_BLOB_SHA,
} from '../host-adapter/extension-gateway/server-plugin/st-source-attestation.mjs';
import { tmpdir } from 'node:os';
import { verifyLegacyHostBundle } from '../scripts/verify-legacy-host-bundle.mjs';

const read = relative => readFileSync(resolve(process.cwd(), relative));
const gitBlobSha = bytes => createHash('sha1')
  .update(Buffer.from('blob ' + bytes.length + '\0', 'utf8'))
  .update(bytes)
  .digest('hex');
const sha256 = value => createHash('sha256').update(value, 'utf8').digest('hex');

test('Host and Core pin the same exact lifecycle patch bundle and inventory handler', () => {
  const core = read('src/application/host-lifecycle-journal.js').toString('utf8');
  const corePatchPin = core.match(/const HOST_INVENTORY_PATCH_BLOB_SHA = '([a-f0-9]{64})';/)?.[1];
  const coreHandlerPin = core.match(/const HOST_INVENTORY_HANDLER_BLOB_SHA = '([a-f0-9]{40})';/)?.[1];

  const lifecyclePatch = gitBlobSha(read('host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-hooks.patch'));
  const rootMutationPatch = gitBlobSha(read('host-adapter/prototype/patches/sillytavern-1.19.0-root-mutation-guards.patch'));
  const actualPatchBundle = sha256([lifecyclePatch, rootMutationPatch].join('\n'));
  const actualHandler = gitBlobSha(read('host-adapter/extension-gateway/server-plugin/st-host-inventory-handler.mjs'));

  assert.equal(PINNED_PATCH_BUNDLE_SHA256, actualPatchBundle,
    'Gateway patch bundle pin must match the exact two reviewed patch layers');
  assert.equal(corePatchPin, PINNED_PATCH_BUNDLE_SHA256,
    'Core must accept only the Gateway-pinned patch bundle');
  assert.equal(PINNED_HOST_HANDLER_GIT_BLOB_SHA, actualHandler,
    'Gateway handler pin must match its exact Git blob identity');
  assert.equal(coreHandlerPin, PINNED_HOST_HANDLER_GIT_BLOB_SHA,
    'Core must accept only the exact Gateway handler blob');
});

test('Legacy Host overlay verification compares canonical LF hashes on every platform', () => {
  const installer = read('scripts/install-sillytavern-host-patch-bundle.mjs').toString('utf8');
  assert.ok(installer.includes('previousHostFileHash === sha256(normalizeText(targetBytes))'),
    'installer must compare the canonical hash returned by verifyLegacyHostBundle');
  assert.equal(installer.includes('previousHostFileHash === sha256(targetBytes)'), false,
    'raw CRLF bytes must not be compared with the canonical LF hash');
});

test('Legacy Host bundle accepts the exact reviewed overlay when Windows materializes CRLF', async t => {
  const root = mkdtempSync(join(tmpdir(), 'legacy-host-bundle-crlf-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const gateway = join(root, 'plugins', 'logic-engine-extension-gateway');
  const sourceDirectory = join(root, 'src');
  const lifecycleDirectory = join(root, 'public', 'scripts', 'logic-engine-lifecycle');
  mkdirSync(gateway, { recursive: true });
  mkdirSync(sourceDirectory, { recursive: true });
  mkdirSync(lifecycleDirectory, { recursive: true });

  const pluginLoader = Buffer.from('export const pinnedHost = true;\n', 'utf8');
  const overlayPath = 'public/scripts/logic-engine-lifecycle/conversation-identity.mjs';
  const overlayLf = 'export const lifecycleIdentity = true;\n';
  const overlayCrLf = overlayLf.replace(/\n/g, '\r\n');
  writeFileSync(join(sourceDirectory, 'plugin-loader.js'), pluginLoader);
  writeFileSync(join(root, overlayPath), overlayCrLf);

  const patchBlobSha = 'a'.repeat(64);
  const proof = {
    pinned_host_commit: 'pinned-test-commit',
    patch_blob_sha: patchBlobSha,
    files: [
      { path: 'src/plugin-loader.js', sha256: createHash('sha256').update(pluginLoader).digest('hex') },
      { path: overlayPath, sha256: createHash('sha256').update(Buffer.alloc(0)).digest('hex') },
    ],
  };
  const canonicalProof = '{' + Object.keys(proof).sort().map(key => JSON.stringify(key) + ':' + JSON.stringify(proof[key])).join(',') + '}';
  const trustedManifestSha256 = createHash('sha256').update(canonicalProof, 'utf8').digest('hex');
  writeFileSync(join(gateway, 'pinned-source-manifest.json'), JSON.stringify({
    ...proof,
    manifest_sha256: trustedManifestSha256,
  }));

  const expectedOverlayHash = createHash('sha256')
    .update(Buffer.from(overlayLf, 'utf8'))
    .digest('hex');
  const result = await verifyLegacyHostBundle({
    installRoot: root,
    expectedPredecessors: [{
      commit: 'pinned-test-commit',
      patchBlobSha,
      manifestSha256: trustedManifestSha256,
    }],
    expectedOverlayFiles: new Map([[overlayPath, expectedOverlayHash]]),
  });
  assert.equal(result.verified, true,
    'the exact canonical Host overlay must remain trusted when Windows changes only line endings');
  assert.equal(result.files.get(overlayPath), expectedOverlayHash);
});
