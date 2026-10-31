import { createHash } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';
import { isActiveWindowsVssSnapshot, withWindowsVssSnapshot } from './windows-vss-snapshot.mjs';

const PINNED_SILLYTAVERN_COMMIT = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';
const MAX_CHAT_FILE_BYTES = 256 * 1024 * 1024;
const MAX_GROUP_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_JSONL_LINE_BYTES = 16 * 1024 * 1024;
const MAX_CHAT_MESSAGES = 100_000;
const MAX_CHAT_VERSIONS_PER_MESSAGE = 256;
const MAX_TOTAL_LOGICAL_VERSIONS = 1_000_000;
const HOST_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
// On Windows, path-based lstat may report st_dev=0 while handle-based fstat
// reports the volume serial. Compare dev when both sources provide it.
const sameStat = (left, right) => (process.platform === 'win32'
  ? left.dev === 0n || right.dev === 0n || left.dev === right.dev
  : left.dev === right.dev)
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


function parseChatJsonlIdentity(bytes, seen) {
  const records = [];
  let start = 0;
  for (let offset = 0; offset <= bytes.length; offset++) {
    if (offset !== bytes.length && bytes[offset] !== 0x0a) continue;
    let line = bytes.subarray(start, offset);
    start = offset + 1;
    if (line.length && line[line.length - 1] === 0x0d) line = line.subarray(0, line.length - 1);
    if (!line.length) continue;
    if (line.length > MAX_JSONL_LINE_BYTES) fail('SOURCE_CHAT_JSONL_LINE_LIMIT');
    let value;
    try {
      value = JSON.parse(line.toString('utf8'));
    } catch {
      fail('SOURCE_CHAT_JSONL_INVALID');
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('SOURCE_CHAT_RECORD_INVALID');
    records.push(value);
    if (records.length > MAX_CHAT_MESSAGES + 1) fail('SOURCE_CHAT_MESSAGE_LIMIT');
  }
  if (!records.length) fail('SOURCE_CHAT_JSONL_EMPTY');

  const hasHeader = records[0].chat_metadata && typeof records[0].chat_metadata === 'object'
    && !Array.isArray(records[0].chat_metadata);
  const header = hasHeader ? records[0] : null;
  const conversationUuid = header?.chat_metadata?.logic_engine_conversation_id ?? null;
  if (conversationUuid !== null && !HOST_UUID.test(conversationUuid)) {
    fail('SOURCE_CHAT_CONVERSATION_ID_INVALID');
  }
  if (conversationUuid) {
    if (seen.conversationIds.has(conversationUuid)) fail('SOURCE_CHAT_CONVERSATION_ID_DUPLICATE');
    seen.conversationIds.add(conversationUuid);
  }

  const messageRecords = hasHeader ? records.slice(1) : records;
  if (messageRecords.length > MAX_CHAT_MESSAGES) fail('SOURCE_CHAT_MESSAGE_LIMIT');
  const messages = [];
  let missingMessageIdentityCount = 0;
  for (const message of messageRecords) {
    const versions = Array.isArray(message.swipes) && message.swipes.length
      ? message.swipes : [message.mes ?? ''];
    if (versions.length > MAX_CHAT_VERSIONS_PER_MESSAGE
      || versions.some(value => typeof value !== 'string')) {
      fail('SOURCE_CHAT_VERSION_LAYOUT_INVALID');
    }
    const activeVersionIndex = Number.isInteger(message.swipe_id) ? message.swipe_id : 0;
    if (activeVersionIndex < 0 || activeVersionIndex >= versions.length) {
      fail('SOURCE_CHAT_ACTIVE_VERSION_INVALID');
    }
    if (typeof message.mes !== 'string' || message.mes !== versions[activeVersionIndex]) {
      fail('SOURCE_CHAT_ACTIVE_MESSAGE_MISMATCH');
    }

    const identity = message._logicEngineLifecycle;
    if (!identity) {
      missingMessageIdentityCount++;
      continue;
    }
    if (typeof identity.messageId !== 'string' || !HOST_UUID.test(identity.messageId)) {
      fail('SOURCE_CHAT_MESSAGE_ID_INVALID');
    }
    if (seen.messageIds.has(identity.messageId)) fail('SOURCE_CHAT_MESSAGE_ID_DUPLICATE');
    if (!Array.isArray(identity.versions) || identity.versions.length === 0
      || identity.versions.length > MAX_CHAT_VERSIONS_PER_MESSAGE) {
      fail('SOURCE_CHAT_MESSAGE_VERSION_LAYOUT_MISMATCH');
    }
    const logicalActiveVersionIndex = identity.activeVersionIndex;
    if (!Number.isInteger(logicalActiveVersionIndex) || logicalActiveVersionIndex < 0
      || logicalActiveVersionIndex >= identity.versions.length) {
      fail('SOURCE_CHAT_MESSAGE_ACTIVE_VERSION_MISMATCH');
    }
    const swipeLayoutAligned = identity.versions.length === versions.length
      && logicalActiveVersionIndex === activeVersionIndex;
    seen.messageIds.add(identity.messageId);

    const versionEntries = [];
    for (let index = 0; index < identity.versions.length; index++) {
      const version = identity.versions[index];
      if (!version || typeof version.versionId !== 'string' || !HOST_UUID.test(version.versionId)
        || seen.versionIds.has(version.versionId)
        || version.versionIndex !== index
        || (version.parentVersionId !== null && version.parentVersionId !== undefined
          && (typeof version.parentVersionId !== 'string' || !HOST_UUID.test(version.parentVersionId)))
        || typeof version.payloadDigest !== 'string' || !/^[a-f0-9]{64}$/.test(version.payloadDigest)) {
        fail('SOURCE_CHAT_VERSION_IDENTITY_INVALID');
      }
      // Edit revisions may exist only in the lifecycle identity ledger,
      // while native swipe alternatives are stored separately. Always verify
      // the active logical revision against persisted message text. Verify all
      // revisions against native swipe text only when both layouts align.
      const actualDigest = index === logicalActiveVersionIndex
        ? digest(Buffer.from(message.mes, 'utf8'))
        : swipeLayoutAligned
          ? digest(Buffer.from(versions[index], 'utf8'))
          : version.payloadDigest;
      if (actualDigest !== version.payloadDigest) fail('SOURCE_CHAT_VERSION_DIGEST_MISMATCH');
      seen.versionIds.add(version.versionId);
      seen.totalVersions++;
      if (seen.totalVersions > MAX_TOTAL_LOGICAL_VERSIONS) fail('SOURCE_CHAT_VERSION_LIMIT');
      versionEntries.push({
        version_id: version.versionId,
        version_index: index,
        parent_version_id: version.parentVersionId ?? null,
        content_sha256: actualDigest,
        active: index === logicalActiveVersionIndex,
      });
    }
    messages.push({
      message_id: identity.messageId,
      role: message.is_user === true ? 'user' : message.is_system === true ? 'system' : 'assistant',
      active_version_index: logicalActiveVersionIndex,
      versions: versionEntries,
    });
  }

  const identityComplete = Boolean(conversationUuid) && missingMessageIdentityCount === 0;
  return {
    conversation_uuid: conversationUuid,
    identity_status: identityComplete ? 'CURRENT_IDENTITIES_VERIFIED' : 'INCOMPLETE',
    message_count: messageRecords.length,
    identified_message_count: messages.length,
    missing_message_identity_count: missingMessageIdentityCount,
    messages,
  };
}

async function assertNoReparseComponents(absolute) {
  const parsed = path.parse(absolute);
  if (!parsed.root) fail('SOURCE_PATH_INVALID');
  let current = parsed.root;
  const components = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (let index = 0; index < components.length; index++) {
    current = path.join(current, components[index]);
    const stat = await fs.lstat(current, { bigint: true }).catch(() => null);
    if (!stat || stat.isSymbolicLink()) fail('SOURCE_PATH_ESCAPE_OR_REPARSE');
    if (index < components.length - 1 && !stat.isDirectory()) fail('SOURCE_PATH_INVALID');
  }
}

async function inspectDirectory(directory, expectedParent = null, snapshotMode = false) {
  const absolute = snapshotMode ? directory : path.resolve(directory);
  if (expectedParent) {
    const parent = snapshotMode ? expectedParent : normalizePath(expectedParent);
    const candidate = snapshotMode ? absolute : normalizePath(absolute);
    if (!isWithin(parent, candidate)) fail('SOURCE_PATH_ESCAPE_OR_REPARSE');
  }
  // A live Windows path is unsafe without a native reparse verifier. In
  // snapshot mode the VSS provider has already audited every component and
  // descendant before the immutable device tree is exposed to this scanner.
  if (!snapshotMode) await assertNoReparseComponents(absolute);

  let before;
  try {
    before = await fs.lstat(absolute, { bigint: true });
  } catch {
    fail('SOURCE_DIRECTORY_UNAVAILABLE');
  }
  if (!before.isDirectory() || before.isSymbolicLink()) fail('SOURCE_DIRECTORY_TYPE_INVALID');
  identityOf(before);

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

export async function readBoundedFileHandle(handle, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) fail('SOURCE_FILE_SIZE_LIMIT');
  const chunks = [];
  const chunkSize = 64 * 1024;
  let total = 0;
  let position = 0;

  while (total <= maxBytes) {
    const remaining = maxBytes + 1 - total;
    const buffer = Buffer.alloc(Math.min(chunkSize, remaining));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (bytesRead === 0) break;

    total += bytesRead;
    if (total > maxBytes) fail('SOURCE_FILE_SIZE_LIMIT');
    chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    position += bytesRead;
  }

  return Buffer.concat(chunks, total);
}

async function readStableFile(filePath, rootPath, maxBytes, snapshotMode = false) {
  const absolute = snapshotMode ? filePath : path.resolve(filePath);
  if (!isWithin(rootPath, absolute)) fail('SOURCE_PATH_ESCAPE_OR_REPARSE');

  let pathBefore;
  try {
    pathBefore = await fs.lstat(absolute, { bigint: true });
  } catch {
    fail('SOURCE_FILE_UNAVAILABLE');
  }
  if (!pathBefore.isFile() || pathBefore.isSymbolicLink()) fail('SOURCE_FILE_TYPE_INVALID');

  const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
  if (!snapshotMode && noFollow === 0) fail('SOURCE_WINDOWS_REPARSE_VERIFICATION_UNAVAILABLE');
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

    const bytes = await readBoundedFileHandle(handle, maxBytes);
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
async function enumeratePinnedSillyTavernChatFilesInternal({
  directories,
  hostCommit = PINNED_SILLYTAVERN_COMMIT,
}, snapshotLease = null) {
  if (!directories || typeof directories !== 'object' || Array.isArray(directories)
    || !['chats', 'groups', 'groupChats'].every(key => typeof directories[key] === 'string'
      && path.isAbsolute(directories[key]))
    || hostCommit !== PINNED_SILLYTAVERN_COMMIT) {
    fail('SOURCE_LAYOUT_OR_HOST_BUILD_UNSUPPORTED');
  }

  const configuredPaths = ['chats', 'groups', 'groupChats'].map(key =>
    snapshotLease ? directories[key] : path.resolve(directories[key]));
  const configuredNormalized = configuredPaths.map(value =>
    snapshotLease ? path.normalize(value).toLowerCase() : normalizePath(value));
  if (snapshotLease) {
    for (const directory of configuredPaths) {
      const relative = path.relative(snapshotLease.snapshotRoot, directory);
      if (!relative || relative === '..' || relative.startsWith('..' + path.sep)
        || path.isAbsolute(relative)) fail('SOURCE_WINDOWS_VSS_PATH_OUTSIDE_SNAPSHOT');
    }
  }
  if (new Set(configuredNormalized).size !== configuredNormalized.length) fail('SOURCE_ROOT_ALIAS');
  for (let left = 0; left < configuredPaths.length; left++) {
    for (let right = left + 1; right < configuredPaths.length; right++) {
      if (isWithin(configuredPaths[left], configuredPaths[right])
        || isWithin(configuredPaths[right], configuredPaths[left])) fail('SOURCE_ROOT_OVERLAP');
    }
  }

  if (process.platform === 'win32' && !snapshotLease) {
    const sourcePaths = ['chats', 'groups', 'groupChats'].map(key => path.resolve(directories[key]));
    let commonRoot = sourcePaths[0];
    for (const candidate of sourcePaths.slice(1)) {
      while (!isWithin(commonRoot, candidate)) {
        const parent = path.dirname(commonRoot);
        if (parent === commonRoot) fail('SOURCE_COMMON_ROOT_UNAVAILABLE');
        commonRoot = parent;
      }
    }
    const volumeRoot = path.parse(commonRoot).root;
    if (normalizePath(commonRoot) === normalizePath(volumeRoot)) fail('SOURCE_COMMON_ROOT_TOO_BROAD');
    const relativeRoots = {};
    for (const key of ['chats', 'groups', 'groupChats']) {
      const relativeRoot = path.relative(commonRoot, path.resolve(directories[key]));
      if (!relativeRoot || relativeRoot === '..' || relativeRoot.startsWith('..' + path.sep)
        || path.isAbsolute(relativeRoot)) fail('SOURCE_COMMON_ROOT_INVALID');
      relativeRoots[key] = relativeRoot;
    }
    try {
      return await withWindowsVssSnapshot(commonRoot, lease => {
        const snapshotDirectories = Object.fromEntries(
          Object.entries(relativeRoots).map(([key, relativeRoot]) => [
            key, path.join(lease.snapshotRoot, relativeRoot),
          ]),
        );
        return enumeratePinnedSillyTavernChatFilesInternal({
          directories: snapshotDirectories,
          hostCommit,
        }, lease);
      });
    } catch (error) {
      if (error instanceof HostSourceInventoryError) throw error;
      const code = typeof error?.message === 'string' && error.message.startsWith('HOST_VSS_')
        ? error.message : 'SOURCE_WINDOWS_VSS_UNAVAILABLE';
      fail(code);
    }
  }

  const snapshotMode = Boolean(snapshotLease);
  const roots = {};
  for (const key of ['chats', 'groups', 'groupChats']) {
    roots[key] = await inspectDirectory(directories[key], null, snapshotMode);
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
  const logicalIdentitySeen = {
    conversationIds: new Set(),
    messageIds: new Set(),
    versionIds: new Set(),
    totalVersions: 0,
  };
  let totalBytes = 0n;

  const addFile = async (kind, locator, filePath, rootPath, maxBytes) => {
    const record = await readStableFile(filePath, rootPath, maxBytes, snapshotMode);
    if (physicalFiles.has(record.identity)) fail('SOURCE_FILE_IDENTITY_DUPLICATE');
    physicalFiles.add(record.identity);
    totalBytes += BigInt(record.size);
    if (totalBytes > BigInt(MAX_TOTAL_BYTES)) fail('SOURCE_INVENTORY_SIZE_LIMIT');
    const logicalIdentity = ['root-chat', 'character-chat', 'group-chat'].includes(kind)
      ? parseChatJsonlIdentity(record.bytes, logicalIdentitySeen)
      : null;
    files.push({
      kind,
      locator,
      file_identity: record.identity,
      size_bytes: record.size,
      mtime_ns: record.mtime_ns,
      ctime_ns: record.ctime_ns,
      content_sha256: record.sha256,
      ...(logicalIdentity ? { logical_identity: logicalIdentity } : {}),
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
      const child = await inspectDirectory(entryPath, chatRoot.absolute, snapshotMode);
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
    const relativeFile = file.kind === 'group-chat' ? file.locator + '.jsonl' : file.locator;
    const absolute = path.join(root.absolute, relativeFile);
    const second = await readStableFile(absolute, root.absolute,
      file.kind === 'group-metadata' ? MAX_GROUP_FILE_BYTES : MAX_CHAT_FILE_BYTES, snapshotMode);
    if (second.identity !== file.file_identity || second.sha256 !== file.content_sha256
      || second.size !== file.size_bytes || second.mtime_ns !== file.mtime_ns
      || second.ctime_ns !== file.ctime_ns) {
      fail('SOURCE_FILE_CHANGED_DURING_SCAN');
    }
  }

  files.sort((a, b) => a.kind.localeCompare(b.kind) || a.locator.localeCompare(b.locator));
  const directoriesDigest = directoriesSeen.map(({ kind, identity, names }) => ({ kind, identity, names }))
    .sort((a, b) => a.kind.localeCompare(b.kind));
  const chatFiles = files.filter(file => file.logical_identity);
  const logicalIdentityComplete = chatFiles.length > 0
    && chatFiles.every(file => file.logical_identity.identity_status === 'CURRENT_IDENTITIES_VERIFIED');
  const inventorySha256 = digest(Buffer.from(canonical({
    host_commit: hostCommit,
    files,
    directories: directoriesDigest,
  }), 'utf8'));

  return Object.freeze({
    status: 'DOUBLE_SCAN_CANDIDATE',
    authority: 'NON_AUTHORITATIVE',
    host_commit: hostCommit,
    scope: 'PINNED_SILLYTAVERN_CHAT_DATA_ROOTS',
    historical_boundary: 'CURRENT_FILE_SET_ONLY_ENROLLMENT_BASELINE_REQUIRED',
    file_count: files.length,
    total_bytes: totalBytes.toString(),
    logical_identity_status: logicalIdentityComplete ? 'CURRENT_FILE_IDENTITIES_VERIFIED' : 'INCOMPLETE',
    conversation_identity_count: logicalIdentitySeen.conversationIds.size,
    message_identity_count: logicalIdentitySeen.messageIds.size,
    version_identity_count: logicalIdentitySeen.versionIds.size,
    files: Object.freeze(files),
    directories_sha256: digest(Buffer.from(canonical(directoriesDigest), 'utf8')),
    inventory_sha256: inventorySha256,
    completeness: 'DOUBLE_SCANNED_PATH_VIEW_ONLY',
    ...(snapshotLease ? {
      snapshot_id: snapshotLease.snapshotId,
      snapshot_provider: snapshotLease.provider,
      snapshot_consistency: snapshotLease.consistency,
      reparse_points: snapshotLease.reparsePoints,
    } : {}),
    blockers: Object.freeze([
      'NO_PRE_ENROLLMENT_DELETED_HISTORY',
      'NO_COMPLETE_MESSAGE_OR_SWIPE_REVISION_HISTORY',
      'NO_HOST_INSTALLATION_BINDING',
      ...(logicalIdentityComplete ? [] : ['CURRENT_CHAT_LOGICAL_IDENTITY_INCOMPLETE']),
      'NO_CORE_WORLD_OR_SESSION_AUTHORIZATION',
      'NO_ACCEPTED_HEAD_AUTHORITY',
      'IMPORT_EXPORT_COPY_BRANCH_RESTORE_UNSUPPORTED',
      ...(snapshotLease ? ['NO_APPLICATION_LEVEL_ATOMIC_SNAPSHOT'] : [
        'NO_ATOMIC_DIRECTORY_SNAPSHOT',
        'PATH_BASED_DIRECTORY_REPLACEMENT_RACE_REMAINS',
      ]),
      'PLATFORM_SPECIFIC_RACE_RESISTANCE_REQUIRES_SECURITY_REVIEW',
    ]),
  });
}


export async function enumeratePinnedSillyTavernChatFiles(options) {
  return enumeratePinnedSillyTavernChatFilesInternal(options);
}

export async function enumeratePinnedSillyTavernChatFilesFromWindowsSnapshot(options, lease) {
  if (!isActiveWindowsVssSnapshot(lease)) fail('SOURCE_WINDOWS_VSS_LEASE_INVALID');
  return enumeratePinnedSillyTavernChatFilesInternal(options, lease);
}
