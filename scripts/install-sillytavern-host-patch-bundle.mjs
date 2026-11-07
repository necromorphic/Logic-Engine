import { createHash, randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SillyTavernPatchManager } from './sillytavern-patch-manager.mjs';
import { verifyLegacyHostBundle } from './verify-legacy-host-bundle.mjs';
import {
  PINNED_HOST_COMMIT,
  PINNED_LOGIC_ENGINE_PLUGIN_GIT_BLOB_SHAS,
  SOURCE_FILE_PATHS,
  verifyPinnedSourceIdentity,
} from '../host-adapter/extension-gateway/server-plugin/st-source-attestation.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const valueAfter = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const stArgument = valueAfter('--st-root');
if (!stArgument) {
  process.stderr.write('Usage: node scripts/install-sillytavern-host-patch-bundle.mjs --st-root <SillyTavern directory>\n');
  process.exit(2);
}
const stRoot = await realpath(path.resolve(stArgument));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const normalizeText = bytes => Buffer.from(bytes.toString('utf8').replace(/\r\n?/g, '\n'), 'utf8');
const exists = async file => lstat(file).then(() => true, error => {
  if (error.code === 'ENOENT') return false;
  throw error;
});
const run = (command, commandArgs, options = {}) => execFileSync(command, commandArgs, {
  stdio: 'inherit',
  ...options,
});
const runGit = (cwd, gitArgs, options = {}) => run('git', ['-C', cwd, ...gitArgs], options);

async function assertSafeTarget(relativePath, allowMissing = true) {
  const candidate = path.resolve(stRoot, relativePath);
  const rel = path.relative(stRoot, candidate);
  if (!rel || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    throw new Error('HOST_PATCH_TARGET_PATH_ESCAPE: ' + relativePath);
  }
  let cursor = stRoot;
  for (const segment of rel.split(path.sep)) {
    cursor = path.join(cursor, segment);
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink()) throw new Error('HOST_PATCH_TARGET_SYMLINK: ' + relativePath);
      if (cursor !== candidate && !info.isDirectory()) {
        throw new Error('HOST_PATCH_TARGET_PARENT_NOT_DIRECTORY: ' + relativePath);
      }
    } catch (error) {
      if (error.code === 'ENOENT' && allowMissing) break;
      throw error;
    }
  }
  return candidate;
}

async function assertOnlyGatewayDirectory(relativeDirectory) {
  const directory = path.join(stRoot, relativeDirectory);
  if (!await exists(directory)) {
    if (relativeDirectory === 'plugins') throw new Error('HOST_CORE_PLUGIN_DIRECTORY_MISSING');
    return;
  }
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('HOST_PATCH_EXTENSION_ROOT_UNSAFE: ' + relativeDirectory);
  }
  const entries = await readdir(directory, { withFileTypes: true });
  // The existing Final-Send plugin is installed separately and must be preserved.
  // The pinned Host patch bundle owns only the Gateway directory; allow the known
  // Logic-Engine plugin alongside it without treating it as an unreviewed extension.
  // On the public third-party root, only the Gateway directory is allowed.
  const allowedDirectories = relativeDirectory === 'plugins'
    ? new Set(['logic-engine', 'logic-engine-extension-gateway'])
    : new Set(['logic-engine-extension-gateway']);
  const unexpected = entries.filter(entry => {
    if (entry.isSymbolicLink()) return true;
    if (entry.isDirectory()) return !allowedDirectories.has(entry.name);
    return !entry.isFile() || !['.gitkeep', 'package.json'].includes(entry.name);
  });
  if (unexpected.length > 0) {
    throw new Error('HOST_PATCH_UNREVIEWED_EXTENSION_PRESENT: ' + relativeDirectory);
  }
  if (relativeDirectory === 'plugins'
    && !entries.some(entry => entry.name === 'logic-engine' && entry.isDirectory() && !entry.isSymbolicLink())) {
    throw new Error('HOST_CORE_PLUGIN_REQUIRED');
  }
}

async function assertExpectedFilesOnly(relativeDirectory, expectedNames) {
  const directory = path.join(stRoot, relativeDirectory);
  if (!await exists(directory)) return;
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('HOST_PATCH_EXTENSION_DIRECTORY_UNSAFE: ' + relativeDirectory);
  }
  const entries = await readdir(directory, { withFileTypes: true });
  const unexpected = entries.filter(entry => !entry.isFile() || entry.isSymbolicLink()
    || !expectedNames.includes(entry.name));
  if (unexpected.length > 0) {
    throw new Error('HOST_PATCH_UNREVIEWED_EXTENSION_FILE_PRESENT: ' + relativeDirectory);
  }
}

const packageJson = JSON.parse(await readFile(path.join(stRoot, 'package.json'), 'utf8'));
if (packageJson.version !== '1.19.0') {
  throw new Error('SILLYTAVERN_VERSION_UNSUPPORTED: ' + packageJson.version);
}
const nodeVersion = process.versions.node.split('.').map(Number);
if (nodeVersion[0] < 22 || (nodeVersion[0] === 22 && nodeVersion[1] < 13)) {
  throw new Error('NODE_VERSION_UNSUPPORTED: requires Node.js >=22.13.0');
}
run('git', ['--version']);
await assertOnlyGatewayDirectory('plugins');
await assertOnlyGatewayDirectory('public/scripts/extensions/third-party');

const tempRoot = await mkdtemp(path.join(tmpdir(), 'logic-engine-host-bundle-'));
const stagingRoot = path.join(tempRoot, 'SillyTavern');
const backupRoot = path.resolve(path.dirname(stRoot),
  path.basename(stRoot) + '-host-patch-backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID());
const changedPaths = [];
const backups = new Map();
let committed = false;

try {
  run('git', ['init', stagingRoot]);
  runGit(stagingRoot, ['remote', 'add', 'origin', 'https://github.com/SillyTavern/SillyTavern.git']);
  runGit(stagingRoot, ['fetch', '--depth=1', 'origin', PINNED_HOST_COMMIT]);
  runGit(stagingRoot, ['checkout', '--detach', 'FETCH_HEAD']);
  runGit(stagingRoot, ['config', 'core.autocrlf', 'false']);
  runGit(stagingRoot, ['config', 'core.eol', 'lf']);
  runGit(stagingRoot, ['checkout-index', '--force', '--all']);

  // Capture immutable upstream hashes before Final-Send and Host overlays are staged.
  // This lets a repeat install distinguish our exact previously installed output
  // from an unrelated local modification without trusting the target blindly.
  const upstreamBaselineHashes = new Map();
  for (const relativePath of SOURCE_FILE_PATHS) {
    const baselinePath = path.join(stagingRoot, relativePath);
    if (await exists(baselinePath)) {
      upstreamBaselineHashes.set(relativePath, sha256(normalizeText(await readFile(baselinePath))));
    }
  }

  // Reconstruct the reviewed Host-only overlay from the immutable upstream
  // checkout. This is an independent expected-output tree: it does not use
  // installed files or the predecessor manifest as source material.
  const overlayStagingRoot = path.join(tempRoot, 'HostOverlay');
  runGit(stagingRoot, ['worktree', 'add', '--detach', overlayStagingRoot, PINNED_HOST_COMMIT]);
  runGit(overlayStagingRoot, ['config', 'core.autocrlf', 'false']);
  runGit(overlayStagingRoot, ['config', 'core.eol', 'lf']);
  const hostPatches = [
    ['host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-hooks.patch', true],
    ['host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-unenrolled-chat-fix.patch', false],
    ['host-adapter/prototype/patches/sillytavern-1.19.0-root-mutation-guards.patch', true],
  ];
  for (const [relativePatch, zeroContext] of hostPatches) {
    const patchPath = path.join(repoRoot, relativePatch);
    const patchArgs = ['-c', 'core.autocrlf=false', 'apply', '--ignore-space-change', '--ignore-whitespace'];
    if (zeroContext) patchArgs.push('--unidiff-zero');
    patchArgs.push(patchPath);
    runGit(overlayStagingRoot, [...patchArgs.slice(0, -1), '--check', patchPath]);
    runGit(overlayStagingRoot, patchArgs);
  }
  const expectedOverlayFiles = new Map();
  for (const relativePath of SOURCE_FILE_PATHS) {
    const expectedPath = path.join(overlayStagingRoot, relativePath);
    if (await exists(expectedPath)) {
      expectedOverlayFiles.set(relativePath, sha256(await readFile(expectedPath)));
    }
  }

  // Accept only explicitly pinned predecessor manifests. A file changed by a
  // later Host patch is trusted only when it equals the independently rebuilt
  // output above; arbitrary local edits remain a hard failure.
  const previousHostBundle = await verifyLegacyHostBundle({
    installRoot: stRoot,
    expectedPredecessors: [
      {
        commit: PINNED_HOST_COMMIT,
        patchBlobSha: 'c24cece59b928f56a514cc191256d01370ccda8e58e3edfbc56cdb96af9b8067',
        manifestSha256: '9cca279d6f4340ee0f5455622c1ef4d8404e29ac0ed73e309f76d7f74fdd9acc',
      },
      {
        commit: PINNED_HOST_COMMIT,
        patchBlobSha: 'dd491fec699cf4a21b32480c2780b79d79a7665302e97624cbcfc8381aa64deb',
        manifestSha256: '5d5490a939a13f94b83b4a407f09d61a18aeefe67e73b65b7e8200d3a0aa736b',
      },
    ],
    expectedOverlayFiles,
  });
  // Final-Send remains independently verified. The legacy overlay exception
  // is limited to exact file hashes covered by the verified predecessor manifest.
  const finalSendManager = new SillyTavernPatchManager({
    extensionRoot: repoRoot,
    stRoot,
    trustedHostOverlayFiles: previousHostBundle.verified ? previousHostBundle.files : new Map(),
  });
  const finalSendInspection = await finalSendManager.inspectInstalledReadOnly();
  const finalSendInstalled = finalSendInspection.status === 'INSTALLED_AND_BACKUPS_VERIFIED';
  const finalSendManifest = finalSendManager.manifest;

  // Reproduce the independently verified Final-Send state in staging before
  // layering the Host lifecycle/inventory patches. This prevents the bundle
  // from silently overwriting Final-Send on shared files such as chat-completions
  // and extensions.js. The patch is checked against the immutable pinned tree.
  if (finalSendInstalled) {
    const finalSendPatch = path.join(repoRoot, finalSendManifest.patch.path);
    runGit(stagingRoot, [
      '-c', 'core.autocrlf=false', 'apply', '--ignore-space-change',
      '--ignore-whitespace', '--check', finalSendPatch,
    ]);
    runGit(stagingRoot, [
      '-c', 'core.autocrlf=false', 'apply', '--ignore-space-change',
      '--ignore-whitespace', finalSendPatch,
    ]);
  }

  const patches = [
    ['host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-hooks.patch', true],
    ['host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-unenrolled-chat-fix.patch', false],
    ['host-adapter/prototype/patches/sillytavern-1.19.0-root-mutation-guards.patch', true],
  ];
  for (const [relativePatch, zeroContext] of patches) {
    const patchPath = path.join(repoRoot, relativePatch);
    const patchArgs = ['-c', 'core.autocrlf=false', 'apply', '--ignore-space-change', '--ignore-whitespace'];
    if (zeroContext) patchArgs.push('--unidiff-zero');
    patchArgs.push(patchPath);
    runGit(stagingRoot, [...patchArgs.slice(0, -1), '--check', patchPath]);
    runGit(stagingRoot, patchArgs);
  }

  const serverSource = path.join(repoRoot, 'host-adapter/extension-gateway/server-plugin');
  const serverTarget = path.join(stagingRoot, 'plugins/logic-engine-extension-gateway');
  await mkdir(serverTarget, { recursive: true });
  for (const entry of await readdir(serverSource, { withFileTypes: true })) {
    if (!entry.isFile() || !(entry.name.endsWith('.mjs') || entry.name.endsWith('.js') || entry.name === 'package.json')) continue;
    await copyFile(path.join(serverSource, entry.name), path.join(serverTarget, entry.name));
  }

  const clientSource = path.join(repoRoot, 'host-adapter/extension-gateway');
  const clientTarget = path.join(stagingRoot, 'public/scripts/extensions/third-party/logic-engine-extension-gateway');
  await mkdir(clientTarget, { recursive: true });
  for (const name of ['index.js', 'gateway-policy.mjs', 'host-context.mjs', 'conversation-identity.mjs', 'manifest.json']) {
    await copyFile(path.join(clientSource, name), path.join(clientTarget, name));
  }

  // Stage the separately installed root runtime's pinned entrypoint and direct imports
  // for source verification. The target plugin is checked, never replaced.
  const stagedCorePlugin = path.join(stagingRoot, 'plugins/logic-engine');
  for (const name of Object.keys(PINNED_LOGIC_ENGINE_PLUGIN_GIT_BLOB_SHAS)) {
    const source = path.join(repoRoot, name);
    const destination = path.join(stagedCorePlugin, name);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }

  const generator = path.join(repoRoot, 'host-adapter/prototype/generate-pinned-source-manifest.mjs');
  run(process.execPath, [generator], {
    cwd: repoRoot,
    env: { ...process.env, SILLYTAVERN_DIR: stagingRoot },
  });
  const stagedIdentity = await verifyPinnedSourceIdentity({ installRoot: stagingRoot });
  if (stagedIdentity.status !== 'CURRENT_IDENTITIES_VERIFIED') {
    throw new Error('HOST_PATCH_STAGING_ATTESTATION_FAILED: ' + stagedIdentity.code);
  }

  // Accept only three exact states for shared Host files:
  // pinned upstream, independently verified Final-Send-only, or the exact
  // Host overlay just reproduced from the pinned source and reviewed patches.
  // The last case makes installation idempotent while still rejecting drift.
  const generatedPrefixes = [
    'public/scripts/logic-engine-lifecycle/',
    'plugins/logic-engine-extension-gateway/',
    'public/scripts/extensions/third-party/logic-engine-extension-gateway/',
  ];
  for (const relativePath of SOURCE_FILE_PATHS) {
    if (generatedPrefixes.some(prefix => relativePath.startsWith(prefix))
      || relativePath === 'src/endpoints/logic-engine-host-inventory-handler.mjs') continue;
    const target = await assertSafeTarget(relativePath);
    const baselineHash = upstreamBaselineHashes.get(relativePath);
    if (baselineHash === undefined) {
      if (await exists(target)) throw new Error('HOST_PATCH_BASELINE_CONFLICT: unexpected file ' + relativePath);
      continue;
    }
    if (!await exists(target)) throw new Error('HOST_PATCH_BASELINE_FILE_MISSING: ' + relativePath);
    const stagedPath = path.join(stagingRoot, relativePath);
    const stagedHash = await exists(stagedPath)
      ? sha256(normalizeText(await readFile(stagedPath)))
      : null;
    const targetBytes = await readFile(target);
    const actualHash = sha256(normalizeText(targetBytes));
    if (actualHash !== baselineHash && actualHash !== stagedHash) {
      const finalSendExpected = finalSendManifest.sourceFiles?.[relativePath];
      const isVerifiedFinalSendState = finalSendInstalled
        && finalSendExpected && typeof finalSendExpected === 'object'
        && typeof finalSendExpected.after === 'string'
        && actualHash === finalSendExpected.after;
      const previousHostFileHash = previousHostBundle.files.get(relativePath);
      const isVerifiedPreviousHostState = previousHostBundle.verified
        && previousHostFileHash === sha256(targetBytes);
      if (!isVerifiedFinalSendState && !isVerifiedPreviousHostState) {
        throw new Error('HOST_PATCH_BASELINE_MISMATCH: ' + relativePath);
      }
    }
  }

  // Preserve the existing extension roots exactly: only the reviewed Gateway
  // is accepted by the runtime source attestation. Existing partial Gateway
  // copies may be replaced, but unknown executable files are never deleted.
  await assertOnlyGatewayDirectory('plugins');
  await assertOnlyGatewayDirectory('public/scripts/extensions/third-party');
  const pluginPrefix = 'plugins/logic-engine-extension-gateway/';
  const clientPrefix = 'public/scripts/extensions/third-party/logic-engine-extension-gateway/';
  const expectedPluginNames = SOURCE_FILE_PATHS.filter(file => file.startsWith(pluginPrefix))
    .map(file => file.slice(pluginPrefix.length)).concat('pinned-source-manifest.json');
  const expectedClientNames = SOURCE_FILE_PATHS.filter(file => file.startsWith(clientPrefix))
    .map(file => file.slice(clientPrefix.length));
  await assertExpectedFilesOnly('plugins/logic-engine-extension-gateway', expectedPluginNames);
  await assertExpectedFilesOnly('public/scripts/extensions/third-party/logic-engine-extension-gateway', expectedClientNames);

  // The Patch Manager is part of the pinned Core plugin identity. Update this
  // single managed file transactionally so runtime lifecycle calls use the same
  // Host-overlay-aware verifier as the deployment installer.
  const filesToInstall = [
    ...SOURCE_FILE_PATHS,
    'plugins/logic-engine-extension-gateway/pinned-source-manifest.json',
    'plugins/logic-engine/scripts/sillytavern-patch-manager.mjs',
  ];
  await mkdir(backupRoot, { recursive: true });
  for (const relativePath of filesToInstall) {
    const source = path.join(stagingRoot, relativePath);
    const target = await assertSafeTarget(relativePath);
    if (!await exists(source)) throw new Error('HOST_PATCH_STAGED_FILE_MISSING: ' + relativePath);
    if (await exists(target)) {
      const backup = path.join(backupRoot, relativePath);
      await mkdir(path.dirname(backup), { recursive: true });
      await copyFile(target, backup);
      backups.set(relativePath, backup);
    }
    changedPaths.push(relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  }

  const installedIdentity = await verifyPinnedSourceIdentity({ installRoot: stRoot });
  if (installedIdentity.status !== 'CURRENT_IDENTITIES_VERIFIED') {
    throw new Error('HOST_PATCH_INSTALL_ATTESTATION_FAILED: ' + installedIdentity.code);
  }
  committed = true;
  process.stdout.write(JSON.stringify({
    status: 'HOST_PATCH_BUNDLE_INSTALLED_AND_VERIFIED',
    pinned_host_commit: PINNED_HOST_COMMIT,
    patch_bundle_sha256: installedIdentity.patch_blob_sha,
    source_manifest_sha256: installedIdentity.manifest_sha256,
    changed_file_count: changedPaths.length,
    backup_directory: backupRoot,
    note: 'Host patch bundle only. Final-Send is a separate installation and is not modified.',
  }, null, 2) + '\n');
} catch (error) {
  for (const relativePath of changedPaths.reverse()) {
    const target = path.join(stRoot, relativePath);
    const backup = backups.get(relativePath);
    if (backup) {
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(backup, target);
    } else {
      await rm(target, { force: true });
    }
  }
  throw error;
} finally {
  await rm(tempRoot, { recursive: true, force: true });
  if (!committed && await exists(backupRoot)) {
    process.stderr.write('Installation rolled back. Backup retained at: ' + backupRoot + '\n');
  }
}
