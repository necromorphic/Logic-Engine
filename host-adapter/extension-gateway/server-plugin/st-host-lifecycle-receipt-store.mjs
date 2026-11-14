import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';
import { enumerateHostDataInventory } from './host-data-inventory.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[a-f0-9]{64}$/;
const MAX_COMMUNICATION_DELIVERY_VERSIONS = 25000;
const OPERATIONS = new Set([
  'create-message', 'message-send', 'message-receive', 'create-swipe',
  'select-swipe', 'delete-swipe', 'delete-message', 'edit-message', 'rename-chat',
]);
const MAX_RECORD_BYTES = 8 * 1024 * 1024;
const canonical = value => Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);
const sha256 = value => createHash('sha256').update(value).digest('hex');
// Capture once per Node process so receipt creation and verification use an identical
// process identity despite millisecond rounding drift in Date.now() - process.uptime().
const PROCESS_STARTED_AT_MS = Math.max(0, Math.floor(Date.now() - process.uptime() * 1000));
const validScope = scope => scope && UUID.test(scope.host_installation_id ?? '')
  && UUID.test(scope.authenticated_account_id ?? '')
  && UUID.test(scope.host_session_id ?? '')
  && UUID.test(scope.conversation_uuid ?? '')
  && UUID.test(scope.mutation_id ?? '')
  && UUID.test(scope.event_id ?? '')
  && OPERATIONS.has(scope.operation)
  && DIGEST.test(scope.mutation_digest ?? '')
  && typeof scope.occurred_at === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(scope.occurred_at)
  && Number.isFinite(Date.parse(scope.occurred_at));

async function syncDirectory(directory) {
  let handle;
  try { handle = await fs.open(directory, fsConstants.O_RDONLY); await handle.sync(); }
  catch { /* Directory fsync is not supported by every Windows filesystem. */ }
  finally { await handle?.close().catch(() => {}); }
}

function normalizedMessage(message) {
  return {
    message_id: message.message_id,
    active_version_index: message.active_version_index,
    versions: message.versions.map(version => ({
      version_id: version.version_id,
      version_index: version.version_index,
      parent_version_id: version.parent_version_id ?? null,
      content_sha256: version.content_sha256,
      active: version.active === true,
    })),
  };
}

function validBackupTransition(before, after) {
  const previous = new Map((before.backup_entries ?? []).map(entry => [entry.path, entry]));
  const current = new Map((after.backup_entries ?? []).map(entry => [entry.path, entry]));
  for (const [filePath, entry] of previous) {
    if (canonical(current.get(filePath)) !== canonical(entry)) return false;
  }
  const additions = [...current].filter(([filePath]) => !previous.has(filePath)).map(([, entry]) => entry);
  // SillyTavern throttles chat backups. A trailing backup can be materialized
  // after the next save has already changed the target file, so the new backup
  // may contain either the exact pre-write or post-write target bytes. No
  // unrelated/older digest is accepted.
  const allowedDigests = new Set([
    before.target_content_sha256,
    after.target_content_sha256,
  ]);
  return additions.every(entry => allowedDigests.has(entry.sha256));
}

function exactlyOneChanged(before, after, predicate) {
  if (before.length !== after.length) return false;
  let changed = 0;
  for (let index = 0; index < before.length; index++) {
    if (canonical(before[index]) === canonical(after[index])) continue;
    changed++;
    if (!predicate(before[index], after[index])) return false;
  }
  return changed === 1;
}

function validOperationTransition(operation, before, after) {
  // A chat rename changes only the file locator. The caller has already
  // verified the filesystem identity, bytes, backups and unrelated inventory;
  // the logical conversation identity must remain exactly unchanged.
  if (operation === 'rename-chat') return canonical(before) === canonical(after);
  const left = before.messages.map(normalizedMessage);
  const right = after.messages.map(normalizedMessage);
  if (operation === 'create-message' || operation === 'message-send' || operation === 'message-receive') {
    return right.length === left.length + 1
      && left.every((message, index) => canonical(message) === canonical(right[index]));
  }
  if (operation === 'create-swipe') {
    return exactlyOneChanged(left, right, (oldMessage, newMessage) =>
      oldMessage.message_id === newMessage.message_id
      && newMessage.versions.length === oldMessage.versions.length + 1
      && oldMessage.versions.every((version, index) => {
        const next = newMessage.versions[index];
        return version.version_id === next.version_id
          && version.version_index === next.version_index
          && version.parent_version_id === next.parent_version_id
          && version.content_sha256 === next.content_sha256;
      })
      && newMessage.versions.at(-1).parent_version_id
        === oldMessage.versions[oldMessage.active_version_index]?.version_id);
  }
  if (operation === 'select-swipe') {
    return exactlyOneChanged(left, right, (oldMessage, newMessage) =>
      oldMessage.message_id === newMessage.message_id
      && oldMessage.active_version_index !== newMessage.active_version_index
      && oldMessage.versions.length === newMessage.versions.length
      && oldMessage.versions.every((version, index) => {
        const next = newMessage.versions[index];
        return version.version_id === next.version_id
          && version.version_index === next.version_index
          && version.content_sha256 === next.content_sha256
          && version.parent_version_id === next.parent_version_id;
      }));
  }
  if (operation === 'delete-swipe') {
    return exactlyOneChanged(left, right, (oldMessage, newMessage) => {
      if (oldMessage.message_id !== newMessage.message_id
        || newMessage.versions.length !== oldMessage.versions.length - 1) return false;
      let priorIndex = -1;
      return newMessage.versions.every(version => {
        const nextIndex = oldMessage.versions.findIndex((old, index) => index > priorIndex
          && old.version_id === version.version_id
          && old.content_sha256 === version.content_sha256
          && old.parent_version_id === version.parent_version_id);
        if (nextIndex < 0) return false;
        priorIndex = nextIndex;
        return true;
      });
    });
  }
  if (operation === 'delete-message') {
    if (right.length !== left.length - 1) return false;
    let index = 0;
    for (const message of left) {
      if (index < right.length && canonical(message) === canonical(right[index])) index++;
    }
    return index === right.length;
  }
  if (operation === 'edit-message') {
    return exactlyOneChanged(left, right, (oldMessage, newMessage) =>
      oldMessage.message_id === newMessage.message_id
      && oldMessage.versions.length === newMessage.versions.length
      && oldMessage.versions.filter((version, index) => {
        const next = newMessage.versions[index];
        return version.version_id !== next.version_id
          || version.content_sha256 !== next.content_sha256;
      }).length === 1
      && oldMessage.versions.some((version, index) =>
        version.version_id !== newMessage.versions[index].version_id
        && version.content_sha256 !== newMessage.versions[index].content_sha256));
  }
  return false;
}


export function createCommunicationDeliveryReceipt({ scope, before, after, recipientBinding, hostCommit }) {
  if (scope?.operation !== 'message-send'
    || before?.target_kind !== 'character-chat'
    || after?.target_kind !== 'character-chat'
    || !recipientBinding || typeof recipientBinding !== 'object' || Array.isArray(recipientBinding)) return null;

  // A delivery receipt is trusted acquisition evidence, not a best-effort
  // lifecycle diagnostic. Require the same pinned source/mutation-coverage
  // attestations and independently captured, aligned VSS snapshots that the
  // Host readiness contract requires. Non-Windows double scans remain useful
  // for diagnostics, but cannot mint a trusted communication_delivered claim.
  const validSnapshotProof = proof => proof && proof.host_commit === hostCommit
    && proof.snapshot_alignment === 'SHARED_VSS_SNAPSHOT'
    && typeof proof.snapshot_id === 'string' && proof.snapshot_id.trim() === proof.snapshot_id
    && proof.snapshot_id.length > 0 && proof.snapshot_id.length <= 512
    && proof.source_snapshot_id === proof.snapshot_id
    && DIGEST.test(proof.snapshot_sha256 ?? '')
    && DIGEST.test(proof.source_inventory_sha256 ?? '')
    && DIGEST.test(proof.source_manifest_sha256 ?? '')
    && DIGEST.test(proof.mutation_coverage_manifest_sha256 ?? '')
    && DIGEST.test(proof.mutation_coverage_source_files_sha256 ?? '');
  const beforeProof = before.snapshot_proof;
  const afterProof = after.snapshot_proof;
  if (!validSnapshotProof(beforeProof) || !validSnapshotProof(afterProof)
    || beforeProof.snapshot_id === afterProof.snapshot_id
    || beforeProof.source_manifest_sha256 !== afterProof.source_manifest_sha256
    || beforeProof.mutation_coverage_manifest_sha256 !== afterProof.mutation_coverage_manifest_sha256
    || beforeProof.mutation_coverage_source_files_sha256 !== afterProof.mutation_coverage_source_files_sha256) return null;

  const coreConversationId = [
    scope.host_session_id, scope.host_installation_id, scope.conversation_uuid,
  ].join(':');
  const safeId = value => typeof value === 'string' && value === value.trim()
    && value.length > 0 && value.length <= 200
    && ![...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
  const beforeLogical = before.logical_identity;
  const afterLogical = after.logical_identity;
  if (beforeLogical?.identity_status !== 'CURRENT_IDENTITIES_VERIFIED'
    || afterLogical?.identity_status !== 'CURRENT_IDENTITIES_VERIFIED'
    || !Array.isArray(beforeLogical.messages) || !Array.isArray(afterLogical.messages)
    || afterLogical.messages.length !== beforeLogical.messages.length + 1
    || !beforeLogical.messages.every((message, index) =>
      canonical(message) === canonical(afterLogical.messages[index]))
    || recipientBinding.conversation_id !== coreConversationId
    || !safeId(recipientBinding.adapter_id)
    || !safeId(recipientBinding.host_character_avatar_id)
    || before.target_locator?.split('/')?.[0] !== recipientBinding.host_character_avatar_id
    || after.target_locator?.split('/')?.[0] !== recipientBinding.host_character_avatar_id
    || !safeId(recipientBinding.world_id)
    || !safeId(recipientBinding.actor_id)
    || typeof recipientBinding.actor_type !== 'string'
    || !/^[a-z][a-z0-9_-]{0,63}$/i.test(recipientBinding.actor_type)) return null;

  const message = afterLogical.messages.at(-1);
  if (!message || message.role !== 'user'
    || !UUID.test(message.message_id ?? '')
    || message.active_version_index !== 0
    || !Array.isArray(message.versions) || message.versions.length !== 1) return null;
  const version = message.versions[0];
  if (!version || version.version_index !== 0 || version.active !== true
    || version.parent_version_id !== null
    || !UUID.test(version.version_id ?? '')
    || !DIGEST.test(version.content_sha256 ?? '')) return null;

  // Bind the complete server-observed conversation version inventory to the
  // same receipt digest. This is digest-only: no message text enters Core.
  const conversationVersions = [];
  const seenMessageIds = new Set();
  const seenVersionIds = new Set();
  for (const entry of afterLogical.messages) {
    if (!entry || !UUID.test(entry.message_id ?? '') || seenMessageIds.has(entry.message_id)
      || !Array.isArray(entry.versions) || entry.versions.length === 0
      || !Number.isInteger(entry.active_version_index)
      || entry.active_version_index < 0 || entry.active_version_index >= entry.versions.length) return null;
    seenMessageIds.add(entry.message_id);
    let activeCount = 0;
    for (let index = 0; index < entry.versions.length; index++) {
      const candidate = entry.versions[index];
      if (!candidate || candidate.version_index !== index
        || !UUID.test(candidate.version_id ?? '') || seenVersionIds.has(candidate.version_id)
        || (candidate.parent_version_id !== null
          && !UUID.test(candidate.parent_version_id ?? ''))
        || !DIGEST.test(candidate.content_sha256 ?? '')
        || typeof candidate.active !== 'boolean'
        || candidate.active !== (index === entry.active_version_index)) return null;
      if (candidate.active) activeCount++;
      seenVersionIds.add(candidate.version_id);
      conversationVersions.push(Object.freeze({
        message_id: entry.message_id,
        version_id: candidate.version_id,
        parent_version_id: candidate.parent_version_id,
        content_sha256: candidate.content_sha256,
        active: candidate.active,
        deleted: false,
      }));
      if (conversationVersions.length > MAX_COMMUNICATION_DELIVERY_VERSIONS) return null;
    }
    if (activeCount !== 1) return null;
  }

  // A one-to-one character chat is the supported Host communication channel.
  // Group chats are deliberately excluded because membership is not delivery
  // to every member. This receipt attests persisted delivery, never read or
  // comprehension, and carries no raw message text.
  return Object.freeze({
    protocol_version: 1,
    evidence_type: 'communication_delivered',
    producer: 'logic-engine-host-delivery-receipt-v1',
    host_commit: hostCommit,
    host_installation_id: scope.host_installation_id,
    authenticated_account_id: scope.authenticated_account_id,
    host_session_id: scope.host_session_id,
    conversation_uuid: scope.conversation_uuid,
    sender: Object.freeze({
      principal_type: 'host_authenticated_account',
      principal_id: scope.authenticated_account_id,
    }),
    recipient: Object.freeze({
      world_id: recipientBinding.world_id,
      actor_id: recipientBinding.actor_id,
      actor_type: recipientBinding.actor_type,
      host_character_avatar_id: recipientBinding.host_character_avatar_id,
    }),
    source_attestation: Object.freeze({
      protocol_version: 1,
      host_commit: hostCommit,
      snapshot_alignment: 'SHARED_VSS_SNAPSHOT',
      before_snapshot_id: beforeProof.snapshot_id,
      after_snapshot_id: afterProof.snapshot_id,
      before_snapshot_sha256: beforeProof.snapshot_sha256,
      after_snapshot_sha256: afterProof.snapshot_sha256,
      before_source_inventory_sha256: beforeProof.source_inventory_sha256,
      after_source_inventory_sha256: afterProof.source_inventory_sha256,
      source_manifest_sha256: beforeProof.source_manifest_sha256,
      mutation_coverage_manifest_sha256: beforeProof.mutation_coverage_manifest_sha256,
      mutation_coverage_source_files_sha256: beforeProof.mutation_coverage_source_files_sha256,
    }),
    channel: 'sillytavern.character_chat',
    source: Object.freeze({
      message_id: message.message_id,
      version_id: version.version_id,
      content_sha256: version.content_sha256,
    }),
    conversation_inventory: Object.freeze({
      protocol_version: 1,
      complete: true,
      versions: Object.freeze(conversationVersions),
    }),
    status: 'delivered',
    delivered_at: scope.occurred_at,
    host_event_id: scope.event_id,
    mutation_id: scope.mutation_id,
  });
}

/**
 * Durable server-owned receipt evidence for the pinned SillyTavern Host.
 * It stores only identities and digests; no chat text or file bytes are retained.
 * A terminal receipt is issued only after a fresh server-side disk inventory
 * proves the expected single-conversation transition and no unrelated file drift.
 */
export class HostLifecycleReceiptStore {
  constructor({ directory, enumerate = enumerateHostDataInventory,
    sourceEvidenceProvider = null,
    hostCommit = '06bde939fb1e9c4c8d8641d810f0a916b5bce127' } = {}) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory)
      || typeof enumerate !== 'function'
      || (sourceEvidenceProvider !== null && typeof sourceEvidenceProvider !== 'function')
      || !/^[a-f0-9]{40}$/.test(hostCommit)) {
      throw new TypeError('HostLifecycleReceiptStore requires a protected absolute directory and pinned enumerator.');
    }
    this.directory = path.resolve(directory);
    this.enumerate = enumerate;
    this.sourceEvidenceProvider = sourceEvidenceProvider;
    this.hostCommit = hostCommit;
  }

  async #prepareDirectory() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(this.directory).catch(() => null);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new Error('HOST_LIFECYCLE_RECEIPT_DIRECTORY_UNSAFE');
  }

  async assertOutsideRoot(root) {
    if (typeof root !== 'string' || !path.isAbsolute(root)) {
      throw new Error('HOST_LIFECYCLE_RECEIPT_DATA_ROOT_INVALID');
    }
    const realRoot = await fs.realpath(root);
    let probe = this.directory;
    let realParent;
    while (!realParent) {
      try { realParent = await fs.realpath(probe); }
      catch (error) {
        if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
        const parent = path.dirname(probe);
        if (parent === probe) throw error;
        probe = parent;
      }
    }
    const isWithinRoot = relative => relative === ''
      || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
    const parentRelative = path.relative(realRoot, realParent);
    if (isWithinRoot(parentRelative)) {
      throw new Error('HOST_LIFECYCLE_RECEIPT_DIRECTORY_INSIDE_DATA_ROOT');
    }
    await this.#prepareDirectory();
    const realDirectory = await fs.realpath(this.directory);
    const relative = path.relative(realRoot, realDirectory);
    if (isWithinRoot(relative)) {
      throw new Error('HOST_LIFECYCLE_RECEIPT_DIRECTORY_INSIDE_DATA_ROOT');
    }
    return true;
  }

  #recordPath(scope, suffix) {
    const key = sha256(Buffer.from(canonical({
      host_installation_id: scope.host_installation_id,
      authenticated_account_id: scope.authenticated_account_id,
      host_session_id: scope.host_session_id,
      conversation_uuid: scope.conversation_uuid,
      mutation_id: scope.mutation_id,
    }), 'utf8'));
    return path.join(this.directory, key + '.' + suffix + '.json');
  }

  async #read(filePath) {
    let handle;
    try {
      const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
      handle = await fs.open(filePath, fsConstants.O_RDONLY | noFollow);
      const before = await handle.stat({ bigint: true });
      if (!before.isFile() || before.size > BigInt(MAX_RECORD_BYTES)) {
        throw new Error('HOST_LIFECYCLE_RECEIPT_RECORD_INVALID');
      }
      const bytes = await handle.readFile();
      const after = await handle.stat({ bigint: true });
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
        || before.mtimeNs !== after.mtimeNs || BigInt(bytes.length) !== after.size) {
        throw new Error('HOST_LIFECYCLE_RECEIPT_RECORD_CHANGED');
      }
      let record;
      try { record = JSON.parse(bytes.toString('utf8')); }
      catch { throw new Error('HOST_LIFECYCLE_RECEIPT_RECORD_CORRUPT'); }
      if (canonical(record) !== bytes.toString('utf8')) throw new Error('HOST_LIFECYCLE_RECEIPT_RECORD_NONCANONICAL');
      return record;
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    } finally { await handle?.close().catch(() => {}); }
  }

  async #writeOnce(filePath, record, duplicateMatches = existing => canonical(existing) === canonical(record)) {
    const encoded = canonical(record);
    if (Buffer.byteLength(encoded) > MAX_RECORD_BYTES) throw new Error('HOST_LIFECYCLE_RECEIPT_RECORD_TOO_LARGE');
    // Publish only a fully written, fsynced record. Creating the final name with
    // link() is atomic and no-clobber; readers can never observe a partial JSON
    // file when concurrent PREPARED/terminal retries race on Windows.
    const temporaryPath = path.join(this.directory, '.receipt-' + randomUUID() + '.tmp');
    let handle;
    let published = false;
    try {
      handle = await fs.open(temporaryPath, 'wx', 0o600);
      await handle.writeFile(encoded, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      try {
        await fs.link(temporaryPath, filePath);
        published = true;
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        const existing = await this.#read(filePath);
        if (!existing || !duplicateMatches(existing)) {
          if (existing?.event_type && record.event_type && existing.event_type !== record.event_type) {
            throw new Error('HOST_LIFECYCLE_RECEIPT_TERMINAL_CONFLICT');
          }
          throw new Error('HOST_LIFECYCLE_RECEIPT_CONFLICT');
        }
        return { status: 'duplicate', record: existing };
      }
      await syncDirectory(this.directory);
      return { status: 'appended', record };
    } finally {
      await handle?.close().catch(() => {});
      await fs.unlink(temporaryPath).catch(() => {});
      if (published) await syncDirectory(this.directory);
    }
  }

  async #snapshot(scope, directories) {
    if (!directories || typeof directories !== 'object' || Array.isArray(directories)
      || !['root', 'chats', 'groups', 'groupChats'].every(key =>
        typeof directories[key] === 'string' && path.isAbsolute(directories[key]))
      || (directories.backups !== undefined
        && (typeof directories.backups !== 'string' || !path.isAbsolute(directories.backups)))) {
      throw new Error('HOST_LIFECYCLE_RECEIPT_DIRECTORIES_INVALID');
    }
    const inventory = await this.enumerate({ directories, hostCommit: this.hostCommit });
    if (inventory?.filesystem?.status !== 'complete'
      || !Array.isArray(inventory.filesystem.entries)
      || inventory?.source?.status !== 'DOUBLE_SCAN_CANDIDATE'
      || inventory?.source?.host_commit !== this.hostCommit
      || !Array.isArray(inventory.source.files)) {
      throw new Error('HOST_LIFECYCLE_RECEIPT_INVENTORY_NON_READY');
    }
    const matches = inventory.source.files.filter(file =>
      file?.logical_identity?.conversation_uuid === scope.conversation_uuid);
    if (matches.length !== 1) throw new Error('HOST_LIFECYCLE_RECEIPT_CONVERSATION_NOT_UNIQUE');
    const target = matches[0];
    const logical = target.logical_identity;
    if (logical.identity_status !== 'CURRENT_IDENTITIES_VERIFIED'
      || logical.missing_message_identity_count !== 0
      || !Array.isArray(logical.messages)) {
      throw new Error('HOST_LIFECYCLE_RECEIPT_LOGICAL_IDENTITY_INCOMPLETE');
    }
    const locator = target.locator;
    if (typeof locator !== 'string' || !locator || locator.includes('\\')
      || locator.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new Error('HOST_LIFECYCLE_RECEIPT_LOCATOR_INVALID');
    }
    const sourceRoot = target.kind === 'group-chat' ? directories.groupChats : directories.chats;
    const absoluteTarget = path.resolve(sourceRoot, ...locator.split('/'));
    const relativeTarget = path.relative(path.resolve(directories.root), absoluteTarget);
    if (!relativeTarget || relativeTarget === '..' || relativeTarget.startsWith('..' + path.sep)
      || path.isAbsolute(relativeTarget)) throw new Error('HOST_LIFECYCLE_RECEIPT_TARGET_OUTSIDE_ROOT');
    const targetPath = relativeTarget.split(path.sep).join('/');
    const rootEntries = inventory.filesystem.entries;
    const rootEntriesByPath = new Map(rootEntries.map(entry => [entry.path, entry]));
    for (const sourceFile of inventory.source.files) {
      const sourceRoot = sourceFile.kind === 'group-chat' ? directories.groupChats
        : sourceFile.kind === 'group-metadata' ? directories.groups
          : ['root-chat', 'character-chat'].includes(sourceFile.kind) ? directories.chats : null;
      if (!sourceRoot || typeof sourceFile.locator !== 'string' || !sourceFile.locator
        || sourceFile.locator.includes('\\')
        || sourceFile.locator.split('/').some(part => !part || part === '.' || part === '..')) {
        throw new Error('HOST_LIFECYCLE_RECEIPT_SOURCE_LOCATOR_INVALID');
      }
      const sourceAbsolute = path.resolve(sourceRoot, ...sourceFile.locator.split('/'));
      const sourceRelative = path.relative(path.resolve(directories.root), sourceAbsolute);
      if (!sourceRelative || sourceRelative === '..' || sourceRelative.startsWith('..' + path.sep)
        || path.isAbsolute(sourceRelative)) throw new Error('HOST_LIFECYCLE_RECEIPT_SOURCE_OUTSIDE_ROOT');
      const rootEntry = rootEntriesByPath.get(sourceRelative.split(path.sep).join('/'));
      if (!rootEntry || rootEntry.sha256 !== sourceFile.content_sha256
        || rootEntry.identity?.dev + ':' + rootEntry.identity?.ino !== sourceFile.file_identity) {
        throw new Error('HOST_LIFECYCLE_RECEIPT_SOURCE_FILESYSTEM_SCAN_MISMATCH');
      }
    }
    const targetRootEntries = rootEntries.filter(entry => entry.path === targetPath);
    if (targetRootEntries.length !== 1 || !DIGEST.test(target.content_sha256 ?? '')
      || typeof target.file_identity !== 'string') {
      throw new Error('HOST_LIFECYCLE_RECEIPT_TARGET_FILE_MISSING');
    }
    const backupRootRelative = typeof directories.backups === 'string'
      ? path.relative(path.resolve(directories.root), path.resolve(directories.backups)).split(path.sep).join('/')
      : null;
    if (backupRootRelative !== null && (!backupRootRelative || backupRootRelative === '..'
      || backupRootRelative.startsWith('../') || path.isAbsolute(backupRootRelative))) {
      throw new Error('HOST_LIFECYCLE_RECEIPT_BACKUP_DIRECTORY_OUTSIDE_ROOT');
    }
    const backupPrefix = backupRootRelative === null ? null : backupRootRelative + '/';
    const backupEntries = backupPrefix === null ? [] : rootEntries
      .filter(entry => typeof entry.path === 'string' && entry.path.startsWith(backupPrefix))
      .map(entry => ({ path: entry.path, identity: entry.identity, sha256: entry.sha256 }))
      .sort((a, b) => a.path.localeCompare(b.path));
    const backupPathSet = new Set(backupEntries.map(entry => entry.path));
    const otherRootEntries = rootEntries.filter(entry => entry.path !== targetPath && !backupPathSet.has(entry.path));
    const otherSourceFiles = inventory.source.files.filter(file => file !== target).map(file => ({
      kind: file.kind,
      locator: file.locator,
      content_sha256: file.content_sha256,
      file_identity: file.file_identity,
    })).sort((a, b) => (a.kind + '/' + a.locator).localeCompare(b.kind + '/' + b.locator));
    let sourceEvidence = null;
    if (this.sourceEvidenceProvider) {
      try {
        const candidate = await this.sourceEvidenceProvider({ directories, hostCommit: this.hostCommit });
        if (candidate?.status === 'VERIFIED'
          && DIGEST.test(candidate.source_manifest_sha256 ?? '')
          && DIGEST.test(candidate.mutation_coverage_manifest_sha256 ?? '')
          && DIGEST.test(candidate.mutation_coverage_source_files_sha256 ?? '')) {
          sourceEvidence = candidate;
        }
      } catch {}
    }
    return {
      target_path: targetPath,
      target_locator: locator,
      target_kind: target.kind,
      target_file_identity: target.file_identity,
      target_content_sha256: target.content_sha256,
      logical_identity: logical,
      other_root_entries_sha256: sha256(Buffer.from(canonical(otherRootEntries), 'utf8')),
      backup_entries: backupEntries,
      other_source_files_sha256: sha256(Buffer.from(canonical(otherSourceFiles), 'utf8')),
      inventory_sha256: inventory.source.inventory_sha256,
      snapshot_alignment: inventory.snapshot_alignment ?? 'UNKNOWN',
      snapshot_proof: {
        host_commit: this.hostCommit,
        snapshot_id: inventory.filesystem.snapshot_id ?? null,
        snapshot_sha256: inventory.filesystem.snapshot_sha256 ?? null,
        source_snapshot_id: inventory.source.snapshot_id ?? null,
        source_inventory_sha256: inventory.source.inventory_sha256,
        source_manifest_sha256: sourceEvidence?.source_manifest_sha256 ?? null,
        mutation_coverage_manifest_sha256: sourceEvidence?.mutation_coverage_manifest_sha256 ?? null,
        mutation_coverage_source_files_sha256: sourceEvidence?.mutation_coverage_source_files_sha256 ?? null,
        snapshot_alignment: inventory.snapshot_alignment ?? 'UNKNOWN',
      },
    };
  }

  async prepare(scope, directories) {
    if (!validScope(scope)) throw new TypeError('Invalid Host lifecycle receipt preparation scope.');
    await this.#prepareDirectory();
    const filePath = this.#recordPath(scope, 'prepared');
    const existing = await this.#read(filePath);
    if (existing) {
      if (existing.schema_version !== 1 || existing.evidence_schema_version !== 2
        || existing.event_id !== scope.event_id
        || existing.mutation_digest !== scope.mutation_digest
        || existing.operation !== scope.operation) {
        throw new Error('HOST_LIFECYCLE_RECEIPT_CONFLICT');
      }
      return { status: 'duplicate', prepared: existing };
    }
    const before = await this.#snapshot(scope, directories);
    const record = {
      schema_version: 1,
      evidence_schema_version: 2,
      process_started_at_ms: PROCESS_STARTED_AT_MS,
      host_installation_id: scope.host_installation_id,
      authenticated_account_id: scope.authenticated_account_id,
      host_session_id: scope.host_session_id,
      conversation_uuid: scope.conversation_uuid,
      mutation_id: scope.mutation_id,
      event_id: scope.event_id,
      operation: scope.operation,
      mutation_digest: scope.mutation_digest,
      occurred_at: scope.occurred_at,
      before,
    };
    const result = await this.#writeOnce(filePath, record, existing =>
      existing.schema_version === record.schema_version
      && existing.event_id === record.event_id
      && existing.operation === record.operation
      && existing.mutation_digest === record.mutation_digest
      && canonical(existing.before) === canonical(record.before));
    return { status: result.status, prepared: result.record };
  }

  async commit(scope, directories, { recipientBinding = null } = {}) {
    if (!validScope(scope)) throw new TypeError('Invalid Host lifecycle receipt commit scope.');
    await this.#prepareDirectory();
    const prepared = await this.#read(this.#recordPath(scope, 'prepared'));
    if (!prepared || (scope.prepared_event_id && prepared.event_id !== scope.prepared_event_id)
      || prepared.mutation_digest !== scope.mutation_digest
      || prepared.operation !== scope.operation) {
      throw new Error('HOST_LIFECYCLE_RECEIPT_PREPARE_MISSING');
    }
    const terminalPath = this.#recordPath(scope, 'terminal');
    const priorTerminal = await this.#read(terminalPath);
    if (priorTerminal) {
      if (priorTerminal.event_type !== 'MUTATION_COMMITTED' || priorTerminal.event_id !== scope.event_id) {
        throw new Error('HOST_LIFECYCLE_RECEIPT_TERMINAL_CONFLICT');
      }
      if (!priorTerminal.receipt
        || priorTerminal.receipt_digest !== sha256(Buffer.from(canonical(priorTerminal.receipt), 'utf8'))) {
        throw new Error('HOST_LIFECYCLE_RECEIPT_CONFLICT');
      }
      return {
        status: 'duplicate',
        receipt_digest: priorTerminal.receipt_digest,
        occurred_at: priorTerminal.occurred_at,
        communication_delivery: priorTerminal.receipt.communication_delivery ?? null,
      };
    }
    const after = await this.#snapshot(scope, directories);
    const rename = scope.operation === 'rename-chat';
    const mismatchReason = rename
      ? after.target_path === prepared.before.target_path ? 'TARGET_PATH_UNCHANGED'
        : after.target_locator === prepared.before.target_locator ? 'TARGET_LOCATOR_UNCHANGED'
          : after.target_file_identity !== prepared.before.target_file_identity ? 'TARGET_FILE_IDENTITY_CHANGED'
            : after.target_content_sha256 !== prepared.before.target_content_sha256 ? 'TARGET_CONTENT_CHANGED'
              : after.other_root_entries_sha256 !== prepared.before.other_root_entries_sha256 ? 'UNRELATED_ROOT_ENTRY_CHANGED'
                : after.other_source_files_sha256 !== prepared.before.other_source_files_sha256 ? 'UNRELATED_SOURCE_FILE_CHANGED'
                  : !validBackupTransition(prepared.before, after) ? 'BACKUP_TRANSITION_INVALID'
                    : !validOperationTransition(scope.operation, prepared.before.logical_identity, after.logical_identity)
                      ? 'LOGICAL_OPERATION_TRANSITION_INVALID' : null
      : after.target_path !== prepared.before.target_path ? 'TARGET_PATH_CHANGED'
        : after.target_locator !== prepared.before.target_locator ? 'TARGET_LOCATOR_CHANGED'
          : after.target_content_sha256 === prepared.before.target_content_sha256 ? 'TARGET_CONTENT_UNCHANGED'
            : after.other_root_entries_sha256 !== prepared.before.other_root_entries_sha256 ? 'UNRELATED_ROOT_ENTRY_CHANGED'
              : after.other_source_files_sha256 !== prepared.before.other_source_files_sha256 ? 'UNRELATED_SOURCE_FILE_CHANGED'
                : !validBackupTransition(prepared.before, after) ? 'BACKUP_TRANSITION_INVALID'
                  : !validOperationTransition(scope.operation, prepared.before.logical_identity, after.logical_identity)
                    ? 'LOGICAL_OPERATION_TRANSITION_INVALID' : null;
    if (mismatchReason) {
      const error = new Error('HOST_LIFECYCLE_RECEIPT_PERSISTED_STATE_MISMATCH');
      error.reason = mismatchReason;
      throw error;
    }
    const receipt = {
      protocol_version: 2,
      host_commit: this.hostCommit,
      before_snapshot_proof: prepared.before.snapshot_proof ?? null,
      after_snapshot_proof: after.snapshot_proof ?? null,
      recovery_verified: scope.recovery_verified === true,
      host_installation_id: scope.host_installation_id,
      authenticated_account_id: scope.authenticated_account_id,
      host_session_id: scope.host_session_id,
      conversation_uuid: scope.conversation_uuid,
      mutation_id: scope.mutation_id,
      event_id: scope.event_id,
      operation: scope.operation,
      mutation_digest: scope.mutation_digest,
      before: {
        target_path: prepared.before.target_path,
        target_file_identity: prepared.before.target_file_identity,
        target_content_sha256: prepared.before.target_content_sha256,
      },
      after: {
        target_path: after.target_path,
        target_file_identity: after.target_file_identity,
        target_content_sha256: after.target_content_sha256,
      },
      other_root_entries_sha256: after.other_root_entries_sha256,
      backup_additions: (after.backup_entries ?? []).filter(entry =>
        !(prepared.before.backup_entries ?? []).some(prior => prior.path === entry.path)),
      other_source_files_sha256: after.other_source_files_sha256,
      logical_transition: sha256(Buffer.from(canonical({
        before: prepared.before.logical_identity,
        after: after.logical_identity,
      }), 'utf8')),
    };
    const communicationDelivery = createCommunicationDeliveryReceipt({
      scope,
      before: prepared.before,
      after,
      recipientBinding,
      hostCommit: this.hostCommit,
    });
    if (communicationDelivery) receipt.communication_delivery = communicationDelivery;
    const receiptDigest = sha256(Buffer.from(canonical(receipt), 'utf8'));
    const record = {
      schema_version: 1,
      evidence_schema_version: 2,
      event_type: 'MUTATION_COMMITTED',
      event_id: scope.event_id,
      receipt_digest: receiptDigest,
      occurred_at: scope.occurred_at,
      receipt,
    };
    const stored = await this.#writeOnce(terminalPath, record, existing =>
      existing.schema_version === record.schema_version
      && existing.event_type === record.event_type
      && existing.event_id === record.event_id
      && existing.receipt_digest === record.receipt_digest
      && canonical(existing.receipt) === canonical(record.receipt));
    return {
      status: stored.status,
      receipt_digest: stored.record.receipt_digest,
      occurred_at: stored.record.occurred_at,
      communication_delivery: stored.record.receipt.communication_delivery ?? null,
    };
  }

  async recover(scope, directories) {
    if (!validScope(scope) || !UUID.test(scope.prepared_event_id ?? '')) {
      throw new TypeError('Invalid Host lifecycle recovery scope.');
    }
    await this.#prepareDirectory();
    const prepared = await this.#read(this.#recordPath(scope, 'prepared'));
    if (!prepared || prepared.event_id !== scope.prepared_event_id
      || prepared.mutation_digest !== scope.mutation_digest
      || prepared.operation !== scope.operation) {
      return { status: 'RECOVERY_REQUIRED', reason: 'HOST_LIFECYCLE_RECEIPT_PREPARE_MISSING' };
    }
    const terminal = await this.#read(this.#recordPath(scope, 'terminal'));
    if (terminal) {
      if (!['MUTATION_COMMITTED', 'MUTATION_ABORTED'].includes(terminal.event_type)
        || !UUID.test(terminal.event_id ?? '')
        || !DIGEST.test(terminal.receipt_digest ?? '')
        || typeof terminal.occurred_at !== 'string'
        || !terminal.receipt
        || terminal.receipt_digest !== sha256(Buffer.from(canonical(terminal.receipt), 'utf8'))) {
        return { status: 'RECOVERY_REQUIRED', reason: 'HOST_LIFECYCLE_RECEIPT_TERMINAL_CORRUPT' };
      }
      return {
        status: terminal.event_type === 'MUTATION_COMMITTED' ? 'COMMITTED' : 'ABORTED',
        event_id: terminal.event_id,
        receipt_digest: terminal.receipt_digest,
        occurred_at: terminal.occurred_at,
      };
    }
    let current;
    try { current = await this.#snapshot(scope, directories); }
    catch { return { status: 'RECOVERY_REQUIRED', reason: 'HOST_LIFECYCLE_RECEIPT_CURRENT_STATE_UNAVAILABLE' }; }
    const terminalScope = {
      ...scope,
      event_id: randomUUID(),
      occurred_at: new Date().toISOString(),
      recovery_verified: true,
    };
    if (canonical(current) === canonical(prepared.before)) {
      const result = await this.abort(terminalScope, directories);
      return {
        status: 'ABORTED',
        event_id: terminalScope.event_id,
        receipt_digest: result.receipt_digest,
        occurred_at: result.occurred_at,
      };
    }
    const matchesExpectedPostState = current.target_path === prepared.before.target_path
      && current.target_locator === prepared.before.target_locator
      && current.target_content_sha256 !== prepared.before.target_content_sha256
      && current.other_root_entries_sha256 === prepared.before.other_root_entries_sha256
      && current.other_source_files_sha256 === prepared.before.other_source_files_sha256
      && validBackupTransition(prepared.before, current)
      && validOperationTransition(scope.operation, prepared.before.logical_identity, current.logical_identity);
    if (!matchesExpectedPostState) {
      return { status: 'RECOVERY_REQUIRED', reason: 'HOST_LIFECYCLE_RECEIPT_PERSISTED_STATE_AMBIGUOUS' };
    }
    const result = await this.commit(terminalScope, directories);
    return {
      status: 'COMMITTED',
      event_id: terminalScope.event_id,
      receipt_digest: result.receipt_digest,
      occurred_at: result.occurred_at,
    };
  }

  async abort(scope, directories) {
    if (!validScope(scope)) throw new TypeError('Invalid Host lifecycle receipt abort scope.');
    await this.#prepareDirectory();
    const prepared = await this.#read(this.#recordPath(scope, 'prepared'));
    if (!prepared || (scope.prepared_event_id && prepared.event_id !== scope.prepared_event_id)
      || prepared.mutation_digest !== scope.mutation_digest
      || prepared.operation !== scope.operation) {
      throw new Error('HOST_LIFECYCLE_RECEIPT_PREPARE_MISSING');
    }
    const terminalPath = this.#recordPath(scope, 'terminal');
    const priorTerminal = await this.#read(terminalPath);
    if (priorTerminal) {
      if (priorTerminal.event_type !== 'MUTATION_ABORTED' || priorTerminal.event_id !== scope.event_id) {
        throw new Error('HOST_LIFECYCLE_RECEIPT_TERMINAL_CONFLICT');
      }
      if (!priorTerminal.receipt
        || priorTerminal.receipt_digest !== sha256(Buffer.from(canonical(priorTerminal.receipt), 'utf8'))) {
        throw new Error('HOST_LIFECYCLE_RECEIPT_CONFLICT');
      }
      return { status: 'duplicate', receipt_digest: priorTerminal.receipt_digest, occurred_at: priorTerminal.occurred_at };
    }
    const after = await this.#snapshot(scope, directories);
    if (canonical(after) !== canonical(prepared.before)) {
      throw new Error('HOST_LIFECYCLE_ABORT_STATE_CHANGED');
    }
    const receipt = {
      protocol_version: 2,
      host_commit: this.hostCommit,
      before_snapshot_proof: prepared.before.snapshot_proof ?? null,
      after_snapshot_proof: after.snapshot_proof ?? null,
      recovery_verified: scope.recovery_verified === true,
      host_installation_id: scope.host_installation_id,
      authenticated_account_id: scope.authenticated_account_id,
      host_session_id: scope.host_session_id,
      conversation_uuid: scope.conversation_uuid,
      mutation_id: scope.mutation_id,
      event_id: scope.event_id,
      operation: scope.operation,
      mutation_digest: scope.mutation_digest,
      before_snapshot_sha256: sha256(Buffer.from(canonical(prepared.before), 'utf8')),
      after_snapshot_sha256: sha256(Buffer.from(canonical(after), 'utf8')),
      outcome: 'VERIFIED_NO_CHANGE',
    };
    const receiptDigest = sha256(Buffer.from(canonical(receipt), 'utf8'));
    const record = {
      schema_version: 1,
      evidence_schema_version: 2,
      event_type: 'MUTATION_ABORTED',
      event_id: scope.event_id,
      receipt_digest: receiptDigest,
      occurred_at: scope.occurred_at,
      receipt,
    };
    const stored = await this.#writeOnce(terminalPath, record, existing =>
      existing.schema_version === record.schema_version
      && existing.event_type === record.event_type
      && existing.event_id === record.event_id
      && existing.receipt_digest === record.receipt_digest
      && canonical(existing.receipt) === canonical(record.receipt));
    return { status: stored.status, receipt_digest: stored.record.receipt_digest, occurred_at: stored.record.occurred_at };
  }

  /**
   * Read-only acceptance audit. It never manufactures receipts or changes
   * pending mutations. Only committed, digest-valid records from a prior
   * server process count toward runtime operation coverage.
   */

  async verifyRuntimeAcceptance({
    pinnedHostCommit, rootPath, rootId, entries, snapshotAlignment,
    snapshotId, snapshotSha256, sourceIdentity, mutationCoverage,
    hostInstallationId, authenticatedAccountId,
    currentProcessStartedAtMs = PROCESS_STARTED_AT_MS,
  } = {}) {
    const fail = reason => ({ status: 'NON_READY', reason });
    if (pinnedHostCommit !== this.hostCommit || typeof rootPath !== 'string'
      || !path.isAbsolute(rootPath) || !DIGEST.test(rootId ?? '')
      || rootId !== sha256(Buffer.from(path.resolve(rootPath), 'utf8'))
      || !UUID.test(hostInstallationId ?? '') || !UUID.test(authenticatedAccountId ?? '')
      || !Array.isArray(entries) || entries.length === 0
      || entries.some(entry => !entry || typeof entry.path !== 'string' || !DIGEST.test(entry.sha256 ?? ''))
      || sha256(Buffer.from(JSON.stringify(entries), 'utf8')) !== snapshotSha256
      || snapshotAlignment !== 'SHARED_VSS_SNAPSHOT'
      || typeof snapshotId !== 'string' || !snapshotId
      || !DIGEST.test(snapshotSha256 ?? '')
      || !Number.isSafeInteger(currentProcessStartedAtMs) || currentProcessStartedAtMs < 1
      || sourceIdentity?.status !== 'CURRENT_IDENTITIES_VERIFIED'
      || !DIGEST.test(sourceIdentity.manifest_sha256 ?? '')
      || mutationCoverage?.status !== 'VERIFIED'
      || mutationCoverage.source_commit !== this.hostCommit
      || !DIGEST.test(mutationCoverage.coverage_manifest_sha256 ?? '')
      || !DIGEST.test(mutationCoverage.source_files_sha256 ?? '')
      || !Number.isSafeInteger(mutationCoverage.route_count) || mutationCoverage.route_count < 1) {
      return fail('HOST_MUTATION_RUNTIME_ACCEPTANCE_INPUT_INVALID');
    }
    try { await this.assertOutsideRoot(rootPath); } catch {
      return fail('HOST_MUTATION_RUNTIME_ACCEPTANCE_RECEIPT_STORE_SCOPE_INVALID');
    }
    await this.#prepareDirectory();
    const names = await fs.readdir(this.directory);
    const preparedNames = names.filter(name => /^[a-f0-9]{64}\.prepared\.json$/.test(name)).sort();
    const terminalNames = new Set(names.filter(name => /^[a-f0-9]{64}\.terminal\.json$/.test(name)));
    const scopedTerminalNames = new Set();
    const required = new Set(OPERATIONS);
    const covered = new Set();
    const evidence = [];
    let recoveryVerified = false;
    for (const name of preparedNames) {
      const prepared = await this.#read(path.join(this.directory, name));
      if (!prepared) return fail('HOST_MUTATION_RUNTIME_ACCEPTANCE_PREPARED_EVIDENCE_INVALID');
      if (prepared.host_installation_id !== hostInstallationId
        || prepared.authenticated_account_id !== authenticatedAccountId) continue;
      const terminalName = name.replace(/\.prepared\.json$/, '.terminal.json');
      if (!terminalNames.has(terminalName)) return fail('HOST_MUTATION_RUNTIME_ACCEPTANCE_TERMINAL_MISSING');
      scopedTerminalNames.add(terminalName);
      const terminal = await this.#read(path.join(this.directory, terminalName));
      if (prepared.evidence_schema_version !== 2) {
        if (!terminal?.receipt
          || terminal.receipt_digest !== sha256(Buffer.from(canonical(terminal.receipt), 'utf8'))) {
          return fail('HOST_MUTATION_RUNTIME_ACCEPTANCE_LEGACY_RECEIPT_INVALID');
        }
        continue;
      }
      if (prepared.schema_version !== 1
        || !Number.isSafeInteger(prepared.process_started_at_ms)
        || prepared.process_started_at_ms < 1
        || prepared.process_started_at_ms >= currentProcessStartedAtMs
        || !required.has(prepared.operation)
        || !UUID.test(prepared.mutation_id ?? '') || !UUID.test(prepared.event_id ?? '')
        || !DIGEST.test(prepared.mutation_digest ?? '')
        || !prepared.before?.snapshot_proof
        || prepared.before.snapshot_proof.host_commit !== this.hostCommit
        || prepared.before.snapshot_proof.snapshot_alignment !== 'SHARED_VSS_SNAPSHOT'
        || typeof prepared.before.snapshot_proof.snapshot_id !== 'string'
        || prepared.before.snapshot_proof.source_snapshot_id !== prepared.before.snapshot_proof.snapshot_id
        || !DIGEST.test(prepared.before.snapshot_proof.snapshot_sha256 ?? '')
        || !DIGEST.test(prepared.before.snapshot_proof.source_inventory_sha256 ?? '')
        || prepared.before.snapshot_proof.source_manifest_sha256 !== sourceIdentity.manifest_sha256
        || prepared.before.snapshot_proof.mutation_coverage_manifest_sha256 !== mutationCoverage.coverage_manifest_sha256
        || prepared.before.snapshot_proof.mutation_coverage_source_files_sha256 !== mutationCoverage.source_files_sha256) {
        return fail('HOST_MUTATION_RUNTIME_ACCEPTANCE_PREPARED_EVIDENCE_INVALID');
      }
      if (!terminal || terminal.schema_version !== 1 || terminal.evidence_schema_version !== 2
        || !['MUTATION_COMMITTED', 'MUTATION_ABORTED'].includes(terminal.event_type)
        || !terminal.receipt
        || terminal.receipt_digest !== sha256(Buffer.from(canonical(terminal.receipt), 'utf8'))) {
        return fail('HOST_MUTATION_RUNTIME_ACCEPTANCE_TERMINAL_INVALID');
      }
      const receipt = terminal.receipt;
      if (receipt.protocol_version !== 2 || receipt.host_commit !== this.hostCommit
        || receipt.host_installation_id !== prepared.host_installation_id
        || receipt.authenticated_account_id !== prepared.authenticated_account_id
        || receipt.host_session_id !== prepared.host_session_id
        || receipt.conversation_uuid !== prepared.conversation_uuid
        || receipt.mutation_id !== prepared.mutation_id
        || receipt.event_id !== terminal.event_id
        || receipt.operation !== prepared.operation
        || receipt.mutation_digest !== prepared.mutation_digest
        || canonical(receipt.before_snapshot_proof) !== canonical(prepared.before.snapshot_proof)
        || receipt.after_snapshot_proof?.host_commit !== this.hostCommit
        || receipt.after_snapshot_proof?.snapshot_alignment !== 'SHARED_VSS_SNAPSHOT'
        || typeof receipt.after_snapshot_proof.snapshot_id !== 'string'
        || receipt.after_snapshot_proof.source_snapshot_id !== receipt.after_snapshot_proof.snapshot_id
        || !DIGEST.test(receipt.after_snapshot_proof.snapshot_sha256 ?? '')
        || !DIGEST.test(receipt.after_snapshot_proof.source_inventory_sha256 ?? '')
        || receipt.after_snapshot_proof.source_manifest_sha256 !== sourceIdentity.manifest_sha256
        || receipt.after_snapshot_proof.mutation_coverage_manifest_sha256 !== mutationCoverage.coverage_manifest_sha256
        || receipt.after_snapshot_proof.mutation_coverage_source_files_sha256 !== mutationCoverage.source_files_sha256
        || receipt.before_snapshot_proof.snapshot_id === receipt.after_snapshot_proof.snapshot_id) {
        return fail('HOST_MUTATION_RUNTIME_ACCEPTANCE_RECEIPT_BINDING_INVALID');
      }
      if (terminal.event_type === 'MUTATION_COMMITTED') covered.add(prepared.operation);
      recoveryVerified ||= receipt.recovery_verified === true;
      evidence.push({
        operation: prepared.operation, event_type: terminal.event_type,
        prepared_process_started_at_ms: prepared.process_started_at_ms,
        prepared_event_id: prepared.event_id, terminal_event_id: terminal.event_id,
        receipt_digest: terminal.receipt_digest,
        before_snapshot_id: receipt.before_snapshot_proof.snapshot_id,
        after_snapshot_id: receipt.after_snapshot_proof.snapshot_id,
      });
    }
    for (const terminalName of terminalNames) {
      if (scopedTerminalNames.has(terminalName)) continue;
      const terminal = await this.#read(path.join(this.directory, terminalName));
      if (terminal?.receipt?.host_installation_id === hostInstallationId
        && terminal?.receipt?.authenticated_account_id === authenticatedAccountId) {
        return fail('HOST_MUTATION_RUNTIME_ACCEPTANCE_ORPHAN_TERMINAL');
      }
    }
    const missing = [...required].filter(operation => !covered.has(operation)).sort();
    if (missing.length) return { ...fail('HOST_MUTATION_RUNTIME_ACCEPTANCE_OPERATION_COVERAGE_INCOMPLETE'), missing_operations: missing };
    if (!recoveryVerified) return fail('HOST_MUTATION_RUNTIME_ACCEPTANCE_RESTART_RECOVERY_UNPROVEN');
    evidence.sort((a, b) => a.operation.localeCompare(b.operation) || a.receipt_digest.localeCompare(b.receipt_digest));
    const evidencePayload = {
      protocol_version: 1, source_commit: this.hostCommit,
      host_installation_id: hostInstallationId, authenticated_account_id: authenticatedAccountId,
      root_id: rootId, snapshot_id: snapshotId, snapshot_sha256: snapshotSha256,
      source_manifest_sha256: sourceIdentity.manifest_sha256,
      mutation_coverage_manifest_sha256: mutationCoverage.coverage_manifest_sha256,
      mutation_coverage_source_files_sha256: mutationCoverage.source_files_sha256,
      operations: evidence,
    };
    return {
      status: 'VERIFIED', source_commit: this.hostCommit,
      snapshot_id: snapshotId, snapshot_sha256: snapshotSha256, root_id: rootId,
      source_manifest_sha256: sourceIdentity.manifest_sha256,
      mutation_coverage_manifest_sha256: mutationCoverage.coverage_manifest_sha256,
      evidence_sha256: sha256(Buffer.from(canonical(evidencePayload), 'utf8')),
    };
  }

}
