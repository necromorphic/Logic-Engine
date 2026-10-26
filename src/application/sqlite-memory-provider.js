import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { isProxy } from 'node:util/types';
import { createHash } from 'node:crypto';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { beginCoordinatorLock, openCoordinatorDatabase } from '../storage/coordinator-lock.js';

const canonicalFilePath = (path) => {
  let candidate = resolve(path);
  const suffix = [];
  // Resolve symlinked ancestors even when the final database file does not
  // exist yet. DatabaseSync may create the file, so checking only realpath(file)
  // misses aliases through a symlinked parent directory.
  while (!existsSync(candidate)) {
    const parent = dirname(candidate);
    if (parent === candidate) break;
    suffix.unshift(basename(candidate));
    candidate = parent;
  }
  return resolve(realpathSync(candidate), ...suffix);
};
const aliasesSameFile = (left, right) => {
  const canonicalLeft = canonicalFilePath(left);
  const canonicalRight = canonicalFilePath(right);
  if (canonicalLeft === canonicalRight) return true;
  if (!existsSync(canonicalLeft) || !existsSync(canonicalRight)) return false;
  const leftStat = statSync(canonicalLeft);
  const rightStat = statSync(canonicalRight);
  return leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino;
};
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const intrinsicObjectPrototypeKeys = new Set([
  'constructor', '__defineGetter__', '__defineSetter__', 'hasOwnProperty', '__lookupGetter__',
  '__lookupSetter__', 'isPrototypeOf', 'propertyIsEnumerable', 'toString', 'valueOf',
  '__proto__', 'toLocaleString',
]);
const hasSafeObjectPrototype = () => {
  try {
    const keys = Reflect.ownKeys(Object.prototype);
    if (keys.length !== intrinsicObjectPrototypeKeys.size) return false;
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (typeof key !== 'string' || !intrinsicObjectPrototypeKeys.has(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, key);
      if (!descriptor) return false;
      if (key === '__proto__') {
        if (!Object.hasOwn(descriptor, 'get') || !Object.hasOwn(descriptor, 'set')) return false;
      } else if (!Object.hasOwn(descriptor, 'value')) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
};
const isPlainDataRecord = (value) => {
  if (!object(value) || isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype === Object.prototype && !hasSafeObjectPrototype()) return false;
  if (prototype !== Object.prototype && prototype !== null) return false;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return false;
  }
  return true;
};
const isPlainDataArray = (value) => {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes('length')) return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return false;
  }
  return true;
};
const copyDataRecord = (value) => Object.fromEntries(
  Reflect.ownKeys(value).map((key) => [key, Object.getOwnPropertyDescriptor(value, key).value]),
);
const snapshotProviderRecord = (value) => {
  if (!isPlainDataRecord(value)) return null;
  const snapshot = copyDataRecord(value);
  if (!isPlainDataArray(snapshot.lineage) || snapshot.lineage.length !== 1
    || !isPlainDataRecord(snapshot.lineage[0])) return null;
  snapshot.lineage = [copyDataRecord(snapshot.lineage[0])];
  return snapshot;
};
const validId = (value) => typeof value === 'string' && value === value.trim()
  && value.length > 0 && value.length <= 200
  && ![...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
const snapshotOf = (value) => object(value)
  && (typeof value.world_revision === 'number' || (typeof value.world_revision === 'string' && value.world_revision.length > 0))
  && (typeof value.commit_sequence === 'number' || (typeof value.commit_sequence === 'string' && value.commit_sequence.length > 0))
  ? { world_revision: value.world_revision, commit_sequence: value.commit_sequence } : null;
const sameSnapshot = (a, b) => !!snapshotOf(a) && !!snapshotOf(b)
  && a.world_revision === b.world_revision && a.commit_sequence === b.commit_sequence;
const decode = (value) => JSON.parse(value);
const encode = (value) => JSON.stringify(value);
const rawDigest = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

const validDirectLineage = (row, lineage) => row.source_kind === 'canonical_entity'
  && validId(row.source_entity_id)
  && validId(row.source_version)
  && Array.isArray(lineage)
  && lineage.length === 1
  && object(lineage[0])
  && lineage[0].source_kind === 'canonical_entity'
  && lineage[0].entity_id === row.source_entity_id
  && lineage[0].source_version === row.source_version;

/**
 * Durable provider adapter for the direct canonical-entity first slice.
 *
 * This database is provider-owned and must not be the Core canonical database.
 * getSnapshot and validateSourceVersion are trusted host integrations, not
 * caller-supplied request fields. No safe default exists for either callback.
 *
 * Raw record persistence and derived index persistence are separate steps:
 * if index construction fails, the raw record remains durable and the provider
 * refuses retrieval until rebuild + reconciliation complete.
 */
export class SQLiteMemoryProvider {
  constructor(options = {}) {
    if (!isPlainDataRecord(options)) throw new TypeError('SQLiteMemoryProvider requires plain data options');
    const {
      path = ':memory:',
      coordinatorPath = process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH ?? null,
      getSnapshot,
      validateSourceVersion,
      validateInventory,
      authorizeRawRead = null,
    } = options;
    if (typeof getSnapshot !== 'function') throw new TypeError('SQLiteMemoryProvider requires trusted getSnapshot');
    if (typeof validateSourceVersion !== 'function') {
      throw new TypeError('SQLiteMemoryProvider requires trusted validateSourceVersion');
    }
    this.getSnapshot = getSnapshot;
    this.validateSourceVersion = validateSourceVersion;
    if (typeof validateInventory !== 'function') {
      throw new TypeError('SQLiteMemoryProvider requires trusted validateInventory');
    }
    this.validateInventory = validateInventory;
    this.authorizeRawRead = typeof authorizeRawRead === 'function' ? authorizeRawRead : null;
    // In-memory instances are deliberately isolated test stores and do not
    // join a process-global coordinator merely because the test runner set one.
    const sharedCoordinatorPath = path === ':memory:' ? null : coordinatorPath;
    if (path !== ':memory:' && (typeof sharedCoordinatorPath !== 'string' || !sharedCoordinatorPath.trim())) {
      throw new TypeError('File-backed Memory Provider requires the shared LOGIC_ENGINE_COORDINATOR_DB_PATH');
    }
    if (sharedCoordinatorPath && !isAbsolute(sharedCoordinatorPath)) {
      throw new TypeError('Memory Provider coordinator path must be absolute and shared with Core');
    }
    if (path !== ':memory:' && sharedCoordinatorPath && aliasesSameFile(path, sharedCoordinatorPath)) {
      throw new Error('Coordinator DB must be separate from the Memory Provider DB, including filesystem aliases.');
    }
    this.reconcileGeneration = new Map();
    this.transactionDepth = 0;
    this.coordinatorDepth = 0;
    this.stateGeneration = new Map();
    this.queryAuthorizationGeneration = new Map();
    this.recordAuthorizationGeneration = new Map();
    // Open the coordinator first so a failed coordinator open cannot leak a Provider DB handle.
    this.coordinatorDb = sharedCoordinatorPath ? openCoordinatorDatabase(sharedCoordinatorPath) : null;
    this.db = null;
    let releaseStartupLock = () => {};
    let startupError = null;
    try {
      releaseStartupLock = this.#acquireCoordinatorLock();
      this.db = new DatabaseSync(path);
      this.db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS memory_records (
        world_id TEXT NOT NULL, subject_id TEXT NOT NULL, purpose TEXT NOT NULL,
        record_ref TEXT NOT NULL, record_version TEXT NOT NULL,
        source_kind TEXT NOT NULL, source_entity_id TEXT NOT NULL, source_version TEXT NOT NULL,
        content_kind TEXT NOT NULL, epistemic_kind TEXT NOT NULL, producer_kind TEXT NOT NULL,
        content_disposition TEXT NOT NULL, evidence_assessment TEXT NOT NULL,
        lineage_json TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY(world_id, record_ref, record_version)
      );
      CREATE TABLE IF NOT EXISTS memory_index_entries (
        world_id TEXT NOT NULL, record_ref TEXT NOT NULL, record_version TEXT NOT NULL,
        indexed_at TEXT NOT NULL,
        PRIMARY KEY(world_id, record_ref, record_version),
        FOREIGN KEY(world_id, record_ref, record_version)
          REFERENCES memory_records(world_id, record_ref, record_version) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS memory_query_grants (
        world_id TEXT NOT NULL, subject_id TEXT NOT NULL, purpose TEXT NOT NULL,
        allowed INTEGER NOT NULL CHECK(allowed IN (0,1)),
        PRIMARY KEY(world_id, subject_id, purpose)
      );
      CREATE TABLE IF NOT EXISTS memory_record_grants (
        world_id TEXT NOT NULL, subject_id TEXT NOT NULL, purpose TEXT NOT NULL,
        record_ref TEXT NOT NULL, record_version TEXT NOT NULL,
        allowed INTEGER NOT NULL CHECK(allowed IN (0,1)),
        PRIMARY KEY(world_id, subject_id, purpose, record_ref, record_version)
      );
      CREATE TABLE IF NOT EXISTS memory_index_state (
        world_id TEXT PRIMARY KEY, index_health TEXT NOT NULL,
        source_reconciliation TEXT NOT NULL, snapshot_revision TEXT,
        snapshot_sequence TEXT, failure_code TEXT, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memory_raw_captures (
        world_id TEXT NOT NULL, conversation_id TEXT NOT NULL, message_id TEXT NOT NULL,
        version_id TEXT NOT NULL, role TEXT NOT NULL, content_text TEXT NOT NULL,
        content_sha256 TEXT NOT NULL, metadata_json TEXT NOT NULL,
        captured_at TEXT NOT NULL, deleted_at TEXT,
        PRIMARY KEY(world_id, conversation_id, message_id, version_id)
      );
      CREATE TABLE IF NOT EXISTS memory_raw_active_versions (
        world_id TEXT NOT NULL, conversation_id TEXT NOT NULL, message_id TEXT NOT NULL,
        version_id TEXT NOT NULL, selected_at TEXT NOT NULL,
        PRIMARY KEY(world_id, conversation_id, message_id),
        FOREIGN KEY(world_id, conversation_id, message_id, version_id)
          REFERENCES memory_raw_captures(world_id, conversation_id, message_id, version_id)
          ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS memory_raw_derived_copies (
        world_id TEXT NOT NULL, conversation_id TEXT NOT NULL, message_id TEXT NOT NULL,
        source_version_id TEXT NOT NULL, copy_ref TEXT NOT NULL, copy_version TEXT NOT NULL,
        copy_kind TEXT NOT NULL, content_text TEXT NOT NULL, content_sha256 TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('current','invalidated')),
        created_at TEXT NOT NULL, invalidated_at TEXT,
        PRIMARY KEY(world_id, conversation_id, message_id, source_version_id, copy_ref, copy_version),
        FOREIGN KEY(world_id, conversation_id, message_id, source_version_id)
          REFERENCES memory_raw_captures(world_id, conversation_id, message_id, version_id)
          ON DELETE CASCADE
      );
    `);
      const stateColumns = this.db.prepare('PRAGMA table_info(memory_index_state)').all();
      if (!stateColumns.some((column) => column.name === 'failure_code')) this.db.exec('ALTER TABLE memory_index_state ADD COLUMN failure_code TEXT');
    } catch (error) {
      startupError = error;
    } finally {
      try { releaseStartupLock(); } catch (error) { startupError ??= error; }
    }
    if (startupError) {
      try { this.db.close(); } catch {}
      try { this.coordinatorDb?.close(); } catch {}
      throw startupError;
    }
  }

  #acquireCoordinatorLock() {
    if (!this.coordinatorDb) return () => {};
    return beginCoordinatorLock(this.coordinatorDb);
  }

  #withCoordinatorLock(work) {
    if (this.coordinatorDepth > 0) return work();
    const release = this.#acquireCoordinatorLock();
    this.coordinatorDepth += 1;
    try { return work(); }
    finally {
      this.coordinatorDepth -= 1;
      release();
    }
  }

  #dataVersion() {
    return this.db.prepare('PRAGMA data_version').get().data_version;
  }

  #withImmediateTransaction(work) {
    return this.#withCoordinatorLock(() => {
      this.db.exec('BEGIN IMMEDIATE');
      this.transactionDepth += 1;
      try {
        const result = work();
        this.db.exec('COMMIT');
        return result;
      } catch (error) {
        try { this.db.exec('ROLLBACK'); } catch {}
        throw error;
      } finally {
        this.transactionDepth -= 1;
      }
    });
  }

  // Access grants, readiness transitions, and Provider-owned record/index writes
  // share SQLite's writer serialization order. Existing compound transactions
  // reuse their transaction instead of attempting a nested BEGIN IMMEDIATE.
  #withSerializedWrite(work) {
    if (this.transactionDepth > 0) return work();
    return this.#withImmediateTransaction(work);
  }

  /**
   * Persist an immutable raw message version. The supplied version ID is an
   * archive identity, not proof of canonical source freshness. Re-ingest is
   * idempotent only when the complete captured payload is identical.
   */
  captureRawMessage(input) {
    // Core has not approved retention of raw Host/SillyTavern text. Keep this
    // path closed until an explicit retention contract is approved.
    throw new Error('MEMORY_RAW_CAPTURE_NOT_APPROVED');
    if (!object(input) || !validId(input.world_id) || !validId(input.conversation_id)
      || !validId(input.message_id) || !validId(input.version_id) || !validId(input.role)
      || typeof input.content !== 'string'
      || (input.metadata !== undefined && !object(input.metadata))) {
      throw new TypeError('Invalid raw Memory capture');
    }
    let metadataJson;
    try { metadataJson = encode(input.metadata ?? {}); } catch {
      throw new TypeError('Invalid raw Memory capture metadata');
    }
    const digest = rawDigest(input.content);
    const key = [input.world_id, input.conversation_id, input.message_id, input.version_id];
    return this.#withImmediateTransaction(() => {
      const existing = this.db.prepare(`SELECT * FROM memory_raw_captures
        WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?`).get(...key);
      if (existing) {
        if (existing.role !== input.role || existing.content_text !== input.content
          || existing.content_sha256 !== digest || existing.metadata_json !== metadataJson) {
          throw new Error('MEMORY_RAW_CAPTURE_CONFLICT');
        }
        return { status: 'duplicate', content_sha256: digest };
      }
      this.db.prepare(`INSERT INTO memory_raw_captures
        (world_id,conversation_id,message_id,version_id,role,content_text,content_sha256,
         metadata_json,captured_at,deleted_at)
        VALUES(?,?,?,?,?,?,?,?,?,NULL)`)
        .run(...key, input.role, input.content, digest, metadataJson, new Date().toISOString());
      return { status: 'captured', content_sha256: digest };
    });
  }

  async #assertRawReadAllowed(request) {
    if (!this.authorizeRawRead) throw new Error('MEMORY_RAW_READ_DENIED');
    let allowed = false;
    try { allowed = await this.authorizeRawRead(Object.freeze({ ...request })) === true; } catch { allowed = false; }
    if (!allowed) throw new Error('MEMORY_RAW_READ_DENIED');
  }

  /**
   * Read one captured version only after an explicitly injected trusted host
   * authorization callback approves this exact request. No default policy exists.
   */
  async readRawMessageVersion(input) {
    // Read grants cannot substitute for an approved source-retention/disclosure policy.
    throw new Error('MEMORY_RAW_DISCLOSURE_NOT_APPROVED');
    if (!object(input) || !validId(input.world_id) || !validId(input.conversation_id)
      || !validId(input.message_id) || !validId(input.version_id)) {
      throw new TypeError('Invalid raw Memory read target');
    }
    const request = { ...input, action: 'read_version' };
    await this.#assertRawReadAllowed(request);
    let row = this.db.prepare(`SELECT * FROM memory_raw_captures
      WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?`)
      .get(input.world_id, input.conversation_id, input.message_id, input.version_id);
    if (!row || row.deleted_at !== null) throw new Error('MEMORY_RAW_VERSION_UNAVAILABLE');
    if (rawDigest(row.content_text) !== row.content_sha256) throw new Error('MEMORY_RAW_CONTENT_CORRUPT');

    // Recheck at the disclosure boundary after the database read. This narrows
    // authorization/deletion races but is not a cross-store atomicity guarantee.
    await this.#assertRawReadAllowed(request);
    row = this.db.prepare(`SELECT * FROM memory_raw_captures
      WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?`)
      .get(input.world_id, input.conversation_id, input.message_id, input.version_id);
    if (!row || row.deleted_at !== null) throw new Error('MEMORY_RAW_VERSION_UNAVAILABLE');
    if (rawDigest(row.content_text) !== row.content_sha256) throw new Error('MEMORY_RAW_CONTENT_CORRUPT');
    return Object.freeze({
      world_id: row.world_id, conversation_id: row.conversation_id, message_id: row.message_id,
      version_id: row.version_id, role: row.role, content: row.content_text,
      content_sha256: row.content_sha256, metadata: Object.freeze(decode(row.metadata_json)),
      captured_at: row.captured_at,
    });
  }

  /**
   * Read only the selected, non-deleted version for each message in a
   * conversation. Authorization is delegated to a trusted host callback.
   */
  async readActiveRawMessages(input) {
    // Fail closed for any legacy rows too; raw Host text is not an approved source.
    throw new Error('MEMORY_RAW_DISCLOSURE_NOT_APPROVED');
    if (!object(input) || !validId(input.world_id) || !validId(input.conversation_id)) {
      throw new TypeError('Invalid raw Memory conversation read');
    }
    const request = { ...input, action: 'read_active' };
    await this.#assertRawReadAllowed(request);
    const readRows = () => this.db.prepare(`SELECT c.* FROM memory_raw_active_versions a
      JOIN memory_raw_captures c ON c.world_id=a.world_id
        AND c.conversation_id=a.conversation_id AND c.message_id=a.message_id
        AND c.version_id=a.version_id
      WHERE a.world_id=? AND a.conversation_id=? AND c.deleted_at IS NULL
      ORDER BY c.message_id`).all(input.world_id, input.conversation_id);
    let rows = readRows();
    if (rows.some((row) => rawDigest(row.content_text) !== row.content_sha256)) {
      throw new Error('MEMORY_RAW_CONTENT_CORRUPT');
    }
    await this.#assertRawReadAllowed(request);
    rows = readRows();
    if (rows.some((row) => rawDigest(row.content_text) !== row.content_sha256)) {
      throw new Error('MEMORY_RAW_CONTENT_CORRUPT');
    }
    return rows.map((row) => Object.freeze({
      world_id: row.world_id, conversation_id: row.conversation_id, message_id: row.message_id,
      version_id: row.version_id, role: row.role, content: row.content_text,
      content_sha256: row.content_sha256, metadata: Object.freeze(decode(row.metadata_json)),
      captured_at: row.captured_at,
    }));
  }

  /**
   * Change only the selected version pointer. Older swipe/generation versions
   * remain retained and are not interpreted as deletion requests.
   */
  selectActiveRawVersion(input) {
    // Do not create active selections from an unapproved raw-source archive.
    throw new Error('MEMORY_RAW_SOURCE_NOT_APPROVED');
    if (!object(input) || !validId(input.world_id) || !validId(input.conversation_id)
      || !validId(input.message_id) || !validId(input.version_id)) {
      throw new TypeError('Invalid raw Memory active-version selection');
    }
    return this.#withImmediateTransaction(() => {
      const key = [input.world_id, input.conversation_id, input.message_id, input.version_id];
      const source = this.db.prepare(`SELECT deleted_at FROM memory_raw_captures
        WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?`).get(...key);
      if (!source || source.deleted_at !== null) throw new Error('MEMORY_RAW_VERSION_UNAVAILABLE');
      this.db.prepare(`INSERT INTO memory_raw_active_versions
        (world_id,conversation_id,message_id,version_id,selected_at) VALUES(?,?,?,?,?)
        ON CONFLICT(world_id,conversation_id,message_id) DO UPDATE SET
        version_id=excluded.version_id,selected_at=excluded.selected_at`)
        .run(input.world_id, input.conversation_id, input.message_id, input.version_id, new Date().toISOString());
      return { status: 'active', version_id: input.version_id };
    });
  }

  /**
   * Record a derived copy's provenance so source deletion can invalidate it and
   * permanent purge can cascade-delete it. This does not authorize the copy for
   * NPC disclosure or create a searchable summary index.
   */
  registerRawDerivedCopy(input) {
    // Derived copies of unapproved raw Host text are also not approved for retention.
    throw new Error('MEMORY_RAW_DERIVED_COPY_NOT_APPROVED');
    if (!object(input) || !validId(input.world_id) || !validId(input.conversation_id)
      || !validId(input.message_id) || !validId(input.source_version_id)
      || !validId(input.copy_ref) || !validId(input.copy_version) || !validId(input.copy_kind)
      || typeof input.content !== 'string') throw new TypeError('Invalid raw Memory derived copy');
    const digest = rawDigest(input.content);
    const values = [input.world_id, input.conversation_id, input.message_id, input.source_version_id,
      input.copy_ref, input.copy_version, input.copy_kind, input.content, digest];
    return this.#withImmediateTransaction(() => {
      const source = this.db.prepare(`SELECT deleted_at FROM memory_raw_captures
        WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?`)
        .get(input.world_id, input.conversation_id, input.message_id, input.source_version_id);
      if (!source || source.deleted_at !== null) throw new Error('MEMORY_RAW_SOURCE_UNAVAILABLE');
      const existing = this.db.prepare(`SELECT * FROM memory_raw_derived_copies
        WHERE world_id=? AND conversation_id=? AND message_id=? AND source_version_id=?
          AND copy_ref=? AND copy_version=?`).get(...values.slice(0, 6));
      if (existing) {
        if (existing.copy_kind !== input.copy_kind || existing.content_text !== input.content
          || existing.content_sha256 !== digest) throw new Error('MEMORY_RAW_COPY_CONFLICT');
        return { status: 'duplicate', content_sha256: digest };
      }
      this.db.prepare(`INSERT INTO memory_raw_derived_copies
        (world_id,conversation_id,message_id,source_version_id,copy_ref,copy_version,copy_kind,
         content_text,content_sha256,status,created_at,invalidated_at)
        VALUES(?,?,?,?,?,?,?,?,?,'current',?,NULL)`)
        .run(...values, new Date().toISOString());
      return { status: 'stored', content_sha256: digest };
    });
  }

  /**
   * Source deletion is a reversible lifecycle marker, not permanent erasure:
   * it excludes the version from active selection and invalidates known derived
   * copies. Permanent purge is a separate explicit operation.
   */
  markRawSourceDeleted(input) {
    if (!isPlainDataRecord(input) || !validId(input.world_id) || !validId(input.conversation_id)
      || !validId(input.message_id) || !validId(input.version_id)) {
      throw new TypeError('Invalid raw Memory deletion target');
    }
    const key = [input.world_id, input.conversation_id, input.message_id, input.version_id];
    return this.#withImmediateTransaction(() => {
      const source = this.db.prepare(`SELECT deleted_at FROM memory_raw_captures
        WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?`).get(...key);
      if (!source) return { status: 'missing', invalidated_copies: 0 };
      const now = new Date().toISOString();
      this.db.prepare(`UPDATE memory_raw_captures SET deleted_at=COALESCE(deleted_at,?)
        WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?`).run(now, ...key);
      this.db.prepare(`DELETE FROM memory_raw_active_versions
        WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?`).run(...key);
      const result = this.db.prepare(`UPDATE memory_raw_derived_copies
        SET status='invalidated', invalidated_at=COALESCE(invalidated_at,?)
        WHERE world_id=? AND conversation_id=? AND message_id=? AND source_version_id=?
          AND status='current'`).run(now, input.world_id, input.conversation_id, input.message_id, input.version_id);
      return { status: 'deleted', invalidated_copies: result.changes };
    });
  }

  /**
   * Permanent purge removes the selected raw version and all registered
   * dependent copies via foreign-key cascade. External stores/indexes are not
   * managed by this provider-local operation and must not be claimed purged.
   */
  purgeRawSource(input) {
    if (!isPlainDataRecord(input) || !validId(input.world_id) || !validId(input.conversation_id)
      || !validId(input.message_id) || !validId(input.version_id)) {
      throw new TypeError('Invalid raw Memory purge target');
    }
    const key = [input.world_id, input.conversation_id, input.message_id, input.version_id];
    return this.#withImmediateTransaction(() => {
      const source = this.db.prepare(`SELECT 1 AS found FROM memory_raw_captures
        WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?`).get(...key);
      if (!source) return { status: 'missing', purged_copies: 0 };
      const copies = this.db.prepare(`SELECT COUNT(*) AS count FROM memory_raw_derived_copies
        WHERE world_id=? AND conversation_id=? AND message_id=? AND source_version_id=?`)
        .get(input.world_id, input.conversation_id, input.message_id, input.version_id).count;
      this.db.prepare(`DELETE FROM memory_raw_active_versions
        WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?`).run(...key);
      this.db.prepare(`DELETE FROM memory_raw_captures
        WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?`).run(...key);
      return { status: 'purged', purged_copies: copies };
    });
  }


  close() {
    try { this.db.close(); }
    finally { this.coordinatorDb?.close(); }
  }

  #scope(scope) {
    if (!isPlainDataRecord(scope) || !validId(scope.world_id) || !validId(scope.subject_id)
      || !validId(scope.purpose)) throw new TypeError('Invalid Memory scope');
    return scope;
  }

  #setState(worldId, indexHealth, reconciliation, snapshot = null, failureCode = null) {
    this.#withSerializedWrite(() => {
      this.db.prepare(`INSERT INTO memory_index_state
        (world_id,index_health,source_reconciliation,snapshot_revision,snapshot_sequence,failure_code,updated_at)
        VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(world_id) DO UPDATE SET index_health=excluded.index_health,
        source_reconciliation=excluded.source_reconciliation,
        snapshot_revision=excluded.snapshot_revision,snapshot_sequence=excluded.snapshot_sequence,
        failure_code=excluded.failure_code,updated_at=excluded.updated_at`).run(worldId, indexHealth, reconciliation,
        snapshot ? String(snapshot.world_revision) : null,
        snapshot ? String(snapshot.commit_sequence) : null, failureCode, new Date().toISOString());
    });
    this.stateGeneration.set(worldId, (this.stateGeneration.get(worldId) ?? 0) + 1);
  }

  /** Provider-internal diagnostics; never project this state into NPC-facing results. */
  getIndexStatusForDiagnostics(worldId) {
    if (!validId(worldId)) throw new TypeError('Invalid world_id');
    const row = this.db.prepare('SELECT * FROM memory_index_state WHERE world_id=?').get(worldId);
    if (!row) return Object.freeze({
      index_health: 'unavailable', source_reconciliation: 'stale',
      snapshot: null, failure_code: 'INDEX_STATE_MISSING',
    });
    return Object.freeze({
      index_health: row.index_health,
      source_reconciliation: row.source_reconciliation,
      snapshot: row.snapshot_revision === null || row.snapshot_sequence === null ? null : {
        world_revision: row.snapshot_revision, commit_sequence: row.snapshot_sequence,
      },
      failure_code: row.failure_code ?? null,
    });
  }

  grantQuery(scope, allowed) {
    this.#scope(scope);
    if (typeof allowed !== 'boolean') throw new TypeError('allowed must be boolean');
    this.#withSerializedWrite(() => {
      this.db.prepare(`INSERT INTO memory_query_grants VALUES(?,?,?,?)
        ON CONFLICT(world_id,subject_id,purpose) DO UPDATE SET allowed=excluded.allowed`)
        .run(scope.world_id, scope.subject_id, scope.purpose, allowed ? 1 : 0);
    });
    const key = JSON.stringify([scope.world_id, scope.subject_id, scope.purpose]);
    this.queryAuthorizationGeneration.set(key, (this.queryAuthorizationGeneration.get(key) ?? 0) + 1);
  }

  grantRecord(scope, recordRef, recordVersion, allowed) {
    this.#scope(scope);
    if (!validId(recordRef) || !validId(recordVersion) || typeof allowed !== 'boolean') {
      throw new TypeError('Invalid record grant');
    }
    this.#withSerializedWrite(() => {
      this.db.prepare(`INSERT INTO memory_record_grants VALUES(?,?,?,?,?,?)
        ON CONFLICT(world_id,subject_id,purpose,record_ref,record_version)
        DO UPDATE SET allowed=excluded.allowed`)
        .run(scope.world_id, scope.subject_id, scope.purpose, recordRef, recordVersion, allowed ? 1 : 0);
    });
    const key = JSON.stringify([scope.world_id, scope.subject_id, scope.purpose, recordRef, recordVersion]);
    this.recordAuthorizationGeneration.set(key, (this.recordAuthorizationGeneration.get(key) ?? 0) + 1);
  }

  revokeRecord(scope, recordRef, recordVersion) {
    this.grantRecord(scope, recordRef, recordVersion, false);
  }

  authorizeQuery(scope) {
    this.#scope(scope);
    const row = this.db.prepare(`SELECT allowed FROM memory_query_grants
      WHERE world_id=? AND subject_id=? AND purpose=?`)
      .get(scope.world_id, scope.subject_id, scope.purpose);
    return row?.allowed === 1;
  }

  async authorizeCandidate(input) {
    // Snapshot request identity before the first await. Caller mutation during
    // source validation must not rebind the final grant/readiness checks.
    if (!isPlainDataRecord(input)) return false;
    input = {
      world_id: input.world_id, subject_id: input.subject_id, purpose: input.purpose,
      record_ref: input.record_ref, record_version: input.record_version,
      source_kind: input.source_kind, source_entity_id: input.source_entity_id,
    };
    // Take the cross-connection epoch before reading any authorization state.
    // Otherwise a revoke/re-grant committed between the initial grant read and
    // the later epoch capture would be invisible to this request.
    const requestDataVersion = this.#dataVersion();
    if (!object(input) || !validId(input.world_id) || !validId(input.subject_id)
      || !validId(input.purpose) || !validId(input.record_ref) || !validId(input.record_version)) return false;
    const scope = { world_id: input.world_id, subject_id: input.subject_id, purpose: input.purpose };
    if (!this.authorizeQuery(scope)) throw new Error('MEMORY_QUERY_DENIED');
    const grant = this.db.prepare(`SELECT allowed FROM memory_record_grants
      WHERE world_id=? AND subject_id=? AND purpose=? AND record_ref=? AND record_version=?`)
      .get(input.world_id, input.subject_id, input.purpose, input.record_ref, input.record_version);
    if (grant?.allowed !== 1) return false;
    const row = this.db.prepare(`SELECT * FROM memory_records
      WHERE world_id=? AND record_ref=? AND record_version=?`)
      .get(input.world_id, input.record_ref, input.record_version);
    if (!row || row.subject_id !== input.subject_id || row.purpose !== input.purpose
      || row.source_kind !== input.source_kind || row.source_entity_id !== input.source_entity_id) return false;
    let lineage;
    try { lineage = decode(row.lineage_json); } catch {
      throw new Error('MEMORY_LINEAGE_INVALID');
    }
    if (!validDirectLineage(row, lineage)) throw new Error('MEMORY_LINEAGE_INVALID');

    // Candidate authorization is only valid against a ready Provider index.
    // Capture a Provider-local generation so a write/rebuild/reconciliation
    // transition during the awaited source check cannot reuse a prior ready row.
    const initialState = this.db.prepare('SELECT * FROM memory_index_state WHERE world_id=?')
      .get(input.world_id);
    if (!initialState || initialState.index_health !== 'ready'
      || initialState.source_reconciliation !== 'current') {
      throw new Error('MEMORY_INDEX_NOT_READY');
    }
    const stateGeneration = this.stateGeneration.get(input.world_id) ?? 0;
    const queryGrantKey = JSON.stringify([input.world_id, input.subject_id, input.purpose]);
    const recordGrantKey = JSON.stringify([
      input.world_id, input.subject_id, input.purpose, input.record_ref, input.record_version,
    ]);
    const queryAuthorizationGeneration = this.queryAuthorizationGeneration.get(queryGrantKey) ?? 0;
    const recordAuthorizationGeneration = this.recordAuthorizationGeneration.get(recordGrantKey) ?? 0;
    const providerDataVersion = requestDataVersion;

    let sourceValid = false;
    try {
      sourceValid = await this.validateSourceVersion(Object.freeze({
        world_id: row.world_id, subject_id: row.subject_id, purpose: row.purpose,
        record_ref: row.record_ref, record_version: row.record_version,
        source_kind: row.source_kind, source_entity_id: row.source_entity_id,
        source_version: row.source_version, lineage: Object.freeze(lineage),
      })) === true;
    } catch {
      // Host/Core validator outage is unavailable, not an ordinary denial.
      // Throw a generic error so MemoryNpcConsumer fails non-ready without leaking details.
      throw new Error('MEMORY_SOURCE_VALIDATION_UNAVAILABLE');
    }
    if (!sourceValid) {
      // A stale/unverifiable source version is not an access denial. Do not let
      // the consumer filter it into a false complete-empty result.
      throw new Error('MEMORY_SOURCE_VERSION_UNVERIFIABLE');
    }

    // Source validation may await a host/Core read. Recheck that Provider
    // readiness did not change while suspended, as well as the grants below.
    // This is Provider-local consistency, not cross-store dispatch atomicity.
    if (!this.authorizeQuery(scope)) throw new Error('MEMORY_QUERY_DENIED');
    const currentGrant = this.db.prepare(`SELECT allowed FROM memory_record_grants
      WHERE world_id=? AND subject_id=? AND purpose=? AND record_ref=? AND record_version=?`)
      .get(input.world_id, input.subject_id, input.purpose, input.record_ref, input.record_version);
    if (currentGrant?.allowed !== 1) {
      // A grant that disappears while source validation is awaited is a
      // mid-request revocation, not an ordinary pre-existing per-record denial.
      // Keep the consumer from turning a revoked last candidate into ready-empty.
      throw new Error('MEMORY_RECORD_ACCESS_REVOKED');
    }
    // If a grant was revoked and re-granted during the await, the final Boolean
    // alone loses that lifecycle transition. Fail this in-flight authorization;
    // a later request can use the new grant after a fresh retrieval.
    if ((this.queryAuthorizationGeneration.get(queryGrantKey) ?? 0) !== queryAuthorizationGeneration
      || (this.recordAuthorizationGeneration.get(recordGrantKey) ?? 0) !== recordAuthorizationGeneration
      || this.#dataVersion() !== providerDataVersion) {
      // PRAGMA data_version detects commits from other SQLite connections, whose
      // in-memory grant generations are not shared with this Provider instance.
      throw new Error('MEMORY_AUTHORIZATION_CHANGED');
    }
    const latestState = this.db.prepare('SELECT * FROM memory_index_state WHERE world_id=?')
      .get(input.world_id);
    if ((this.stateGeneration.get(input.world_id) ?? 0) !== stateGeneration
      || !latestState || latestState.index_health !== 'ready'
      || latestState.source_reconciliation !== 'current') {
      throw new Error('MEMORY_INDEX_NOT_READY');
    }
    if (this.#dataVersion() !== providerDataVersion) throw new Error('MEMORY_AUTHORIZATION_CHANGED');
    return true;
  }

  putRecord(record) {
    // Reject executable caller objects and snapshot nested lineage before any
    // identity validation or persistence. The method is synchronous, so this
    // immutable local copy remains stable through the complete write sequence.
    const snapshot = snapshotProviderRecord(record);
    if (!snapshot) throw new TypeError('Invalid direct-source Memory record; complete single-source lineage is required');
    // Serialize identity lookup and both durable record/index phases as one
    // coordinator window. The local record transaction still commits before
    // the separate index transaction so index failure remains recoverable.
    return this.#withCoordinatorLock(() => this.#putRecordUnderLock(snapshot));
  }

  #putRecordUnderLock(record) {
    if (!isPlainDataRecord(record) || !validId(record.world_id) || !validId(record.subject_id)
      || !validId(record.purpose) || !validId(record.record_ref) || !validId(record.record_version)
      || record.source_kind !== 'canonical_entity' || !validId(record.source_entity_id)
      || !validId(record.source_version) || !validId(record.content_kind) || record.content_kind === 'summary'
      || !validId(record.epistemic_kind) || !validId(record.producer_kind)
      || !validId(record.content_disposition) || !validId(record.evidence_assessment)
      || !isPlainDataArray(record.lineage) || record.lineage.length !== 1
      || !isPlainDataRecord(record.lineage[0]) || record.lineage[0].source_kind !== 'canonical_entity'
      || record.lineage[0].entity_id !== record.source_entity_id
      || record.lineage[0].source_version !== record.source_version) {
      throw new TypeError('Invalid direct-source Memory record; complete single-source lineage is required');
    }
    const values = [record.world_id, record.subject_id, record.purpose, record.record_ref,
      record.record_version, record.source_kind, record.source_entity_id, record.source_version,
      record.content_kind, record.epistemic_kind, record.producer_kind, record.content_disposition,
      record.evidence_assessment, encode(record.lineage), new Date().toISOString()];
    const existing = this.db.prepare(`SELECT * FROM memory_records
      WHERE world_id=? AND record_ref=? AND record_version=?`)
      .get(record.world_id, record.record_ref, record.record_version);
    if (existing) {
      const prior = { ...existing, lineage_json: decode(existing.lineage_json), created_at: undefined };
      const next = { world_id: record.world_id, subject_id: record.subject_id, purpose: record.purpose,
        record_ref: record.record_ref, record_version: record.record_version, source_kind: record.source_kind,
        source_entity_id: record.source_entity_id, source_version: record.source_version,
        content_kind: record.content_kind, epistemic_kind: record.epistemic_kind, producer_kind: record.producer_kind,
        content_disposition: record.content_disposition, evidence_assessment: record.evidence_assessment,
        lineage_json: record.lineage, created_at: undefined };
      if (!isDeepStrictEqual(prior, next)) throw new Error('MEMORY_IDENTITY_CONFLICT');

      // An earlier ingest may have committed the durable record but failed while
      // writing its derived index entry. An identical replay must not report a
      // fully ordinary duplicate while silently leaving that entry absent.
      const indexed = this.db.prepare(`SELECT 1 AS ok FROM memory_index_entries
        WHERE world_id=? AND record_ref=? AND record_version=?`)
        .get(record.world_id, record.record_ref, record.record_version);
      if (!indexed) {
        this.#setState(record.world_id, 'rebuilding', 'stale', null, 'INDEX_ENTRY_MISSING');
        try {
          this.#withSerializedWrite(() => this.db.prepare('INSERT INTO memory_index_entries VALUES(?,?,?,?)')
            .run(record.world_id, record.record_ref, record.record_version, new Date().toISOString()));
        } catch (error) {
          this.#setState(record.world_id, 'unavailable', 'stale', null, 'INDEX_WRITE_FAILED');
          throw error;
        }
        return {
          status: 'duplicate', record_ref: record.record_ref, record_version: record.record_version,
          index_repaired: true, reconciliation_required: true,
        };
      }
      return { status: 'duplicate', record_ref: record.record_ref, record_version: record.record_version };
    }

    // Invalidate the readiness marker before any ingest mutation. If either the raw
    // write or index write fails, retrieval cannot reuse a prior ready marker.
    this.#setState(record.world_id, 'rebuilding', 'stale');
    this.#withSerializedWrite(() => this.db.prepare(`INSERT INTO memory_records VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...values));
    try {
      this.#withSerializedWrite(() => this.db.prepare('INSERT INTO memory_index_entries VALUES(?,?,?,?)')
        .run(record.world_id, record.record_ref, record.record_version, new Date().toISOString()));
    } catch (error) {
      this.#setState(record.world_id, 'unavailable', 'stale', null, 'INDEX_WRITE_FAILED');
      throw error;
    }
    return { status: 'stored', record_ref: record.record_ref, record_version: record.record_version };
  }

  async rebuildIndex(worldId) {
    if (!validId(worldId)) throw new TypeError('Invalid world_id');
    this.#setState(worldId, 'rebuilding', 'stale');
    try {
      const count = this.#withImmediateTransaction(() => {
        this.db.prepare('DELETE FROM memory_index_entries WHERE world_id=?').run(worldId);
        const records = this.db.prepare('SELECT record_ref,record_version FROM memory_records WHERE world_id=?')
          .all(worldId);
        const insert = this.db.prepare('INSERT INTO memory_index_entries VALUES(?,?,?,?)');
        for (const record of records) {
          insert.run(worldId, record.record_ref, record.record_version, new Date().toISOString());
        }
        return records.length;
      });
      return { status: 'rebuilt', count };
    } catch (error) {
      this.#setState(worldId, 'unavailable', 'stale', null, 'INDEX_REBUILD_FAILED');
      throw error;
    }
  }

  async reconcile(worldId) {
    if (!validId(worldId)) throw new TypeError('Invalid world_id');
    const generation = (this.reconcileGeneration.get(worldId) ?? 0) + 1;
    this.reconcileGeneration.set(worldId, generation);
    const superseded = () => this.reconcileGeneration.get(worldId) !== generation;
    this.#setState(worldId, 'rebuilding', 'stale');
    // Capture the Provider-local mutation epoch after this reconciliation marks
    // the index non-ready. Any ingest, rebuild, or competing state transition
    // during an awaited Core validation invalidates this reconciliation attempt.
    const providerStateGeneration = this.stateGeneration.get(worldId) ?? 0;
    const providerDataVersion = this.#dataVersion();
    const providerStateChanged = () =>
      (this.stateGeneration.get(worldId) ?? 0) !== providerStateGeneration
      || this.#dataVersion() !== providerDataVersion;
    let before;
    try { before = snapshotOf(await this.getSnapshot(worldId)); } catch { before = null; }
    if (superseded()) return { status: 'stale', reason: 'RECONCILIATION_SUPERSEDED' };
    if (!before) {
      this.#setState(worldId, 'unavailable', 'stale', null, 'CORE_SNAPSHOT_UNAVAILABLE');
      return { status: 'unavailable', reason: 'CORE_SNAPSHOT_UNAVAILABLE' };
    }
    const records = this.db.prepare('SELECT * FROM memory_records WHERE world_id=?').all(worldId);
    for (const row of records) {
      const entry = this.db.prepare(`SELECT 1 AS ok FROM memory_index_entries
        WHERE world_id=? AND record_ref=? AND record_version=?`)
        .get(worldId, row.record_ref, row.record_version);
      if (!entry) {
        this.#setState(worldId, 'rebuilding', 'stale', null, 'INDEX_ENTRY_MISSING');
        return { status: 'rebuilding', reason: 'INDEX_ENTRY_MISSING' };
      }
      let lineage;
      try { lineage = decode(row.lineage_json); } catch {
        this.#setState(worldId, 'stale', 'stale', null, 'LINEAGE_INVALID');
        return { status: 'stale', reason: 'LINEAGE_INVALID' };
      }
      if (!validDirectLineage(row, lineage)) {
        this.#setState(worldId, 'stale', 'stale', null, 'LINEAGE_INVALID');
        return { status: 'stale', reason: 'LINEAGE_INVALID' };
      }
      let valid = false;
      try {
        valid = await this.validateSourceVersion(Object.freeze({
          world_id: row.world_id, subject_id: row.subject_id, purpose: row.purpose,
          record_ref: row.record_ref, record_version: row.record_version,
          source_kind: row.source_kind, source_entity_id: row.source_entity_id,
          source_version: row.source_version, lineage: Object.freeze(lineage),
        })) === true;
      } catch { valid = false; }
      if (superseded()) return { status: 'stale', reason: 'RECONCILIATION_SUPERSEDED' };
      if (!valid) {
        this.#setState(worldId, 'stale', 'stale', null, 'SOURCE_VALIDATION_FAILED');
        return { status: 'stale', reason: 'SOURCE_VALIDATION_FAILED' };
      }
    }
    // Per-record validation cannot prove that the inventory itself is complete.
    // A trusted source adapter must explicitly confirm completeness for this
    // world/source domain before the provider can publish a current marker.
    let inventoryComplete = false;
    try {
      inventoryComplete = await this.validateInventory(worldId, Object.freeze(records.map((row) => Object.freeze({
        record_ref: row.record_ref, record_version: row.record_version,
        source_kind: row.source_kind, source_entity_id: row.source_entity_id,
        source_version: row.source_version,
      })))) === true;
    } catch { inventoryComplete = false; }
    if (superseded()) return { status: 'stale', reason: 'RECONCILIATION_SUPERSEDED' };
    if (providerStateChanged()) {
      this.#setState(worldId, 'stale', 'stale', null, 'PROVIDER_STATE_CHANGED');
      return { status: 'stale', reason: 'PROVIDER_STATE_CHANGED' };
    }
    if (!inventoryComplete) {
      this.#setState(worldId, 'stale', 'stale', null, 'INVENTORY_INCOMPLETE_OR_UNAVAILABLE');
      return { status: 'stale', reason: 'INVENTORY_INCOMPLETE_OR_UNAVAILABLE' };
    }

    // Provider-local writes can occur while source validation/inventory callbacks
    // are awaited. Do not publish a current marker for a record set that was not
    // the one reconciled; the Core snapshot alone cannot detect provider writes.
    // Compare the full persisted record payload, not only source identity.
    // Any metadata/scope/lineage mutation during awaited validators must prevent
    // reconciliation from publishing a current marker for a different record.
    const recordSet = (rows) => rows.map(({ created_at, ...record }) => record)
      .sort((a, b) => a.record_ref.localeCompare(b.record_ref)
        || a.record_version.localeCompare(b.record_version));
    const latestRecords = this.db.prepare('SELECT * FROM memory_records WHERE world_id=?').all(worldId);
    if (!isDeepStrictEqual(recordSet(records), recordSet(latestRecords))) {
      this.#setState(worldId, 'stale', 'stale');
      return { status: 'stale' };
    }

    let after;
    try { after = snapshotOf(await this.getSnapshot(worldId)); } catch { after = null; }
    if (superseded()) return { status: 'stale', reason: 'RECONCILIATION_SUPERSEDED' };
    if (!sameSnapshot(before, after)) {
      this.#setState(worldId, 'stale', 'stale');
      return { status: 'stale' };
    }
    // Serialize the final local-record comparison with publication of the
    // ready/current marker. BEGIN IMMEDIATE prevents a second SQLite connection
    // from committing a Provider write between the final comparison and marker.
    try {
      return this.#withImmediateTransaction(() => {
        if (providerStateChanged()) {
          this.#setState(worldId, 'stale', 'stale', null, 'PROVIDER_STATE_CHANGED');
          return { status: 'stale', reason: 'PROVIDER_STATE_CHANGED' };
        }
        const finalRecords = this.db.prepare('SELECT * FROM memory_records WHERE world_id=?').all(worldId);
        if (!isDeepStrictEqual(recordSet(records), recordSet(finalRecords))) {
          this.#setState(worldId, 'stale', 'stale');
          return { status: 'stale', reason: 'PROVIDER_RECORD_SET_CHANGED' };
        }
        // Record equality alone does not prove that the derived index is complete.
        // A second Provider instance can rebuild/delete index rows without sharing
        // this instance's in-memory state generation. Verify exact index coverage
        // under the same write lock before publishing ready/current.
        const compareIdentity = (a, b) => a.record_ref.localeCompare(b.record_ref)
          || a.record_version.localeCompare(b.record_version);
        const finalIndex = this.db.prepare('SELECT record_ref, record_version FROM memory_index_entries WHERE world_id=?')
          .all(worldId)
          .map((row) => ({ record_ref: row.record_ref, record_version: row.record_version }))
          .sort(compareIdentity);
        const expectedIndex = finalRecords
          .map((row) => ({ record_ref: row.record_ref, record_version: row.record_version }))
          .sort(compareIdentity);
        if (!isDeepStrictEqual(expectedIndex, finalIndex)) {
          this.#setState(worldId, 'stale', 'stale', null, 'INDEX_INVENTORY_MISMATCH');
          return { status: 'stale', reason: 'INDEX_INVENTORY_MISMATCH' };
        }
        this.#setState(worldId, 'ready', 'current', after);
        return { status: 'current', snapshot: after, records_checked: records.length };
      });
    } catch {
      // A lock/transaction failure is not evidence that reconciliation succeeded.
      try { this.#setState(worldId, 'unavailable', 'stale', null, 'FINAL_RECONCILIATION_COMMIT_FAILED'); } catch {}
      return { status: 'unavailable', reason: 'FINAL_RECONCILIATION_COMMIT_FAILED' };
    }
  }

  async retrieveCandidates(scope) {
    // Snapshot the scope before the first await. Reusing a mutable caller object
    // after getSnapshot() would let the eventual SQL query switch subjects.
    if (!isPlainDataRecord(scope)) throw new TypeError('Invalid Memory scope');
    scope = { world_id: scope.world_id, subject_id: scope.subject_id, purpose: scope.purpose };
    // Capture before checking the query grant or readiness. Capturing after
    // those reads can miss a cross-connection revoke/re-grant ABA that finishes
    // just before the first await.
    const requestDataVersion = this.#dataVersion();
    this.#scope(scope);
    if (!this.authorizeQuery(scope)) throw new Error('MEMORY_QUERY_DENIED');
    const queryGrantKey = JSON.stringify([scope.world_id, scope.subject_id, scope.purpose]);
    const queryAuthorizationGeneration = this.queryAuthorizationGeneration.get(queryGrantKey) ?? 0;
    const state = this.db.prepare('SELECT * FROM memory_index_state WHERE world_id=?').get(scope.world_id);
    if (!state || state.index_health !== 'ready' || state.source_reconciliation !== 'current') {
      throw new Error('MEMORY_INDEX_NOT_READY');
    }
    const stateGeneration = this.stateGeneration.get(scope.world_id) ?? 0;
    const providerDataVersion = requestDataVersion;
    const scopedRecords = this.db.prepare(`SELECT record_ref, record_version FROM memory_records
      WHERE world_id=? AND subject_id=? AND purpose=?`)
      .all(scope.world_id, scope.subject_id, scope.purpose);
    const recordAuthorizationGenerations = new Map(scopedRecords.map((row) => {
      const key = JSON.stringify([
        scope.world_id, scope.subject_id, scope.purpose, row.record_ref, row.record_version,
      ]);
      return [key, this.recordAuthorizationGeneration.get(key) ?? 0];
    }));
    let current;
    try {
      current = snapshotOf(await this.getSnapshot(scope.world_id));
    } catch {
      this.#setState(scope.world_id, 'unavailable', 'stale', null, 'CORE_SNAPSHOT_UNAVAILABLE');
      throw new Error('MEMORY_SNAPSHOT_UNAVAILABLE');
    }
    if (!current) {
      this.#setState(scope.world_id, 'unavailable', 'stale', null, 'CORE_SNAPSHOT_UNAVAILABLE');
      throw new Error('MEMORY_SNAPSHOT_UNAVAILABLE');
    }
    if (String(current.world_revision) !== state.snapshot_revision
      || String(current.commit_sequence) !== state.snapshot_sequence) {
      this.#setState(scope.world_id, 'stale', 'stale', null, 'SNAPSHOT_STALE');
      throw new Error('MEMORY_SNAPSHOT_STALE');
    }
    // Snapshot lookup is awaited. A query grant revoked while it was in flight
    // must not authorize this retrieval using the pre-await allow.
    if (!this.authorizeQuery(scope)) throw new Error('MEMORY_QUERY_DENIED');
    if ((this.queryAuthorizationGeneration.get(queryGrantKey) ?? 0) !== queryAuthorizationGeneration) {
      throw new Error('MEMORY_AUTHORIZATION_CHANGED');
    }

    // A Provider write can invalidate readiness while getSnapshot() is awaited.
    // Re-read the readiness marker after the await; the earlier state object is
    // only a snapshot of readiness before that asynchronous boundary.
    const latestState = this.db.prepare('SELECT * FROM memory_index_state WHERE world_id=?').get(scope.world_id);
    if (!latestState || latestState.index_health !== 'ready'
      || latestState.source_reconciliation !== 'current') {
      throw new Error('MEMORY_INDEX_NOT_READY');
    }
    if (String(current.world_revision) !== latestState.snapshot_revision
      || String(current.commit_sequence) !== latestState.snapshot_sequence) {
      this.#setState(scope.world_id, 'stale', 'stale', null, 'SNAPSHOT_STALE');
      throw new Error('MEMORY_SNAPSHOT_STALE');
    }
    // A readiness transition away and back to ready/current during the await is
    // an ABA change. Fail closed rather than treating the final Boolean state as
    // proof that the same Provider snapshot remained valid throughout retrieval.
    if ((this.stateGeneration.get(scope.world_id) ?? 0) !== stateGeneration
      || this.#dataVersion() !== providerDataVersion) {
      throw new Error('MEMORY_INDEX_NOT_READY');
    }

    const rows = this.db.prepare(`SELECT r.* FROM memory_records r
      JOIN memory_index_entries i USING(world_id,record_ref,record_version)
      JOIN memory_record_grants g ON g.world_id=r.world_id AND g.record_ref=r.record_ref
        AND g.record_version=r.record_version AND g.subject_id=? AND g.purpose=? AND g.allowed=1
      WHERE r.world_id=? AND r.subject_id=? AND r.purpose=?
      ORDER BY r.record_ref,r.record_version LIMIT 51`)
      .all(scope.subject_id, scope.purpose, scope.world_id, scope.subject_id, scope.purpose);
    // Grant state is durable, but grant generations are process-local. Compare
    // the generations captured before the await so revoke/re-grant cannot make
    // an in-flight retrieval appear continuously authorized.
    for (const [key, generation] of recordAuthorizationGenerations) {
      if ((this.recordAuthorizationGeneration.get(key) ?? 0) !== generation) {
        throw new Error('MEMORY_AUTHORIZATION_CHANGED');
      }
    }
    // A query-authorized empty result is meaningful only when no indexed
    // records exist in this scope. If scoped records exist but none are
    // authorized for this subject/purpose, report a typed withheld failure
    // rather than collapsing denial into successful complete-empty. No record
    // identity, count, or content is included in the failure.
    if (rows.length === 0) {
      const withheld = this.db.prepare(`SELECT 1 AS found FROM memory_records r
        JOIN memory_index_entries i USING(world_id,record_ref,record_version)
        WHERE r.world_id=? AND r.subject_id=? AND r.purpose=? LIMIT 1`)
        .get(scope.world_id, scope.subject_id, scope.purpose);
      if (withheld) throw new Error('MEMORY_RECORDS_WITHHELD');
    }

    const candidates = rows.slice(0, 50).map((row) => ({
      record: { ref: row.record_ref, version: row.record_version },
      source: { kind: row.source_kind, entity_id: row.source_entity_id },
      world_id: row.world_id, subject_id: row.subject_id, purpose: row.purpose,
      content_kind: row.content_kind, epistemic_kind: row.epistemic_kind,
      producer: { kind: row.producer_kind },
      lifecycle: { content_disposition: row.content_disposition,
        source_reconciliation: latestState.source_reconciliation,
        evidence_assessment: row.evidence_assessment, index_health: latestState.index_health },
      freshness: { status: 'current' },
      snapshot: current,
    }));
    // Detect commits from another Provider connection that happened while this
    // result was being assembled. This remains Provider-local protection; it
    // cannot make a later model dispatch atomic with revocation.
    if (this.#dataVersion() !== providerDataVersion) throw new Error('MEMORY_INDEX_NOT_READY');
    return {
      completeness: rows.length > 50 ? 'partial' : 'complete',
      index_health: latestState.index_health,
      source_reconciliation: latestState.source_reconciliation,
      scope: { world_id: scope.world_id, subject_id: scope.subject_id, purpose: scope.purpose },
      snapshot: current,
      candidates,
    };
  }
}
