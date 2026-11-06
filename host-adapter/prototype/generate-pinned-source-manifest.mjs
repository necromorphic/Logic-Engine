import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { HOST_INVENTORY_COVERAGE_ID, PINNED_HOST_COMMIT, PINNED_PATCH_BUNDLE_SHA256, PINNED_HOST_HANDLER_GIT_BLOB_SHA, SOURCE_FILE_PATHS } from '../extension-gateway/server-plugin/st-source-attestation.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceRoot = path.resolve(process.env.SILLYTAVERN_DIR || path.join(repoRoot, 'Sillytavern'));
const outputPath = path.join(sourceRoot, 'plugins', 'logic-engine-extension-gateway', 'pinned-source-manifest.json');

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
// Windows checkout/apply may differ only in CRLF vs LF. Compare normalized source
// text, but retain the installed file's exact bytes in the emitted deployment pin.
const normalizeLineEndings = bytes => Buffer.from(bytes.toString('utf8').replace(/\r\n?/g, '\n'), 'utf8');
const canonical = value => Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);
const gitBlobSha = bytes => createHash('sha1')
  .update(Buffer.from('blob ' + bytes.length + '\0', 'utf8'))
  .update(bytes).digest('hex');

const actualCommit = execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (actualCommit !== PINNED_HOST_COMMIT) {
  throw new Error('HOST_SOURCE_MANIFEST_REQUIRES_EXACT_PINNED_COMMIT');
}

const lifecyclePatchPath = path.join(repoRoot, 'host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-hooks.patch');
const unenrolledFixPatchPath = path.join(repoRoot, 'host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-unenrolled-chat-fix.patch');
const rootMutationPatchPath = path.join(repoRoot, 'host-adapter/prototype/patches/sillytavern-1.19.0-root-mutation-guards.patch');
const lifecyclePatch = await readFile(lifecyclePatchPath);
const unenrolledFixPatch = await readFile(unenrolledFixPatchPath);
const rootMutationPatch = await readFile(rootMutationPatchPath);
const handlerSource = await readFile(path.join(repoRoot, 'host-adapter/extension-gateway/server-plugin/st-host-inventory-handler.mjs'));
const lifecycleBlobSha = gitBlobSha(lifecyclePatch);
const unenrolledFixBlobSha = gitBlobSha(unenrolledFixPatch);
const rootMutationBlobSha = gitBlobSha(rootMutationPatch);
const patchBlobSha = sha256(Buffer.from(
  lifecycleBlobSha + '\n' + unenrolledFixBlobSha + '\n' + rootMutationBlobSha, 'utf8',
));
const handlerBlobSha = gitBlobSha(handlerSource);

// The Host Bundle installer may receive a SillyTavern tree where the separate
// Final-Send Patch Manager has already installed its pinned patch. Reproduce
// that state in the independent expected tree only when every managed source
// file and every created hook file matches the exact post-install manifest.
// A pristine upstream tree remains the other accepted state; partial or
// unrecognized edits are rejected rather than silently normalized.
const finalSendManifestPath = path.join(repoRoot, 'host-adapter/patches/sillytavern-1.19.0-final-send.manifest.json');
const finalSendPatchPath = path.join(repoRoot, 'host-adapter/patches/sillytavern-1.19.0-final-send.patch');
const finalSendManifest = JSON.parse(await readFile(finalSendManifestPath, 'utf8'));
const finalSendPatchBytes = await readFile(finalSendPatchPath);
if (finalSendManifest.host?.commit !== PINNED_HOST_COMMIT
  || finalSendManifest.patch?.path !== 'host-adapter/patches/sillytavern-1.19.0-final-send.patch'
  || finalSendManifest.patch?.sha256 !== sha256(finalSendPatchBytes)) {
  throw new Error('HOST_FINAL_SEND_PINNED_ARTIFACT_INVALID');
}
const finalSendHashAt = async relativePath => {
  const bytes = await readFile(path.join(sourceRoot, relativePath));
  return sha256(normalizeLineEndings(bytes));
};
// These files are also modified by the Host Bundle patches before this
// generator runs. Their final combined state is verified below against the
// independently reconstructed pinned tree, so they cannot be used to classify
// the Final-Send-only state at this point.
const hostPatchedSharedPaths = new Set([
  'src/server-main.js',
  'src/plugin-loader.js',
  'src/endpoints/backends/chat-completions.js',
  'src/endpoints/extensions.js',
]);
let finalSendBeforeMatches = true;
let finalSendAfterMatches = true;
for (const [relativePath, expected] of Object.entries(finalSendManifest.sourceFiles ?? {})) {
  if (hostPatchedSharedPaths.has(relativePath)) continue;
  const actual = await finalSendHashAt(relativePath);
  const before = typeof expected === 'string' ? expected : expected.before;
  const after = typeof expected === 'string' ? expected : expected.after;
  if (actual !== before) finalSendBeforeMatches = false;
  if (actual !== after) finalSendAfterMatches = false;
}
let finalSendCreatedFilesAbsent = true;
let finalSendCreatedFilesMatch = true;
for (const [relativePath, expected] of Object.entries(finalSendManifest.createdFiles ?? {})) {
  try {
    const actual = await finalSendHashAt(relativePath);
    finalSendCreatedFilesAbsent = false;
    if (actual !== expected) finalSendCreatedFilesMatch = false;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    finalSendCreatedFilesMatch = false;
  }
}
const finalSendInstalled = finalSendAfterMatches && finalSendCreatedFilesMatch;
const finalSendPristine = finalSendBeforeMatches && finalSendCreatedFilesAbsent;
if (!finalSendInstalled && !finalSendPristine) {
  throw new Error('HOST_FINAL_SEND_SOURCE_STATE_UNRECOGNIZED');
}
if (patchBlobSha !== PINNED_PATCH_BUNDLE_SHA256) {
  throw new Error('HOST_PINNED_PATCH_BUNDLE_SHA_MISMATCH:' + patchBlobSha);
}
if (handlerBlobSha !== PINNED_HOST_HANDLER_GIT_BLOB_SHA) {
  throw new Error('HOST_PINNED_HANDLER_BLOB_SHA_MISMATCH:' + handlerBlobSha);
}

const worktreeParent = await mkdtemp(path.join(tmpdir(), 'host-pinned-source-tree-'));
const expectedRoot = path.join(worktreeParent, 'SillyTavern');
let files = [];
try {
  execFileSync('git', ['-C', sourceRoot, 'worktree', 'add', '--detach', expectedRoot, PINNED_HOST_COMMIT], { stdio: 'ignore' });
  // Reproduce the exact checkout and whitespace-tolerant patch application used
  // by host-adapter-pinned-source-audit.yml. Checkout the pinned index FIRST:
  // checkout-index --force --all overwrites tracked files, so running it after
  // Final-Send would silently erase that patch from the expected tree.
  execFileSync('git', ['-C', expectedRoot, 'config', 'core.autocrlf', 'false'], { stdio: 'ignore' });
  execFileSync('git', ['-C', expectedRoot, 'config', 'core.eol', 'lf'], { stdio: 'ignore' });
  execFileSync('git', ['-C', expectedRoot, 'checkout-index', '--force', '--all'], { stdio: 'ignore' });
  // Match the independently verified Final-Send state before applying the
  // Host lifecycle/inventory patches. This is intentionally conditional:
  // CI and standalone Host installs from pristine upstream remain unchanged.
  if (finalSendInstalled) {
    execFileSync('git', [
      '-C', expectedRoot,
      '-c', 'core.autocrlf=false',
      'apply', '--ignore-space-change', '--ignore-whitespace', '--check',
      finalSendPatchPath,
    ], { stdio: 'ignore' });
    execFileSync('git', [
      '-C', expectedRoot,
      '-c', 'core.autocrlf=false',
      'apply', '--ignore-space-change', '--ignore-whitespace',
      finalSendPatchPath,
    ], { stdio: 'ignore' });
  }
  for (const [patchPath, allowZeroContext] of [
    [lifecyclePatchPath, true],
    [unenrolledFixPatchPath, false],
    [rootMutationPatchPath, true],
  ]) {
    const args = [
      '-C', expectedRoot,
      '-c', 'core.autocrlf=false',
      'apply', '--ignore-space-change', '--ignore-whitespace',
    ];
    if (allowZeroContext) args.push('--unidiff-zero');
    args.push(patchPath);
    execFileSync('git', args, { stdio: 'ignore' });
  }
  const expectedPluginDir = path.join(expectedRoot, 'plugins/logic-engine-extension-gateway');
  const expectedClientDir = path.join(expectedRoot, 'public/scripts/extensions/third-party/logic-engine-extension-gateway');
  await mkdir(expectedPluginDir, { recursive: true });
  await mkdir(expectedClientDir, { recursive: true });
  const serverPluginDir = path.join(repoRoot, 'host-adapter/extension-gateway/server-plugin');
  for (const name of await readdir(serverPluginDir)) {
    if (name.endsWith('.mjs') || name.endsWith('.js') || name === 'package.json') {
      await copyFile(path.join(serverPluginDir, name), path.join(expectedPluginDir, name));
    }
  }
  const clientSourceDir = path.join(repoRoot, 'host-adapter/extension-gateway');
  for (const name of ['index.js', 'gateway-policy.mjs', 'host-context.mjs', 'conversation-identity.mjs', 'manifest.json']) {
    await copyFile(path.join(clientSourceDir, name), path.join(expectedClientDir, name));
  }
  // Pin the actual Extension Gateway Host inventory handler. The patched
  // ST endpoint module is a thin re-export and is independently compared with
  // the expected patched tree through SOURCE_FILE_PATHS below.
  const installedHandlerSource = await readFile(path.join(sourceRoot, 'plugins/logic-engine-extension-gateway/st-host-inventory-handler.mjs'));
  if (gitBlobSha(installedHandlerSource) !== handlerBlobSha) {
    throw new Error('HOST_INSTALLED_HANDLER_DIFFERS_FROM_PINNED_HANDLER');
  }

  for (const relativePath of SOURCE_FILE_PATHS) {
    const actualPath = path.resolve(sourceRoot, relativePath);
    const expectedPath = path.resolve(expectedRoot, relativePath);
    const relative = path.relative(sourceRoot, actualPath);
    if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      throw new Error('HOST_SOURCE_MANIFEST_PATH_ESCAPE');
    }
    const actualBytes = await readFile(actualPath);
    const expectedBytes = await readFile(expectedPath);
    if (sha256(normalizeLineEndings(actualBytes)) !== sha256(normalizeLineEndings(expectedBytes))) {
      let firstDifference = 0;
      const limit = Math.min(actualBytes.length, expectedBytes.length);
      while (firstDifference < limit && actualBytes[firstDifference] === expectedBytes[firstDifference]) firstDifference += 1;
      const contextStart = Math.max(0, firstDifference - 12);
      const contextEnd = Math.min(Math.max(actualBytes.length, expectedBytes.length), firstDifference + 20);
      throw new Error([
        'HOST_INSTALLED_SOURCE_DIFFERS_FROM_PATCHED_PINNED_TREE: ' + relativePath,
        'actual_sha256=' + sha256(actualBytes),
        'expected_sha256=' + sha256(expectedBytes),
        'actual_length=' + actualBytes.length,
        'expected_length=' + expectedBytes.length,
        'first_difference=' + firstDifference,
        'actual_hex=' + actualBytes.subarray(contextStart, Math.min(contextEnd, actualBytes.length)).toString('hex'),
        'expected_hex=' + expectedBytes.subarray(contextStart, Math.min(contextEnd, expectedBytes.length)).toString('hex'),
      ].join('\\n'));
    }
    files.push({ path: relativePath, sha256: sha256(actualBytes) });
  }
} finally {
  try { execFileSync('git', ['-C', sourceRoot, 'worktree', 'remove', '--force', expectedRoot], { stdio: 'ignore' }); } catch {}
  await rm(worktreeParent, { recursive: true, force: true });
}
const proof = {
  protocol_version: 1,
  pinned_host_commit: PINNED_HOST_COMMIT,
  coverage_id: HOST_INVENTORY_COVERAGE_ID,
  patch_blob_sha: patchBlobSha,
  host_handler_blob_sha: handlerBlobSha,
  files,
};
const manifest = { ...proof, manifest_sha256: sha256(Buffer.from(canonical(proof), 'utf8')) };
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
process.stdout.write('Pinned Host source manifest generated for ' + files.length + ' files.\n' + 'Core deployment pin (ENGINE_HOST_ROOT_IDENTITIES.source_manifest_sha256): ' + manifest.manifest_sha256 + '\n');
