import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

async function readHostEnrollmentState(directories, fs) {
  const chatsRoot = directories?.chats;
  if (typeof chatsRoot !== 'string' || !path.isAbsolute(chatsRoot)) throw new Error('HOST_STARTUP_MIGRATION_SCOPE_UNAVAILABLE');
  let canonicalChatsRoot;
  try {
    const chatsStat = await fs.lstat(chatsRoot);
    if (!chatsStat.isDirectory() || chatsStat.isSymbolicLink()) throw new Error('unsafe');
    canonicalChatsRoot = await fs.realpath(chatsRoot);
  } catch { throw new Error('HOST_STARTUP_MIGRATION_STORAGE_UNAVAILABLE'); }
  const stateDirectory = path.join(path.dirname(canonicalChatsRoot), '.logic-engine-host');
  const registryPath = path.join(stateDirectory, 'enrollments.json');
  try {
    const stateStat = await fs.lstat(stateDirectory);
    if (!stateStat.isDirectory() || stateStat.isSymbolicLink()) throw new Error('unsafe');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw new Error('HOST_STARTUP_MIGRATION_STATE_UNAVAILABLE');
    // The sibling marker survives accidental deletion of the state directory.
    // Check it before treating this as a never-enrolled user: this guard runs
    // before HTTP middleware and must not allow startup migrations to rewrite
    // artifacts after Host enrollment state has been lost.
    const markerPath = path.join(path.dirname(canonicalChatsRoot), '.logic-engine-host-enrollment-marker');
    let markerStat;
    try {
      markerStat = await fs.lstat(markerPath);
    } catch (markerError) {
      if (markerError?.code === 'ENOENT') return { enrolled: false, stateDirectoryExists: false };
      throw new Error('HOST_STARTUP_MIGRATION_MARKER_UNAVAILABLE');
    }
    if (!markerStat.isFile() || markerStat.isSymbolicLink()) {
      throw new Error('HOST_STARTUP_MIGRATION_MARKER_UNSAFE');
    }
    throw new Error('HOST_STARTUP_MIGRATION_STATE_LOST');
  }
  let registryText;
  try {
    const registryStat = await fs.lstat(registryPath);
    if (!registryStat.isFile() || registryStat.isSymbolicLink()) throw new Error('unsafe');
    registryText = await fs.readFile(registryPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error('HOST_STARTUP_MIGRATION_REGISTRY_MISSING');
    throw new Error('HOST_STARTUP_MIGRATION_REGISTRY_UNAVAILABLE');
  }
  let registry;
  try { registry = JSON.parse(registryText); } catch { throw new Error('HOST_STARTUP_MIGRATION_REGISTRY_INVALID'); }
  if (registry?.version !== 1 || !Array.isArray(registry.conversations)) throw new Error('HOST_STARTUP_MIGRATION_REGISTRY_INVALID');
  return { enrolled: registry.conversations.length > 0, stateDirectoryExists: true };
}

/** Guard the legacy public-data migration, which runs before HTTP middleware starts. */
export async function assertHostUserDataMigrationSafe(userDirectories, legacyPublicCharactersPath, { fs = { lstat, readFile, realpath } } = {}) {
  if (!Array.isArray(userDirectories) || typeof legacyPublicCharactersPath !== 'string' || !path.isAbsolute(legacyPublicCharactersPath)) {
    throw new Error('HOST_STARTUP_MIGRATION_SCOPE_INVALID');
  }
  try {
    const legacyStat = await fs.lstat(legacyPublicCharactersPath);
    if (!legacyStat.isDirectory() || legacyStat.isSymbolicLink()) throw new Error('HOST_STARTUP_MIGRATION_LEGACY_SOURCE_UNSAFE');
  } catch (error) {
    if (error?.code === 'ENOENT') return { status: 'SAFE_NO_LEGACY_PUBLIC_DATA_MIGRATION' };
    throw new Error('HOST_STARTUP_MIGRATION_LEGACY_SOURCE_UNAVAILABLE');
  }
  for (const directories of userDirectories) {
    const enrollment = await readHostEnrollmentState(directories, fs);
    if (enrollment.enrolled) throw new Error('HOST_STARTUP_PUBLIC_DATA_MIGRATION_BLOCKED_ENROLLED_HISTORY');
  }
  return { status: 'SAFE_NO_ENROLLED_HOST_HISTORY' };
}

/** Fail closed if pre-listener group metadata migration would rewrite enrolled artifacts. */
export async function assertHostStartupMigrationSafe(userDirectories, { fs = { lstat, readFile, readdir, realpath } } = {}) {
  if (!Array.isArray(userDirectories)) throw new Error('HOST_STARTUP_MIGRATION_SCOPE_INVALID');
  for (const directories of userDirectories) {
    const groupsRoot = directories?.groups;
    if (typeof groupsRoot !== 'string' || !path.isAbsolute(groupsRoot)) throw new Error('HOST_STARTUP_MIGRATION_SCOPE_UNAVAILABLE');
    const enrollment = await readHostEnrollmentState(directories, fs);
    if (!enrollment.enrolled) continue;
    let canonicalGroupsRoot;
    try {
      const groupsStat = await fs.lstat(groupsRoot);
      if (!groupsStat.isDirectory() || groupsStat.isSymbolicLink()) throw new Error('unsafe');
      canonicalGroupsRoot = await fs.realpath(groupsRoot);
    } catch { throw new Error('HOST_STARTUP_MIGRATION_GROUPS_UNAVAILABLE'); }
    let groupEntries;
    try { groupEntries = await fs.readdir(canonicalGroupsRoot, { withFileTypes: true }); }
    catch { throw new Error('HOST_STARTUP_MIGRATION_GROUP_ENUMERATION_FAILED'); }
    for (const entry of groupEntries) {
      if (!entry.isFile() || path.extname(entry.name) !== '.json') continue;
      const groupPath = path.join(canonicalGroupsRoot, entry.name);
      try {
        const before = await fs.lstat(groupPath);
        if (!before.isFile() || before.isSymbolicLink()) throw new Error('unsafe');
        const data = JSON.parse(await fs.readFile(groupPath, 'utf8'));
        if (data && typeof data === 'object' && (Object.hasOwn(data, 'chat_metadata') || Object.hasOwn(data, 'past_metadata'))) {
          throw new Error('HOST_STARTUP_GROUP_MIGRATION_BLOCKED_ENROLLED_HISTORY');
        }
      } catch (error) {
        if (error?.message === 'HOST_STARTUP_GROUP_MIGRATION_BLOCKED_ENROLLED_HISTORY') throw error;
        throw new Error('HOST_STARTUP_MIGRATION_GROUP_SCAN_UNCERTAIN');
      }
    }
  }
  return { status: 'SAFE_TO_RUN_NO_ENROLLED_GROUP_MIGRATION' };
}
