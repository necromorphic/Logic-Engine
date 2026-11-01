import { access, lstat, mkdir, open, realpath, stat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { arch, hostname, release, type as osType } from 'node:os';
import { dirname, resolve } from 'node:path';
import { createCapabilityEvidence } from './policy.js';

const ADAPTER_VERSION = '1.0.0';
const supportedPlatform = (value) => value === 'win32' ? 'windows' : value === 'linux' ? 'linux' : 'unknown';

function capability(id, status, required, evidenceSource, observedSummary, limitations = []) {
  return createCapabilityEvidence({
    id, status, required, evidenceSource, observedSummary,
    adapterVersion: ADAPTER_VERSION, limitations,
  });
}

async function accessStatus(path, mode) {
  try {
    await access(path, mode);
    return 'PASS';
  } catch (error) {
    if (error?.code === 'ENOENT') return 'FAIL';
    if (error?.code === 'EACCES' || error?.code === 'EPERM') return 'FAIL';
    return 'NOT_TESTED';
  }
}

export function createPlatformSecurityAdapter({ platform = process.platform } = {}) {
  const family = supportedPlatform(platform);

  async function identifyPlatform() {
    let effectiveUser = null;
    let effectiveGroups = [];
    let elevated = null;
    if (family === 'linux' && typeof process.getuid === 'function') {
      effectiveUser = String(process.getuid());
      effectiveGroups = [String(process.getgid()), ...process.getgroups().map(String)];
      elevated = process.getuid() === 0;
    } else if (family === 'windows') {
      // Node does not expose a stable Windows SID/token API; environment names are not identity proof.
      effectiveUser = null;
      elevated = null;
    }
    return Object.freeze({
      platform: family,
      release: release(),
      architecture: arch(),
      osName: osType(),
      hostname: hostname(),
      effectiveUser,
      effectiveGroups: Object.freeze(effectiveGroups),
      elevated,
    });
  }

  async function inspectPath(inputPath, intents = ['read']) {
    if (typeof inputPath !== 'string' || !inputPath.trim()) throw new TypeError('DEPLOYMENT_PATH_REQUIRED');
    const canonicalInput = resolve(inputPath);
    let item;
    try {
      item = await lstat(canonicalInput);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        return Object.freeze({
          canonicalPath: canonicalInput,
          exists: null,
          linkType: 'unknown',
          access: Object.freeze(Object.fromEntries(intents.map((intent) => [intent, 'NOT_TESTED']))),
          evidence: Object.freeze([capability('filesystem.path.canonicalize', 'NOT_TESTED', true, 'node:fs.lstat', undefined, ['Path inspection failed: ' + (error?.code ?? 'unknown')])]),
        });
      }
      const parent = dirname(canonicalInput);
      const parentAccess = await accessStatus(parent, fsConstants.W_OK | fsConstants.X_OK);
      return Object.freeze({
        canonicalPath: canonicalInput,
        exists: false,
        linkType: 'none',
        access: Object.freeze(Object.fromEntries(intents.map((intent) => [intent, intent === 'create' || intent === 'delete' || intent === 'rename' ? parentAccess : 'FAIL']))),
        evidence: Object.freeze([capability('filesystem.path.canonicalize', 'PASS', true, 'node:fs.lstat', 'Target does not exist; parent path inspected.')]),
      });
    }
    const linkType = item.isSymbolicLink() ? (family === 'windows' ? 'reparse' : 'symlink') : 'none';
    let resolvedPath = canonicalInput;
    try { resolvedPath = await realpath(canonicalInput); } catch {}
    const targetStat = await stat(canonicalInput).catch(() => null);
    const modeMap = {
      read: fsConstants.R_OK,
      append: fsConstants.W_OK,
      replace: fsConstants.W_OK,
      create: fsConstants.W_OK | fsConstants.X_OK,
      delete: fsConstants.W_OK | fsConstants.X_OK,
      rename: fsConstants.W_OK | fsConstants.X_OK,
    };
    const access = {};
    for (const intent of intents) {
      if (!Object.hasOwn(modeMap, intent)) {
        access[intent] = 'UNSUPPORTED';
        continue;
      }
      const target = ['create', 'delete', 'rename'].includes(intent) ? dirname(canonicalInput) : canonicalInput;
      access[intent] = await accessStatus(target, modeMap[intent]);
    }
    const linkStatus = linkType === 'none' ? 'PASS' : 'FAIL';
    return Object.freeze({
      canonicalPath: resolvedPath,
      exists: true,
      isDirectory: item.isDirectory(),
      isFile: item.isFile(),
      linkType,
      owner: family === 'linux' && typeof item.uid === 'number' ? String(item.uid) : undefined,
      mode: family === 'linux' ? (item.mode & 0o777).toString(8) : undefined,
      size: targetStat?.size,
      access: Object.freeze(access),
      evidence: Object.freeze([
        capability('filesystem.path.canonicalize', 'PASS', true, 'node:fs.realpath', 'Resolved filesystem path.'),
        capability('filesystem.links.inspect', linkStatus, true, 'node:fs.lstat', linkType === 'none' ? 'Final path component is not a symbolic link.' : 'Link/reparse point detected.', linkType === 'none' ? [] : ['Path link requires separate reviewed policy.']),
      ]),
    });
  }

  async function ensurePrivateDirectory(inputPath, policy = 'private-owner') {
    if (family !== 'linux') {
      return capability('filesystem.private-directory.create', 'UNSUPPORTED', true, 'platform-adapter', 'Private directory ACL enforcement is not implemented for this platform.', ['No Windows ACL mutation or effective-access verification is performed.']);
    }
    const path = resolve(inputPath);
    await mkdir(path, { recursive: true, mode: 0o700 });
    const item = await lstat(path);
    if (!item.isDirectory() || item.isSymbolicLink()) {
      return capability('filesystem.private-directory.create', 'FAIL', true, 'node:fs.mkdir+lstat', 'Target is not a real directory.');
    }
    const mode = item.mode & 0o777;
    const status = (mode & 0o077) === 0 ? 'PASS' : 'FAIL';
    return capability('filesystem.private-directory.create', status, true, 'node:fs.mkdir+lstat', 'Directory mode ' + mode.toString(8), status === 'PASS' ? [] : ['Directory grants access beyond owner.']);
  }

  async function ensurePrivateFile(inputPath, policy = 'private-owner') {
    if (family !== 'linux') {
      return capability('filesystem.private-file.create', 'UNSUPPORTED', true, 'platform-adapter', 'Private file ACL enforcement is not implemented for this platform.', ['No Windows ACL mutation or effective-access verification is performed.']);
    }
    const path = resolve(inputPath);
    const handle = await open(path, 'wx', 0o600);
    try { await handle.sync(); } finally { await handle.close(); }
    const item = await lstat(path);
    if (!item.isFile() || item.isSymbolicLink()) return capability('filesystem.private-file.create', 'FAIL', true, 'node:fs.open+lstat', 'Target is not a regular file.');
    const mode = item.mode & 0o777;
    const status = (mode & 0o077) === 0 ? 'PASS' : 'FAIL';
    return capability('filesystem.private-file.create', status, true, 'node:fs.open+lstat', 'File mode ' + mode.toString(8), status === 'PASS' ? [] : ['File grants access beyond owner.']);
  }

  async function inspectOpenHandles() {
    return [capability('filesystem.open-handles.inspect', 'NOT_TESTED', true, 'platform-adapter', undefined, ['Cross-platform complete open-handle inspection is not implemented.'])];
  }

  async function inspectSecretCapabilities() {
    return [
      capability('secrets.os-store.available', 'NOT_TESTED', false, 'platform-adapter', undefined, ['OS secret-store discovery is not implemented.']),
      capability('secrets.private-file.verified', 'NOT_TESTED', false, 'platform-adapter', undefined, ['Requires a separately inspected private secrets directory.']),
    ];
  }

  async function inspectServiceCapabilities() {
    return [
      capability('process.supervisor.available', 'NOT_TESTED', false, 'platform-adapter', undefined, ['Service/supervisor integration is not implemented in Portable/Desktop phase.']),
      capability('process.identity.separate', 'UNSUPPORTED', false, 'portable-profile', 'Portable/Desktop uses a single process identity.', ['No per-component OS identity isolation is claimed.']),
    ];
  }

  async function collectEvidence() {
    const identity = await identifyPlatform();
    const platformStatus = family === 'unknown' ? 'UNSUPPORTED' : 'PASS';
    const identityStatus = family === 'linux' && identity.effectiveUser !== null ? 'PASS' : 'NOT_TESTED';
    return [
      capability('platform.identity.inspect', platformStatus, true, 'node:os', family),
      capability('platform.execution-identity.inspect', identityStatus, true, 'node:process', identity.effectiveUser ?? undefined, identityStatus === 'PASS' ? [] : ['Effective OS identity is not proven by this adapter.']),
      capability('filesystem.access.effective', 'NOT_TESTED', true, 'platform-adapter', undefined, ['Path-specific effective access must be inspected for each manifest resource.']),
      ...(await inspectOpenHandles()),
      ...(await inspectSecretCapabilities()),
      ...(await inspectServiceCapabilities()),
      capability('backup.freshness-anchor.available', 'NOT_TESTED', false, 'platform-adapter', undefined, ['Independent anti-rollback anchor is not implemented in Portable/Desktop phase.']),
    ];
  }

  return Object.freeze({
    id: 'logic-engine.platform.' + family,
    version: ADAPTER_VERSION,
    platform: family,
    identifyPlatform,
    inspectPath,
    ensurePrivateDirectory,
    ensurePrivateFile,
    inspectOpenHandles,
    inspectSecretCapabilities,
    inspectServiceCapabilities,
    collectEvidence,
  });
}
