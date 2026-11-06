import { createHash, randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  PINNED_HOST_COMMIT,
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
  if (!await exists(directory)) return;
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('HOST_PATCH_EXTENSION_ROOT_UNSAFE: ' + relativeDirectory);
  }
  const entries = await readdir(directory, { withFileTypes: true });
  const unexpected = entries.filter(entry => entry.name !== 'logic-engine-extension-gateway');
  if (unexpected.length > 0 || entries.some(entry => !entry.isDirectory() || entry.isSymbolicLink())) {
    throw new Error('HOST_PATCH_UNREVIEWED_EXTENSION_PRESENT: ' + relativeDirectory);
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

  // The archive/checkout supplied by the operator must match the exact pinned
  // upstream source for every covered pre-patch file. Existing partial patches
  // and files created by a previous incomplete installation are rejected.
  const generatedPrefixes = [
    'public/scripts/logic-engine-lifecycle/',
    'plugins/logic-engine-extension-gateway/',
    'public/scripts/extensions/third-party/logic-engine-extension-gateway/',
  ];
  for (const relativePath of SOURCE_FILE_PATHS) {
    if (generatedPrefixes.some(prefix => relativePath.startsWith(prefix))
      || relativePath === 'src/endpoints/logic-engine-host-inventory-handler.mjs') continue;
    const baseline = path.join(stagingRoot, relativePath);
    const target = await assertSafeTarget(relativePath);
    if (!await exists(baseline)) {
      if (await exists(target)) throw new Error('HOST_PATCH_BASELINE_CONFLICT: unexpected file ' + relativePath);
      continue;
    }
    if (!await exists(target)) throw new Error('HOST_PATCH_BASELINE_FILE_MISSING: ' + relativePath);
    const [expectedBytes, actualBytes] = await Promise.all([readFile(baseline), readFile(target)]);
    if (sha256(normalizeText(expectedBytes)) !== sha256(normalizeText(actualBytes))) {
      throw new Error('HOST_PATCH_BASELINE_MISMATCH: ' + relativePath);
    }
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

  const generator = path.join(repoRoot, 'host-adapter/prototype/generate-pinned-source-manifest.mjs');
  run(process.execPath, [generator], {
    cwd: repoRoot,
    env: { ...process.env, SILLYTAVERN_DIR: stagingRoot },
  });
  const stagedIdentity = await verifyPinnedSourceIdentity({ installRoot: stagingRoot });
  if (stagedIdentity.status !== 'CURRENT_IDENTITIES_VERIFIED') {
    throw new Error('HOST_PATCH_STAGING_ATTESTATION_FAILED: ' + stagedIdentity.code);
  }

  // Preserve the existing extension roots exactly: only the reviewed Gateway
  // is accepted by the runtime source attestation.
  await assertOnlyGatewayDirectory('plugins');
  await assertOnlyGatewayDirectory('public/scripts/extensions/third-party');

  const filesToInstall = [...SOURCE_FILE_PATHS, 'plugins/logic-engine-extension-gateway/pinned-source-manifest.json'];
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
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
    changedPaths.push(relativePath);
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
