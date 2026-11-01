import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SillyTavernPatchManager } from '../scripts/sillytavern-patch-manager.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'logic-engine-st-patch-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const extensionRoot = join(root, 'extension');
  const stRoot = join(root, 'SillyTavern');
  await mkdir(join(extensionRoot, 'patches'), { recursive: true });
  await mkdir(join(stRoot, 'src'), { recursive: true });
  const original = "export const host = 'stock';\n";
  const patched = "export const host = 'patched';\n";
  const hook = "export const finalSendHook = true;\n";
  const patch = [
    '--- a/src/host.js',
    '+++ b/src/host.js',
    '@@ -1 +1 @@',
    "-export const host = 'stock';",
    "+export const host = 'patched';",
    '--- /dev/null',
    '+++ b/src/hook.js',
    '@@ -0,0 +1 @@',
    '+export const finalSendHook = true;',
    '',
  ].join('\n');
  await writeFile(join(stRoot, 'package.json'), JSON.stringify({ version: '1.19.0' }));
  await writeFile(join(stRoot, 'src/host.js'), original);
  const patchPath = join(extensionRoot, 'patches', 'test.patch');
  const manifestPath = join(extensionRoot, 'patches', 'manifest.json');
  await writeFile(patchPath, patch);
  const manifest = {
    id: 'logic-engine-sillytavern-final-send',
    host: { name: 'SillyTavern', version: '1.19.0', commit: '06bde939fb1e9c4c8d8641d810f0a916b5bce127' },
    patch: { version: 'test', sha256: hash(patch) },
    sourceFiles: {
      'package.json': hash(await readFile(join(stRoot, 'package.json'))),
      'src/host.js': { before: hash(original), after: hash(patched) },
    },
    createdFiles: { 'src/hook.js': hash(hook) },
  };
  await writeFile(manifestPath, JSON.stringify(manifest));
  const manager = new SillyTavernPatchManager({ extensionRoot, stRoot, manifestPath, patchPath });
  return { manager, stRoot, original, patched };
}

test('Patch Manager performs preflight, backup, apply, verify and uninstall', async (t) => {
  const { manager, stRoot, original, patched } = await fixture(t);
  assert.equal((await manager.execute('preflight')).status, 'PREFLIGHT_OK');
  assert.equal((await manager.execute('install')).status, 'INSTALLED');
  assert.equal(await readFile(join(stRoot, 'src/host.js'), 'utf8'), patched);
  assert.equal((await manager.execute('verify')).status, 'INSTALLED_AND_VERIFIED');
  assert.equal((await manager.execute('uninstall')).status, 'ROLLED_BACK');
  assert.equal(await readFile(join(stRoot, 'src/host.js'), 'utf8'), original);
});

test('Patch Manager refuses user edits and preserves the conflicting file on rollback', async (t) => {
  const { manager, stRoot } = await fixture(t);
  await manager.execute('install');
  const userEdit = "export const host = 'user-owned change';\n";
  await writeFile(join(stRoot, 'src/host.js'), userEdit);
  await assert.rejects(manager.execute('uninstall'), /ROLLBACK_CONFLICT_USER_CHANGE_PRESERVED/);
  assert.equal(await readFile(join(stRoot, 'src/host.js'), 'utf8'), userEdit);
});

test('Patch Manager denies unknown source revisions before writing backups or patches', async (t) => {
  const { manager, stRoot } = await fixture(t);
  await writeFile(join(stRoot, 'src/host.js'), 'export const host = "locally modified";\n');
  await assert.rejects(manager.execute('install'), /SILLYTAVERN_SOURCE_CONFLICT/);
  assert.equal(await readFile(join(stRoot, 'src/host.js'), 'utf8'), 'export const host = "locally modified";\n');
});

test('Patch Manager repair restores the pinned patch when the installed tree is intact', async (t) => {
  const { manager, stRoot, patched } = await fixture(t);
  await manager.execute('install');
  assert.equal((await manager.execute('repair')).status, 'INSTALLED');
  assert.equal(await readFile(join(stRoot, 'src/host.js'), 'utf8'), patched);
});
