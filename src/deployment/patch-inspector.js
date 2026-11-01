import { createHash } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(resolve(here, 'pins/sillytavern-1.19.0-final-send.manifest.json'), 'utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const canonicalTextHash = (bytes) => {
  if (!isUtf8(bytes)) throw new Error('SILLYTAVERN_INSPECTION_ENCODING_INVALID');
  return sha256(Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8'));
};
const isWithin = (root, target) => {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel));
};

async function assertRegularFile(root, relativePath) {
  const target = resolve(root, relativePath);
  if (!isWithin(root, target)) throw new Error('SILLYTAVERN_INSPECTION_PATH_ESCAPE');
  const parts = relative(root, target).split(sep);
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    current = resolve(current, parts[index]);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error('SILLYTAVERN_INSPECTION_LINK_DENIED');
    if (index < parts.length - 1 && !info.isDirectory()) throw new Error('SILLYTAVERN_INSPECTION_PATH_INVALID');
    if (index === parts.length - 1 && !info.isFile()) throw new Error('SILLYTAVERN_INSPECTION_FILE_INVALID');
  }
  return target;
}

async function assertRegularDirectory(root, relativePath) {
  const target = resolve(root, relativePath);
  if (!isWithin(root, target)) throw new Error('SILLYTAVERN_INSPECTION_PATH_ESCAPE');
  const parts = relative(root, target).split(sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = resolve(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error('SILLYTAVERN_INSPECTION_LINK_DENIED');
    if (!info.isDirectory()) throw new Error('SILLYTAVERN_INSPECTION_DIRECTORY_INVALID');
  }
  return target;
}

async function hashAt(root, relativePath) {
  const target = await assertRegularFile(root, relativePath);
  const bytes = await readFile(target);
  return canonicalTextHash(bytes);
}

export async function verifyPinnedPatchManagerBackups(root, state, pinnedManifest = manifest) {
  const managerRelative = '.logic-engine-patch-manager';
  await assertRegularDirectory(root, managerRelative);
  await assertRegularDirectory(root, managerRelative + '/backups');
  const expectedBackups = Object.entries(pinnedManifest.sourceFiles).filter(([, expected]) => typeof expected !== 'string');
  const backupEntries = Object.entries(state.backups ?? {});
  if (backupEntries.length !== expectedBackups.length) throw new Error('PATCH_MANAGER_BACKUP_SET_INCOMPLETE');

  for (const [relativePath, expected] of expectedBackups) {
    const record = state.backups[relativePath];
    const expectedPath = ['backups', state.backupId, ...relativePath.split('/')].join(sep);
    if (!record || record.sha256 !== expected.before || record.backupPath !== expectedPath) {
      throw new Error('PATCH_MANAGER_BACKUP_RECORD_INVALID:' + relativePath);
    }
    const backupRelative = [managerRelative, ...record.backupPath.split(/[\\\\/]/)].join(sep);
    if (!isWithin(resolve(root, managerRelative, 'backups', state.backupId), resolve(root, backupRelative))) {
      throw new Error('PATCH_MANAGER_BACKUP_PATH_INVALID:' + relativePath);
    }
    if (await hashAt(root, backupRelative) !== expected.before) {
      throw new Error('PATCH_MANAGER_BACKUP_INTEGRITY_MISMATCH:' + relativePath);
    }
  }
  return Object.freeze({ status: 'PASS', summary: 'All required pre-patch backups match their pinned baseline hashes.' });
}

/**
 * Independently inspects the pinned SillyTavern tree and Patch Manager backups.
 * The supplied root selects a target only; all expected identities and digests
 * come from the deployment package's pinned manifest.
 */
export async function inspectPinnedSillyTavernInstallation(stRoot) {
  if (typeof stRoot !== 'string' || !stRoot.trim() || !isAbsolute(stRoot)) {
    return Object.freeze({
      files: { status: 'NOT_TESTED', summary: 'No SillyTavern installation root was configured.' },
      backups: { status: 'NOT_TESTED', summary: 'No SillyTavern installation root was configured.' },
    });
  }

  try {
    const inputInfo = await lstat(resolve(stRoot));
    if (inputInfo.isSymbolicLink() || !inputInfo.isDirectory()) throw new Error('SILLYTAVERN_ROOT_UNSAFE');
    const root = await realpath(stRoot);
    const packageJson = JSON.parse(await readFile(await assertRegularFile(root, 'package.json'), 'utf8'));
    if (packageJson.version !== manifest.host.version) throw new Error('SILLYTAVERN_VERSION_MISMATCH');

    let installedCount = 0;
    let baselineCount = 0;
    const changedSourceEntries = Object.entries(manifest.sourceFiles)
      .filter(([, expected]) => typeof expected !== 'string');
    for (const [relativePath, expected] of Object.entries(manifest.sourceFiles)) {
      const actual = await hashAt(root, relativePath);
      if (typeof expected === 'string') {
        if (actual !== expected) throw new Error('SILLYTAVERN_SOURCE_DRIFT:' + relativePath);
        continue;
      }
      if (actual === expected.after) installedCount += 1;
      else if (actual === expected.before) baselineCount += 1;
      else throw new Error('SILLYTAVERN_SOURCE_DRIFT:' + relativePath);
    }
    if (baselineCount === changedSourceEntries.length) {
      for (const relativePath of Object.keys(manifest.createdFiles)) {
        try {
          await assertRegularFile(root, relativePath);
          throw new Error('SILLYTAVERN_PATCH_STATE_MIXED');
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      return Object.freeze({
        files: { status: 'NOT_TESTED', summary: 'Pinned SillyTavern baseline is present; Final-Send patch is not installed.' },
        backups: { status: 'NOT_TESTED', summary: 'No installed patch backup set is expected for an unpatched baseline.' },
      });
    }
    if (installedCount !== changedSourceEntries.length) {
      throw new Error('SILLYTAVERN_PATCH_STATE_MIXED');
    }

    for (const [relativePath, expected] of Object.entries(manifest.createdFiles)) {
      if (await hashAt(root, relativePath) !== expected) {
        throw new Error('SILLYTAVERN_PATCH_FILE_MISSING_OR_DRIFTED:' + relativePath);
      }
    }

    const managerRelative = '.logic-engine-patch-manager';
    await assertRegularDirectory(root, managerRelative);
    const stateRelative = managerRelative + '/state.json';
    const journalRelative = managerRelative + '/transaction.json';
    try {
      await assertRegularFile(root, journalRelative);
      return Object.freeze({
        files: { status: 'PASS', summary: 'All pinned installed source and created-file hashes match.' },
        backups: { status: 'NOT_TESTED', summary: 'An active transaction journal makes backup state ambiguous.' },
      });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    const state = JSON.parse(await readFile(await assertRegularFile(root, stateRelative), 'utf8'));
    if (state.manifestId !== manifest.id || state.status !== 'INSTALLED'
      || state.hostVersion !== manifest.host.version
      || state.hostCommit !== manifest.host.commit
      || state.patchVersion !== manifest.patch.version
      || state.patchSha256 !== manifest.patch.sha256
      || typeof state.backupId !== 'string'
      || !/^\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(state.backupId)) {
      throw new Error('PATCH_MANAGER_STATE_IDENTITY_INVALID');
    }

    const backupInspection = await verifyPinnedPatchManagerBackups(root, state);

    return Object.freeze({
      files: { status: 'PASS', summary: 'All pinned installed source and created-file hashes match.' },
      backups: backupInspection,
    });
  } catch (error) {
    const code = typeof error?.message === 'string' ? error.message.split(':')[0] : 'SILLYTAVERN_INSPECTION_FAILED';
    return Object.freeze({
      files: { status: 'FAIL', summary: 'Pinned SillyTavern installation inspection failed: ' + code + '.' },
      backups: { status: 'FAIL', summary: 'Pinned Patch Manager backup inspection failed: ' + code + '.' },
    });
  }
}
