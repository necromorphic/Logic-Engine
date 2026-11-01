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
  const untouched = "export const nativeRoute = 'stock';\n";
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
  await writeFile(join(stRoot, 'src/native-route.js'), untouched);
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
      'src/native-route.js': hash(untouched),
    },
    createdFiles: { 'src/hook.js': hash(hook) },
  };
  await writeFile(manifestPath, JSON.stringify(manifest));
  const manager = new SillyTavernPatchManager({ extensionRoot, stRoot, manifestPath, patchPath });
  return { manager, stRoot, original, patched, patchPath };
}

test('Patch Manager rejects a non-UTF-8 patch artifact', async (t) => {
  const { manager, patchPath } = await fixture(t);
  await writeFile(patchPath, Buffer.from([0xff, 0xfe, 0x00]));
  await assert.rejects(manager.execute('preflight'), /PATCH_ARTIFACT_ENCODING_INVALID/);
});

test('Patch Manager verifies canonical LF patch digest when Windows checks out CRLF text', async (t) => {
  const { manager, patchPath } = await fixture(t);
  const lfPatch = await readFile(patchPath, 'utf8');
  await writeFile(patchPath, lfPatch.replace(/\n/g, '\r\n'));
  assert.equal((await manager.execute('preflight')).status, 'PREFLIGHT_OK');
});

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

test('Patch Manager refuses rollback when an untouched pinned ST route has drifted', async (t) => {
  const { manager, stRoot } = await fixture(t);
  await manager.execute('install');
  const userEdit = "export const nativeRoute = 'user-edited';\\n";
  await writeFile(join(stRoot, 'src/native-route.js'), userEdit);
  await assert.rejects(manager.execute('uninstall'), /ROLLBACK_CONFLICT_USER_CHANGE_PRESERVED/);
  assert.equal(await readFile(join(stRoot, 'src/native-route.js'), 'utf8'), userEdit);
});

test('Patch Manager recovers an interrupted apply journal to the verified baseline', async (t) => {
  const { manager, stRoot, original } = await fixture(t);
  await manager.execute('install');
  const managerDir = join(stRoot, '.logic-engine-patch-manager');
  const state = JSON.parse(await readFile(join(managerDir, 'state.json'), 'utf8'));
  await writeFile(join(managerDir, 'transaction.json'), JSON.stringify({
    manifestId: state.manifestId,
    phase: 'APPLYING',
    backups: state.backups,
    createdFiles: state.createdFiles,
    sourceFilesAfter: state.sourceFilesAfter,
    sourceFilesBefore: state.sourceFilesBefore,
  }));
  assert.equal((await manager.execute('status')).status, 'NOT_INSTALLED');
  assert.equal(await readFile(join(stRoot, 'src/host.js'), 'utf8'), original);
});

test('Patch Manager updates an owned patch by rolling back the previous pinned version first', async (t) => {
  const { manager, stRoot } = await fixture(t);
  await manager.execute('install');

  const extensionRoot = join(stRoot, '..', 'extension');
  const manifestPath = join(extensionRoot, 'patches', 'manifest.json');
  const patchPath = join(extensionRoot, 'patches', 'test.patch');
  const original = "export const host = 'stock';\\n";
  const patchedV2 = "export const host = 'patched-v2';\\n";
  const hookV2 = "export const finalSendHook = 'v2';\\n";
  const patchV2 = [
    '--- a/src/host.js',
    '+++ b/src/host.js',
    '@@ -1 +1 @@',
    "-export const host = 'stock';",
    "+export const host = 'patched-v2';",
    '--- /dev/null',
    '+++ b/src/hook.js',
    '@@ -0,0 +1 @@',
    "+export const finalSendHook = 'v2';",
    '',
  ].join('\\n');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.patch.version = 'test-2';
  manifest.patch.sha256 = hash(patchV2);
  manifest.sourceFiles['src/host.js'].after = hash(patchedV2);
  manifest.createdFiles['src/hook.js'] = hash(hookV2);
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(patchPath, patchV2);

  const updatedManager = new SillyTavernPatchManager({
    extensionRoot,
    stRoot,
    manifestPath,
    patchPath,
  });
  assert.equal((await updatedManager.execute('update')).status, 'INSTALLED');
  assert.equal(await readFile(join(stRoot, 'src/host.js'), 'utf8'), patchedV2);
  assert.equal((await updatedManager.execute('verify')).status, 'INSTALLED_AND_VERIFIED');
});
