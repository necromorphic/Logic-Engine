import { createHash, randomUUID } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import {
  copyFile, lstat, mkdir, open, readFile, realpath, rename, rm, stat, unlink, writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

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

async function ensureSafeDirectory(path) {
  const info = await lstat(path).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (info?.isSymbolicLink() || info && !info.isDirectory()) {
    throw new Error('PATCH_MANAGER_DIRECTORY_UNSAFE: ' + path);
  }
  if (!info) await mkdir(path, { recursive: false });
}

async function assertRegularFile(root, relativePath) {
  const target = resolve(root, relativePath);
  await assertNoSymlinkComponents(root, target);
  const info = await lstat(target);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error('PATCH_TARGET_NOT_REGULAR_FILE: ' + relativePath);
  return target;
}

function runGit(args, cwd) {
  execFileSync('git', args, { cwd, stdio: 'pipe', windowsHide: true });
}

function canonicalTextHash(bytes) {
  if (!isUtf8(bytes)) throw new Error('PATCH_BACKUP_ENCODING_INVALID');
  return sha256(Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8'));
}

export class SillyTavernPatchManager {
  constructor({ extensionRoot, stRoot, manifestPath = DEFAULT_MANIFEST, patchPath = DEFAULT_PATCH, runGitImpl = runGit }) {
    if (typeof extensionRoot !== 'string' || typeof stRoot !== 'string' || !isAbsolute(resolve(stRoot))) {
      throw new TypeError('Patch Manager requires extensionRoot and an absolute SillyTavern root.');
    }
    this.extensionRoot = resolve(extensionRoot);
    this.stRootInput = resolve(stRoot);
    this.manifestPath = resolve(manifestPath);
    this.patchPath = resolve(patchPath);
    this.runGit = runGitImpl;
    this.managerDir = resolve(this.stRootInput, '.logic-engine-patch-manager');
    this.statePath = resolve(this.managerDir, 'state.json');
    this.journalPath = resolve(this.managerDir, 'transaction.json');
    this.lockPath = resolve(this.managerDir, 'manager.lock');
    this.backupsRoot = resolve(this.managerDir, 'backups');
  }

  async initialize() {
    this.stRoot = await realpath(this.stRootInput);
    const rootInfo = await lstat(this.stRoot);
    if (!rootInfo.isDirectory()) throw new Error('SILLYTAVERN_ROOT_INVALID');
    if (!isWithin(this.stRoot, this.managerDir)) throw new Error('PATCH_MANAGER_STATE_PATH_INVALID');
    for (const [path, code] of [[this.manifestPath, 'PATCH_MANIFEST_UNSAFE'], [this.patchPath, 'PATCH_ARTIFACT_UNSAFE']]) {
      const info = await lstat(path);
      if (info.isSymbolicLink() || !info.isFile()) throw new Error(code);
    }
    this.manifest = JSON.parse(await readFile(this.manifestPath, 'utf8'));
    this.patchBytes = await readFile(this.patchPath);
    if (!isUtf8(this.patchBytes)) throw new Error('PATCH_ARTIFACT_ENCODING_INVALID');
    // Git may materialize text patches with CRLF on Windows. The manifest
    // pins canonical UTF-8/LF bytes so the same artifact verifies on every OS.
    const canonicalPatchBytes = Buffer.from(this.patchBytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
    if (sha256(canonicalPatchBytes) !== this.manifest.patch.sha256) throw new Error('PATCH_ARTIFACT_INTEGRITY_MISMATCH');
    if (this.manifest.id !== 'logic-engine-sillytavern-final-send'
      || this.manifest.host?.name !== 'SillyTavern'
      || this.manifest.host?.version !== '1.19.0'
      || this.manifest.host?.commit !== '06bde939fb1e9c4c8d8641d810f0a916b5bce127') {
      throw new Error('PATCH_MANIFEST_IDENTITY_INVALID');
    }
  }

  async withLock(operation) {
    await assertNoSymlinkComponents(this.stRoot, this.managerDir);
    await ensureSafeDirectory(this.managerDir);
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
    return sha256(Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8'));
  }

  async verifyBaseline() {
    const packageJson = JSON.parse(await readFile(await assertRegularFile(this.stRoot, 'package.json'), 'utf8'));
    if (packageJson.version !== this.manifest.host.version) throw new Error('SILLYTAVERN_VERSION_MISMATCH');
    for (const [relativePath, expected] of Object.entries(this.manifest.sourceFiles)) {
      const before = typeof expected === 'string' ? expected : expected.before;
      const actual = await this.hashAt(relativePath);
      if (actual !== before) throw new Error('SILLYTAVERN_SOURCE_CONFLICT: ' + relativePath);
    }
  }

  async verifyInstalled() {
    for (const [relativePath, expected] of Object.entries(this.manifest.sourceFiles)) {
      const after = typeof expected === 'string' ? expected : expected.after;
      if (await this.hashAt(relativePath) !== after) throw new Error('PATCH_VERIFY_FAILED: ' + relativePath);
    }
    for (const [relativePath, expected] of Object.entries(this.manifest.createdFiles)) {
      if (await this.hashAt(relativePath) !== expected) throw new Error('PATCH_VERIFY_FAILED: ' + relativePath);
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
      || state.patchSha256 !== this.manifest.patch.sha256
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
      patchSha256: this.manifest.patch.sha256,
      verifiedBackupCount: expectedBackups.length,
    };
  }

  async preflight() {
    await this.initialize();
    await this.verifyBaseline();
    this.runGit(['apply', '--check', this.patchPath], this.stRoot);
    return { status: 'PREFLIGHT_OK', hostVersion: this.manifest.host.version, patchVersion: this.manifest.patch.version };
  }

  async installUnlocked() {
    const state = await this.readState();
    if (state?.status === 'INSTALLED') {
      await this.verifyInstalled();
      return { status: 'ALREADY_INSTALLED', patchVersion: state.patchVersion };
    }
    await this.verifyBaseline();
    this.runGit(['apply', '--check', this.patchPath], this.stRoot);

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
    try {
      this.runGit(['apply', this.patchPath], this.stRoot);
      await this.verifyInstalled();
      const installed = {
        manifestId: this.manifest.id,
        status: 'INSTALLED',
        hostVersion: this.manifest.host.version,
        hostCommit: this.manifest.host.commit,
        patchVersion: this.manifest.patch.version,
        patchSha256: this.manifest.patch.sha256,
        backupId,
        backups,
        createdFiles: this.manifest.createdFiles,
        sourceFilesAfter: Object.fromEntries(Object.entries(this.manifest.sourceFiles).map(([path, value]) => [path, typeof value === 'string' ? value : value.after])),
        sourceFilesBefore: Object.fromEntries(Object.entries(this.manifest.sourceFiles).map(([path, value]) => [path, typeof value === 'string' ? value : value.before])),
        installedAt: new Date().toISOString(),
      };
      await atomicWrite(this.statePath, JSON.stringify(installed, null, 2) + '\n');
      await rm(this.journalPath, { force: true });
      return { status: 'INSTALLED', patchVersion: this.manifest.patch.version };
    } catch (error) {
      await this.restoreJournal(journal);
      throw error;
    }
  }

  async restoreJournal(journal) {
    // Every audited file must still match the exact installed host baseline,
    // except files owned by this patch which may match their exact post-patch hash.
    for (const [relativePath, before] of Object.entries(journal.sourceFilesBefore ?? {})) {
      const current = await this.hashAt(relativePath);
      const after = journal.sourceFilesAfter?.[relativePath];
      if (current !== before && (!after || current !== after)) {
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
      const temp = target + '.logic-engine-restore-' + randomUUID();
      await copyFile(backup, temp);
      await rename(temp, target);
    }
    for (const relativePath of Object.keys(journal.createdFiles ?? {})) {
      await rm(resolve(this.stRoot, relativePath), { force: true });
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
        this.runGit(['apply', '--check', this.patchPath], this.stRoot);
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
        if (state?.patchVersion === this.manifest.patch.version) {
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
