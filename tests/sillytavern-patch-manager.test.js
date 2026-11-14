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
  return { manager, stRoot, extensionRoot, original, patched, patchPath };
}

test('Patch Manager hashes pinned source text canonically across CRLF checkouts', async (t) => {
  const { manager, stRoot, original } = await fixture(t);
  const sourcePath = join(stRoot, 'src/host.js');
  await writeFile(sourcePath, original.replace(/\n/g, '\r\n'));
  await manager.initialize();
  assert.equal(await manager.hashAt('src/host.js'), hash(original));
});

test('Patch Manager applies exact source hunks on CRLF Windows checkouts and preserves line endings', async (t) => {
  const { manager, stRoot, patched } = await fixture(t);
  const sourcePath = join(stRoot, 'src/host.js');
  const crlfOriginal = "export const host = 'stock';\r\n";
  await writeFile(sourcePath, crlfOriginal);
  assert.equal((await manager.execute('preflight')).status, 'PREFLIGHT_OK');
  assert.equal(await readFile(sourcePath, 'utf8'), crlfOriginal, 'preflight must not mutate the installed source');
  assert.equal((await manager.execute('install')).status, 'INSTALLED');
  assert.equal(await readFile(sourcePath, 'utf8'), patched.replace(/\n/g, '\r\n'));
  assert.equal((await manager.inspectInstalledReadOnly()).status, 'INSTALLED_AND_BACKUPS_VERIFIED');
});

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


test('Patch Manager applies contextual hunks from a CRLF-checked-out patch artifact', async (t) => {
  const { manager, stRoot, patchPath } = await fixture(t);
  const original = "const before = true;\nexport const host = 'stock';\nconst after = true;\n";
  const patched = "const before = true;\nexport const host = 'patched';\nconst after = true;\n";
  const sourcePath = join(stRoot, 'src/host.js');
  await writeFile(sourcePath, original.replace(/\n/g, String.fromCharCode(13, 10)));

  const contextualPatch = [
    '--- a/src/host.js',
    '+++ b/src/host.js',
    '@@ -1,3 +1,3 @@',
    ' const before = true;',
    "-export const host = 'stock';",
    "+export const host = 'patched';",
    ' const after = true;',
    '',
  ].join('\n');
  const manifest = JSON.parse(await readFile(manager.manifestPath, 'utf8'));
  manifest.sourceFiles['src/host.js'] = {
    before: hash(Buffer.from(original, 'utf8')),
    after: hash(Buffer.from(patched, 'utf8')),
  };
  manifest.createdFiles = {};
  manifest.patch.sha256 = hash(Buffer.from(contextualPatch, 'utf8'));
  await writeFile(manager.manifestPath, JSON.stringify(manifest));
  await writeFile(patchPath, contextualPatch.replace(/\n/g, String.fromCharCode(13, 10)));

  assert.equal((await manager.execute('preflight')).status, 'PREFLIGHT_OK');
  assert.equal((await manager.execute('install')).status, 'INSTALLED');
  assert.equal(await readFile(sourcePath, 'utf8'), patched.replace(/\n/g, String.fromCharCode(13, 10)));
});

test('Patch Manager performs preflight, backup, apply, verify and uninstall', async (t) => {
  const { manager, stRoot, original, patched } = await fixture(t);
  assert.equal((await manager.execute('preflight')).status, 'PREFLIGHT_OK');
  assert.equal((await manager.execute('install')).status, 'INSTALLED');
  assert.equal((await readFile(join(stRoot, 'src/host.js'), 'utf8')).replace(/\r\n/g, '\n'), patched);
  assert.equal((await manager.execute('verify')).status, 'INSTALLED_AND_VERIFIED');
  assert.equal((await manager.execute('uninstall')).status, 'ROLLED_BACK');
  assert.equal(await readFile(join(stRoot, 'src/host.js'), 'utf8'), original);
});

test('read-only deployment inspection verifies installed files and every pinned backup', async (t) => {
  const { manager, stRoot } = await fixture(t);
  await manager.execute('install');
  const result = await manager.inspectInstalledReadOnly();
  assert.equal(result.status, 'INSTALLED_AND_BACKUPS_VERIFIED');
  assert.equal(result.verifiedBackupCount, 1);

  const backup = join(stRoot, 'data', 'logic-engine', 'final-send-patch', 'backups',
    JSON.parse(await readFile(join(stRoot, 'data', 'logic-engine', 'final-send-patch', 'state.json'), 'utf8')).backupId,
    'src/host.js');
  await writeFile(backup, 'tampered backup\\n');
  await assert.rejects(manager.inspectInstalledReadOnly(), /PATCH_MANAGER_BACKUP_INTEGRITY_MISMATCH/);
});

test('read-only deployment inspection refuses an ambiguous transaction journal', async (t) => {
  const { manager, stRoot } = await fixture(t);
  await manager.execute('install');
  await writeFile(join(stRoot, 'data', 'logic-engine', 'final-send-patch', 'transaction.json'), JSON.stringify({ phase: 'APPLYING' }));
  assert.equal((await manager.inspectInstalledReadOnly()).status, 'AMBIGUOUS_TRANSACTION');
});

test('rollback accepts canonical backup bytes from a CRLF Windows checkout', async (t) => {
  const { manager, stRoot } = await fixture(t);
  await manager.execute('install');
  const statePath = join(stRoot, 'data', 'logic-engine', 'final-send-patch', 'state.json');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  const backupPath = join(stRoot, 'data', 'logic-engine', 'final-send-patch', state.backups['src/host.js'].backupPath);
  const originalBackup = await readFile(backupPath, 'utf8');
  await writeFile(backupPath, originalBackup.replace(/\\n/g, '\\r\\n'));
  assert.equal((await manager.execute('uninstall')).status, 'ROLLED_BACK');
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
  assert.equal((await readFile(join(stRoot, 'src/host.js'), 'utf8')).replace(/\r\n/g, '\n'), patched);
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
  const managerDir = join(stRoot, 'data', 'logic-engine', 'final-send-patch');
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

test('Patch Manager updates a changed artifact even when its version label is unchanged', async (t) => {
  const { manager, stRoot } = await fixture(t);
  await manager.execute('install');

  const extensionRoot = join(stRoot, '..', 'extension');
  const manifestPath = join(extensionRoot, 'patches', 'manifest.json');
  const patchPath = join(extensionRoot, 'patches', 'test.patch');
  const original = "export const host = 'stock';\n";
  const patchedV2 = "export const host = 'patched-v2';\n";
  const hookV2 = "export const finalSendHook = 'v2';\n";
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
  ].join('\n');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
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
  await assert.rejects(
    updatedManager.inspectInstalledReadOnly(),
    /PATCH_MANAGER_STATE_IDENTITY_INVALID/,
    'read-only inspection must reject the predecessor state before migration',
  );
  assert.equal((await updatedManager.execute('update')).status, 'INSTALLED');
  assert.equal((await updatedManager.inspectInstalledReadOnly()).status, 'INSTALLED_AND_BACKUPS_VERIFIED');
  assert.equal((await readFile(join(stRoot, 'src/host.js'), 'utf8')).replace(/\r\n/g, '\n'), patchedV2);
  assert.equal((await updatedManager.execute('verify')).status, 'INSTALLED_AND_VERIFIED');
});


test('Patch Manager defers Host attestation regeneration for an independently verified predecessor overlay', async (t) => {
  const { manager, stRoot, extensionRoot } = await fixture(t);
  await manager.execute('install');

  // src/host.js is a Final-Send managed file. This exercises the exact
  // rollback exception rather than an unrelated Host-only file.
  const overlayBytes = Buffer.from("export const host = 'legacy-host-overlay';\n", 'utf8');
  const overlayHash = hash(overlayBytes);
  await writeFile(join(stRoot, 'src/host.js'), overlayBytes);

  const gatewayDir = join(stRoot, 'plugins/logic-engine-extension-gateway');
  await mkdir(gatewayDir, { recursive: true });
  await writeFile(join(gatewayDir, 'st-source-attestation.mjs'),
    "export async function verifyPinnedSourceIdentity() { return { status: 'CURRENT_IDENTITIES_VERIFIED' }; }\n");
  await writeFile(join(gatewayDir, 'pinned-source-manifest.json'),
    JSON.stringify({ files: [{ path: 'src/host.js', sha256: overlayHash }] }));

  const generatorDir = join(extensionRoot, 'host-adapter/prototype');
  await mkdir(generatorDir, { recursive: true });
  await writeFile(join(generatorDir, 'generate-pinned-source-manifest.mjs'),
    "throw new Error('LEGACY_HOST_GENERATOR_MUST_NOT_RUN_DURING_PREDECESSOR_MIGRATION');\n");

  const manifestPath = join(extensionRoot, 'patches/manifest.json');
  const patchPath = join(extensionRoot, 'patches/test.patch');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const patchedV2 = "export const host = 'patched-v2';\n";
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
  ].join('\n');
  manifest.patch.sha256 = hash(patchV2);
  manifest.sourceFiles['src/host.js'].after = hash(patchedV2);
  manifest.createdFiles['src/hook.js'] = hash("export const finalSendHook = 'v2';\n");
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(patchPath, patchV2);

  const updatedManager = new SillyTavernPatchManager({
    extensionRoot,
    stRoot,
    manifestPath,
    patchPath,
    trustedHostOverlayFiles: new Map([['src/host.js', overlayHash]]),
  });
  await assert.rejects(updatedManager.inspectInstalledReadOnly(), /PATCH_MANAGER_STATE_IDENTITY_INVALID/);
  assert.equal((await updatedManager.execute('update')).status, 'INSTALLED');
  assert.equal((await updatedManager.inspectInstalledReadOnly()).status, 'INSTALLED_AND_BACKUPS_VERIFIED');
  assert.equal(await readFile(join(stRoot, 'src/host.js'), 'utf8'), patchedV2, 'migration safely restores the trusted shared-file baseline and applies the new Final-Send patch');
});

test('Patch Manager backups survive removal of the Logic-Engine Extension directory', async (t) => {
  const { manager, stRoot, extensionRoot, original } = await fixture(t);
  await manager.execute('install');
  const managerDir = join(stRoot, 'data', 'logic-engine', 'final-send-patch');
  const state = JSON.parse(await readFile(join(managerDir, 'state.json'), 'utf8'));
  const backupPath = join(managerDir, state.backups['src/host.js'].backupPath);

  await rm(extensionRoot, { recursive: true, force: true });

  assert.equal(await readFile(backupPath, 'utf8'), original);
});

test('Patch Manager recovers an interrupted restore after the Host files were already restored', async (t) => {
  const { manager, stRoot, original } = await fixture(t);
  await manager.execute('install');
  const managerDir = join(stRoot, 'data', 'logic-engine', 'final-send-patch');
  const state = JSON.parse(await readFile(join(managerDir, 'state.json'), 'utf8'));

  await writeFile(join(managerDir, 'transaction.json'), JSON.stringify({
    manifestId: state.manifestId,
    phase: 'ROLLING_BACK',
    backups: state.backups,
    createdFiles: state.createdFiles,
    sourceFilesAfter: state.sourceFilesAfter,
    sourceFilesBefore: state.sourceFilesBefore,
  }));
  await writeFile(join(stRoot, 'src/host.js'), original);
  await rm(join(stRoot, 'src/hook.js'), { force: true });

  assert.equal((await manager.execute('status')).status, 'NOT_INSTALLED');
  assert.equal(await readFile(join(stRoot, 'src/host.js'), 'utf8'), original);
  await assert.rejects(readFile(join(managerDir, 'transaction.json')), { code: 'ENOENT' });
});


test('Patch Manager applies an ordered patch bundle in one backup and rollback transaction', async (t) => {
  const { manager, stRoot, extensionRoot, original } = await fixture(t);
  const firstPatch = await readFile(manager.patchPath, 'utf8');
  const firstHash = hash(Buffer.from(firstPatch, 'utf8'));
  const finalHost = "export const host = 'lifecycle-patched';\n";
  const lifecycleHook = "export const lifecycleHook = true;\n";
  const secondPatch = [
    '--- a/src/host.js',
    '+++ b/src/host.js',
    '@@ -1 +1 @@',
    "-export const host = 'patched';",
    "+export const host = 'lifecycle-patched';",
    '--- /dev/null',
    '+++ b/src/lifecycle-hook.js',
    '@@ -0,0 +1 @@',
    '+export const lifecycleHook = true;',
    '',
  ].join('\n');
  const secondPath = join(extensionRoot, 'patches', 'lifecycle.patch');
  await writeFile(secondPath, secondPatch, 'utf8');
  const manifest = JSON.parse(await readFile(manager.manifestPath, 'utf8'));
  const secondHash = hash(Buffer.from(secondPatch, 'utf8'));
  const artifacts = [
    { path: 'patches/test.patch', sha256: firstHash, allowUnidiffZero: false },
    { path: 'patches/lifecycle.patch', sha256: secondHash, allowUnidiffZero: false },
  ];
  manifest.patch.path = 'patches/test.patch';
  manifest.patch.sha256 = firstHash;
  manifest.patch.bundleSha256 = hash(Buffer.from(JSON.stringify(artifacts), 'utf8'));
  manifest.patch.artifacts = artifacts;
  manifest.patch.version = 'bundle-test';
  manifest.sourceFiles['src/host.js'].after = hash(Buffer.from(finalHost, 'utf8'));
  manifest.createdFiles['src/lifecycle-hook.js'] = hash(Buffer.from(lifecycleHook, 'utf8'));
  await writeFile(manager.manifestPath, JSON.stringify(manifest));
  const bundled = new SillyTavernPatchManager({
    extensionRoot,
    stRoot,
    manifestPath: manager.manifestPath,
    patchPath: manager.patchPath,
  });

  assert.equal((await bundled.execute('preflight')).status, 'PREFLIGHT_OK');
  assert.equal(await readFile(join(stRoot, 'src/host.js'), 'utf8'), original,
    'preflight must not mutate the installed source');
  assert.equal((await bundled.execute('install')).status, 'INSTALLED');
  assert.equal(await readFile(join(stRoot, 'src/host.js'), 'utf8'), finalHost);
  assert.equal(await readFile(join(stRoot, 'src/hook.js'), 'utf8'), "export const finalSendHook = true;\n");
  assert.equal(await readFile(join(stRoot, 'src/lifecycle-hook.js'), 'utf8'), lifecycleHook);
  assert.equal((await bundled.execute('verify')).status, 'INSTALLED_AND_VERIFIED');
  assert.equal((await bundled.inspectInstalledReadOnly()).status, 'INSTALLED_AND_BACKUPS_VERIFIED');
  assert.equal((await bundled.execute('uninstall')).status, 'ROLLED_BACK');
  assert.equal(await readFile(join(stRoot, 'src/host.js'), 'utf8'), original);
  await assert.rejects(readFile(join(stRoot, 'src/hook.js')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(stRoot, 'src/lifecycle-hook.js')), { code: 'ENOENT' });
});

test('Patch Manager rejects a patch bundle with a path escape before reading artifacts', async (t) => {
  const { manager, extensionRoot, stRoot } = await fixture(t);
  const manifest = JSON.parse(await readFile(manager.manifestPath, 'utf8'));
  const patchBytes = await readFile(manager.patchPath);
  const patchHash = hash(patchBytes);
  const artifacts = [
    { path: 'patches/test.patch', sha256: patchHash, allowUnidiffZero: false },
    { path: '../outside.patch', sha256: 'a'.repeat(64), allowUnidiffZero: false },
  ];
  manifest.patch.artifacts = artifacts;
  manifest.patch.bundleSha256 = hash(Buffer.from(JSON.stringify(artifacts), 'utf8'));
  await writeFile(manager.manifestPath, JSON.stringify(manifest));
  const bundled = new SillyTavernPatchManager({
    extensionRoot,
    stRoot,
    manifestPath: manager.manifestPath,
    patchPath: manager.patchPath,
  });
  await assert.rejects(bundled.execute('preflight'), /PATCH_ARTIFACT_BUNDLE_INVALID/);
});


test('Patch Manager skips Host Bundle patches only when the installed Host overlay is attested', async (t) => {
  const { manager, stRoot, extensionRoot, original, patched, patchPath } = await fixture(t);
  const hostOriginal = "export const nativeRoute = 'stock';\n";
  const hostPatched = "export const nativeRoute = 'host-overlay';\n";
  const hostPatch = [
    'diff --git a/src/native-route.js b/src/native-route.js',
    '--- a/src/native-route.js',
    '+++ b/src/native-route.js',
    '@@ -1 +1 @@',
    "-export const nativeRoute = 'stock';",
    "+export const nativeRoute = 'host-overlay';",
    '',
  ].join('\n');
  const hostPatchPath = 'host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-hooks.patch';
  const hostPatchAbsolutePath = join(extensionRoot, hostPatchPath);
  await mkdir(join(extensionRoot, 'host-adapter/prototype/patches'), { recursive: true });
  await writeFile(hostPatchAbsolutePath, hostPatch);
  await writeFile(join(stRoot, 'src/native-route.js'), hostPatched);

  const gatewayDir = join(stRoot, 'plugins/logic-engine-extension-gateway');
  await mkdir(gatewayDir, { recursive: true });
  await writeFile(join(gatewayDir, 'st-source-attestation.mjs'),
    "export async function verifyPinnedSourceIdentity() { return { status: 'CURRENT_IDENTITIES_VERIFIED' }; }\n");
  const overlayManifestPath = join(gatewayDir, 'pinned-source-manifest.json');
  await writeFile(overlayManifestPath, JSON.stringify({
    files: [{ path: 'src/native-route.js', sha256: hash(Buffer.from(hostPatched, 'utf8')) }],
  }));

  const generatorPath = join(extensionRoot, 'host-adapter/prototype/generate-pinned-source-manifest.mjs');
  await writeFile(generatorPath, [
    "import { createHash } from 'node:crypto';",
    "import { readFile, writeFile } from 'node:fs/promises';",
    "import { join } from 'node:path';",
    "const root = process.env.SILLYTAVERN_DIR;",
    "const bytes = await readFile(join(root, 'src/native-route.js'));",
    "const sha256 = createHash('sha256').update(bytes).digest('hex');",
    "await writeFile(join(root, 'plugins/logic-engine-extension-gateway/pinned-source-manifest.json'), JSON.stringify({ files: [{ path: 'src/native-route.js', sha256 }] }));",
    '',
  ].join('\n'));

  const firstPatch = await readFile(patchPath);
  const artifacts = [
    { path: 'patches/test.patch', sha256: hash(firstPatch), allowUnidiffZero: false },
    { path: hostPatchPath, sha256: hash(Buffer.from(hostPatch, 'utf8')), allowUnidiffZero: true },
  ];
  const manifest = JSON.parse(await readFile(manager.manifestPath, 'utf8'));
  manifest.patch.path = 'patches/test.patch';
  manifest.patch.sha256 = artifacts[0].sha256;
  manifest.patch.artifacts = artifacts;
  manifest.patch.bundleSha256 = hash(Buffer.from(JSON.stringify(artifacts), 'utf8'));
  await writeFile(manager.manifestPath, JSON.stringify(manifest));

  const bundled = new SillyTavernPatchManager({
    extensionRoot,
    stRoot,
    manifestPath: manager.manifestPath,
    patchPath,
  });

  assert.equal((await bundled.execute('preflight')).status, 'PREFLIGHT_OK');
  assert.equal(await readFile(join(stRoot, 'src/host.js'), 'utf8'), original,
    'preflight must not mutate Final-Send source');
  assert.equal(await readFile(join(stRoot, 'src/native-route.js'), 'utf8'), hostPatched,
    'preflight must not reapply the already installed Host patch');

  assert.equal((await bundled.execute('install')).status, 'INSTALLED');
  assert.equal((await readFile(join(stRoot, 'src/host.js'), 'utf8')).replace(/\\r\n/g, '\n'), patched);
  assert.equal(await readFile(join(stRoot, 'src/native-route.js'), 'utf8'), hostPatched,
    'Final-Send installation must preserve the attested Host overlay');
  assert.equal((await bundled.inspectInstalledReadOnly()).status, 'INSTALLED_AND_BACKUPS_VERIFIED',
    'read-only inspection must verify the Host-overlay baseline backup');

  assert.equal((await bundled.execute('uninstall')).status, 'ROLLED_BACK');
  assert.equal(await readFile(join(stRoot, 'src/host.js'), 'utf8'), original);
  assert.equal(await readFile(join(stRoot, 'src/native-route.js'), 'utf8'), hostPatched,
    'Final-Send rollback must restore the Host overlay, not the upstream file');
  await assert.rejects(readFile(join(stRoot, 'src/hook.js')), { code: 'ENOENT' });
  const restoredManifest = JSON.parse(await readFile(overlayManifestPath, 'utf8'));
  assert.equal(restoredManifest.files[0].sha256, hash(Buffer.from(hostPatched, 'utf8')),
    'rollback must regenerate a valid Host-only source manifest');
});


test('Patch Manager rollback preserves a Host-owned file listed by a legacy Final-Send createdFiles manifest', async (t) => {
  const { manager, stRoot, extensionRoot, patchPath } = await fixture(t);
  const hostPath = 'src/host-inventory-handler.mjs';
  const hostBytes = "export const owner = 'host-bundle';\\n";
  const hostHash = hash(Buffer.from(hostBytes, 'utf8'));
  await writeFile(join(stRoot, hostPath), hostBytes);

  const manifest = JSON.parse(await readFile(manager.manifestPath, 'utf8'));
  // Reproduce the faulty predecessor manifest: it claims a Host-owned path.
  manifest.createdFiles[hostPath] = hostHash;
  await writeFile(manager.manifestPath, JSON.stringify(manifest));

  const overlayAwareManager = new SillyTavernPatchManager({
    extensionRoot,
    stRoot,
    manifestPath: manager.manifestPath,
    patchPath,
    trustedHostOverlayFiles: new Map([[hostPath, hostHash]]),
  });

  assert.equal((await overlayAwareManager.execute('install')).status, 'INSTALLED');
  assert.equal((await overlayAwareManager.execute('uninstall')).status, 'ROLLED_BACK');
  assert.equal(await readFile(join(stRoot, hostPath), 'utf8'), hostBytes,
    'Final-Send rollback must not delete an independently attested Host-owned file');
});



test('Patch Manager recovery preserves an attested Host-owned created file when a legacy journal omits its ownership map', async (t) => {
  const { manager, stRoot, extensionRoot, patchPath } = await fixture(t);
  const hostPath = 'src/host-inventory-handler.mjs';
  const nativePath = 'src/native-route.js';
  const hostBytes = "export const owner = 'host-bundle';\\n";
  const hostHash = hash(Buffer.from(hostBytes, 'utf8'));
  const nativeBytes = "export const nativeRoute = 'stock';\\n";
  const nativeHash = hash(Buffer.from(nativeBytes, 'utf8'));
  await writeFile(join(stRoot, hostPath), hostBytes);

  const manifest = JSON.parse(await readFile(manager.manifestPath, 'utf8'));
  manifest.createdFiles[hostPath] = hostHash;
  await writeFile(manager.manifestPath, JSON.stringify(manifest));
  await manager.execute('install');

  const managerDir = join(stRoot, 'data', 'logic-engine', 'final-send-patch');
  const state = JSON.parse(await readFile(join(managerDir, 'state.json'), 'utf8'));
  const gatewayDir = join(stRoot, 'plugins/logic-engine-extension-gateway');
  await mkdir(gatewayDir, { recursive: true });
  await writeFile(join(gatewayDir, 'st-source-attestation.mjs'),
    "export async function verifyPinnedSourceIdentity() { return { status: 'CURRENT_IDENTITIES_VERIFIED' }; }");
  await writeFile(join(gatewayDir, 'pinned-source-manifest.json'), JSON.stringify({
    files: [
      { path: nativePath, sha256: nativeHash },
      { path: hostPath, sha256: hostHash },
    ],
  }));

  const generatorDir = join(extensionRoot, 'host-adapter/prototype');
  await mkdir(generatorDir, { recursive: true });
  await writeFile(join(generatorDir, 'generate-pinned-source-manifest.mjs'),
    "process.stdout.write('manifest regeneration simulated\\n');");

  // Simulate a predecessor journal whose Host overlay map omits the handler,
  // even though the current verified Host manifest still attests that file.
  await writeFile(join(managerDir, 'transaction.json'), JSON.stringify({
    manifestId: state.manifestId,
    phase: 'ROLLING_BACK',
    backups: state.backups,
    createdFiles: { ...state.createdFiles, [hostPath]: hostHash },
    sourceFilesAfter: state.sourceFilesAfter,
    sourceFilesBefore: state.sourceFilesBefore,
    hostOverlayFiles: { [nativePath]: nativeHash },
  }));

  const recoveryManager = new SillyTavernPatchManager({
    extensionRoot,
    stRoot,
    manifestPath: manager.manifestPath,
    patchPath,
  });
  assert.equal((await recoveryManager.execute('status')).status, 'NOT_INSTALLED');
  assert.equal(await readFile(join(stRoot, hostPath), 'utf8'), hostBytes,
    'recovery must preserve a Host-owned handler attested by the current Host manifest');
});

test('Patch Manager recovery defers Host attestation when a Host-owned file is missing', async (t) => {
  const { manager, stRoot, extensionRoot, patchPath } = await fixture(t);
  const hostPath = 'src/host-inventory-handler.mjs';
  const hostBytes = "export const owner = 'host-bundle';\\n";
  const hostHash = hash(Buffer.from(hostBytes, 'utf8'));
  await writeFile(join(stRoot, hostPath), hostBytes);

  const manifest = JSON.parse(await readFile(manager.manifestPath, 'utf8'));
  manifest.createdFiles[hostPath] = hostHash;
  await writeFile(manager.manifestPath, JSON.stringify(manifest));
  const overlayAwareManager = new SillyTavernPatchManager({
    extensionRoot,
    stRoot,
    manifestPath: manager.manifestPath,
    patchPath,
    trustedHostOverlayFiles: new Map([[hostPath, hostHash]]),
  });
  await overlayAwareManager.execute('install');

  const managerDir = join(stRoot, 'data', 'logic-engine', 'final-send-patch');
  const state = JSON.parse(await readFile(join(managerDir, 'state.json'), 'utf8'));
  const gatewayDir = join(stRoot, 'plugins/logic-engine-extension-gateway');
  await mkdir(gatewayDir, { recursive: true });
  await writeFile(join(gatewayDir, 'st-source-attestation.mjs'), 'export const present = true;\\n');
  const generatorDir = join(extensionRoot, 'host-adapter/prototype');
  await mkdir(generatorDir, { recursive: true });
  await writeFile(join(generatorDir, 'generate-pinned-source-manifest.mjs'),
    "throw new Error('GENERATOR_MUST_WAIT_FOR_HOST_REPAIR');\\n");

  await rm(join(stRoot, hostPath), { force: true });
  await writeFile(join(managerDir, 'transaction.json'), JSON.stringify({
    manifestId: state.manifestId,
    phase: 'ROLLING_BACK',
    backups: state.backups,
    createdFiles: state.createdFiles,
    sourceFilesAfter: state.sourceFilesAfter,
    sourceFilesBefore: state.sourceFilesBefore,
    hostOverlayFiles: state.hostOverlayFiles,
  }));

  assert.equal((await overlayAwareManager.execute('status')).status, 'NOT_INSTALLED');
  await assert.rejects(readFile(join(managerDir, 'transaction.json')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(stRoot, hostPath)), { code: 'ENOENT' });
});
