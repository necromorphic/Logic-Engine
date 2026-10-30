import { createHash } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';

const PINNED_SILLYTAVERN_COMMIT = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';
const MAX_CHAT_FILE_BYTES = 256 * 1024 * 1024;
const MAX_GROUP_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;

export class HostSourceInventoryError extends Error {
  constructor(code) {
    super(code);
    this.name = 'HostSourceInventoryError';
    this.code = code;
  }
}

const fail = code => { throw new HostSourceInventoryError(code); };
const validLeaf = value => typeof value === 'string' && value.length > 0
  && value !== '.' && value !== '..'
  && !value.includes('/') && !value.includes('\\')
  && ![...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
const isWithin = (parent, candidate) => {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
};
const normalizePath = value => {
  let normalized = path.resolve(value);
  if (process.platform === 'win32' && normalized.startsWith('\\\\?\\')) {
    normalized = normalized.slice(4);
  }
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
};
const samePath = (left, right) => normalizePath(left) === normalizePath(right);
const identityOf = stat => {
  if (stat.ino === 0n) fail('FILE_IDENTITY_UNAVAILABLE');
  return stat.dev.toString() + ':' + stat.ino.toString();
};
const sameStat = (left, right) => left.dev === right.dev
  && left.ino === right.ino
  && left.mode === right.mode
  && left.size === right.size
  && left.mtimeNs === right.mtimeNs
  && left.ctimeNs === right.ctimeNs;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);

async function inspectDirectory(directory, expectedParent = null) {
  const absolute = path.resolve(directory);
  let before;
  try {
    before = await fs.lstat(absolute, { bigint: true });
  } catch {
    fail('SOURCE_DIRECTORY_UNAVAILABLE');
  }
  if (!before.isDirectory() || before.isSymbolicLink()) fail('SOURCE_DIRECTORY_TYPE_INVALID');
  identityOf(before);

  let real;
  try {
    real = await fs.realpath(absolute);
  } catch {
    fail('SOURCE_DIRECTORY_UNAVAILABLE');
  }
  if (!samePath(real, absolute) || (expectedParent && !isWithin(normalizePath(expectedParent), normalizePath(real)))) {
    fail('SOURCE_PATH_ESCAPE_OR_REPARSE');
  }

  let dirents;
  try {
    dirents = await fs.readdir(absolute, { withFileTypes: true });
  } catch {
    fail('SOURCE_DIRECTORY_UNREADABLE');
  }
  const names = dirents.map(entry => entry.name).sort();
  if (new Set(names).size !== names.length) fail('SOURCE_DIRECTORY_DUPLICATE_ENTRY');
  const after = await fs.lstat(absolute, { bigint: true }).catch(() => null);
  if (!after || !sameStat(before, after)) fail('SOURCE_DIRECTORY_MUTATED');
  return { absolute, identity: identityOf(before), stat: before, names, dirents };
}

async function readStableFile(filePath, rootPath, maxBytes) {
  const absolute = path.resolve(filePath);
  if (!isWithin(rootPath, absolute)) fail('SOURCE_PATH_ESCAPE_OR_REPARSE');

  let pathBefore;
  try {
    pathBefore = await fs.lstat(absolute, { bigint: true });
  } catch {
    fail('SOURCE_FILE_UNAVAILABLE');
  }
  if (!pathBefore.isFile() || pathBefore.isSymbolicLink()) fail('SOURCE_FILE_TYPE_INVALID');

  const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
  let handle;
  try {
    handle = await fs.open(absolute, fsConstants.O_RDONLY | noFollow);
  } catch {
    fail('SOURCE_FILE_OPEN_FAILED');
  }

  try {
    const openedBefore = await handle.stat({ bigint: true });
    if (!openedBefore.isFile() || !sameStat(pathBefore, openedBefore)) {
      fail('SOURCE_FILE_IDENTITY_CHANGED');
    }
    identityOf(openedBefore);
    if (openedBefore.size > BigInt(maxBytes)) fail('SOURCE_FILE_SIZE_LIMIT');

    const bytes = await handle.readFile();
    if (BigInt(bytes.length) !== openedBefore.size) fail('SOURCE_FILE_SIZE_CHANGED');

    const openedAfter = await handle.stat({ bigint: true });
    const pathAfter = await fs.lstat(absolute, { bigint: true }).catch(() => null);
    if (!pathAfter || !sameStat(openedBefore, openedAfter) || !sameStat(openedAfter, pathAfter)) {
      fail('SOURCE_FILE_MUTATED');
    }
    return {
      bytes,
      identity: identityOf(openedAfter),
      size: openedAfter.size.toString(),
      mtime_ns: openedAfter.mtimeNs.toString(),
      ctime_ns: openedAfter.ctimeNs.toString(),
      sha256: digest(bytes),
    };
  } finally {
    await handle.close().catch(() => {});
  }
}

/**
 * Enumerates the current SillyTavern chat-file set for the pinned 1.19.0
 * directory layout. This is a scan candidate, not an authenticated Host
 * manifest, message revision inventory, enrollment history, or Core authority.
 *
 * The caller must pass request.user.directories.{chats,groups,groupChats}.
 * Character chat directories are enumerated directly under chats, rather than
 * discovered from the recent-chat endpoint's avatar-only traversal.
 */
export async function enumeratePinnedSillyTavernChatFiles({
  directories,
  hostCommit = PINNED_SILLYTAVERN_COMMIT,
}) {
  if (!directories || typeof directories !== 'object' || Array.isArray(directories)
    || !['chats', 'groups', 'groupChats'].every(key => typeof directories[key] === 'string'
      && path.isAbsolute(directories[key]))
    || hostCommit !== PINNED_SILLYTAVERN_COMMIT) {
    fail('SOURCE_LAYOUT_OR_HOST_BUILD_UNSUPPORTED');
  }

  const roots = {};
  for (const key of ['chats', 'groups', 'groupChats']) {
    roots[key] = await inspectDirectory(directories[key]);
  }
  const rootIdentities = Object.values(roots).map(root => root.identity);
  if (new Set(rootIdentities).size !== rootIdentities.length) fail('SOURCE_ROOT_ALIAS');
  for (const left of Object.values(roots)) {
    for (const right of Object.values(roots)) {
      if (left === right) continue;
      if (isWithin(left.absolute, right.absolute) || isWithin(right.absolute, left.absolute)) {
        fail('SOURCE_ROOT_OVERLAP');
      }
    }
  }

  const files = [];
  const directoriesSeen = [...Object.entries(roots).map(([kind, value]) => ({
    kind: 'root:' + kind, absolute: value.absolute, identity: value.identity, stat: value.stat, names: value.names,
  }))];
  const physicalFiles = new Set();
  let totalBytes = 0n;

  const addFile = async (kind, locator, filePath, rootPath, maxBytes) => {
    const record = await readStableFile(filePath, rootPath, maxBytes);
    if (physicalFiles.has(record.identity)) fail('SOURCE_FILE_IDENTITY_DUPLICATE');
    physicalFiles.add(record.identity);
    totalBytes += BigInt(record.size);
    if (totalBytes > BigInt(MAX_TOTAL_BYTES)) fail('SOURCE_INVENTORY_SIZE_LIMIT');
    files.push({
      kind,
      locator,
      file_identity: record.identity,
      size_bytes: record.size,
      mtime_ns: record.mtime_ns,
      ctime_ns: record.ctime_ns,
      content_sha256: record.sha256,
    });
    return record.bytes;
  };

  const chatRoot = roots.chats;
  const groupRoot = roots.groups;
  const groupChatRoot = roots.groupChats;
  const referencedGroupChats = new Set();
  const groupIds = new Set();

  // Root-level chats and per-character chat directories.
  for (const entry of chatRoot.dirents) {
    const entryPath = path.join(chatRoot.absolute, entry.name);
    if (entry.isSymbolicLink()) fail('SOURCE_REPARSE_ENTRY');
    if (entry.isDirectory()) {
      const child = await inspectDirectory(entryPath, chatRoot.absolute);
      directoriesSeen.push({
        kind: 'character-chat-directory',
        absolute: child.absolute,
        identity: child.identity,
        stat: child.stat,
        names: child.names,
      });
      for (const childEntry of child.dirents) {
        if (childEntry.isSymbolicLink()) fail('SOURCE_REPARSE_ENTRY');
        if (!childEntry.isFile() || path.extname(childEntry.name) !== '.jsonl') {
          fail('SOURCE_UNKNOWN_CHARACTER_CHAT_LAYOUT');
        }
        await addFile(
          'character-chat',
          entry.name + '/' + childEntry.name,
          path.join(child.absolute, childEntry.name),
          child.absolute,
          MAX_CHAT_FILE_BYTES,
        );
      }
    } else if (entry.isFile() && path.extname(entry.name) === '.jsonl') {
      await addFile('root-chat', entry.name, entryPath, chatRoot.absolute, MAX_CHAT_FILE_BYTES);
    } else {
      fail('SOURCE_UNKNOWN_CHAT_LAYOUT');
    }
  }

  // Group metadata is the authoritative mapping from group IDs to group chat files.
  for (const entry of groupRoot.dirents) {
    if (entry.isSymbolicLink()) fail('SOURCE_REPARSE_ENTRY');
    if (!entry.isFile() || path.extname(entry.name) !== '.json') fail('SOURCE_UNKNOWN_GROUP_LAYOUT');
    const bytes = await addFile('group-metadata', entry.name, path.join(groupRoot.absolute, entry.name),
      groupRoot.absolute, MAX_GROUP_FILE_BYTES);
    let group;
    try {
      group = JSON.parse(bytes.toString('utf8'));
    } catch {
      fail('SOURCE_GROUP_METADATA_INVALID');
    }
    if (!group || typeof group !== 'object' || Array.isArray(group)
      || !validLeaf(group.id) || !Array.isArray(group.chats) || groupIds.has(group.id)) {
      fail('SOURCE_GROUP_METADATA_INVALID');
    }
    groupIds.add(group.id);
    const localChats = new Set();
    for (const chatId of group.chats) {
      if (!validLeaf(chatId) || localChats.has(chatId) || referencedGroupChats.has(chatId)) {
        fail('SOURCE_GROUP_CHAT_REFERENCE_INVALID');
      }
      localChats.add(chatId);
      referencedGroupChats.add(chatId);
    }
  }

  // Every group-chat file must be referenced exactly once by readable group metadata.
  const groupChatNames = new Set();
  for (const entry of groupChatRoot.dirents) {
    if (entry.isSymbolicLink()) fail('SOURCE_REPARSE_ENTRY');
    if (!entry.isFile() || path.extname(entry.name) !== '.jsonl') fail('SOURCE_UNKNOWN_GROUP_CHAT_LAYOUT');
    const chatId = entry.name.slice(0, -'.jsonl'.length);
    if (!validLeaf(chatId) || groupChatNames.has(chatId)) fail('SOURCE_GROUP_CHAT_ID_INVALID');
    groupChatNames.add(chatId);
    if (!referencedGroupChats.has(chatId)) fail('SOURCE_ORPHAN_GROUP_CHAT');
    await addFile('group-chat', chatId, path.join(groupChatRoot.absolute, entry.name),
      groupChatRoot.absolute, MAX_CHAT_FILE_BYTES);
  }
  for (const chatId of referencedGroupChats) {
    if (!groupChatNames.has(chatId)) fail('SOURCE_GROUP_CHAT_MISSING');
  }

  // Re-list every directory and re-stat every file after the complete scan.
  for (const directory of directoriesSeen) {
    const current = await fs.readdir(directory.absolute, { withFileTypes: true }).catch(() => null);
    if (!current || current.map(entry => entry.name).sort().join('\u0000') !== directory.names.join('\u0000')) {
      fail('SOURCE_DIRECTORY_MUTATED');
    }
    const stat = await fs.lstat(directory.absolute, { bigint: true }).catch(() => null);
    if (!stat || identityOf(stat) !== directory.identity || !sameStat(directory.stat, stat)) {
      fail('SOURCE_DIRECTORY_IDENTITY_CHANGED');
    }
  }

  // Re-hash each exact file through a fresh handle. This detects content changes
  // that occur after its first read but before the inventory is finalized.
  for (const file of files) {
    const root = file.kind === 'group-metadata' ? groupRoot
      : file.kind === 'group-chat' ? groupChatRoot : chatRoot;
    const absolute = path.join(root.absolute, file.locator);
    const second = await readStableFile(absolute, root.absolute,
      file.kind === 'group-metadata' ? MAX_GROUP_FILE_BYTES : MAX_CHAT_FILE_BYTES);
    if (second.identity !== file.file_identity || second.sha256 !== file.content_sha256
      || second.size !== file.size_bytes || second.mtime_ns !== file.mtime_ns
      || second.ctime_ns !== file.ctime_ns) {
      fail('SOURCE_FILE_CHANGED_DURING_SCAN');
    }
  }

  files.sort((a, b) => a.kind.localeCompare(b.kind) || a.locator.localeCompare(b.locator));
  const directoriesDigest = directoriesSeen.map(({ kind, identity, names }) => ({ kind, identity, names }))
    .sort((a, b) => a.kind.localeCompare(b.kind));
  const inventorySha256 = digest(Buffer.from(canonical({
    host_commit: hostCommit,
    files,
    directories: directoriesDigest,
  }), 'utf8'));

  return Object.freeze({
    status: 'STABLE_SCAN_CANDIDATE',
    authority: 'NON_AUTHORITATIVE',
    host_commit: hostCommit,
    scope: 'PINNED_SILLYTAVERN_CHAT_DATA_ROOTS',
    historical_boundary: 'CURRENT_FILE_SET_ONLY_ENROLLMENT_BASELINE_REQUIRED',
    file_count: files.length,
    total_bytes: totalBytes.toString(),
    files: Object.freeze(files),
    directories_sha256: digest(Buffer.from(canonical(directoriesDigest), 'utf8')),
    inventory_sha256: inventorySha256,
    completeness: 'STABLE_CURRENT_FILE_SET_ONLY',
    blockers: Object.freeze([
      'NO_PRE_ENROLLMENT_DELETED_HISTORY',
      'NO_MESSAGE_OR_SWIPE_REVISION_LINEAGE',
      'NO_CORE_WORLD_OR_SESSION_AUTHORIZATION',
      'NO_ACCEPTED_HEAD_AUTHORITY',
      'IMPORT_EXPORT_COPY_BRANCH_RESTORE_UNSUPPORTED',
      'PLATFORM_SPECIFIC_RACE_RESISTANCE_REQUIRES_SECURITY_REVIEW',
    ]),
  });
}
