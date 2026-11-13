import { createHash, randomUUID } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import {
  copyFile, lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm, stat, unlink, writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MANIFEST = resolve(here, '../host-adapter/patches/sillytavern-1.19.0-final-send.manifest.json');
const DEFAULT_PATCH = resolve(here, '../host-adapter/patches/sillytavern-1.19.0-final-send.patch');

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const exists = async (path) => stat(path).then(() => true, () => false);
const isWithin = (root, path) => {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel));
};

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temp = path + '.tmp-' + randomUUID();
  const handle = await open(temp, 'wx', 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, path);
  await syncDirectory(dirname(path));
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await open(directory, 'r');
    await handle.sync();
  } catch (error) {
    // Some Windows filesystems do not support directory fsync; other I/O
    // failures must abort the transaction and leave its journal recoverable.
    if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM', 'EBADF'].includes(error?.code)) throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function atomicReplaceExisting(path, content) {
  const current = await lstat(path);
  if (current.isSymbolicLink() || !current.isFile()) {
    throw new Error('PATCH_RESTORE_TARGET_UNSAFE: ' + path);
  }
  const temp = path + '.tmp-' + randomUUID();
  const handle = await open(temp, 'wx', current.mode & 0o777);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, path);
  await syncDirectory(dirname(path));
}

async function assertNoSymlinkComponents(root, target) {
  if (!isWithin(root, target)) throw new Error('PATCH_PATH_ESCAPE: ' + target);
  const rel = relative(root, target);
  let current = root;
  const parts = rel ? rel.split(sep) : [];
  for (let index = 0; index < parts.length; index += 1) {
    current = resolve(current, parts[index]);
    const info = await lstat(current).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (info?.isSymbolicLink()) throw new Error('PATCH_SYMLINK_PATH_DENIED: ' + current);
    if (info && index < parts.length - 1 && !info.isDirectory()) {
      throw new Error('PATCH_PATH_COMPONENT_NOT_DIRECTORY: ' + current);
    }
  }
}

async function ensureSafeDirectoryTree(root, target) {
  if (!isWithin(root, target) || target === root) {
    throw new Error('PATCH_MANAGER_DIRECTORY_UNSAFE: ' + target);
  }
  let current = root;
  for (const component of relative(root, target).split(sep).filter(Boolean)) {
    current = resolve(current, component);
    try {
      await mkdir(current);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error('PATCH_MANAGER_DIRECTORY_UNSAFE: ' + current);
    }
  }
}

async function assertRegularFile(root, relativePath) {
  const target = resolve(root, relativePath);
  await assertNoSymlinkComponents(root, target);
  const info = await lstat(target);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error('PATCH_TARGET_NOT_REGULAR_FILE: ' + relativePath);
  return target;
}

function runGit(args, cwd) {
  const candidates = process.platform === 'win32'
    ? [
      process.env.GIT_EXECUTABLE,
      'C:\\Program Files\\Git\\cmd\\git.exe',
      'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
      resolve(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'cmd', 'git.exe'),
      'git',
    ].filter(Boolean)
    : [process.env.GIT_EXECUTABLE || 'git'];
  let lastError;
  for (const executable of candidates) {
    try {
      execFileSync(executable, args, { cwd, stdio: 'pipe', windowsHide: true });
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      lastError = error;
    }
  }
  throw lastError ?? new Error('GIT_EXECUTABLE_NOT_FOUND');
}

function canonicalTextHash(bytes) {
  if (!isUtf8(bytes)) throw new Error('PATCH_BACKUP_ENCODING_INVALID');
  return sha256(Buffer.from(bytes.toString('utf8').replace(/\r\n?/g, '\n'), 'utf8'));
}

export class SillyTavernPatchManager {
  constructor({ extensionRoot, stRoot, manifestPath = DEFAULT_MANIFEST, patchPath = DEFAULT_PATCH, runGitImpl = runGit, trustedHostOverlayFiles = new Map() }) {
    if (typeof extensionRoot !== 'string' || typeof stRoot !== 'string' || !isAbsolute(resolve(stRoot))) {
      throw new TypeError('Patch Manager requires extensionRoot and an absolute SillyTavern root.');
    }
    this.extensionRoot = resolve(extensionRoot);
    this.stRootInput = resolve(stRoot);
    this.manifestPath = resolve(manifestPath);
    this.patchPath = resolve(patchPath);
    this.runGit = runGitImpl;
    // Exact file hashes from a separately verified legacy Host bundle may explain
    // shared-file overlays before the new Gateway attestation is installed.
    this.trustedHostOverlayFiles = trustedHostOverlayFiles instanceof Map
      ? new Map(trustedHostOverlayFiles)
      : new Map();
    // Keep transaction state and byte-exact backups outside the removable Extension tree.
    this.managerDir = resolve(this.stRootInput, 'data', 'logic-engine', 'final-send-patch');
    this.statePath = resolve(this.managerDir, 'state.json');
    this.journalPath = resolve(this.managerDir, 'transaction.json');
    this.lockPath = resolve(this.managerDir, 'manager.lock');
    this.backupsRoot = resolve(this.managerDir, 'backups');
  }

  async initialize() {
    this.stRoot = await realpath(this.stRootInput);
    // Resolve all durable state paths against the canonical Host root, not a
    // possibly symlinked caller spelling of the installation directory.
    this.managerDir = resolve(this.stRoot, 'data', 'logic-engine', 'final-send-patch');
    this.statePath = resolve(this.managerDir, 'state.json');
    this.journalPath = resolve(this.managerDir, 'transaction.json');
    this.lockPath = resolve(this.managerDir, 'manager.lock');
    this.backupsRoot = resolve(this.managerDir, 'backups');
    const rootInfo = await lstat(this.stRoot);
    if (!rootInfo.isDirectory()) throw new Error('SILLYTAVERN_ROOT_INVALID');
    if (!isWithin(this.stRoot, this.managerDir)) throw new Error('PATCH_MANAGER_STATE_PATH_INVALID');
    const manifestInfo = await lstat(this.manifestPath);
    if (manifestInfo.isSymbolicLink() || !manifestInfo.isFile()) throw new Error('PATCH_MANIFEST_UNSAFE');
    this.manifest = JSON.parse(await readFile(this.manifestPath, 'utf8'));
    const declaredArtifacts = this.manifest.patch?.artifacts;
    if (declaredArtifacts === undefined) {
      const patchInfo = await lstat(this.patchPath);
      if (patchInfo.isSymbolicLink() || !patchInfo.isFile()) throw new Error('PATCH_ARTIFACT_UNSAFE');
    }
    this.patchArtifacts = [];
    if (declaredArtifacts !== undefined) {
      if (!Array.isArray(declaredArtifacts) || declaredArtifacts.length < 2 || declaredArtifacts.length > 16) {
        throw new Error('PATCH_ARTIFACT_BUNDLE_INVALID');
      }
      for (const [index, descriptor] of declaredArtifacts.entries()) {
        if (!descriptor || typeof descriptor.path !== 'string'
          || descriptor.path.includes('\\') || isAbsolute(descriptor.path)
          || descriptor.path.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':') || part.includes('\0'))
          || !/^[a-f0-9]{64}$/.test(descriptor.sha256 ?? '')
          || typeof descriptor.allowUnidiffZero !== 'boolean') {
          throw new Error('PATCH_ARTIFACT_BUNDLE_INVALID');
        }
        const artifactPath = resolve(this.extensionRoot, ...descriptor.path.split('/'));
        await assertNoSymlinkComponents(this.extensionRoot, artifactPath);
        const artifactInfo = await lstat(artifactPath);
        if (artifactInfo.isSymbolicLink() || !artifactInfo.isFile()) {
          throw new Error('PATCH_ARTIFACT_UNSAFE: ' + descriptor.path);
        }
        const bytes = await readFile(artifactPath);
        if (!isUtf8(bytes)) throw new Error('PATCH_ARTIFACT_ENCODING_INVALID: ' + descriptor.path);
        const canonicalBytes = Buffer.from(bytes.toString('utf8').replace(/\r\n?/g, '\n'), 'utf8');
        if (sha256(canonicalBytes) !== descriptor.sha256) {
          throw new Error('PATCH_ARTIFACT_INTEGRITY_MISMATCH: ' + descriptor.path);
        }
        this.patchArtifacts.push({
          path: descriptor.path,
          bytes: canonicalBytes,
          sha256: descriptor.sha256,
          allowUnidiffZero: descriptor.allowUnidiffZero === true,
        });
      }
      const bundleIdentity = JSON.stringify(this.patchArtifacts.map(({ path, sha256, allowUnidiffZero }) => ({ path, sha256, allowUnidiffZero })));
      this.patchSha256 = sha256(Buffer.from(bundleIdentity, 'utf8'));
      if (this.manifest.patch.bundleSha256 !== this.patchSha256) {
        throw new Error('PATCH_ARTIFACT_BUNDLE_INTEGRITY_MISMATCH');
      }
      const finalSendArtifact = this.patchArtifacts.find(item => item.path === this.manifest.patch.path);
      if (!finalSendArtifact || finalSendArtifact.sha256 !== this.manifest.patch.sha256) {
        throw new Error('PATCH_ARTIFACT_FINAL_SEND_PIN_MISMATCH');
      }
      this.canonicalPatchBytes = finalSendArtifact.bytes;
    } else {
      this.patchBytes = await readFile(this.patchPath);
      if (!isUtf8(this.patchBytes)) throw new Error('PATCH_ARTIFACT_ENCODING_INVALID');
      // Git may materialize text patches with CRLF on Windows. The manifest
      // pins canonical UTF-8/LF bytes so the same artifact verifies on every OS.
      const canonicalPatchBytes = Buffer.from(this.patchBytes.toString('utf8').replace(/\r\n?/g, '\n'), 'utf8');
      this.canonicalPatchBytes = canonicalPatchBytes;
      if (sha256(canonicalPatchBytes) !== this.manifest.patch.sha256) throw new Error('PATCH_ARTIFACT_INTEGRITY_MISMATCH');
      this.patchArtifacts.push({
        path: this.manifest.patch.path ?? 'logic-engine-final-send.patch',
        bytes: canonicalPatchBytes,
        sha256: this.manifest.patch.sha256,
        allowUnidiffZero: false,
      });
      this.patchSha256 = this.manifest.patch.sha256;
    }
    if (this.manifest.id !== 'logic-engine-sillytavern-final-send'
      || this.manifest.host?.name !== 'SillyTavern'
      || this.manifest.host?.version !== '1.19.0'
      || this.manifest.host?.commit !== '06bde939fb1e9c4c8d8641d810f0a916b5bce127') {
      throw new Error('PATCH_MANIFEST_IDENTITY_INVALID');
    }
  }

  async withLock(operation) {
    await assertNoSymlinkComponents(this.stRoot, this.managerDir);
    await ensureSafeDirectoryTree(this.stRoot, this.managerDir);
    let handle;
    try {
      handle = await open(this.lockPath, 'wx', 0o600);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let lock;
      try { lock = JSON.parse(await readFile(this.lockPath, 'utf8')); } catch {
        throw new Error('PATCH_MANAGER_LOCKED_OR_STALE');
      }
      if (!Number.isSafeInteger(lock.pid) || lock.pid < 1) {
        throw new Error('PATCH_MANAGER_LOCKED_OR_STALE');
      }
      try {
        process.kill(lock.pid, 0);
        throw new Error('PATCH_MANAGER_LOCKED_OR_STALE');
      } catch (probeError) {
        if (probeError.message === 'PATCH_MANAGER_LOCKED_OR_STALE') throw probeError;
        if (probeError.code !== 'ESRCH') throw new Error('PATCH_MANAGER_LOCKED_OR_STALE');
      }
      await unlink(this.lockPath);
      handle = await open(this.lockPath, 'wx', 0o600);
    }
    try {
      await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      await handle.sync();
      return await operation();
    } finally {
      await handle.close();
      await unlink(this.lockPath).catch(() => {});
    }
  }

  async readState() {
    await assertNoSymlinkComponents(this.stRoot, this.statePath);
    if (!await exists(this.statePath)) return null;
    const stateInfo = await lstat(this.statePath);
    if (stateInfo.isSymbolicLink() || !stateInfo.isFile()) throw new Error('PATCH_MANAGER_STATE_UNSAFE');
    const state = JSON.parse(await readFile(this.statePath, 'utf8'));
    if (state.manifestId !== this.manifest.id) throw new Error('PATCH_MANAGER_STATE_ID_MISMATCH');
    return state;
  }

  async writeJournal(journal) {
    await atomicWrite(this.journalPath, JSON.stringify(journal, null, 2) + '\n');
  }

  async readJournal() {
    await assertNoSymlinkComponents(this.stRoot, this.journalPath);
    if (!await exists(this.journalPath)) return null;
    const journalInfo = await lstat(this.journalPath);
    if (journalInfo.isSymbolicLink() || !journalInfo.isFile()) throw new Error('PATCH_MANAGER_JOURNAL_UNSAFE');
    return JSON.parse(await readFile(this.journalPath, 'utf8'));
  }

  async hashAt(relativePath) {
    const target = await assertRegularFile(this.stRoot, relativePath);
    const bytes = await readFile(target);
    // Git's Windows checkout may materialize pinned text files with CRLF.
    // All audited SillyTavern source artifacts are UTF-8 text and are pinned
    // by their canonical LF representation, independent of core.autocrlf.
    if (!isUtf8(bytes)) throw new Error('SILLYTAVERN_SOURCE_ENCODING_INVALID: ' + relativePath);
    return sha256(Buffer.from(bytes.toString('utf8').replace(/\r\n?/g, '\n'), 'utf8'));
  }

  async verifyBaseline() {
    const packageJson = JSON.parse(await readFile(await assertRegularFile(this.stRoot, 'package.json'), 'utf8'));
    if (packageJson.version !== this.manifest.host.version) throw new Error('SILLYTAVERN_VERSION_MISMATCH');
    for (const [relativePath, expected] of Object.entries(this.manifest.sourceFiles)) {
      const before = typeof expected === 'string' ? expected : expected.before;
      const actual = await this.hashAt(relativePath);
      // The separately installed Host Patch Bundle legitimately overlays a
      // small, reviewed set of SillyTavern files (including plugin-loader.js).
      // Accept such a baseline difference only when the Gateway's pinned
      // source attestation verifies the complete Host tree and this exact
      // file's bytes match its manifest. Unattested local edits still fail closed.
      if (actual !== before && !(await this.verifyHostOverlay(relativePath))) {
        throw new Error('SILLYTAVERN_SOURCE_CONFLICT: ' + relativePath);
      }
    }
  }

  // Host Bundle layers reviewed lifecycle/inventory changes over several
  // SillyTavern files that Final-Send also inventories. Accept an overlap only
  // when the installed Gateway independently verifies the complete pinned Host
  // source tree and the exact current file bytes appear in that verified manifest.
  async loadVerifiedHostOverlayManifest() {
    if (!this._hostOverlayManifestPromise) {
      this._hostOverlayManifestPromise = (async () => {
        const attestationPath = await assertRegularFile(
          this.stRoot,
          'plugins/logic-engine-extension-gateway/st-source-attestation.mjs',
        );
        const { verifyPinnedSourceIdentity } = await import(pathToFileURL(attestationPath).href);
        if (typeof verifyPinnedSourceIdentity !== 'function') return null;
        const identity = await verifyPinnedSourceIdentity({ installRoot: this.stRoot });
        if (identity?.status !== 'CURRENT_IDENTITIES_VERIFIED') return null;

        const manifestPath = await assertRegularFile(
          this.stRoot,
          'plugins/logic-engine-extension-gateway/pinned-source-manifest.json',
        );
        return JSON.parse(await readFile(manifestPath, 'utf8'));
      })().catch(() => null);
    }
    return this._hostOverlayManifestPromise;
  }

  async verifyHostOverlay(relativePath) {
    const hostManifest = await this.loadVerifiedHostOverlayManifest();
    const pinnedFile = hostManifest?.files?.find(entry => entry?.path === relativePath);
    if (!pinnedFile || !/^[a-f0-9]{64}$/.test(pinnedFile.sha256 ?? '')) return false;
    try {
      const target = await assertRegularFile(this.stRoot, relativePath);
      return sha256(await readFile(target)) === pinnedFile.sha256;
    } catch {
      // Missing or unsafe files never weaken the original Final-Send hash requirement.
      return false;
    }
  }

  async verifyInstalled() {
    // Re-attest on every verification call; within one call, verify the complete
    // Host tree once and reuse that result for every overlapping source file.
    this._hostOverlayManifestPromise = null;
    for (const [relativePath, expected] of Object.entries(this.manifest.sourceFiles)) {
      const after = typeof expected === 'string' ? expected : expected.after;
      const actual = await this.hashAt(relativePath);
      const trustedLegacyOverlay = this.trustedHostOverlayFiles.get(relativePath) === actual;
      if (actual !== after && !trustedLegacyOverlay && !(await this.verifyHostOverlay(relativePath))) {
        throw new Error('PATCH_VERIFY_FAILED: ' + relativePath);
      }
    }
    for (const [relativePath, expected] of Object.entries(this.manifest.createdFiles)) {
      const actual = await this.hashAt(relativePath);
      if (actual !== expected) throw new Error('PATCH_VERIFY_FAILED: ' + relativePath + ' expected=' + expected + ' actual=' + actual);
    }
    return true;
  }

  // Read-only deployment inspection. It does not trust state.json as proof:
  // installed files and every required backup are re-hashed against the pinned manifest.
  async inspectInstalledReadOnly() {
    await this.initialize();
    const journal = await this.readJournal();
    if (journal) return { status: 'AMBIGUOUS_TRANSACTION', reason: 'A transaction journal is present.' };

    const state = await this.readState();
    if (!state) return { status: 'NOT_INSTALLED' };
    if (state.status !== 'INSTALLED'
      || state.hostVersion !== this.manifest.host.version
      || state.hostCommit !== this.manifest.host.commit
      || state.patchVersion !== this.manifest.patch.version
      || state.patchSha256 !== this.patchSha256
      || typeof state.backupId !== 'string'
      || !state.backupId
      || JSON.stringify(state.createdFiles) !== JSON.stringify(this.manifest.createdFiles)) {
      throw new Error('PATCH_MANAGER_STATE_IDENTITY_INVALID');
    }

    await this.verifyInstalled();

    const expectedBackups = Object.entries(this.manifest.sourceFiles)
      .filter(([, expected]) => typeof expected !== 'string');
    const backupEntries = Object.entries(state.backups ?? {});
    if (backupEntries.length !== expectedBackups.length) {
      throw new Error('PATCH_MANAGER_BACKUP_SET_INCOMPLETE');
    }
    for (const [relativePath, expected] of expectedBackups) {
      const backupInfo = state.backups[relativePath];
      if (!backupInfo || backupInfo.sha256 !== expected.before
        || typeof backupInfo.backupPath !== 'string') {
        throw new Error('PATCH_MANAGER_BACKUP_RECORD_INVALID: ' + relativePath);
      }
      const expectedSuffix = relative(this.managerDir, resolve(this.managerDir, 'backups', state.backupId, relativePath));
      if (backupInfo.backupPath !== expectedSuffix) {
        throw new Error('PATCH_MANAGER_BACKUP_PATH_INVALID: ' + relativePath);
      }
      const backup = resolve(this.managerDir, backupInfo.backupPath);
      if (!isWithin(this.managerDir, backup)) throw new Error('PATCH_MANAGER_BACKUP_PATH_ESCAPE');
      await assertNoSymlinkComponents(this.managerDir, backup);
      const info = await lstat(backup);
      if (info.isSymbolicLink() || !info.isFile()) {
        throw new Error('PATCH_MANAGER_BACKUP_UNSAFE: ' + relativePath);
      }
      if (canonicalTextHash(await readFile(backup)) !== expected.before) {
        throw new Error('PATCH_MANAGER_BACKUP_INTEGRITY_MISMATCH: ' + relativePath);
      }
    }

    return {
      status: 'INSTALLED_AND_BACKUPS_VERIFIED',
      hostVersion: this.manifest.host.version,
      hostCommit: this.manifest.host.commit,
      patchVersion: this.manifest.patch.version,
      patchSha256: this.patchSha256,
      verifiedBackupCount: expectedBackups.length,
    };
  }

  async normalizePatchTargetsForApply() {
    for (const [relativePath, expected] of Object.entries(this.manifest.sourceFiles)) {
      if (typeof expected === 'string') continue;
      const target = await assertRegularFile(this.stRoot, relativePath);
      const bytes = await readFile(target);
      if (!isUtf8(bytes)) throw new Error('SILLYTAVERN_SOURCE_ENCODING_INVALID: ' + relativePath);
      const normalized = bytes.toString('utf8').replace(/\r\n/g, '\n');
      await atomicReplaceExisting(target, Buffer.from(normalized, 'utf8'));
    }
  }

  async restorePatchTargetLineEndings() {
    for (const [relativePath, expected] of Object.entries(this.manifest.sourceFiles)) {
      if (typeof expected === 'string') continue;
      const backupInfo = this._activeInstallBackups?.[relativePath];
      if (!backupInfo) throw new Error('PATCH_BACKUP_RECORD_MISSING: ' + relativePath);
      const backup = resolve(this.managerDir, backupInfo.backupPath);
      const originalBytes = await readFile(backup);
      if (!isUtf8(originalBytes)) throw new Error('PATCH_BACKUP_ENCODING_INVALID: ' + relativePath);
      const hadCrLf = originalBytes.toString('utf8').includes('\r\n');
      if (!hadCrLf) continue;
      const target = await assertRegularFile(this.stRoot, relativePath);
      const currentBytes = await readFile(target);
      if (!isUtf8(currentBytes)) throw new Error('SILLYTAVERN_SOURCE_ENCODING_INVALID: ' + relativePath);
      const restored = currentBytes.toString('utf8').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
      await atomicReplaceExisting(target, Buffer.from(restored, 'utf8'));
    }
  }

  async preflightPatchApplicability() {
    // If the separately installed Host Bundle is present, its pinned source
    // attestation proves that the lifecycle and root-mutation patches are
    // already applied. Reapplying those artifacts would fail on their own
    // changed hunks; Final-Send itself must still be checked against this tree.
    this._hostOverlayManifestPromise = null;
    const hostManifest = await this.loadVerifiedHostOverlayManifest();
    const attestedPaths = new Set(
      (Array.isArray(hostManifest?.files) ? hostManifest.files : [])
        .filter(file => typeof file?.path === 'string')
        .map(file => file.path),
    );
    const preappliedHostArtifacts = new Set();
    if (hostManifest) {
      const hostArtifactPaths = new Set([
        'host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-hooks.patch',
        'host-adapter/prototype/patches/sillytavern-1.19.0-root-mutation-guards.patch',
      ]);
      for (const artifact of this.patchArtifacts) {
        if (!hostArtifactPaths.has(artifact.path)) continue;
        const touchedPaths = [...artifact.bytes.toString('utf8').matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)]
          .flatMap(([, oldPath, newPath]) => [oldPath, newPath])
          .filter(filePath => filePath !== '/dev/null');
        if (touchedPaths.length === 0 || touchedPaths.some(filePath => !attestedPaths.has(filePath))) {
          throw new Error('PATCH_HOST_OVERLAY_ATTESTATION_INCOMPLETE: ' + artifact.path);
        }
        preappliedHostArtifacts.add(artifact.path);
      }
    }

    const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'logic-engine-st-patch-preflight-'));
    const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'logic-engine-st-patch-preflight-'));
    try {
      for (const [relativePath, expected] of Object.entries(this.manifest.sourceFiles)) {
        if (typeof expected === 'string') continue;
        const source = await assertRegularFile(this.stRoot, relativePath);
        const bytes = await readFile(source);
        if (!isUtf8(bytes)) throw new Error('SILLYTAVERN_SOURCE_ENCODING_INVALID: ' + relativePath);
        const target = resolve(temporaryRoot, relativePath);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
      }
      for (const [index, artifact] of this.patchArtifacts.entries()) {
        if (preappliedHostArtifacts.has(artifact.path)) continue;
        const canonicalPatchPath = resolve(temporaryRoot, 'logic-engine-patch-' + index + '.patch');
        await writeFile(canonicalPatchPath, artifact.bytes, { flag: 'wx', mode: 0o600 });
        const args = ['-c', 'core.autocrlf=false', 'apply', '--ignore-whitespace'];
        if (artifact.allowUnidiffZero) args.push('--unidiff-zero');
        args.push('--check', canonicalPatchPath);
        this.runGit(args, temporaryRoot);
        const applyArgs = ['-c', 'core.autocrlf=false', 'apply', '--ignore-whitespace'];
        if (artifact.allowUnidiffZero) applyArgs.push('--unidiff-zero');
        applyArgs.push(canonicalPatchPath);
        this.runGit(applyArgs, temporaryRoot);
      }
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
    return preappliedHostArtifacts;
  }

  async preflight() {
    await this.initialize();
    await this.verifyBaseline();
    await this.preflightPatchApplicability();
    return { status: 'PREFLIGHT_OK', hostVersion: this.manifest.host.version, patchVersion: this.manifest.patch.version };
  }

  async installUnlocked() {
    const state = await this.readState();
    if (state?.status === 'INSTALLED') {
      await this.verifyInstalled();
      return { status: 'ALREADY_INSTALLED', patchVersion: state.patchVersion };
    }
    await this.verifyBaseline();
    const preappliedHostArtifacts = await this.preflightPatchApplicability();

    await mkdir(this.backupsRoot, { recursive: true });
    await assertNoSymlinkComponents(this.stRoot, this.backupsRoot);
    const backupRootInfo = await lstat(this.backupsRoot);
    if (backupRootInfo.isSymbolicLink() || !backupRootInfo.isDirectory()) {
      throw new Error('PATCH_MANAGER_BACKUP_DIRECTORY_UNSAFE');
    }
    const backupId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID();
    const backupDir = resolve(this.backupsRoot, backupId);
    await mkdir(backupDir, { recursive: false });
    const backups = {};
    for (const [relativePath, expected] of Object.entries(this.manifest.sourceFiles)) {
      if (typeof expected === 'string') continue;
      const source = await assertRegularFile(this.stRoot, relativePath);
      const backup = resolve(backupDir, relativePath);
      await mkdir(dirname(backup), { recursive: true });
      await copyFile(source, backup);
      backups[relativePath] = { sha256: expected.before, backupPath: relative(this.managerDir, backup) };
    }

    const journal = {
      manifestId: this.manifest.id,
      phase: 'BACKED_UP',
      backupId,
      backups,
      createdFiles: this.manifest.createdFiles,
      sourceFilesAfter: Object.fromEntries(Object.entries(this.manifest.sourceFiles).map(([path, value]) => [path, typeof value === 'string' ? value : value.after])),
      sourceFilesBefore: Object.fromEntries(Object.entries(this.manifest.sourceFiles).map(([path, value]) => [path, typeof value === 'string' ? value : value.before])),
      startedAt: new Date().toISOString(),
    };
    await this.writeJournal(journal);
    journal.phase = 'APPLYING';
    await this.writeJournal(journal);
    this._activeInstallBackups = backups;
    const patchRoot = await mkdtemp(resolve(tmpdir(), 'logic-engine-st-patch-'));
    try {
      await this.normalizePatchTargetsForApply();
      for (const [index, artifact] of this.patchArtifacts.entries()) {
        if (preappliedHostArtifacts.has(artifact.path)) continue;
        const canonicalPatchPath = resolve(patchRoot, 'logic-engine-patch-' + index + '.patch');
        await writeFile(canonicalPatchPath, artifact.bytes, { flag: 'wx', mode: 0o600 });
        const args = ['-c', 'core.autocrlf=false', 'apply', '--ignore-whitespace'];
        if (artifact.allowUnidiffZero) args.push('--unidiff-zero');
        args.push(canonicalPatchPath);
        this.runGit(args, this.stRoot);
      }
      await this.restorePatchTargetLineEndings();

      // The Host source manifest initially describes the Host-only overlay.
      // Final-Send also changes shared ST files, so that manifest must be
      // regenerated from the independently reconstructed combined tree before
      // verifying the installed state. The generator accepts only the exact
      // pinned Host commit plus the complete pinned Final-Send patch state.
      const hostAttestationPath = resolve(
        this.stRoot,
        'plugins/logic-engine-extension-gateway/st-source-attestation.mjs',
      );
      if (await exists(hostAttestationPath) && this.trustedHostOverlayFiles.size === 0) {
        // Standalone Patch Manager updates must regenerate and verify the
        // combined Host/Final-Send manifest. During the Host Bundle installer's
        // predecessor migration, however, the orchestrator has already
        // independently verified the legacy Host overlay and supplied its
        // exact file hashes. Regenerating here would compare that old overlay
        // against the new Host source tree before the orchestrator can replace
        // it. verifyInstalled() still checks every Final-Send output and accepts
        // only those exact verified predecessor hashes; the bundle installer
        // then stages and installs the new combined Host attestation.
        await assertRegularFile(
          this.stRoot,
          'plugins/logic-engine-extension-gateway/st-source-attestation.mjs',
        );
        await assertRegularFile(
          this.stRoot,
          'plugins/logic-engine-extension-gateway/pinned-source-manifest.json',
        );
        const generatorPath = await assertRegularFile(
          this.extensionRoot,
          'host-adapter/prototype/generate-pinned-source-manifest.mjs',
        );
        execFileSync(process.execPath, [generatorPath], {
          cwd: this.extensionRoot,
          env: { ...process.env, SILLYTAVERN_DIR: this.stRoot },
          stdio: 'pipe',
          windowsHide: true,
        });
      }
      await this.verifyInstalled();
      const installed = {
        manifestId: this.manifest.id,
        status: 'INSTALLED',
        hostVersion: this.manifest.host.version,
        hostCommit: this.manifest.host.commit,
        patchVersion: this.manifest.patch.version,
        patchSha256: this.patchSha256,
        backupId,
        backups,
        createdFiles: this.manifest.createdFiles,
        sourceFilesAfter: Object.fromEntries(Object.entries(this.manifest.sourceFiles).map(([path, value]) => [path, typeof value === 'string' ? value : value.after])),
        sourceFilesBefore: Object.fromEntries(Object.entries(this.manifest.sourceFiles).map(([path, value]) => [path, typeof value === 'string' ? value : value.before])),
        installedAt: new Date().toISOString(),
      };
      await atomicWrite(this.statePath, JSON.stringify(installed, null, 2) + '\n');
      await rm(this.journalPath, { force: true });
      this._activeInstallBackups = null;
      return { status: 'INSTALLED', patchVersion: this.manifest.patch.version };
    } catch (error) {
      this._activeInstallBackups = null;
      try {
        await this.restoreJournal(journal);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'PATCH_INSTALL_FAILED_AND_ROLLBACK_FAILED: ' + error.message + ' | ' + rollbackError.message,
        );
      }
      throw error;
    } finally {
      await rm(patchRoot, { recursive: true, force: true });
    }
  }

  async restoreJournal(journal) {
    // Every audited file must still match the exact installed host baseline,
    // except files owned by this patch which may match their exact post-patch hash.
    for (const [relativePath, before] of Object.entries(journal.sourceFilesBefore ?? {})) {
      const current = await this.hashAt(relativePath);
      const after = journal.sourceFilesAfter?.[relativePath];
      // A Host Bundle predecessor is trusted only when the orchestrator
      // independently verified its pinned manifest and supplied this exact
      // per-file hash. Permit that overlay during rollback so the saved
      // Final-Send baseline can be restored before the new Host overlay is
      // reconstructed and installed by the bundle transaction.
      const trustedHostOverlay = this.trustedHostOverlayFiles.get(relativePath) === current
        || await this.verifyHostOverlay(relativePath);
      if (current !== before && (!after || current !== after) && !trustedHostOverlay) {
        throw new Error('ROLLBACK_CONFLICT_USER_CHANGE_PRESERVED: ' + relativePath);
      }
    }
    for (const [relativePath, expected] of Object.entries(journal.createdFiles ?? {})) {
      const target = resolve(this.stRoot, relativePath);
      if (await exists(target) && await this.hashAt(relativePath) !== expected) {
        throw new Error('ROLLBACK_CONFLICT_USER_CHANGE_PRESERVED: ' + relativePath);
      }
    }
    for (const [relativePath, backupInfo] of Object.entries(journal.backups ?? {})) {
      const backup = resolve(this.managerDir, backupInfo.backupPath);
      await assertNoSymlinkComponents(this.managerDir, backup);
      const backupInfoStat = await lstat(backup);
      if (backupInfoStat.isSymbolicLink() || !backupInfoStat.isFile()) {
        throw new Error('PATCH_BACKUP_INTEGRITY_INVALID: ' + relativePath);
      }
      const backupBytes = await readFile(backup);
      if (canonicalTextHash(backupBytes) !== backupInfo.sha256) {
        throw new Error('PATCH_BACKUP_INTEGRITY_MISMATCH: ' + relativePath);
      }
      const target = await assertRegularFile(this.stRoot, relativePath);
      await atomicReplaceExisting(target, backupBytes);
    }
    for (const relativePath of Object.keys(journal.createdFiles ?? {})) {
      await rm(resolve(this.stRoot, relativePath), { force: true });
    }

    // The Host source attestation was regenerated after Final-Send installation.
    // Once the exact pre-Final-Send files are restored, rebuild the Host-only
    // attestation. Legacy predecessor migration defers this to its orchestrator.
    const hostAttestationPath = resolve(
      this.stRoot,
      'plugins/logic-engine-extension-gateway/st-source-attestation.mjs',
    );
    if (this.trustedHostOverlayFiles.size === 0 && await exists(hostAttestationPath)) {
      await assertRegularFile(this.stRoot, 'plugins/logic-engine-extension-gateway/st-source-attestation.mjs');
      await assertRegularFile(this.stRoot, 'plugins/logic-engine-extension-gateway/pinned-source-manifest.json');
      const generatorPath = await assertRegularFile(
        this.extensionRoot,
        'host-adapter/prototype/generate-pinned-source-manifest.mjs',
      );
      execFileSync(process.execPath, [generatorPath], {
        cwd: this.extensionRoot,
        env: { ...process.env, SILLYTAVERN_DIR: this.stRoot },
        stdio: 'pipe',
        windowsHide: true,
      });
    }

    await rm(this.statePath, { force: true });
    await rm(this.journalPath, { force: true });
  }

  async recoverUnlocked() {
    const journal = await this.readJournal();
    if (!journal) return { status: 'NO_RECOVERY_NEEDED' };
    if (journal.manifestId !== this.manifest.id) throw new Error('PATCH_RECOVERY_MANIFEST_MISMATCH');
    await this.restoreJournal(journal);
    return { status: 'RECOVERED_TO_BASELINE' };
  }

  async rollbackUnlocked() {
    const state = await this.readState();
    if (!state) return { status: 'NOT_INSTALLED' };
    if (state.status !== 'INSTALLED' || !/^[a-f0-9]{64}$/.test(state.patchSha256 ?? '')) {
      throw new Error('PATCH_STATE_UNRECOGNIZED');
    }
    const journal = {
      manifestId: this.manifest.id,
      phase: 'ROLLING_BACK',
      backups: state.backups,
      createdFiles: state.createdFiles,
      sourceFilesAfter: state.sourceFilesAfter,
      sourceFilesBefore: state.sourceFilesBefore,
      startedAt: new Date().toISOString(),
    };
    await this.writeJournal(journal);
    await this.restoreJournal(journal);
    return { status: 'ROLLED_BACK' };
  }

  async execute(command) {
    await this.initialize();
    return this.withLock(async () => {
      await this.recoverUnlocked();
      if (command === 'preflight') {
        await this.verifyBaseline();
        await this.preflightPatchApplicability();
        return { status: 'PREFLIGHT_OK' };
      }
      if (command === 'install') return this.installUnlocked();
      if (command === 'verify' || command === 'status') {
        const state = await this.readState();
        if (!state) return { status: 'NOT_INSTALLED' };
        await this.verifyInstalled();
        return { status: 'INSTALLED_AND_VERIFIED', patchVersion: state.patchVersion };
      }
      if (command === 'repair') {
        const state = await this.readState();
        if (!state) return this.installUnlocked();
        await this.rollbackUnlocked();
        return this.installUnlocked();
      }
      if (command === 'update') {
        const state = await this.readState();
        const sameInstalledArtifact = state?.status === 'INSTALLED'
          && state.hostVersion === this.manifest.host.version
          && state.hostCommit === this.manifest.host.commit
          && state.patchVersion === this.manifest.patch.version
          && state.patchSha256 === this.patchSha256
          && JSON.stringify(state.createdFiles) === JSON.stringify(this.manifest.createdFiles);
        if (sameInstalledArtifact) {
          await this.verifyInstalled();
          return { status: 'UP_TO_DATE', patchVersion: state.patchVersion };
        }
        if (state) await this.rollbackUnlocked();
        return this.installUnlocked();
      }
      if (command === 'rollback' || command === 'uninstall') return this.rollbackUnlocked();
      throw new Error('UNKNOWN_PATCH_MANAGER_COMMAND');
    });
  }
}

function parseArgs(argv) {
  const [command = 'install', ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === '--st-root') options.stRoot = rest[++index];
    else if (rest[index] === '--extension-root') options.extensionRoot = rest[++index];
    else throw new Error('UNKNOWN_ARGUMENT: ' + rest[index]);
  }
  if (!options.stRoot) throw new Error('REQUIRED_ARGUMENT: --st-root');
  options.extensionRoot ??= process.cwd();
  return { command, options };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { command, options } = parseArgs(process.argv.slice(2));
    const manager = new SillyTavernPatchManager(options);
    const result = await manager.execute(command);
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    process.stderr.write(JSON.stringify({ status: 'DENY_FAIL_CLOSED', code: error.message }) + '\n');
    process.exitCode = 1;
  }
}
