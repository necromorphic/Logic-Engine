import assert from 'node:assert/strict';
import { lstat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { SillyTavernPatchManager } from './sillytavern-patch-manager.mjs';

const stRoot = resolve(process.argv[2] ?? 'SillyTavern-manager');
const legacyManifestPath = resolve(process.argv[3] ?? 'tests/fixtures/sillytavern-final-send-v1.manifest.json');
const extensionRoot = process.cwd();

const legacy = new SillyTavernPatchManager({
  extensionRoot,
  stRoot,
  manifestPath: legacyManifestPath,
});
assert.equal((await legacy.execute('preflight')).status, 'PREFLIGHT_OK');
assert.equal((await legacy.execute('install')).status, 'INSTALLED');
assert.equal((await legacy.execute('verify')).status, 'INSTALLED_AND_VERIFIED');

const manager = new SillyTavernPatchManager({ extensionRoot, stRoot });
assert.equal((await manager.execute('update')).status, 'INSTALLED');
assert.equal((await manager.execute('update')).status, 'UP_TO_DATE');

const inspection = await manager.inspectInstalledReadOnly();
assert.equal(inspection.status, 'INSTALLED_AND_BACKUPS_VERIFIED');
const expectedBackupCount = Object.values(manager.manifest.sourceFiles)
  .filter(value => value && typeof value === 'object').length;
assert.equal(inspection.verifiedBackupCount, expectedBackupCount);
assert.equal((await manager.execute('verify')).status, 'INSTALLED_AND_VERIFIED');
assert.equal((await manager.execute('uninstall')).status, 'ROLLED_BACK');

for (const [relativePath, pin] of Object.entries(manager.manifest.sourceFiles)) {
  const expected = typeof pin === 'string' ? pin : pin.before;
  assert.equal(await manager.hashAt(relativePath), expected, 'rollback baseline: ' + relativePath);
}
for (const relativePath of Object.keys(manager.manifest.createdFiles)) {
  await assert.rejects(lstat(resolve(stRoot, relativePath)), { code: 'ENOENT' });
}
const diff = execFileSync('git', ['-C', stRoot, 'diff', '--name-only'], { encoding: 'utf8' }).trim();
assert.equal(diff, '', 'upgrade and uninstall must restore the complete tracked SillyTavern tree');

process.stdout.write('PASS: v1-to-v2 upgrade, idempotent update, backup inspection, verify and rollback; '
  + Object.keys(manager.manifest.sourceFiles).length + ' source files restored; '
  + Object.keys(manager.manifest.createdFiles).length + ' created files removed.\n');
