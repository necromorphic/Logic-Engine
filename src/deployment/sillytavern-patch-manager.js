import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync,
  realpathSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const MANAGER_DIR = '.logic-engine/patch-manager';
const JOURNAL_NAME = 'transaction.json';
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_PATCH_BYTES = 8 * 1024 * 1024;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function runGit(root, args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  }).trim();
}

function safeRegularFile(root, relativePath, label) {
  if (typeof relativePath !== 'string' || !relativePath || isAbsolute(relativePath)) {
    throw new Error(label + ' must be a non-empty relative path.');
  }
  const target = resolve(root, relativePath);
  const rel = relative(root, target);
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
    throw new Error(label + ' escapes its trusted root.');
  }
  let cursor = root;
  for (const part of rel.split(sep)) {
    cursor = join(cursor, part);
    if (!existsSync(cursor)) continue;
    const stat = lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error(label + ' must not traverse symbolic links.');
  }
  const stat = lstatSync(target);
  if (!stat.isFile()) throw new Error(label + ' must be a regular file.');
  return target;
}

function readManifest(manifestPath) {
  const absolute = resolve(manifestPath);
  const stat = lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_MANIFEST_BYTES) {
    throw new Error('Patch manifest must be a regular file no larger than 256 KiB.');
  }
  const raw = readFileSync(absolute);
  const manifest = JSON.parse(raw.toString('utf8'));
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
    || manifest.schema_version !== 1
    || !/^[a-z0-9][a-z0-9._-]{2,79}$/.test(manifest.package_id)
    || !/^[0-9a-f]{40}$/.test(manifest.target_git_commit)
    || !Array.isArray(manifest.patches) || manifest.patches.length !== 1) {
    throw new Error('Patch manifest schema or target identity is invalid.');
  }
  const seen = new Set();
  for (const patch of manifest.patches) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)
      || typeof patch.path !== 'string' || !/^[0-9a-f]{64}$/.test(patch.sha256)
      || !Number.isSafeInteger(patch.size) || patch.size < 1 || patch.size > MAX_PATCH_BYTES
      || seen.has(patch.path)) {
      throw new Error('Patch entry is malformed, duplicated, or outside size limits.');
    }
    seen.add(patch.path);
  }
  return { manifest, manifestRoot: dirname(absolute), manifestDigest: sha256(raw) };
}

function targetInfo(stPath) {
  const requested = resolve(stPath);
  const root = realpathSync(requested);
  if (!lstatSync(root).isDirectory()) throw new Error('SillyTavern target must be a directory.');
  const gitRoot = realpathSync(runGit(root, ['rev-parse', '--show-toplevel']));
  if (gitRoot !== root) throw new Error('Target path must be the SillyTavern Git worktree root.');
  const commit = runGit(root, ['rev-parse', 'HEAD']);
  const status = runGit(root, ['status', '--porcelain=v1', '--untracked-files=all']);
  return { root, commit, clean: status.length === 0, status };
}

function managerPaths(root) {
  const gitDirectory = resolve(root, runGit(root, ['rev-parse', '--git-path', 'logic-engine-patch-manager']));
  const directory = gitDirectory;
  return { directory, journal: join(directory, JOURNAL_NAME), backups: join(directory, 'backups') };
}

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = path + '.' + randomUUID() + '.tmp';
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  try { chmodSync(temp, 0o600); } catch {}
  renameSync(temp, path);
}

function loadJournal(root) {
  const { journal } = managerPaths(root);
  if (!existsSync(journal)) return null;
  const stat = lstatSync(journal);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Patch Manager journal is not a regular file.');
  const value = JSON.parse(readFileSync(journal, 'utf8'));
  if (value?.schema_version !== 1 || typeof value.package_id !== 'string'
    || !Array.isArray(value.files) || !['APPLYING', 'APPLIED', 'ROLLING_BACK'].includes(value.state)) {
    throw new Error('Patch Manager journal is malformed; manual recovery is required.');
  }
  return value;
}

function patchPaths(root, patchText) {
  const paths = [];
  for (const line of patchText.split(/\r?\n/)) {
    if (!line.startsWith('diff --git a/')) continue;
    const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (!match || match[1] !== match[2] || match[1].includes('\0')) {
      throw new Error('Patch contains a rename/copy or malformed path; only same-path edits are supported.');
    }
    const filePath = match[1];
    const absolute = resolve(root, filePath);
    const rel = relative(root, absolute);
    if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
      throw new Error('Patch path escapes the SillyTavern root.');
    }
    paths.push(filePath);
  }
  if (paths.length < 1 || new Set(paths).size !== paths.length) throw new Error('Patch has no file edits or duplicate paths.');
  return paths;
}

function assertSafeTargetPath(root, filePath) {
  const destination = resolve(root, filePath);
  const rel = relative(root, destination);
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('Journal path escapes target root.');
  let cursor = root;
  const parts = rel.split(sep);
  for (let index = 0; index < parts.length; index++) {
    cursor = join(cursor, parts[index]);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new Error('Refusing to follow a symbolic link during recovery.');
  }
  return destination;
}

function restoreFiles(root, journal) {
  const { backups } = managerPaths(root);
  for (const file of journal.files) {
    const destination = assertSafeTargetPath(root, file.path);
    if (file.existed) {
      const backup = resolve(backups, file.backup);
      if (!backup.startsWith(backups + sep) || !existsSync(backup) || sha256(readFileSync(backup)) !== file.sha256) {
        throw new Error('Backup missing or digest mismatch for ' + file.path + '; recovery stopped.');
      }
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(backup, destination);
    } else {
      if (existsSync(destination)) rmSync(destination, { force: true });
    }
  }
}

export function inspectSillyTavernPatchTarget(stPath) {
  const info = targetInfo(stPath);
  return {
    root: info.root,
    commit: info.commit,
    clean: info.clean,
    dirtyStatus: info.status,
    patchManagerJournal: loadJournal(info.root),
  };
}

export function installSillyTavernPatchPackage({ stPath, manifestPath }) {
  const target = targetInfo(stPath);
  if (!target.clean) throw new Error('Refusing to patch a dirty SillyTavern worktree; preserve and review local changes first.');
  const { manifest, manifestRoot, manifestDigest } = readManifest(manifestPath);
  if (target.commit !== manifest.target_git_commit) throw new Error('Unsupported SillyTavern commit; exact target commit required.');
  const paths = managerPaths(target.root);
  const prior = loadJournal(target.root);
  if (prior) {
    if (prior.package_id === manifest.package_id && prior.manifest_digest === manifestDigest && prior.state === 'APPLIED') {
      return { status: 'ALREADY_APPLIED', package_id: manifest.package_id, target_commit: target.commit };
    }
    throw new Error('A prior Patch Manager transaction exists; recover or uninstall it before proceeding.');
  }

  const patchEntries = [];
  for (const item of manifest.patches) {
    const file = safeRegularFile(manifestRoot, item.path, 'Patch artifact');
    const bytes = readFileSync(file);
    if (bytes.length !== item.size || sha256(bytes) !== item.sha256) throw new Error('Patch artifact integrity check failed: ' + item.path);
    const text = bytes.toString('utf8');
    patchEntries.push({ path: file, text, affected: patchPaths(target.root, text) });
  }
  const affected = [...new Set(patchEntries.flatMap((entry) => entry.affected))].sort();
  const files = affected.map((filePath, index) => {
    const absolute = resolve(target.root, filePath);
    const rel = relative(target.root, absolute);
    if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('Patch target escapes SillyTavern root.');
    let cursor = target.root;
    for (const part of rel.split(sep)) {
      cursor = join(cursor, part);
      if (!existsSync(cursor)) continue;
      if (lstatSync(cursor).isSymbolicLink()) throw new Error('Patch target traverses a symbolic link.');
    }
    if (!existsSync(absolute)) return { path: filePath, existed: false, backup: index + '.bin', sha256: null, bytes: null };
    const stat = lstatSync(absolute);
    if (!stat.isFile()) throw new Error('Patch target must be a regular file: ' + filePath);
    const bytes = readFileSync(absolute);
    return { path: filePath, existed: true, backup: index + '.bin', sha256: sha256(bytes), bytes };
  });
  const id = randomUUID();
  mkdirSync(paths.backups, { recursive: true, mode: 0o700 });
  for (const file of files) {
    if (!file.existed) continue;
    const backup = join(paths.backups, file.backup);
    writeFileSync(backup, file.bytes, { flag: 'wx', mode: 0o600 });
    try { chmodSync(backup, 0o600); } catch {}
  }
  const storedPatchDirectory = join(paths.directory, 'patches');
  mkdirSync(storedPatchDirectory, { recursive: true, mode: 0o700 });
  const storedPatch = join(storedPatchDirectory, 'package.patch');
  writeFileSync(storedPatch, patchEntries[0].text, { flag: 'wx', mode: 0o600 });
  try { chmodSync(storedPatch, 0o600); } catch {}
  const journal = {
    schema_version: 1, transaction_id: id, package_id: manifest.package_id,
    manifest_digest: manifestDigest, target_commit: target.commit, state: 'APPLYING',
    patch_file: storedPatch, patch_sha256: sha256(readFileSync(storedPatch)),
    files: files.map(({ bytes, ...item }) => ({ ...item, installed_sha256: null })),
  };
  atomicJson(paths.journal, journal);
  try {
    for (const entry of patchEntries) runGit(target.root, ['apply', '--check', entry.path]);
    for (const entry of patchEntries) runGit(target.root, ['apply', entry.path]);
    const dirty = runGit(target.root, ['status', '--porcelain=v1', '--untracked-files=all']);
    const expected = new Set(affected.flatMap((file) => ['M ' + file, '?? ' + file]));
    const actual = dirty.split('\n').filter(Boolean);
    if (actual.some((line) => !expected.has(line)) || actual.length !== expected.size) {
      throw new Error('Post-apply worktree diff does not match the declared patch file set.');
    }
    const appliedFiles = journal.files.map((file) => {
      const absolute = assertSafeTargetPath(target.root, file.path);
      return { ...file, installed_sha256: existsSync(absolute) ? sha256(readFileSync(absolute)) : null };
    });
    atomicJson(paths.journal, { ...journal, files: appliedFiles, state: 'APPLIED' });
    return { status: 'APPLIED', package_id: manifest.package_id, target_commit: target.commit, affected_files: affected };
  } catch (error) {
    restoreFiles(target.root, journal);
    rmSync(paths.journal, { force: true });
    rmSync(paths.backups, { recursive: true, force: true });
    rmSync(join(paths.directory, 'patches'), { recursive: true, force: true });
    throw error;
  }
}

export function uninstallSillyTavernPatchPackage({ stPath, packageId }) {
  const target = targetInfo(stPath);
  const paths = managerPaths(target.root);
  const journal = loadJournal(target.root);
  if (!journal || journal.state !== 'APPLIED' || journal.package_id !== packageId) {
    throw new Error('No matching applied package journal exists.');
  }
  for (const file of journal.files) {
    const destination = assertSafeTargetPath(target.root, file.path);
    const exists = existsSync(destination);
    if (file.installed_sha256 === null ? exists : (!exists || !lstatSync(destination).isFile() || sha256(readFileSync(destination)) !== file.installed_sha256)) {
      throw new Error('Patched file changed since installation; refusing to overwrite user changes: ' + file.path);
    }
  }
  atomicJson(paths.journal, { ...journal, state: 'ROLLING_BACK' });
  try {
    restoreFiles(target.root, journal);
    rmSync(paths.journal, { force: true });
    rmSync(paths.backups, { recursive: true, force: true });
    rmSync(join(paths.directory, 'patches'), { recursive: true, force: true });
    return { status: 'ROLLED_BACK', package_id: packageId };
  } catch (error) {
    throw new Error('Rollback incomplete; Patch Manager journal retained for recovery: ' + error.message);
  }
}

export function recoverSillyTavernPatchTransaction(stPath) {
  const target = targetInfo(stPath);
  const paths = managerPaths(target.root);
  const journal = loadJournal(target.root);
  if (!journal) return { status: 'CLEAN' };
  if (!['APPLYING', 'ROLLING_BACK'].includes(journal.state)) return { status: journal.state, package_id: journal.package_id };
  if (journal.state === 'APPLYING') {
    const patch = journal.patch_file;
    if (typeof patch !== 'string' || !patch.startsWith(paths.directory + sep) || !existsSync(patch)
      || sha256(readFileSync(patch)) !== journal.patch_sha256) {
      throw new Error('Recovery patch artifact is missing or has changed; manual recovery is required.');
    }
    try {
      runGit(target.root, ['apply', '--reverse', '--check', patch]);
    } catch {
      const unchanged = journal.files.every((file) => {
        const destination = assertSafeTargetPath(target.root, file.path);
        if (!file.existed) return !existsSync(destination);
        return existsSync(destination) && sha256(readFileSync(destination)) === file.sha256;
      });
      if (!unchanged) throw new Error('Interrupted patch state is ambiguous; refusing destructive recovery.');
    }
  } else {
    for (const file of journal.files) {
      const destination = assertSafeTargetPath(target.root, file.path);
      const exists = existsSync(destination);
      const isOriginal = file.existed ? exists && sha256(readFileSync(destination)) === file.sha256 : !exists;
      const isInstalled = file.installed_sha256 === null ? !exists : exists && sha256(readFileSync(destination)) === file.installed_sha256;
      if (!isOriginal && !isInstalled) throw new Error('Recovery found an unexpected user change; refusing to overwrite: ' + file.path);
    }
  }
  restoreFiles(target.root, journal);
  rmSync(paths.journal, { force: true });
  rmSync(paths.backups, { recursive: true, force: true });
  rmSync(join(paths.directory, 'patches'), { recursive: true, force: true });
  return { status: 'RECOVERED_ROLLBACK', package_id: journal.package_id };
}
