import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../scripts/sillytavern-patch-manager.mjs', import.meta.url), 'utf8');

test('Final-Send accepts shared Host files only through the pinned Host source attestation', () => {
  assert.match(source, /async verifyHostOverlay\(relativePath\)/);
  assert.match(source, /verifyPinnedSourceIdentity\(\{ installRoot: this\.stRoot \}\)/);
  assert.match(source, /identity\?\.status !== 'CURRENT_IDENTITIES_VERIFIED'/);
  assert.match(source, /hostManifest\.files\?\.find\(entry => entry\?\.path === relativePath\)/);
  assert.match(source, /sha256\(await readFile\(target\)\) === pinnedFile\.sha256/);
  assert.match(source, /actual !== after && !\(await this\.verifyHostOverlay\(relativePath\)\)/);
});

test('Final-Send keeps fail-closed behavior when Host overlay attestation is unavailable', () => {
  assert.match(source, /Missing, malformed, or non-matching Host attestation never weakens/);
  assert.match(source, /throw new Error\('PATCH_VERIFY_FAILED: ' \+ relativePath\)/);
});
