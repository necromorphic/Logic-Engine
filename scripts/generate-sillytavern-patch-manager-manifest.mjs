import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(process.env.SILLYTAVERN_DIR || resolve(repoRoot, 'SillyTavern'));
const pinnedCommit = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';
const manifestPath = resolve(repoRoot, 'host-adapter/patches/sillytavern-1.19.0-final-send.manifest.json');
const outputPath = manifestPath;
const patchDefinitions = [
  {
    path: 'host-adapter/patches/sillytavern-1.19.0-final-send.patch',
    allowUnidiffZero: false,
  },
  {
    path: 'host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-hooks.patch',
    allowUnidiffZero: true,
  },
  {
    path: 'host-adapter/prototype/patches/sillytavern-1.19.0-root-mutation-guards.patch',
    allowUnidiffZero: true,
  },
];

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const normalize = bytes => {
  const value = bytes.toString('utf8');
  if (Buffer.from(value, 'utf8').compare(bytes) !== 0) throw new Error('PATCH_MANAGER_SOURCE_ENCODING_INVALID');
  return Buffer.from(value.replace(/\r\n?/g, '\n'), 'utf8');
};
const canonicalHash = bytes => sha256(normalize(bytes));
const runGit = args => execFileSync('git', args, { stdio: 'pipe', windowsHide: true });
const isWithin = (root, target) => {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel));
};

function safeRelativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || isAbsolute(value)
    || value.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':'))) {
    throw new Error('PATCH_MANAGER_BUNDLE_PATH_INVALID: ' + value);
  }
  return value;
}

function patchTargets(patchText) {
  const existing = new Set();
  const created = new Set();
  let oldPath = null;
  for (const line of patchText.split(/\r?\n/)) {
    if (line.startsWith('--- a/')) oldPath = safeRelativePath(line.slice(6));
    else if (line === '--- /dev/null') oldPath = null;
    else if (line.startsWith('+++ b/')) {
      const newPath = safeRelativePath(line.slice(6));
      if (oldPath === null) created.add(newPath);
      else {
        if (oldPath !== newPath) throw new Error('PATCH_MANAGER_BUNDLE_RENAME_UNSUPPORTED');
        existing.add(oldPath);
      }
    } else if (line === '+++ /dev/null') {
      throw new Error('PATCH_MANAGER_BUNDLE_DELETION_UNSUPPORTED');
    }
  }
  return { existing, created };
}

function readPinnedFile(relativePath) {
  safeRelativePath(relativePath);
  return runGit(['-C', sourceRoot, 'show', pinnedCommit + ':' + relativePath]);
}

async function hashExpectedFile(expectedRoot, relativePath) {
  const target = resolve(expectedRoot, ...safeRelativePath(relativePath).split('/'));
  if (!isWithin(expectedRoot, target)) throw new Error('PATCH_MANAGER_BUNDLE_PATH_ESCAPE');
  return canonicalHash(await readFile(target));
}

const actualCommit = runGit(['-C', sourceRoot, 'rev-parse', 'HEAD']).toString('utf8').trim();
if (actualCommit !== pinnedCommit) throw new Error('SILLYTAVERN_PINNED_COMMIT_MISMATCH: ' + actualCommit);
const baseManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (baseManifest.host?.commit !== pinnedCommit || baseManifest.host?.version !== '1.19.0'
  || baseManifest.id !== 'logic-engine-sillytavern-final-send') {
  throw new Error('PATCH_MANAGER_BASE_MANIFEST_IDENTITY_INVALID');
}
const packageJson = JSON.parse(readPinnedFile('package.json').toString('utf8'));
if (packageJson.version !== '1.19.0') throw new Error('SILLYTAVERN_PINNED_VERSION_MISMATCH');

const artifacts = [];
const touchedExisting = new Set();
const touchedCreated = new Set();
for (const definition of patchDefinitions) {
  const bytes = await readFile(resolve(repoRoot, definition.path));
  const canonicalBytes = normalize(bytes);
  const digest = sha256(canonicalBytes);
  artifacts.push({
    path: definition.path,
    sha256: digest,
    allowUnidiffZero: definition.allowUnidiffZero,
  });
  const targets = patchTargets(canonicalBytes.toString('utf8'));
  for (const item of targets.existing) touchedExisting.add(item);
  for (const item of targets.created) touchedCreated.add(item);
}
if (artifacts[0].sha256 !== baseManifest.patch.sha256
  || artifacts[0].path !== baseManifest.patch.path) {
  throw new Error('PATCH_MANAGER_FINAL_SEND_ARTIFACT_PIN_MISMATCH');
}

const worktreeParent = await mkdtemp(resolve(tmpdir(), 'logic-engine-st-patch-manifest-'));
const expectedRoot = resolve(worktreeParent, 'SillyTavern');
let worktreeAdded = false;
try {
  runGit(['-C', sourceRoot, 'worktree', 'add', '--detach', expectedRoot, pinnedCommit]);
  worktreeAdded = true;

  for (let index = 0; index < patchDefinitions.length; index += 1) {
    const definition = patchDefinitions[index];
    const patchPath = resolve(repoRoot, definition.path);
    const checkArgs = ['-C', expectedRoot, '-c', 'core.autocrlf=false', 'apply', '--ignore-space-change', '--ignore-whitespace'];
    if (definition.allowUnidiffZero) checkArgs.push('--unidiff-zero');
    checkArgs.push('--check', patchPath);
    runGit(checkArgs);
    const applyArgs = ['-C', expectedRoot, '-c', 'core.autocrlf=false', 'apply', '--ignore-space-change', '--ignore-whitespace'];
    if (definition.allowUnidiffZero) applyArgs.push('--unidiff-zero');
    applyArgs.push(patchPath);
    runGit(applyArgs);
  }
  runGit(['-C', expectedRoot, 'diff', '--check']);

  const sourceFiles = {};
  for (const [relativePath, pin] of Object.entries(baseManifest.sourceFiles ?? {})) {
    safeRelativePath(relativePath);
    const beforeExpected = typeof pin === 'string' ? pin : pin?.before;
    if (!/^[a-f0-9]{64}$/.test(beforeExpected ?? '')) {
      throw new Error('PATCH_MANAGER_BASELINE_PIN_INVALID: ' + relativePath);
    }
    const before = canonicalHash(readPinnedFile(relativePath));
    if (before !== beforeExpected) throw new Error('PATCH_MANAGER_BASELINE_SOURCE_DRIFT: ' + relativePath);
    const after = await hashExpectedFile(expectedRoot, relativePath);
    sourceFiles[relativePath] = after === before ? before : { before, after };
  }

  for (const relativePath of touchedExisting) {
    if (Object.hasOwn(sourceFiles, relativePath)) continue;
    const before = canonicalHash(readPinnedFile(relativePath));
    const after = await hashExpectedFile(expectedRoot, relativePath);
    if (before === after) throw new Error('PATCH_MANAGER_PATCH_TARGET_UNCHANGED: ' + relativePath);
    sourceFiles[relativePath] = { before, after };
  }

  const createdFiles = {};
  for (const relativePath of Object.keys(baseManifest.createdFiles ?? {})) {
    safeRelativePath(relativePath);
    let existsInPinnedTree = true;
    try { readPinnedFile(relativePath); } catch { existsInPinnedTree = false; }
    if (existsInPinnedTree) throw new Error('PATCH_MANAGER_CREATED_FILE_EXISTS_IN_BASELINE: ' + relativePath);
    createdFiles[relativePath] = await hashExpectedFile(expectedRoot, relativePath);
  }
  for (const relativePath of touchedCreated) {
    let existsInPinnedTree = true;
    try { readPinnedFile(relativePath); } catch { existsInPinnedTree = false; }
    if (existsInPinnedTree) throw new Error('PATCH_MANAGER_CREATED_FILE_EXISTS_IN_BASELINE: ' + relativePath);
    createdFiles[relativePath] = await hashExpectedFile(expectedRoot, relativePath);
  }

  const comparePath = (left, right) => left < right ? -1 : left > right ? 1 : 0;
  const orderedSourceFiles = Object.fromEntries(Object.entries(sourceFiles).sort(([a], [b]) => comparePath(a, b)));
  const orderedCreatedFiles = Object.fromEntries(Object.entries(createdFiles).sort(([a], [b]) => comparePath(a, b)));
  const bundleSha256 = sha256(Buffer.from(JSON.stringify(artifacts), 'utf8'));
  const manifest = {
    ...baseManifest,
    patch: {
      ...baseManifest.patch,
      version: '2.0.0',
      bundleSha256,
      artifacts,
    },
    sourceFiles: orderedSourceFiles,
    createdFiles: orderedCreatedFiles,
  };
  const serialized = JSON.stringify(manifest, null, 2) + '\n';
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serialized, 'utf8');
  process.stdout.write('PATCH_MANAGER_MANIFEST_BEGIN\n' + serialized + 'PATCH_MANAGER_MANIFEST_END\n');
  process.stdout.write('Generated ordered bundle: ' + artifacts.length + ' patches, '
    + Object.keys(orderedSourceFiles).length + ' pinned source files, '
    + Object.keys(orderedCreatedFiles).length + ' created files.\n');
} finally {
  if (worktreeAdded) {
    try { runGit(['-C', sourceRoot, 'worktree', 'remove', '--force', expectedRoot]); } catch {}
  }
  await rm(worktreeParent, { recursive: true, force: true });
}
