import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';
import { enumerateHostDataInventory } from './host-data-inventory.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[a-f0-9]{64}$/;
const OPERATIONS = new Set([
  'create-message', 'message-send', 'message-receive', 'create-swipe',
  'select-swipe', 'delete-swipe', 'delete-message', 'edit-message',
]);
const MAX_RECORD_BYTES = 8 * 1024 * 1024;
const canonical = value => Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);
const sha256 = value => createHash('sha256').update(value).digest('hex');
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

/**
 * Durable server-owned receipt evidence for the pinned SillyTavern Host.
 * It stores only identities and digests; no chat text or file bytes are retained.
 * A terminal receipt is issued only after a fresh server-side disk inventory
 * proves the expected single-conversation transition and no unrelated file drift.
 */
export class HostLifecycleReceiptStore {
  constructor({ directory, enumerate = enumerateHostDataInventory,
    hostCommit = '06bde939fb1e9c4c8d8641d810f0a916b5bce127' } = {}) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory)
      || typeof enumerate !== 'function' || !/^[a-f0-9]{40}$/.test(hostCommit)) {
      throw new TypeError('HostLifecycleReceiptStore requires a protected absolute directory and pinned enumerator.');
    }
    this.directory = path.resolve(directory);
    this.enumerate = enumerate;
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
    let handle;
    try {
      handle = await fs.open(filePath, 'wx', 0o600);
      await handle.writeFile(encoded, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await syncDirectory(this.directory);
      return { status: 'appended', record };
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
    } finally { await handle?.close().catch(() => {}); }
  }

  async #snapshot(scope, directories) {
    if (!directories || typeof directories !== 'object' || Array.isArray(directories)
      || !['root', 'chats', 'groups', 'groupChats'].every(key =>
        typeof directories[key] === 'string' && path.isAbsolute(directories[key]))) {
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
    const otherRootEntries = rootEntries.filter(entry => entry.path !== targetPath);
    const otherSourceFiles = inventory.source.files.filter(file => file !== target).map(file => ({
      kind: file.kind,
      locator: file.locator,
      content_sha256: file.content_sha256,
      file_identity: file.file_identity,
    })).sort((a, b) => (a.kind + '/' + a.locator).localeCompare(b.kind + '/' + b.locator));
    return {
      target_path: targetPath,
      target_locator: locator,
      target_kind: target.kind,
      target_file_identity: target.file_identity,
      target_content_sha256: target.content_sha256,
      logical_identity: logical,
      other_root_entries_sha256: sha256(Buffer.from(canonical(otherRootEntries), 'utf8')),
      other_source_files_sha256: sha256(Buffer.from(canonical(otherSourceFiles), 'utf8')),
      inventory_sha256: inventory.source.inventory_sha256,
      snapshot_alignment: inventory.snapshot_alignment ?? 'UNKNOWN',
    };
  }

  async prepare(scope, directories) {
    if (!validScope(scope)) throw new TypeError('Invalid Host lifecycle receipt preparation scope.');
    await this.#prepareDirectory();
    const filePath = this.#recordPath(scope, 'prepared');
    const existing = await this.#read(filePath);
    if (existing) {
      if (existing.schema_version !== 1
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

  async commit(scope, directories) {
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
      return { status: 'duplicate', receipt_digest: priorTerminal.receipt_digest, occurred_at: priorTerminal.occurred_at };
    }
    const after = await this.#snapshot(scope, directories);
    if (after.target_path !== prepared.before.target_path
      || after.target_locator !== prepared.before.target_locator
      || after.target_content_sha256 === prepared.before.target_content_sha256
      || after.other_root_entries_sha256 !== prepared.before.other_root_entries_sha256
      || after.other_source_files_sha256 !== prepared.before.other_source_files_sha256
      || !validOperationTransition(scope.operation, prepared.before.logical_identity, after.logical_identity)) {
      throw new Error('HOST_LIFECYCLE_RECEIPT_PERSISTED_STATE_MISMATCH');
    }
    const receipt = {
      protocol_version: 1,
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
      other_source_files_sha256: after.other_source_files_sha256,
      logical_transition: sha256(Buffer.from(canonical({
        before: prepared.before.logical_identity,
        after: after.logical_identity,
      }), 'utf8')),
    };
    const receiptDigest = sha256(Buffer.from(canonical(receipt), 'utf8'));
    const record = {
      schema_version: 1,
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
    return { status: stored.status, receipt_digest: stored.record.receipt_digest, occurred_at: stored.record.occurred_at };
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
      protocol_version: 1,
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
}
