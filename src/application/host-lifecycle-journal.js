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
]);
const EVENT_KEYS = new Set([
  'event_id', 'host_installation_id', 'authenticated_account_id', 'conversation_uuid',
  'event_type', 'message_id', 'version_id', 'parent_version_id', 'payload_sha256',
  'active', 'mutation_digest', 'occurred_at',
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
    || !validText(event.event_id, 200)
    || !validText(event.host_installation_id, 200)
    || !validText(event.authenticated_account_id, 200)
    || !UUID.test(event.conversation_uuid)
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
  if (event.occurred_at !== undefined && (typeof event.occurred_at !== 'string' || !Number.isFinite(Date.parse(event.occurred_at)))) {
    throw new TypeError('Invalid Host lifecycle event timestamp.');
  }
  return Object.freeze({ ...event, occurred_at: event.occurred_at ?? new Date().toISOString() });
}

/**
 * Append-only Host lifecycle journal prototype.
 *
 * This class stores identity and digest metadata only; it never stores raw chat
 * text. resolveIdentity is a trusted synchronous Core/Host integration seam and
 * must verify the server-authenticated installation/account binding. Caller
 * fields alone are never authority. This prototype is not wired to a public
 * route and cannot mark an inventory READY.
 */
export class HostLifecycleJournal {
  constructor({ path, coordinatorPath, resolveIdentity }) {
    if (!validText(path) || !isAbsolute(path) || path === ':memory:'
      || !validText(coordinatorPath) || !isAbsolute(coordinatorPath)
      || typeof resolveIdentity !== 'function' || isProxy(resolveIdentity)
      || Object.getPrototypeOf(resolveIdentity) === Object.getPrototypeOf(async function () {})) {
      throw new TypeError('HostLifecycleJournal requires absolute file paths and a trusted synchronous identity resolver.');
    }
    if (aliasesSameFile(path, coordinatorPath)) throw new Error('HOST_JOURNAL_COORDINATOR_PATH_ALIAS');
    this.resolveIdentity = resolveIdentity;
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
          sequence INTEGER NOT NULL CHECK(sequence > 0),
          event_id TEXT NOT NULL,
          conversation_uuid TEXT NOT NULL,
          event_type TEXT NOT NULL,
          message_id TEXT,
          version_id TEXT,
          parent_version_id TEXT,
          payload_sha256 TEXT,
          mutation_digest TEXT,
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
      `);
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
          conversation_uuid: event.conversation_uuid,
        });
      } catch {
        throw new Error('HOST_LIFECYCLE_IDENTITY_NOT_AUTHORIZED');
      }
      if (!isPlainRecord(identity) || identity.authorized !== true
        || identity.host_installation_id !== event.host_installation_id
        || identity.authenticated_account_id !== event.authenticated_account_id
        || identity.conversation_uuid !== event.conversation_uuid) {
        throw new Error('HOST_LIFECYCLE_IDENTITY_NOT_AUTHORIZED');
      }

      const canonicalEvent = canonical(event);
      const { occurred_at: _occurredAt, ...eventContent } = event;
      const eventDigest = sha256(canonical(eventContent));
      const existing = this.db.prepare(`
        SELECT sequence,event_sha256 FROM host_lifecycle_events
        WHERE host_installation_id=? AND authenticated_account_id=? AND event_id=?
      `).get(event.host_installation_id, event.authenticated_account_id, event.event_id);
      if (existing) {
        if (existing.event_sha256 !== eventDigest) throw new Error('HOST_LIFECYCLE_EVENT_ID_CONFLICT');
        return { status: 'duplicate', sequence: existing.sequence, event_sha256: existing.event_sha256 };
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
          host_installation_id,authenticated_account_id,sequence,event_id,conversation_uuid,
          event_type,message_id,version_id,parent_version_id,payload_sha256,mutation_digest,
          occurred_at,previous_sha256,event_sha256,canonical_event_json
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        event.host_installation_id, event.authenticated_account_id, sequence, event.event_id,
        event.conversation_uuid, event.event_type, event.message_id ?? null, event.version_id ?? null,
        event.parent_version_id ?? null, event.payload_sha256 ?? null, event.mutation_digest ?? null,
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

  close() {
    try { this.db?.close(); } finally { this.coordinator?.close(); }
  }
}
