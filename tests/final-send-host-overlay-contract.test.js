import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../scripts/sillytavern-patch-manager.mjs', import.meta.url), 'utf8');
const installer = await readFile(new URL('../scripts/install-sillytavern-host-patch-bundle.mjs', import.meta.url), 'utf8');
const attestation = await readFile(new URL('../host-adapter/extension-gateway/server-plugin/st-source-attestation.mjs', import.meta.url), 'utf8');

test('Final-Send accepts shared Host files only through the pinned Host source attestation', () => {
  assert.match(source, /async loadVerifiedHostOverlayManifest\(\)/);
  assert.match(source, /async verifyHostOverlay\(relativePath\)/);
  assert.match(source, /this\._hostOverlayManifestPromise = null/);
  assert.match(source, /verifyPinnedSourceIdentity\(\{ installRoot: this\.stRoot \}\)/);
  assert.match(source, /identity\?\.status !== 'CURRENT_IDENTITIES_VERIFIED'/);
  assert.match(source, /hostManifest\.files\?\.find\(entry => entry\?\.path === relativePath\)/);
  assert.match(source, /sha256\(await readFile\(target\)\) === pinnedFile\.sha256/);
  assert.match(source, /actual !== after && !\(await this\.verifyHostOverlay\(relativePath\)\)/);
});

test('Final-Send keeps fail-closed behavior when Host overlay attestation is unavailable', () => {
  assert.match(source, /Missing or unsafe files never weaken the original Final-Send hash requirement/);
  assert.match(source, /throw new Error\('PATCH_VERIFY_FAILED: ' \+ relativePath\)/);
});

test('Host Bundle installs and pins the updated Patch Manager in the Core plugin', () => {
  assert.match(installer, /plugins\/logic-engine\/scripts\/sillytavern-patch-manager\.mjs/);
  assert.match(installer, /Update this[\s\S]*single managed file transactionally/);
  assert.match(attestation, /'scripts\/sillytavern-patch-manager\.mjs': '84ae3706cd2ba882dbe16539ac3407e9781dae58'/);
});
