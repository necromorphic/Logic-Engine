import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  lstat, mkdir, readFile, rename, rm, unlink, open, realpath,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { SILLYTAVERN_TARGET } from './target.mjs';

const MANIFEST_NAME = 'manifest.json';
const PENDING_NAME = 'pending.json';
const LOCK_NAME = '.patch-manager.lock';
const PATCH_ID = 'sillytavern-1.19.0-final-send-v1';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const normalizeLineEndings = bytes => Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
const pinnedSourceHash = bytes => sha256(normalizeLineEndings(bytes));
const fail = code => { throw new Error('LOGIC_ENGINE_PATCH_' + code); };

async function exists(path) {
  try { await lstat(path); return true; } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function inside(parent, candidate) {
  const rel = relative(parent, candidate);
  return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel));
}

async function assertRegularFile(root, relativePath) {
  const absolute = resolve(root, relativePath);
  if (!inside(root, absolute)) fail('PATH_ESCAPE');
  const components = relative(root, absolute).split(sep).filter(Boolean);
  let current = root;
  for (const component of components) {
    current = join(current, component);
    const info = await lstat(current).catch(() => null);
    if (!info || info.isSymbolicLink()) fail('HOST_PATH_MISSING_OR_REPARSE');
  }
  const info = await lstat(absolute);
  if (!info.isFile()) fail('HOST_FILE_TYPE_INVALID');
  return absolute;
}

async function atomicWrite(path, bytes, mode = 0o600) {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, '.' + randomUUID() + '.tmp');
  let handle;
  try {
    handle = await open(temporary, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, mode);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, path);
  } catch (error) {
    try { await handle?.close(); } catch {}
    try { await unlink(temporary); } catch {}
    throw error;
  }
}

async function atomicJson(path, value) {
  await atomicWrite(path, Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8'));
}

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    fail('PATCH_ANCHOR_' + label);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export function patchChatCompletionsSource(source) {
  if (typeof source !== 'string') fail('SOURCE_INVALID');
  const lineEnding = source.includes('\r\n') ? '\r\n' : '\n';
  let result = source.replace(/\r\n/g, '\n');
  result = replaceExactlyOnce(
    result,
    "import fetch from 'node-fetch';",
    "import { logicEngineFetch as fetch, runWithLogicEngineFinalSend, logicEngineForwardFetchResponse } from '../../logic-engine-final-send-hook.js';",
    'FETCH_IMPORT',
  );
  result = replaceExactlyOnce(
    result,
    '    forwardFetchResponse,',
    '    forwardFetchResponse as nativeForwardFetchResponse,',
    'FORWARD_IMPORT',
  );
  result = replaceExactlyOnce(
    result,
    "import { fetchGoogleModels, GoogleModelsHttpError } from './google-models.js';",
    "import { fetchGoogleModels, GoogleModelsHttpError } from './google-models.js';\n\nconst forwardFetchResponse = (upstream, response) => logicEngineForwardFetchResponse(\n    upstream,\n    response,\n    nativeForwardFetchResponse,\n);",
    'FORWARD_WRAPPER',
  );
  result = replaceExactlyOnce(
    result,
    "router.post('/generate', async function (request, response) {",
    "router.post('/generate', async function (request, response) {\n    return runWithLogicEngineFinalSend(request, response, async () => {",
    'GENERATION_ENTRY',
  );
  result = replaceExactlyOnce(
    result,
    '\n});\n\nconst multimodalModels = express.Router();',
    '\n    });\n});\n\nconst multimodalModels = express.Router();',
    'GENERATION_EXIT',
  );
  return lineEnding === '\n' ? result : result.replace(/\n/g, '\r\n');
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) {
    if (error?.code === 'ENOENT') return null;
    fail('STATE_INVALID');
  }
}

async function verifyPinnedHost(hostRoot) {
  const root = resolve(hostRoot);
  const rootReal = await realpath(root).catch(() => null);
  if (!rootReal) fail('HOST_ROOT_MISSING');
  const packagePath = await assertRegularFile(rootReal, 'package.json');
  const pkg = await readJson(packagePath);
  if (pkg?.version !== SILLYTAVERN_TARGET.packageVersion) fail('HOST_VERSION_UNSUPPORTED');

  const files = new Map();
  for (const [relativePath, expectedHash] of Object.entries(SILLYTAVERN_TARGET.sourceHashes)) {
    const path = await assertRegularFile(rootReal, relativePath);
    const bytes = await readFile(path);
    if (pinnedSourceHash(bytes) !== expectedHash) fail('HOST_SOURCE_HASH_MISMATCH_' + relativePath.replaceAll('/', '_').replaceAll('.', '_'));
    files.set(relativePath, { path, bytes, hash: expectedHash });
  }
  return { root: rootReal, files };
}

async function acquireLock(stateRoot) {
  const lockPath = join(stateRoot, LOCK_NAME);
  try {
    await mkdir(lockPath);
  } catch (error) {
    if (error?.code === 'EEXIST') fail('LOCKED');
    throw error;
  }
  return async () => rm(lockPath, { recursive: true, force: true });
}

async function recoverInterruptedApply(stateRoot, hostRoot) {
  const pendingPath = join(stateRoot, PENDING_NAME);
  const pending = await readJson(pendingPath);
  if (!pending) return;
  const targetPath = resolve(hostRoot, pending.endpointRelativePath);
  const hookPath = resolve(hostRoot, pending.hookRelativePath);
  const backupPath = resolve(stateRoot, pending.backupRelativePath);
  if (!inside(hostRoot, targetPath) || !inside(hostRoot, hookPath)
    || !inside(stateRoot, backupPath)) fail('RECOVERY_PATH_INVALID');

  const original = await readFile(backupPath).catch(() => null);
  if (!original || sha256(original) !== pending.originalHash) fail('RECOVERY_BACKUP_INVALID');
  const currentTarget = await readFile(targetPath).catch(() => null);
  const currentHook = await readFile(hookPath).catch(() => null);
  const committedManifest = await readJson(join(stateRoot, MANIFEST_NAME));
  if (committedManifest?.patchId === PATCH_ID
    && committedManifest.patchedHash === pending.patchedHash
    && committedManifest.hookHash === pending.hookHash
    && currentTarget && sha256(currentTarget) === pending.patchedHash
    && currentHook && sha256(currentHook) === pending.hookHash) {
    // Commit reached the installed manifest; only pending-file cleanup was
    // interrupted. Keep the verified installed patch.
    await unlink(pendingPath);
    return;
  }

  if (currentTarget && sha256(currentTarget) === pending.patchedHash) {
    await atomicWrite(targetPath, original);
  } else if (!currentTarget || sha256(currentTarget) !== pending.originalHash) {
    fail('RECOVERY_TARGET_DRIFT');
  }
  if (currentHook) {
    if (sha256(currentHook) !== pending.hookHash) fail('RECOVERY_HOOK_DRIFT');
    await unlink(hookPath);
  }
  await unlink(pendingPath);
}

export async function applyFinalSendPatch({ hostRoot, stateRoot, hookSourcePath }) {
  if (typeof hostRoot !== 'string' || !isAbsolute(hostRoot)
    || typeof stateRoot !== 'string' || !isAbsolute(stateRoot)
    || typeof hookSourcePath !== 'string' || !isAbsolute(hookSourcePath)) {
    throw new TypeError('Patch Manager requires absolute hostRoot, stateRoot, and hookSourcePath.');
  }
  const root = resolve(hostRoot);
  const state = resolve(stateRoot);
  if (inside(root, state) && inside(resolve(root, 'src'), state)) fail('STATE_INSIDE_HOST_SOURCE');
  await mkdir(state, { recursive: true });
  const release = await acquireLock(state);
  try {
    const rootReal = await realpath(root).catch(() => null);
    if (!rootReal) fail('HOST_ROOT_MISSING');
    // Recover an interrupted transaction before inspecting either baseline or
    // installed state. Recovery is idempotent across process restarts.
    await recoverInterruptedApply(state, rootReal);

    const manifestPath = join(state, MANIFEST_NAME);
    const existingManifest = await readJson(manifestPath);
    const hookSource = await readFile(hookSourcePath);
    if (hookSource.length === 0) fail('HOOK_SOURCE_EMPTY');
    const hookHash = sha256(hookSource);

    if (existingManifest) {
      if (existingManifest.patchId !== PATCH_ID
        || existingManifest.hostCommit !== SILLYTAVERN_TARGET.commit
        || existingManifest.originalHash !== SILLYTAVERN_TARGET.sourceHashes[SILLYTAVERN_TARGET.endpointRelativePath]
        || existingManifest.hookHash !== hookHash
        || existingManifest.endpointRelativePath !== SILLYTAVERN_TARGET.endpointRelativePath
        || existingManifest.hookRelativePath !== SILLYTAVERN_TARGET.hookRelativePath) {
        fail('INSTALLED_MANIFEST_MISMATCH');
      }
      const pkg = await readJson(await assertRegularFile(rootReal, 'package.json'));
      if (pkg?.version !== SILLYTAVERN_TARGET.packageVersion) fail('HOST_VERSION_UNSUPPORTED');
      for (const [relativePath, expectedHash] of Object.entries(SILLYTAVERN_TARGET.sourceHashes)) {
        if (relativePath === SILLYTAVERN_TARGET.endpointRelativePath) continue;
        const sourcePath = await assertRegularFile(rootReal, relativePath);
        if (sha256(await readFile(sourcePath)) !== expectedHash) fail('HOST_SOURCE_HASH_MISMATCH_' + relativePath.replaceAll('/', '_').replaceAll('.', '_'));
      }
      const endpointPath = await assertRegularFile(rootReal, SILLYTAVERN_TARGET.endpointRelativePath);
      const hookPath = await assertRegularFile(rootReal, SILLYTAVERN_TARGET.hookRelativePath);
      const backupPath = resolve(state, existingManifest.backupRelativePath);
      if (!inside(state, backupPath)) fail('INSTALLED_BACKUP_PATH_INVALID');
      const original = await readFile(backupPath).catch(() => null);
      if (!original || sha256(original) !== existingManifest.originalHash
        || pinnedSourceHash(original) !== SILLYTAVERN_TARGET.sourceHashes[SILLYTAVERN_TARGET.endpointRelativePath]
        || sha256(Buffer.from(patchChatCompletionsSource(original.toString('utf8')), 'utf8')) !== existingManifest.patchedHash
        || sha256(await readFile(endpointPath)) !== existingManifest.patchedHash
        || sha256(await readFile(hookPath)) !== hookHash) {
        fail('INSTALLED_PATCH_DRIFT');
      }
      return Object.freeze({ status: 'installed', patchId: PATCH_ID, hostCommit: SILLYTAVERN_TARGET.commit });
    }

    const pinned = await verifyPinnedHost(rootReal);
    const endpoint = pinned.files.get(SILLYTAVERN_TARGET.endpointRelativePath);
    const hookPath = resolve(pinned.root, SILLYTAVERN_TARGET.hookRelativePath);
    if (await exists(hookPath)) fail('UNMANAGED_HOOK_EXISTS');

    const originalHash = sha256(endpoint.bytes);
    const patchedBytes = Buffer.from(patchChatCompletionsSource(endpoint.bytes.toString('utf8')), 'utf8');
    const patchedHash = sha256(patchedBytes);
    const backupRelativePath = 'backups/' + randomUUID() + '/chat-completions.js';
    const backupPath = join(state, backupRelativePath);
    await mkdir(dirname(backupPath), { recursive: true });
    const backupHandle = await open(backupPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
    try {
      await backupHandle.writeFile(endpoint.bytes);
      await backupHandle.sync();
    } finally {
      await backupHandle.close();
    }

    const pending = {
      patchId: PATCH_ID,
      hostCommit: SILLYTAVERN_TARGET.commit,
      endpointRelativePath: SILLYTAVERN_TARGET.endpointRelativePath,
      hookRelativePath: SILLYTAVERN_TARGET.hookRelativePath,
      backupRelativePath,
      originalHash,
      patchedHash,
      hookHash,
    };
    await atomicJson(join(state, PENDING_NAME), pending);

    try {
      await atomicWrite(hookPath, hookSource, 0o644);
      await atomicWrite(endpoint.path, patchedBytes, 0o644);
      const verifyEndpoint = await readFile(endpoint.path);
      const verifyHook = await readFile(hookPath);
      if (sha256(verifyEndpoint) !== patchedHash || sha256(verifyHook) !== hookHash) {
        fail('POST_INSTALL_VERIFY_FAILED');
      }
      await atomicJson(manifestPath, {
        ...pending,
        status: 'installed',
        installedAt: new Date().toISOString(),
      });
      await unlink(join(state, PENDING_NAME));
      return Object.freeze({ status: 'installed', patchId: PATCH_ID, hostCommit: SILLYTAVERN_TARGET.commit });
    } catch (error) {
      const currentEndpoint = await readFile(endpoint.path).catch(() => null);
      if (currentEndpoint && sha256(currentEndpoint) === patchedHash) {
        await atomicWrite(endpoint.path, endpoint.bytes);
      }
      const currentHook = await readFile(hookPath).catch(() => null);
      if (currentHook && sha256(currentHook) === hookHash) await unlink(hookPath);
      await unlink(join(state, PENDING_NAME)).catch(() => {});
      throw error;
    }
  } finally {
    await release();
  }
}

export async function restoreFinalSendPatch({ hostRoot, stateRoot }) {
  if (typeof hostRoot !== 'string' || !isAbsolute(hostRoot)
    || typeof stateRoot !== 'string' || !isAbsolute(stateRoot)) {
    throw new TypeError('Patch Manager restore requires absolute hostRoot and stateRoot.');
  }
  const root = resolve(hostRoot);
  const state = resolve(stateRoot);
  await mkdir(state, { recursive: true });
  const release = await acquireLock(state);
  try {
    const manifestPath = join(state, MANIFEST_NAME);
    const manifest = await readJson(manifestPath);
    if (!manifest || manifest.status !== 'installed' || manifest.patchId !== PATCH_ID) {
      fail('PATCH_NOT_INSTALLED');
    }
    const endpointPath = resolve(root, manifest.endpointRelativePath);
    const hookPath = resolve(root, manifest.hookRelativePath);
    const backupPath = resolve(state, manifest.backupRelativePath);
    if (!inside(root, endpointPath) || !inside(root, hookPath) || !inside(state, backupPath)) {
      fail('RESTORE_PATH_INVALID');
    }
    const endpoint = await readFile(endpointPath);
    const hook = await readFile(hookPath);
    const original = await readFile(backupPath);
    if (sha256(endpoint) !== manifest.patchedHash
      || sha256(hook) !== manifest.hookHash
      || sha256(original) !== manifest.originalHash) {
      fail('RESTORE_DRIFT');
    }
    await atomicWrite(endpointPath, original);
    await unlink(hookPath);
    await unlink(manifestPath);
    return Object.freeze({ status: 'restored', patchId: PATCH_ID });
  } finally {
    await release();
  }
}

export async function getFinalSendPatchStatus({ hostRoot, stateRoot }) {
  const state = resolve(stateRoot);
  const manifest = await readJson(join(state, MANIFEST_NAME));
  if (!manifest) {
    const hookPath = resolve(hostRoot, SILLYTAVERN_TARGET.hookRelativePath);
    if (await exists(hookPath)) return Object.freeze({ status: 'unmanaged' });
    return Object.freeze({ status: 'not_installed' });
  }
  if (manifest.patchId !== PATCH_ID
    || manifest.endpointRelativePath !== SILLYTAVERN_TARGET.endpointRelativePath
    || manifest.hookRelativePath !== SILLYTAVERN_TARGET.hookRelativePath) {
    return Object.freeze({ status: 'unmanaged' });
  }
  const endpointPath = resolve(hostRoot, manifest.endpointRelativePath);
  const hookPath = resolve(hostRoot, manifest.hookRelativePath);
  if (!inside(resolve(hostRoot), endpointPath) || !inside(resolve(hostRoot), hookPath)) {
    return Object.freeze({ status: 'unmanaged' });
  }
  const endpoint = await readFile(endpointPath).catch(() => null);
  const hook = await readFile(hookPath).catch(() => null);
  if (!endpoint || !hook || sha256(endpoint) !== manifest.patchedHash
    || sha256(hook) !== manifest.hookHash) {
    return Object.freeze({ status: 'drifted', patchId: manifest.patchId });
  }
  return Object.freeze({ status: 'installed', patchId: manifest.patchId, hostCommit: manifest.hostCommit });
}
