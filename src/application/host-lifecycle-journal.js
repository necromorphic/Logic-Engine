import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { isProxy } from 'node:util/types';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { openCoordinatorDatabase, beginCoordinatorLock } from '../storage/coordinator-lock.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[a-f0-9]{64}$/;
const EVENT_TYPES = new Set([
  'VERSION_CREATED',
  'VERSION_EDITED',
  'VERSION_REGENERATED',
  'VERSION_SELECTED',
  'VERSION_DELETED',
  'CONVERSATION_DELETED',
  'IMPORT_APPLIED',
  'COPY_APPLIED',
  'BRANCH_CREATED',
  'RESTORE_APPLIED',
  'MIGRATION_APPLIED',
  'MUTATION_PREPARED',
  'MUTATION_COMMITTED',
  'MUTATION_ABORTED',
]);
const MUTATION_OPERATIONS = new Set([
  'create-message', 'message-send', 'message-receive', 'create-swipe', 'select-swipe',
  'delete-swipe', 'delete-message', 'edit-message',
]);
const EVENT_KEYS = new Set([
  'event_id', 'host_installation_id', 'authenticated_account_id', 'host_session_id', 'conversation_uuid',
  'authority_id', 'generation', 'snapshot_fingerprint', 'receipt_digest', 'receipt_signature',
  'event_type', 'message_id', 'version_id', 'parent_version_id', 'payload_sha256',
  'active', 'mutation_digest', 'mutation_id', 'operation', 'occurred_at',
]);

const validText = (value, max = 200) => typeof value === 'string'
  && value.length > 0 && value.length <= max && value === value.trim()
  && ![...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
const validDigest = (value) => typeof value === 'string' && DIGEST.test(value);
const isPlainRecord = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = typeof key === 'string' ? Object.getOwnPropertyDescriptor(value, key) : null;
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return false;
  }
  return true;
};
const canonical = (value) => Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);
const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

const MAX_ROOT_INVENTORY_ENTRIES = 25_000;
const MAX_ROOT_INVENTORY_BYTES = 8 * 1024 * 1024;
const MAX_ROOT_DELTA_FILES = 5_000;

function validateRootEntries(entries) {
  if (!Array.isArray(entries) || entries.length > MAX_ROOT_INVENTORY_ENTRIES) {
    throw new TypeError('HOST_ROOT_INVENTORY_ENTRY_LIMIT');
  }
  const seen = new Set();
  const physicalIds = new Set();
  let previous = null;
  const normalized = entries.map((entry) => {
    if (!isPlainRecord(entry) || Object.keys(entry).some((key) => !['path', 'identity', 'sha256'].includes(key))
      || !validText(entry.path, 4096) || entry.path.startsWith('/') || entry.path.startsWith('//') || /^[a-z]:/i.test(entry.path) || entry.path.includes('\\')
      || entry.path.split('/').some((part) => !part || part === '.' || part === '..')
      || !isPlainRecord(entry.identity)
      || Object.keys(entry.identity).length !== 6
      || Object.keys(entry.identity).some((key) => !['dev', 'ino', 'mode', 'size', 'mtimeMs', 'ctimeMs'].includes(key))
      || !validText(entry.identity.dev, 100) || !validText(entry.identity.ino, 100)
      || !/^[0-9]+$/.test(entry.identity.dev) || !/^[0-9]+$/.test(entry.identity.ino)
      || entry.identity.ino === '0'
      || !Number.isSafeInteger(entry.identity.mode) || entry.identity.mode < 0
      || !Number.isSafeInteger(entry.identity.size) || entry.identity.size < 0
      || !Number.isFinite(entry.identity.mtimeMs) || entry.identity.mtimeMs < 0
      || !Number.isFinite(entry.identity.ctimeMs) || entry.identity.ctimeMs < 0
      || !validDigest(entry.sha256) || seen.has(entry.path)
      || (previous !== null && entry.path.localeCompare(previous) < 0)) {
      throw new TypeError('HOST_ROOT_INVENTORY_ENTRY_INVALID');
    }
    const physicalId = process.platform === 'win32'
      ? 'win:' + entry.identity.ino
      : 'posix:' + entry.identity.dev + ':' + entry.identity.ino;
    if (physicalIds.has(physicalId)) throw new TypeError('HOST_ROOT_INVENTORY_PHYSICAL_IDENTITY_DUPLICATE');
    seen.add(entry.path);
    physicalIds.add(physicalId);
    previous = entry.path;
    return {
      path: entry.path,
      identity: { ...entry.identity },
      sha256: entry.sha256,
    };
  });
  if (Buffer.byteLength(canonical(normalized), 'utf8') > MAX_ROOT_INVENTORY_BYTES) {
    throw new TypeError('HOST_ROOT_INVENTORY_BYTE_LIMIT');
  }
  return normalized;
}

function rootPhysicalId(entry) {
  return process.platform === 'win32'
    ? 'win:' + entry.identity.ino
    : 'posix:' + entry.identity.dev + ':' + entry.identity.ino;
}

function rootInventoryDelta(beforeEntries, afterEntries) {
  const before = new Map(beforeEntries.map((entry) => [entry.path, entry]));
  const after = new Map(afterEntries.map((entry) => [entry.path, entry]));
  const beforeIds = new Map(beforeEntries.map((entry) => [rootPhysicalId(entry), entry]));
  const afterIds = new Map(afterEntries.map((entry) => [rootPhysicalId(entry), entry]));
  const delta = { added: [], removed: [], modified: [], metadata_changed: [], replaced: [], moved: [] };
  for (const [filePath, oldEntry] of before) {
    const next = after.get(filePath);
    if (!next) {
      const moved = afterIds.get(rootPhysicalId(oldEntry));
      if (moved && moved.path !== filePath) {
        delta.moved.push({
          from: filePath, to: moved.path,
          before_sha256: oldEntry.sha256, after_sha256: moved.sha256,
          content_changed: oldEntry.sha256 !== moved.sha256,
        });
      } else delta.removed.push({ path: filePath, sha256: oldEntry.sha256 });
    } else if (rootPhysicalId(oldEntry) !== rootPhysicalId(next)) {
      delta.replaced.push({ path: filePath, before_sha256: oldEntry.sha256, after_sha256: next.sha256 });
    } else if (oldEntry.sha256 !== next.sha256) {
      delta.modified.push({ path: filePath, before_sha256: oldEntry.sha256, after_sha256: next.sha256 });
    } else if (canonical(oldEntry.identity) !== canonical(next.identity)) {
      delta.metadata_changed.push({ path: filePath, before_identity: oldEntry.identity, after_identity: next.identity });
    }
  }
  for (const [filePath, next] of after) {
    if (before.has(filePath)) continue;
    const moved = beforeIds.get(rootPhysicalId(next));
    if (!moved || moved.path === filePath) delta.added.push({ path: filePath, sha256: next.sha256 });
  }
  return delta;
}

function canonicalFilePath(path) {
  let candidate = resolve(path);
  const suffix = [];
  while (!existsSync(candidate)) {
    const parent = dirname(candidate);
    if (parent === candidate) throw new TypeError('Cannot resolve Host lifecycle journal path.');
    suffix.unshift(basename(candidate));
    candidate = parent;
  }
  return resolve(realpathSync(candidate), ...suffix);
}
function aliasesSameFile(left, right) {
  const a = canonicalFilePath(left);
  const b = canonicalFilePath(right);
  if (a === b) return true;
  if (!existsSync(a) || !existsSync(b)) return false;
  const sa = statSync(a, { bigint: true });
  const sb = statSync(b, { bigint: true });
  return sa.dev === sb.dev && sa.ino === sb.ino;
}

function validateEvent(event) {
  if (!isPlainRecord(event) || Object.keys(event).some((key) => !EVENT_KEYS.has(key))
    || !UUID.test(event.event_id ?? '')
    || !UUID.test(event.host_installation_id ?? '')
    || !UUID.test(event.authenticated_account_id ?? '')
    || !UUID.test(event.host_session_id ?? '')
    || !UUID.test(event.conversation_uuid ?? '')
    || !validText(event.authority_id)
    || !Number.isSafeInteger(event.generation) || event.generation < 1
    || !validDigest(event.snapshot_fingerprint)
    || !EVENT_TYPES.has(event.event_type)) {
    throw new TypeError('Invalid Host lifecycle event envelope.');
  }
  const versionEvent = ['VERSION_CREATED', 'VERSION_EDITED', 'VERSION_REGENERATED',
    'VERSION_SELECTED', 'VERSION_DELETED'].includes(event.event_type);
  if (versionEvent && (!UUID.test(event.message_id) || !UUID.test(event.version_id))) {
    throw new TypeError('Host version lifecycle events require stable message and version UUIDs.');
  }
  if (['VERSION_CREATED', 'VERSION_EDITED', 'VERSION_REGENERATED'].includes(event.event_type)) {
    if (!(event.parent_version_id === null || UUID.test(event.parent_version_id))
      || !validDigest(event.payload_sha256)
      || (event.active !== undefined && typeof event.active !== 'boolean')) {
      throw new TypeError('Host version creation requires immutable parent and payload digest.');
    }
  } else if (event.parent_version_id !== undefined || event.payload_sha256 !== undefined) {
    throw new TypeError('Only version creation events may declare parent and payload digest.');
  }
  if (event.event_type === 'VERSION_SELECTED' && event.active !== true) {
    throw new TypeError('VERSION_SELECTED must explicitly set active=true.');
  }
  if (event.event_type === 'VERSION_DELETED' && event.active !== undefined) {
    throw new TypeError('Deleted versions cannot be active.');
  }
  if (['IMPORT_APPLIED', 'COPY_APPLIED', 'BRANCH_CREATED', 'RESTORE_APPLIED', 'MIGRATION_APPLIED'].includes(event.event_type)
    && !validDigest(event.mutation_digest)) {
    throw new TypeError('Bulk lifecycle mutations require a digest of the resulting mutation manifest.');
  }
  if (event.mutation_digest !== undefined && !validDigest(event.mutation_digest)) {
    throw new TypeError('Invalid Host lifecycle mutation digest.');
  }
  const mutationEvent = ['MUTATION_PREPARED', 'MUTATION_COMMITTED', 'MUTATION_ABORTED'].includes(event.event_type);
  if (mutationEvent && (!UUID.test(event.mutation_id ?? '') || !validText(event.operation)
    || !MUTATION_OPERATIONS.has(event.operation)
    || !validDigest(event.mutation_digest)
    || (event.event_type === 'MUTATION_PREPARED' && (event.receipt_digest !== undefined || event.receipt_signature !== undefined))
    || (event.event_type !== 'MUTATION_PREPARED' && (!validDigest(event.receipt_digest) || !validDigest(event.receipt_signature))))) {
    throw new TypeError('Host mutation lifecycle events require mutation UUID, operation, intent digest and terminal receipt digest.');
  }
  if (!mutationEvent && (event.mutation_id !== undefined || event.operation !== undefined
    || event.receipt_digest !== undefined || event.receipt_signature !== undefined)) {
    throw new TypeError('Mutation identity and receipt fields are reserved for mutation lifecycle events.');
  }
  if (typeof event.occurred_at !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(event.occurred_at)
    || !Number.isFinite(Date.parse(event.occurred_at))) {
    throw new TypeError('Invalid Host lifecycle event timestamp.');
  }
  const normalized = {};
  for (const [key, value] of Object.entries(event)) {
    if (value !== undefined) normalized[key] = value;
  }
  normalized.occurred_at ??= new Date().toISOString();
  return Object.freeze(normalized);
}

/**
 * Append-only Host lifecycle journal prototype.
 *
 * This class stores identity and digest metadata only; it never stores raw chat
 * text. resolveIdentity is a trusted synchronous Core/Host integration seam and
 * must verify the server-authenticated installation/account binding. Caller
 * fields alone are never authority. The public root-inventory API exposes
 * only review-only baseline/observation operations; it cannot mark inventory
 * READY. Lifecycle event append remains private until operation-specific
 * authorization and mutation-receipt contracts are implemented.
 */
export class HostLifecycleJournal {
  constructor({ path, coordinatorPath, resolveIdentity, resolveRootIdentity = null, verifyMutationReceipt = () => false }) {
    if (!validText(path) || !isAbsolute(path) || path === ':memory:'
      || !validText(coordinatorPath) || !isAbsolute(coordinatorPath)
      || typeof resolveIdentity !== 'function' || isProxy(resolveIdentity)
      || Object.getPrototypeOf(resolveIdentity) === Object.getPrototypeOf(async function () {})
      || typeof verifyMutationReceipt !== 'function' || isProxy(verifyMutationReceipt)
      || Object.getPrototypeOf(verifyMutationReceipt) === Object.getPrototypeOf(async function () {})
      || (resolveRootIdentity !== null && (typeof resolveRootIdentity !== 'function'
        || isProxy(resolveRootIdentity)
        || Object.getPrototypeOf(resolveRootIdentity) === Object.getPrototypeOf(async function () {})))) {
      throw new TypeError('HostLifecycleJournal requires absolute file paths and trusted synchronous identity resolvers.');
    }
    if (aliasesSameFile(path, coordinatorPath)) throw new Error('HOST_JOURNAL_COORDINATOR_PATH_ALIAS');
    this.resolveIdentity = resolveIdentity;
    this.resolveRootIdentity = resolveRootIdentity;
    this.verifyMutationReceipt = verifyMutationReceipt;
    this.coordinator = openCoordinatorDatabase(coordinatorPath);
    this.db = null;
    let release = null;
    try {
      release = beginCoordinatorLock(this.coordinator);
      this.db = new DatabaseSync(resolve(path));
      this.db.exec(`
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=FULL;
        PRAGMA foreign_keys=ON;
        PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS host_lifecycle_heads (
          host_installation_id TEXT NOT NULL,
          authenticated_account_id TEXT NOT NULL,
          sequence INTEGER NOT NULL CHECK(sequence >= 0),
          head_sha256 TEXT NOT NULL CHECK(length(head_sha256)=64),
          PRIMARY KEY(host_installation_id, authenticated_account_id)
        );
        CREATE TABLE IF NOT EXISTS host_lifecycle_events (
          host_installation_id TEXT NOT NULL,
          authenticated_account_id TEXT NOT NULL,
          host_session_id TEXT NOT NULL,
          sequence INTEGER NOT NULL CHECK(sequence > 0),
          event_id TEXT NOT NULL,
          conversation_uuid TEXT NOT NULL,
          event_type TEXT NOT NULL,
          message_id TEXT,
          version_id TEXT,
          parent_version_id TEXT,
          payload_sha256 TEXT,
          mutation_digest TEXT,
          receipt_digest TEXT,
          occurred_at TEXT NOT NULL,
          previous_sha256 TEXT NOT NULL CHECK(length(previous_sha256)=64),
          event_sha256 TEXT NOT NULL CHECK(length(event_sha256)=64),
          canonical_event_json TEXT NOT NULL,
          PRIMARY KEY(host_installation_id, authenticated_account_id, sequence),
          UNIQUE(host_installation_id, authenticated_account_id, event_id)
        );
        CREATE INDEX IF NOT EXISTS host_lifecycle_events_conversation
          ON host_lifecycle_events(host_installation_id, authenticated_account_id, conversation_uuid, sequence);
        CREATE TRIGGER IF NOT EXISTS host_lifecycle_events_no_update
          BEFORE UPDATE ON host_lifecycle_events BEGIN
            SELECT RAISE(ABORT, 'HOST_LIFECYCLE_JOURNAL_APPEND_ONLY');
          END;
        CREATE TRIGGER IF NOT EXISTS host_lifecycle_events_no_delete
          BEFORE DELETE ON host_lifecycle_events BEGIN
            SELECT RAISE(ABORT, 'HOST_LIFECYCLE_JOURNAL_APPEND_ONLY');
          END;
        CREATE TABLE IF NOT EXISTS host_lifecycle_authority_state (
          singleton_id INTEGER PRIMARY KEY CHECK(singleton_id=1),
          authority_id TEXT NOT NULL,
          generation INTEGER NOT NULL CHECK(generation > 0)
        );
        CREATE TRIGGER IF NOT EXISTS host_lifecycle_authority_generation_no_rollback
          BEFORE UPDATE ON host_lifecycle_authority_state
          WHEN OLD.authority_id=NEW.authority_id AND NEW.generation<OLD.generation BEGIN
            SELECT RAISE(ABORT, 'HOST_LIFECYCLE_AUTHORITY_GENERATION_ROLLBACK');
          END;
        CREATE TABLE IF NOT EXISTS host_root_inventory_heads (
          host_installation_id TEXT NOT NULL,
          authenticated_account_id TEXT NOT NULL,
          root_id TEXT NOT NULL CHECK(length(root_id)=64),
          sequence INTEGER NOT NULL CHECK(sequence > 0),
          baseline_manifest_sha256 TEXT NOT NULL CHECK(length(baseline_manifest_sha256)=64),
          latest_manifest_sha256 TEXT NOT NULL CHECK(length(latest_manifest_sha256)=64),
          head_sha256 TEXT NOT NULL CHECK(length(head_sha256)=64),
          status TEXT NOT NULL CHECK(status IN ('BASELINED_REVIEW_ONLY','NON_READY')),
          PRIMARY KEY(host_installation_id,authenticated_account_id,root_id)
        );
        CREATE TABLE IF NOT EXISTS host_root_inventory_events (
          host_installation_id TEXT NOT NULL,
          authenticated_account_id TEXT NOT NULL,
          root_id TEXT NOT NULL CHECK(length(root_id)=64),
          sequence INTEGER NOT NULL CHECK(sequence > 0),
          event_id TEXT NOT NULL,
          event_type TEXT NOT NULL CHECK(event_type IN ('BASELINE','DELTA_OBSERVED','DELTA_LIMIT_EXCEEDED')),
          manifest_sha256 TEXT NOT NULL CHECK(length(manifest_sha256)=64),
          delta_sha256 TEXT,
          previous_sha256 TEXT NOT NULL CHECK(length(previous_sha256)=64),
          event_sha256 TEXT NOT NULL CHECK(length(event_sha256)=64),
          canonical_event_json TEXT NOT NULL,
          PRIMARY KEY(host_installation_id,authenticated_account_id,root_id,sequence),
          UNIQUE(host_installation_id,authenticated_account_id,event_id)
        );
        CREATE TRIGGER IF NOT EXISTS host_root_inventory_events_no_update
          BEFORE UPDATE ON host_root_inventory_events BEGIN
            SELECT RAISE(ABORT, 'HOST_ROOT_INVENTORY_APPEND_ONLY');
          END;
        CREATE TRIGGER IF NOT EXISTS host_root_inventory_events_no_delete
          BEFORE DELETE ON host_root_inventory_events BEGIN
            SELECT RAISE(ABORT, 'HOST_ROOT_INVENTORY_APPEND_ONLY');
          END;
      `);
      const lifecycleColumns = new Set(this.db.prepare('PRAGMA table_info(host_lifecycle_events)').all().map(column => column.name));
      for (const [column, definition] of [
        ['host_session_id', "TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000000'"],
        ['receipt_digest', 'TEXT'],
      ]) {
        if (!lifecycleColumns.has(column)) this.db.exec('ALTER TABLE host_lifecycle_events ADD COLUMN ' + column + ' ' + definition);
      }
    } catch (error) {
      try { this.db?.close(); } catch {}
      try { this.coordinator?.close(); } catch {}
      throw error;
    } finally {
      try { release?.(); } catch {}
    }
  }

  #withWrite(work) {
    const release = beginCoordinatorLock(this.coordinator);
    try {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const result = work();
        this.db.exec('COMMIT');
        return result;
      } catch (error) {
        try { this.db.exec('ROLLBACK'); } catch {}
        throw error;
      }
    } finally {
      release();
    }
  }

  append(input) {
    const event = validateEvent(input);
    return this.#withWrite(() => {
      let identity;
      try {
        identity = this.resolveIdentity({
          host_installation_id: event.host_installation_id,
          authenticated_account_id: event.authenticated_account_id,
          host_session_id: event.host_session_id,
          conversation_uuid: event.conversation_uuid,
        });
      } catch {
        throw new Error('HOST_LIFECYCLE_IDENTITY_NOT_AUTHORIZED');
      }
      if (!isPlainRecord(identity) || identity.authorized !== true
        || identity.host_installation_id !== event.host_installation_id
        || identity.authenticated_account_id !== event.authenticated_account_id
        || identity.host_session_id !== event.host_session_id
        || identity.conversation_uuid !== event.conversation_uuid
        || identity.authority_id !== event.authority_id
        || identity.generation !== event.generation
        || !validText(identity.adapter_id) || !validDigest(identity.root_id)) {
        throw new Error('HOST_LIFECYCLE_IDENTITY_NOT_AUTHORIZED');
      }
      const currentAuthority = this.#authoritySnapshotFingerprint(identity);
      if (!currentAuthority || currentAuthority.snapshot_fingerprint !== event.snapshot_fingerprint) {
        throw new Error('HOST_LIFECYCLE_AUTHORITY_STALE');
      }

      // Idempotency must precede state-machine validation. A lost HTTP response
      // can cause an exact retry while a later mutation is pending.
      const existing = this.db.prepare(`
        SELECT sequence,event_sha256,canonical_event_json FROM host_lifecycle_events
        WHERE host_installation_id=? AND authenticated_account_id=? AND event_id=?
      `).get(event.host_installation_id, event.authenticated_account_id, event.event_id);
      const canonicalEvent = canonical(event);
      if (existing) {
        if (existing.canonical_event_json !== canonicalEvent) {
          throw new Error('HOST_LIFECYCLE_EVENT_ID_CONFLICT');
        }
        return {
          status: 'duplicate',
          sequence: existing.sequence,
          event_sha256: existing.event_sha256,
        };
      }

      const mutationEvent = ['MUTATION_PREPARED', 'MUTATION_COMMITTED', 'MUTATION_ABORTED'].includes(event.event_type);
      if (mutationEvent) {
        const priorRows = this.db.prepare(`
          SELECT canonical_event_json FROM host_lifecycle_events
          WHERE host_installation_id=? AND authenticated_account_id=?
            AND host_session_id=? AND conversation_uuid=?
          ORDER BY sequence
        `).all(event.host_installation_id, event.authenticated_account_id,
          event.host_session_id, event.conversation_uuid);
        const prepared = new Map();
        const terminal = new Map();
        for (const row of priorRows) {
          let prior;
          try { prior = JSON.parse(row.canonical_event_json); } catch {
            throw new Error('HOST_LIFECYCLE_EVENT_STORED_JSON_INVALID');
          }
          if (prior.event_type === 'MUTATION_PREPARED') {
            if (prepared.has(prior.mutation_id) || terminal.has(prior.mutation_id)) {
              throw new Error('HOST_LIFECYCLE_STATE_MACHINE_CORRUPT');
            }
            prepared.set(prior.mutation_id, prior);
          } else if (prior.event_type === 'MUTATION_COMMITTED' || prior.event_type === 'MUTATION_ABORTED') {
            const intent = prepared.get(prior.mutation_id);
            if (!intent || intent.operation !== prior.operation
              || intent.mutation_digest !== prior.mutation_digest
              || intent.authority_id !== prior.authority_id
              || intent.generation !== prior.generation
              || intent.snapshot_fingerprint !== prior.snapshot_fingerprint
              || terminal.has(prior.mutation_id)) {
              throw new Error('HOST_LIFECYCLE_STATE_MACHINE_CORRUPT');
            }
            prepared.delete(prior.mutation_id);
            terminal.set(prior.mutation_id, prior.event_type);
          }
        }
        if (event.event_type === 'MUTATION_PREPARED') {
          if (prepared.size) throw new Error('HOST_LIFECYCLE_MUTATION_ALREADY_PENDING');
          if (terminal.has(event.mutation_id)) throw new Error('HOST_LIFECYCLE_MUTATION_TERMINAL_CONFLICT');
        } else {
          const intent = prepared.get(event.mutation_id);
          if (!intent) {
            if (terminal.has(event.mutation_id)) throw new Error('HOST_LIFECYCLE_MUTATION_TERMINAL_CONFLICT');
            throw new Error('HOST_LIFECYCLE_MUTATION_PREPARE_MISSING');
          }
          if (intent.operation !== event.operation || intent.mutation_digest !== event.mutation_digest
            || intent.authority_id !== event.authority_id || intent.generation !== event.generation
            || intent.snapshot_fingerprint !== event.snapshot_fingerprint) {
            throw new Error('HOST_LIFECYCLE_INTENT_DIGEST_MISMATCH');
          }
          let receiptVerified = false;
          try {
            receiptVerified = this.verifyMutationReceipt({
              event,
              prepared: intent,
              identity,
            }) === true;
          } catch {}
          if (!receiptVerified) throw new Error('HOST_LIFECYCLE_RECEIPT_MISMATCH');
        }
      }

      const head = this.db.prepare(`
        SELECT sequence,head_sha256 FROM host_lifecycle_heads
        WHERE host_installation_id=? AND authenticated_account_id=?
      `).get(event.host_installation_id, event.authenticated_account_id)
        ?? { sequence: 0, head_sha256: '0'.repeat(64) };
      const sequence = head.sequence + 1;
      if (!Number.isSafeInteger(sequence)) throw new Error('HOST_LIFECYCLE_SEQUENCE_EXHAUSTED');
      const eventSha = sha256(canonical({
        host_installation_id: event.host_installation_id,
        authenticated_account_id: event.authenticated_account_id,
        sequence,
        previous_sha256: head.head_sha256,
        event,
      }));
      this.db.prepare(`
        INSERT INTO host_lifecycle_events (
          host_installation_id,authenticated_account_id,host_session_id,sequence,event_id,conversation_uuid,
          event_type,message_id,version_id,parent_version_id,payload_sha256,mutation_digest,receipt_digest,
          occurred_at,previous_sha256,event_sha256,canonical_event_json
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        event.host_installation_id, event.authenticated_account_id, event.host_session_id,
        sequence, event.event_id, event.conversation_uuid, event.event_type,
        event.message_id ?? null, event.version_id ?? null, event.parent_version_id ?? null,
        event.payload_sha256 ?? null, event.mutation_digest ?? null, event.receipt_digest ?? null,
        event.occurred_at, head.head_sha256, eventSha, canonicalEvent,
      );
      this.db.prepare(`
        INSERT INTO host_lifecycle_heads(host_installation_id,authenticated_account_id,sequence,head_sha256)
        VALUES(?,?,?,?)
        ON CONFLICT(host_installation_id,authenticated_account_id)
        DO UPDATE SET sequence=excluded.sequence,head_sha256=excluded.head_sha256
      `).run(event.host_installation_id, event.authenticated_account_id, sequence, eventSha);
      return { status: 'appended', sequence, event_sha256: eventSha, previous_sha256: head.head_sha256 };
    });
  }

  getConversationStatus(hostInstallationId, authenticatedAccountId, hostSessionId, conversationUuid, authorityContext) {
    if (!UUID.test(hostInstallationId ?? '') || !UUID.test(authenticatedAccountId ?? '')
      || !UUID.test(hostSessionId ?? '') || !UUID.test(conversationUuid ?? '')
      || !isPlainRecord(authorityContext)
      || !validText(authorityContext.authority_id)
      || !Number.isSafeInteger(authorityContext.generation) || authorityContext.generation < 1
      || !validDigest(authorityContext.snapshot_fingerprint)
      || !validText(authorityContext.adapter_id) || !validDigest(authorityContext.root_id)) {
      throw new TypeError('Valid Host installation, account, session, conversation and trusted authority context are required.');
    }
    return this.#withWrite(() => {
      const identity = {
        host_installation_id: hostInstallationId,
        authenticated_account_id: authenticatedAccountId,
        host_session_id: hostSessionId,
        conversation_uuid: conversationUuid,
      };
      const authority = {
        authority_id: authorityContext.authority_id,
        generation: authorityContext.generation,
        snapshot_fingerprint: authorityContext.snapshot_fingerprint,
      };
      const integrity = this.verifyChain(hostInstallationId, authenticatedAccountId);
      if (!integrity.valid) {
        return { status: 'NON_READY', identity, authority,
          journal: { integrity: 'INVALID', ...integrity }, pending: null, reason: integrity.reason };
      }
      const currentAuthority = this.#authoritySnapshotFingerprint({
        authority_id: authorityContext.authority_id,
        generation: authorityContext.generation,
        adapter_id: authorityContext.adapter_id,
        root_id: authorityContext.root_id,
        host_installation_id: hostInstallationId,
        authenticated_account_id: authenticatedAccountId,
      });
      if (!currentAuthority || currentAuthority.snapshot_fingerprint !== authority.snapshot_fingerprint) {
        return { status: 'NON_READY', identity, authority,
          journal: { integrity: 'VALID', sequence: integrity.sequence, head_sha256: integrity.head_sha256 },
          pending: null, reason: 'HOST_LIFECYCLE_AUTHORITY_STALE' };
      }
      const rows = this.db.prepare(`
        SELECT canonical_event_json FROM host_lifecycle_events
        WHERE host_installation_id=? AND authenticated_account_id=?
          AND host_session_id=? AND conversation_uuid=?
        ORDER BY sequence
      `).all(hostInstallationId, authenticatedAccountId, hostSessionId, conversationUuid);
      const pending = new Map();
      for (const row of rows) {
        let event;
        try { event = JSON.parse(row.canonical_event_json); } catch {
          return { status: 'NON_READY', identity, authority,
            journal: { integrity: 'INVALID', ...integrity }, pending: null,
            reason: 'HOST_LIFECYCLE_EVENT_JSON_INVALID' };
        }
        if (event.authority_id !== authority.authority_id
          || event.generation !== authority.generation
          || event.snapshot_fingerprint !== authority.snapshot_fingerprint) {
          return { status: 'NON_READY', identity, authority,
            journal: { integrity: 'VALID', ...integrity }, pending: null,
            reason: 'HOST_LIFECYCLE_AUTHORITY_STALE' };
        }
        if (event.event_type === 'MUTATION_PREPARED') {
          if (pending.has(event.mutation_id)) {
            return { status: 'NON_READY', identity, authority,
              journal: { integrity: 'VALID', ...integrity }, pending: null,
              reason: 'HOST_LIFECYCLE_DUPLICATE_PENDING_MUTATION' };
          }
          pending.set(event.mutation_id, {
            mutation_id: event.mutation_id,
            operation: event.operation,
            mutation_digest: event.mutation_digest,
            authority_id: event.authority_id,
            generation: event.generation,
            snapshot_fingerprint: event.snapshot_fingerprint,
            prepared_event_id: event.event_id,
            occurred_at: event.occurred_at,
          });
        } else if (event.event_type === 'MUTATION_COMMITTED' || event.event_type === 'MUTATION_ABORTED') {
          const prior = pending.get(event.mutation_id);
          if (!prior || prior.operation !== event.operation
            || prior.mutation_digest !== event.mutation_digest
            || prior.authority_id !== event.authority_id
            || prior.generation !== event.generation
            || prior.snapshot_fingerprint !== event.snapshot_fingerprint) {
            return { status: 'NON_READY', identity, authority,
              journal: { integrity: 'VALID', ...integrity }, pending: null,
              reason: 'HOST_LIFECYCLE_MUTATION_TERMINAL_WITHOUT_PREPARE' };
          }
          pending.delete(event.mutation_id);
        }
      }
      if (pending.size > 1) {
        return { status: 'NON_READY', identity, authority,
          journal: { integrity: 'VALID', ...integrity }, pending: null,
          reason: 'HOST_LIFECYCLE_MULTIPLE_PENDING_MUTATIONS' };
      }
      const unresolved = pending.values().next().value ?? null;
      return {
        status: unresolved ? 'PENDING_MUTATION' : 'NO_PENDING_MUTATION',
        identity,
        authority,
        journal: { integrity: 'VALID', sequence: integrity.sequence, head_sha256: integrity.head_sha256 },
        pending: unresolved,
        reason: null,
      };
    });
  }

  setAuthorityGeneration(authorityId, generation) {
    if (!validText(authorityId) || !Number.isSafeInteger(generation) || generation < 1) {
      throw new TypeError('A stable Host authority ID and positive generation are required.');
    }
    return this.#withWrite(() => {
      const current = this.db.prepare(`
        SELECT authority_id,generation FROM host_lifecycle_authority_state WHERE singleton_id=1
      `).get();
      if (!current) {
        this.db.prepare(`
          INSERT INTO host_lifecycle_authority_state(singleton_id,authority_id,generation)
          VALUES(1,?,?)
        `).run(authorityId, generation);
        return { status: 'INITIALIZED', authority_id: authorityId, generation };
      }
      if (current.authority_id === authorityId && generation < current.generation) {
        throw new Error('HOST_LIFECYCLE_AUTHORITY_GENERATION_ROLLBACK');
      }
      if (current.authority_id === authorityId && generation === current.generation) {
        return { status: 'UNCHANGED', authority_id: authorityId, generation };
      }
      this.db.prepare(`
        UPDATE host_lifecycle_authority_state SET authority_id=?,generation=? WHERE singleton_id=1
      `).run(authorityId, generation);
      return { status: current.authority_id === authorityId ? 'ADVANCED' : 'ROTATED',
        authority_id: authorityId, generation };
    });
  }

  getHead(hostInstallationId, authenticatedAccountId) {
    if (!validText(hostInstallationId) || !validText(authenticatedAccountId)) {
      throw new TypeError('Valid Host installation and authenticated account identities are required.');
    }
    return this.db.prepare(`
      SELECT sequence,head_sha256 FROM host_lifecycle_heads
      WHERE host_installation_id=? AND authenticated_account_id=?
    `).get(hostInstallationId, authenticatedAccountId)
      ?? Object.freeze({ sequence: 0, head_sha256: '0'.repeat(64) });
  }

  verifyChain(hostInstallationId, authenticatedAccountId) {
    if (!validText(hostInstallationId) || !validText(authenticatedAccountId)) {
      throw new TypeError('Valid Host installation and authenticated account identities are required.');
    }
    const events = this.db.prepare(`
      SELECT sequence,event_id,conversation_uuid,event_type,message_id,version_id,parent_version_id,
        payload_sha256,mutation_digest,occurred_at,previous_sha256,event_sha256,canonical_event_json
      FROM host_lifecycle_events
      WHERE host_installation_id=? AND authenticated_account_id=?
      ORDER BY sequence
    `).all(hostInstallationId, authenticatedAccountId);
    let previous = '0'.repeat(64);
    let sequence = 0;
    for (const row of events) {
      sequence += 1;
      if (row.sequence !== sequence || row.previous_sha256 !== previous) {
        return { valid: false, reason: 'HOST_LIFECYCLE_SEQUENCE_OR_PREVIOUS_HASH_MISMATCH', verified_events: sequence - 1 };
      }
      let parsed;
      try { parsed = JSON.parse(row.canonical_event_json); } catch {
        return { valid: false, reason: 'HOST_LIFECYCLE_EVENT_JSON_INVALID', verified_events: sequence - 1 };
      }
      if (canonical(parsed) !== row.canonical_event_json) {
        return { valid: false, reason: 'HOST_LIFECYCLE_EVENT_CANONICALIZATION_MISMATCH', verified_events: sequence - 1 };
      }
      const expected = sha256(canonical({
        host_installation_id: hostInstallationId,
        authenticated_account_id: authenticatedAccountId,
        sequence,
        previous_sha256: previous,
        event: parsed,
      }));
      if (expected !== row.event_sha256) {
        return { valid: false, reason: 'HOST_LIFECYCLE_HASH_MISMATCH', verified_events: sequence - 1 };
      }
      previous = expected;
    }
    const head = this.getHead(hostInstallationId, authenticatedAccountId);
    if (head.sequence !== sequence || head.head_sha256 !== previous) {
      return { valid: false, reason: 'HOST_LIFECYCLE_HEAD_MISMATCH', verified_events: sequence };
    }
    return { valid: true, sequence, head_sha256: previous, verified_events: sequence };
  }

  #assertRootIdentity({ host_installation_id, authenticated_account_id, root_id }) {
    if (typeof this.resolveRootIdentity !== 'function') {
      throw new Error('HOST_ROOT_INVENTORY_IDENTITY_RESOLVER_UNAVAILABLE');
    }
    let identity;
    try {
      identity = this.resolveRootIdentity({ host_installation_id, authenticated_account_id, root_id });
    } catch {
      throw new Error('HOST_ROOT_INVENTORY_IDENTITY_NOT_AUTHORIZED');
    }
    if (!isPlainRecord(identity) || identity.authorized !== true
      || identity.host_installation_id !== host_installation_id
      || identity.authenticated_account_id !== authenticated_account_id
      || identity.root_id !== root_id) {
      throw new Error('HOST_ROOT_INVENTORY_IDENTITY_NOT_AUTHORIZED');
    }
  }

  #verifyRootInventoryRows(hostInstallationId, accountId, rootId, rows) {
    let previous = '0'.repeat(64);
    let baselineManifestSha256 = null;
    let previousEntries = null;
    let latestManifestSha256 = null;
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      if (row.sequence !== index + 1 || row.previous_sha256 !== previous) {
        return { valid: false, reason: 'HOST_ROOT_INVENTORY_SEQUENCE_OR_PREVIOUS_HASH_MISMATCH' };
      }
      let event;
      try { event = JSON.parse(row.canonical_event_json); } catch {
        return { valid: false, reason: 'HOST_ROOT_INVENTORY_EVENT_JSON_INVALID' };
      }
      if (canonical(event) !== row.canonical_event_json
        || event.event_id !== row.event_id || event.event_type !== row.event_type
        || event.root_id !== rootId || !Array.isArray(event.entries)) {
        return { valid: false, reason: 'HOST_ROOT_INVENTORY_EVENT_CANONICALIZATION_MISMATCH' };
      }
      let entries;
      try { entries = validateRootEntries(event.entries); } catch {
        return { valid: false, reason: 'HOST_ROOT_INVENTORY_MANIFEST_INVALID' };
      }
      const manifestSha256 = sha256(canonical(entries));
      if (manifestSha256 !== row.manifest_sha256 || manifestSha256 !== event.manifest_sha256) {
        return { valid: false, reason: 'HOST_ROOT_INVENTORY_MANIFEST_DIGEST_MISMATCH' };
      }
      if (row.event_type === 'BASELINE') {
        if (index !== 0 || baselineManifestSha256 !== null || row.delta_sha256 !== null
          || event.delta !== null || event.delta_sha256 !== null) {
          return { valid: false, reason: 'HOST_ROOT_INVENTORY_BASELINE_LAYOUT_INVALID' };
        }
        baselineManifestSha256 = manifestSha256;
        previousEntries = entries;
      } else if (row.event_type === 'DELTA_OBSERVED' || row.event_type === 'DELTA_LIMIT_EXCEEDED') {
        if (index === 0 || !validDigest(row.delta_sha256)
          || event.delta_sha256 !== row.delta_sha256) {
          return { valid: false, reason: 'HOST_ROOT_INVENTORY_DELTA_DIGEST_MISMATCH' };
        }
        const expectedDelta = rootInventoryDelta(previousEntries, entries);
        const expectedDeltaSha256 = sha256(canonical(expectedDelta));
        const changed = Object.values(expectedDelta).reduce((sum, items) => sum + items.length, 0);
        if (expectedDeltaSha256 !== row.delta_sha256
          || (row.event_type === 'DELTA_OBSERVED'
            ? (event.delta === null || canonical(event.delta) !== canonical(expectedDelta)
              || changed > MAX_ROOT_DELTA_FILES)
            : (event.delta !== null || changed <= MAX_ROOT_DELTA_FILES))) {
          return { valid: false, reason: 'HOST_ROOT_INVENTORY_DELTA_CONTENT_MISMATCH' };
        }
      } else return { valid: false, reason: 'HOST_ROOT_INVENTORY_EVENT_TYPE_INVALID' };
      const expected = sha256(canonical({
        host_installation_id: hostInstallationId,
        authenticated_account_id: accountId,
        root_id: rootId,
        sequence: row.sequence,
        previous_sha256: previous,
        event,
      }));
      if (expected !== row.event_sha256) return { valid: false, reason: 'HOST_ROOT_INVENTORY_HASH_MISMATCH' };
      previous = expected;
      previousEntries = entries;
      latestManifestSha256 = manifestSha256;
    }
    const head = this.db.prepare(`
      SELECT sequence,baseline_manifest_sha256,latest_manifest_sha256,head_sha256,status
      FROM host_root_inventory_heads
      WHERE host_installation_id=? AND authenticated_account_id=? AND root_id=?
    `).get(hostInstallationId, accountId, rootId);
    if (!rows.length || !head || head.sequence !== rows.length || head.head_sha256 !== previous
      || head.baseline_manifest_sha256 !== baselineManifestSha256
      || head.latest_manifest_sha256 !== latestManifestSha256
      || head.status !== (rows.length === 1 ? 'BASELINED_REVIEW_ONLY' : 'NON_READY')) {
      return { valid: false, reason: 'HOST_ROOT_INVENTORY_HEAD_MISMATCH' };
    }
    return { valid: true, sequence: rows.length, head_sha256: previous,
      baseline_manifest_sha256: baselineManifestSha256, latest_manifest_sha256: latestManifestSha256,
      status: head.status };
  }

  #authoritySnapshotFingerprint(identity) {
    if (!isPlainRecord(identity) || !validText(identity.authority_id)
      || !Number.isSafeInteger(identity.generation) || identity.generation < 1
      || !validText(identity.adapter_id) || !validText(identity.host_installation_id)
      || !validText(identity.authenticated_account_id) || !validDigest(identity.root_id)) return null;
    const rows = this.db.prepare(`
      SELECT event_id,event_type,manifest_sha256,delta_sha256,sequence,event_sha256,
        previous_sha256,canonical_event_json
      FROM host_root_inventory_events
      WHERE host_installation_id=? AND authenticated_account_id=? AND root_id=?
      ORDER BY sequence
    `).all(identity.host_installation_id, identity.authenticated_account_id, identity.root_id);
    const root = this.#verifyRootInventoryRows(identity.host_installation_id,
      identity.authenticated_account_id, identity.root_id, rows);
    if (!root.valid || root.status !== 'BASELINED_REVIEW_ONLY') return null;
    const snapshot = {
      authority_id: identity.authority_id,
      generation: identity.generation,
      adapter_id: identity.adapter_id,
      host_installation_id: identity.host_installation_id,
      authenticated_account_id: identity.authenticated_account_id,
      root_id: identity.root_id,
      root_inventory_sequence: root.sequence,
      root_manifest_sha256: root.latest_manifest_sha256,
      root_journal_head_sha256: root.head_sha256,
    };
    return {
      sequence: root.sequence,
      manifest_sha256: root.latest_manifest_sha256,
      journal_head_sha256: root.head_sha256,
      snapshot_fingerprint: sha256(canonical(snapshot)),
    };
  }

  #appendRootInventoryEvent({ host_installation_id, authenticated_account_id, root_id,
    event_id, event_type, entries, manifest_sha256, delta = null, delta_sha256 = null }) {
    const existing = this.db.prepare(`
      SELECT root_id,event_id,event_type,manifest_sha256,delta_sha256,sequence,event_sha256
      FROM host_root_inventory_events
      WHERE host_installation_id=? AND authenticated_account_id=? AND event_id=?
    `).get(host_installation_id, authenticated_account_id, event_id);
    if (existing) {
      if (existing.root_id !== root_id || existing.event_type !== event_type || existing.manifest_sha256 !== manifest_sha256
        || existing.delta_sha256 !== delta_sha256) throw new Error('HOST_ROOT_INVENTORY_EVENT_ID_CONFLICT');
      return { status: 'duplicate', sequence: existing.sequence, event_sha256: existing.event_sha256 };
    }
    const head = this.db.prepare(`
      SELECT sequence,head_sha256,baseline_manifest_sha256
      FROM host_root_inventory_heads
      WHERE host_installation_id=? AND authenticated_account_id=? AND root_id=?
    `).get(host_installation_id, authenticated_account_id, root_id);
    if (event_type === 'BASELINE' ? Boolean(head) : !head) {
      throw new Error(event_type === 'BASELINE'
        ? 'HOST_ROOT_INVENTORY_ALREADY_ENROLLED' : 'HOST_ROOT_INVENTORY_BASELINE_MISSING');
    }
    const sequence = (head?.sequence ?? 0) + 1;
    const previous_sha256 = head?.head_sha256 ?? '0'.repeat(64);
    const event = { event_id, event_type, root_id, manifest_sha256, entries, delta, delta_sha256 };
    if (Buffer.byteLength(canonical(event), 'utf8') > MAX_ROOT_INVENTORY_BYTES) {
      throw new Error('HOST_ROOT_INVENTORY_BYTE_LIMIT');
    }
    const eventSha = sha256(canonical({
      host_installation_id, authenticated_account_id, root_id, sequence, previous_sha256, event,
    }));
    this.db.prepare(`
      INSERT INTO host_root_inventory_events (
        host_installation_id,authenticated_account_id,root_id,sequence,event_id,event_type,
        manifest_sha256,delta_sha256,previous_sha256,event_sha256,canonical_event_json
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
    `).run(host_installation_id, authenticated_account_id, root_id, sequence, event_id,
      event_type, manifest_sha256, delta_sha256, previous_sha256, eventSha, canonical(event));
    this.db.prepare(`
      INSERT INTO host_root_inventory_heads (
        host_installation_id,authenticated_account_id,root_id,sequence,
        baseline_manifest_sha256,latest_manifest_sha256,head_sha256,status
      ) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(host_installation_id,authenticated_account_id,root_id)
      DO UPDATE SET sequence=excluded.sequence,latest_manifest_sha256=excluded.latest_manifest_sha256,
        head_sha256=excluded.head_sha256,status=excluded.status
    `).run(host_installation_id, authenticated_account_id, root_id, sequence,
      head?.baseline_manifest_sha256 ?? manifest_sha256, manifest_sha256, eventSha,
      event_type === 'BASELINE' ? 'BASELINED_REVIEW_ONLY' : 'NON_READY');
    return { status: event_type === 'BASELINE' ? 'BASELINED_REVIEW_ONLY' : 'NON_READY',
      sequence, manifest_sha256: manifest_sha256,
      ...(delta ? { delta } : {}),
      ...(delta_sha256 ? { delta_sha256 } : {}), event_sha256: eventSha };
  }

  enrollRootInventory(input) {
    if (!isPlainRecord(input) || !validText(input.host_installation_id)
      || !validText(input.authenticated_account_id) || !validDigest(input.root_id)
      || !validText(input.event_id) || !Array.isArray(input.entries)) {
      throw new TypeError('Invalid Host root inventory baseline envelope.');
    }
    const entries = validateRootEntries(input.entries);
    const manifestSha256 = sha256(canonical(entries));
    return this.#withWrite(() => {
      this.#assertRootIdentity(input);
      return this.#appendRootInventoryEvent({ ...input, event_type: 'BASELINE',
        entries, manifest_sha256: manifestSha256 });
    });
  }

  observeRootInventory(input) {
    if (!isPlainRecord(input) || !validText(input.host_installation_id)
      || !validText(input.authenticated_account_id) || !validDigest(input.root_id)
      || !validText(input.event_id) || !Array.isArray(input.entries)) {
      throw new TypeError('Invalid Host root inventory observation envelope.');
    }
    const entries = validateRootEntries(input.entries);
    const manifestSha256 = sha256(canonical(entries));
    return this.#withWrite(() => {
      this.#assertRootIdentity(input);
      const rows = this.db.prepare(`
        SELECT event_id,event_type,manifest_sha256,delta_sha256,sequence,event_sha256,
          previous_sha256,canonical_event_json
        FROM host_root_inventory_events
        WHERE host_installation_id=? AND authenticated_account_id=? AND root_id=?
        ORDER BY sequence
      `).all(input.host_installation_id, input.authenticated_account_id, input.root_id);
      const integrity = this.#verifyRootInventoryRows(input.host_installation_id,
        input.authenticated_account_id, input.root_id, rows);
      if (!integrity.valid) throw new Error(integrity.reason);
      const reusedEventId = rows.find((row) => row.event_id === input.event_id);
      if (reusedEventId && (!['DELTA_OBSERVED', 'DELTA_LIMIT_EXCEEDED'].includes(reusedEventId.event_type)
        || reusedEventId.manifest_sha256 !== manifestSha256)) {
        throw new Error('HOST_ROOT_INVENTORY_EVENT_ID_CONFLICT');
      }
      const latest = JSON.parse(rows.at(-1).canonical_event_json);
      if (manifestSha256 === integrity.latest_manifest_sha256) {
        if (rows.length > 1) return { status: 'NON_READY',
          reason: 'previously observed root inventory delta remains unresolved',
          sequence: integrity.sequence, manifest_sha256: manifestSha256 };
        return { status: 'UNCHANGED_REVIEW_ONLY', sequence: integrity.sequence,
          manifest_sha256: manifestSha256 };
      }
      const restoringBaseline = manifestSha256 === integrity.baseline_manifest_sha256 && rows.length > 1;
      const delta = rootInventoryDelta(latest.entries, entries);
      const changed = Object.values(delta).reduce((sum, items) => sum + items.length, 0);
      const deltaSha256 = sha256(canonical(delta));
      if (changed > MAX_ROOT_DELTA_FILES) {
        if (reusedEventId) {
          if (reusedEventId.event_type !== 'DELTA_LIMIT_EXCEEDED' || reusedEventId.delta_sha256 !== deltaSha256) {
            throw new Error('HOST_ROOT_INVENTORY_EVENT_ID_CONFLICT');
          }
          return { status: 'NON_READY', duplicate: true, sequence: reusedEventId.sequence,
            manifest_sha256: manifestSha256, reason: 'HOST_ROOT_INVENTORY_DELTA_LIMIT',
            delta_sha256: deltaSha256 };
        }
        const existingLimit = rows.find((row) => row.event_type === 'DELTA_LIMIT_EXCEEDED'
          && row.manifest_sha256 === manifestSha256 && row.delta_sha256 === deltaSha256);
        if (existingLimit) return { status: 'NON_READY', duplicate: true,
          sequence: existingLimit.sequence, manifest_sha256: manifestSha256,
          reason: 'HOST_ROOT_INVENTORY_DELTA_LIMIT', delta_sha256: deltaSha256 };
        const recorded = this.#appendRootInventoryEvent({ ...input, event_type: 'DELTA_LIMIT_EXCEEDED',
          entries, manifest_sha256: manifestSha256, delta: null, delta_sha256: deltaSha256 });
        return { ...recorded, reason: 'HOST_ROOT_INVENTORY_DELTA_LIMIT',
          changed_files: changed, maximum_changed_files: MAX_ROOT_DELTA_FILES };
      }
      if (reusedEventId) {
        if (reusedEventId.event_type !== 'DELTA_OBSERVED' || reusedEventId.delta_sha256 !== deltaSha256) {
          throw new Error('HOST_ROOT_INVENTORY_EVENT_ID_CONFLICT');
        }
        return { status: 'NON_READY', duplicate: true, sequence: reusedEventId.sequence,
          manifest_sha256: manifestSha256, delta_sha256: deltaSha256, delta };
      }
      const existing = rows.find((row) => row.event_type === 'DELTA_OBSERVED'
        && row.manifest_sha256 === manifestSha256 && row.delta_sha256 === deltaSha256);
      if (existing) return { status: 'NON_READY', duplicate: true,
        sequence: existing.sequence, manifest_sha256: manifestSha256,
        delta_sha256: deltaSha256, delta };
      const recorded = this.#appendRootInventoryEvent({ ...input, event_type: 'DELTA_OBSERVED',
        entries, manifest_sha256: manifestSha256, delta, delta_sha256: deltaSha256 });
      return { ...recorded, delta, ...(restoringBaseline ? {
        reason: 'previously observed root inventory delta remains unresolved',
      } : {}) };
    });
  }

  getAuthoritySnapshot(input) {
    if (!isPlainRecord(input) || !validText(input.authority_id)
      || !Number.isSafeInteger(input.generation) || input.generation < 1
      || !validText(input.adapter_id) || !validText(input.host_installation_id)
      || !validText(input.authenticated_account_id) || !validDigest(input.root_id)) {
      throw new TypeError('Invalid Host lifecycle authority snapshot request.');
    }
    return this.#withWrite(() => {
      this.#assertRootIdentity(input);
      const snapshot = this.#authoritySnapshotFingerprint(input);
      return snapshot ? { status: 'INTEGRITY_OK', ...snapshot }
        : { status: 'NON_READY', reason: 'HOST_LIFECYCLE_AUTHORITY_ROOT_HEAD_UNAVAILABLE' };
    });
  }

  verifyRootInventory({ host_installation_id, authenticated_account_id, root_id }) {
    if (!validText(host_installation_id) || !validText(authenticated_account_id)
      || !validDigest(root_id)) throw new TypeError('Invalid Host root inventory identity.');
    return this.#withWrite(() => {
      this.#assertRootIdentity({ host_installation_id, authenticated_account_id, root_id });
      const rows = this.db.prepare(`
        SELECT event_id,event_type,manifest_sha256,delta_sha256,sequence,event_sha256,
          previous_sha256,canonical_event_json
        FROM host_root_inventory_events
        WHERE host_installation_id=? AND authenticated_account_id=? AND root_id=?
        ORDER BY sequence
      `).all(host_installation_id, authenticated_account_id, root_id);
      const result = this.#verifyRootInventoryRows(host_installation_id, authenticated_account_id, root_id, rows);
      return result.valid ? { ...result, status: 'INTEGRITY_OK' }
        : { status: 'NON_READY', reason: result.reason };
    });
  }

  close() {
    try { this.db?.close(); } finally { this.coordinator?.close(); }
  }
}
