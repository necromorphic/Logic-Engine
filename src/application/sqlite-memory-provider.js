import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
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
  constructor({ path = ':memory:', getSnapshot, validateSourceVersion, validateInventory, authorizeRawRead }) {
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
        snapshot_sequence TEXT, updated_at TEXT NOT NULL
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
  }

  #withImmediateTransaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  /**
   * Persist an immutable raw message version. The supplied version ID is an
   * archive identity, not proof of canonical source freshness. Re-ingest is
   * idempotent only when the complete captured payload is identical.
   */
  captureRawMessage(input) {
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
    if (!object(input) || !validId(input.world_id) || !validId(input.conversation_id)
      || !validId(input.message_id) || !validId(input.version_id)) {
      throw new TypeError('Invalid raw Memory read target');
    }
    await this.#assertRawReadAllowed({ ...input, action: 'read_version' });
    const row = this.db.prepare(`SELECT * FROM memory_raw_captures
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
    if (!object(input) || !validId(input.world_id) || !validId(input.conversation_id)) {
      throw new TypeError('Invalid raw Memory conversation read');
    }
    await this.#assertRawReadAllowed({ ...input, action: 'read_active' });
    const rows = this.db.prepare(`SELECT c.* FROM memory_raw_active_versions a
      JOIN memory_raw_captures c ON c.world_id=a.world_id
        AND c.conversation_id=a.conversation_id AND c.message_id=a.message_id
        AND c.version_id=a.version_id
      WHERE a.world_id=? AND a.conversation_id=? AND c.deleted_at IS NULL
      ORDER BY c.message_id`).all(input.world_id, input.conversation_id);
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
    if (!object(input) || !validId(input.world_id) || !validId(input.conversation_id)
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
    if (!object(input) || !validId(input.world_id) || !validId(input.conversation_id)
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

  close() { this.db.close(); }

  #scope(scope) {
    if (!object(scope) || !validId(scope.world_id) || !validId(scope.subject_id)
      || !validId(scope.purpose)) throw new TypeError('Invalid Memory scope');
    return scope;
  }

  #setState(worldId, indexHealth, reconciliation, snapshot = null) {
    this.db.prepare(`INSERT INTO memory_index_state
      (world_id,index_health,source_reconciliation,snapshot_revision,snapshot_sequence,updated_at)
      VALUES(?,?,?,?,?,?)
      ON CONFLICT(world_id) DO UPDATE SET index_health=excluded.index_health,
      source_reconciliation=excluded.source_reconciliation,
      snapshot_revision=excluded.snapshot_revision,snapshot_sequence=excluded.snapshot_sequence,
      updated_at=excluded.updated_at`).run(worldId, indexHealth, reconciliation,
      snapshot ? String(snapshot.world_revision) : null,
      snapshot ? String(snapshot.commit_sequence) : null, new Date().toISOString());
  }

  grantQuery(scope, allowed) {
    this.#scope(scope);
    if (typeof allowed !== 'boolean') throw new TypeError('allowed must be boolean');
    this.db.prepare(`INSERT INTO memory_query_grants VALUES(?,?,?,?)
      ON CONFLICT(world_id,subject_id,purpose) DO UPDATE SET allowed=excluded.allowed`)
      .run(scope.world_id, scope.subject_id, scope.purpose, allowed ? 1 : 0);
  }

  grantRecord(scope, recordRef, recordVersion, allowed) {
    this.#scope(scope);
    if (!validId(recordRef) || !validId(recordVersion) || typeof allowed !== 'boolean') {
      throw new TypeError('Invalid record grant');
    }
    this.db.prepare(`INSERT INTO memory_record_grants VALUES(?,?,?,?,?,?)
      ON CONFLICT(world_id,subject_id,purpose,record_ref,record_version)
      DO UPDATE SET allowed=excluded.allowed`)
      .run(scope.world_id, scope.subject_id, scope.purpose, recordRef, recordVersion, allowed ? 1 : 0);
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
    if (!object(input) || !validId(input.world_id) || !validId(input.subject_id)
      || !validId(input.purpose) || !validId(input.record_ref) || !validId(input.record_version)) return false;
    const scope = { world_id: input.world_id, subject_id: input.subject_id, purpose: input.purpose };
    if (!this.authorizeQuery(scope)) return false;
    const grant = this.db.prepare(`SELECT allowed FROM memory_record_grants
      WHERE world_id=? AND subject_id=? AND purpose=? AND record_ref=? AND record_version=?`)
      .get(input.world_id, input.subject_id, input.purpose, input.record_ref, input.record_version);
    if (grant?.allowed !== 1) return false;
    const row = this.db.prepare(`SELECT * FROM memory_records
      WHERE world_id=? AND record_ref=? AND record_version=?`)
      .get(input.world_id, input.record_ref, input.record_version);
    if (!row || row.subject_id !== input.subject_id || row.purpose !== input.purpose
      || row.source_kind !== input.source_kind || row.source_entity_id !== input.source_entity_id) return false;
    let sourceValid = false;
    try {
      sourceValid = await this.validateSourceVersion(Object.freeze({
        world_id: row.world_id, subject_id: row.subject_id, purpose: row.purpose,
        record_ref: row.record_ref, record_version: row.record_version,
        source_kind: row.source_kind, source_entity_id: row.source_entity_id,
        source_version: row.source_version, lineage: Object.freeze(decode(row.lineage_json)),
      })) === true;
    } catch { return false; }
    if (!sourceValid) return false;

    // Source validation may await a host/Core read. Recheck provider-owned grants
    // after that await so a revocation during validation cannot reuse the earlier
    // allow. This narrows the race; it is not a cross-store atomicity guarantee.
    if (!this.authorizeQuery(scope)) return false;
    const currentGrant = this.db.prepare(`SELECT allowed FROM memory_record_grants
      WHERE world_id=? AND subject_id=? AND purpose=? AND record_ref=? AND record_version=?`)
      .get(input.world_id, input.subject_id, input.purpose, input.record_ref, input.record_version);
    return currentGrant?.allowed === 1;
  }

  putRecord(record) {
    if (!object(record) || !validId(record.world_id) || !validId(record.subject_id)
      || !validId(record.purpose) || !validId(record.record_ref) || !validId(record.record_version)
      || record.source_kind !== 'canonical_entity' || !validId(record.source_entity_id)
      || !validId(record.source_version) || !validId(record.content_kind) || record.content_kind === 'summary'
      || !validId(record.epistemic_kind) || !validId(record.producer_kind)
      || !validId(record.content_disposition) || !validId(record.evidence_assessment)
      || !Array.isArray(record.lineage) || record.lineage.length !== 1
      || !object(record.lineage[0]) || record.lineage[0].source_kind !== 'canonical_entity'
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
      return { status: 'duplicate', record_ref: record.record_ref, record_version: record.record_version };
    }

    // Invalidate the readiness marker before any ingest mutation. If either the raw
    // write or index write fails, retrieval cannot reuse a prior ready marker.
    this.#setState(record.world_id, 'rebuilding', 'stale');
    this.db.prepare(`INSERT INTO memory_records VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...values);
    try {
      this.db.prepare('INSERT INTO memory_index_entries VALUES(?,?,?,?)')
        .run(record.world_id, record.record_ref, record.record_version, new Date().toISOString());
    } catch (error) {
      this.#setState(record.world_id, 'unavailable', 'stale');
      throw error;
    }
    return { status: 'stored', record_ref: record.record_ref, record_version: record.record_version };
  }

  async rebuildIndex(worldId) {
    if (!validId(worldId)) throw new TypeError('Invalid world_id');
    this.#setState(worldId, 'rebuilding', 'stale');
    try {
      this.db.prepare('DELETE FROM memory_index_entries WHERE world_id=?').run(worldId);
      const records = this.db.prepare('SELECT record_ref,record_version FROM memory_records WHERE world_id=?')
        .all(worldId);
      const insert = this.db.prepare('INSERT INTO memory_index_entries VALUES(?,?,?,?)');
      for (const record of records) {
        insert.run(worldId, record.record_ref, record.record_version, new Date().toISOString());
      }
      return { status: 'rebuilt', count: records.length };
    } catch (error) {
      this.#setState(worldId, 'unavailable', 'stale');
      throw error;
    }
  }

  async reconcile(worldId) {
    if (!validId(worldId)) throw new TypeError('Invalid world_id');
    this.#setState(worldId, 'rebuilding', 'stale');
    let before;
    try { before = snapshotOf(await this.getSnapshot(worldId)); } catch { before = null; }
    if (!before) {
      this.#setState(worldId, 'unavailable', 'stale');
      return { status: 'unavailable' };
    }
    const records = this.db.prepare('SELECT * FROM memory_records WHERE world_id=?').all(worldId);
    for (const row of records) {
      const entry = this.db.prepare(`SELECT 1 AS ok FROM memory_index_entries
        WHERE world_id=? AND record_ref=? AND record_version=?`)
        .get(worldId, row.record_ref, row.record_version);
      if (!entry) {
        this.#setState(worldId, 'rebuilding', 'stale');
        return { status: 'rebuilding' };
      }
      let valid = false;
      try {
        valid = await this.validateSourceVersion(Object.freeze({
          world_id: row.world_id, subject_id: row.subject_id, purpose: row.purpose,
          record_ref: row.record_ref, record_version: row.record_version,
          source_kind: row.source_kind, source_entity_id: row.source_entity_id,
          source_version: row.source_version, lineage: Object.freeze(decode(row.lineage_json)),
        })) === true;
      } catch { valid = false; }
      if (!valid) {
        this.#setState(worldId, 'stale', 'stale');
        return { status: 'stale' };
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
    if (!inventoryComplete) {
      this.#setState(worldId, 'stale', 'stale');
      return { status: 'stale' };
    }
    let after;
    try { after = snapshotOf(await this.getSnapshot(worldId)); } catch { after = null; }
    if (!sameSnapshot(before, after)) {
      this.#setState(worldId, 'stale', 'stale');
      return { status: 'stale' };
    }
    this.#setState(worldId, 'ready', 'current', after);
    return { status: 'current', snapshot: after, records_checked: records.length };
  }

  async retrieveCandidates(scope) {
    this.#scope(scope);
    if (!this.authorizeQuery(scope)) throw new Error('MEMORY_QUERY_DENIED');
    const state = this.db.prepare('SELECT * FROM memory_index_state WHERE world_id=?').get(scope.world_id);
    if (!state || state.index_health !== 'ready' || state.source_reconciliation !== 'current') {
      throw new Error('MEMORY_INDEX_NOT_READY');
    }
    let current;
    try {
      current = snapshotOf(await this.getSnapshot(scope.world_id));
    } catch {
      this.#setState(scope.world_id, 'unavailable', 'stale');
      throw new Error('MEMORY_SNAPSHOT_UNAVAILABLE');
    }
    if (!current) {
      this.#setState(scope.world_id, 'unavailable', 'stale');
      throw new Error('MEMORY_SNAPSHOT_UNAVAILABLE');
    }
    if (String(current.world_revision) !== state.snapshot_revision
      || String(current.commit_sequence) !== state.snapshot_sequence) {
      this.#setState(scope.world_id, 'stale', 'stale');
      throw new Error('MEMORY_SNAPSHOT_STALE');
    }
    const rows = this.db.prepare(`SELECT r.* FROM memory_records r
      JOIN memory_index_entries i USING(world_id,record_ref,record_version)
      JOIN memory_record_grants g ON g.world_id=r.world_id AND g.record_ref=r.record_ref
        AND g.record_version=r.record_version AND g.subject_id=? AND g.purpose=? AND g.allowed=1
      WHERE r.world_id=? AND r.subject_id=? AND r.purpose=?
      ORDER BY r.record_ref,r.record_version LIMIT 51`)
      .all(scope.subject_id, scope.purpose, scope.world_id, scope.subject_id, scope.purpose);
    const candidates = rows.slice(0, 50).map((row) => ({
      record: { ref: row.record_ref, version: row.record_version },
      source: { kind: row.source_kind, entity_id: row.source_entity_id },
      world_id: row.world_id, subject_id: row.subject_id, purpose: row.purpose,
      content_kind: row.content_kind, epistemic_kind: row.epistemic_kind,
      producer: { kind: row.producer_kind },
      lifecycle: { content_disposition: row.content_disposition,
        source_reconciliation: state.source_reconciliation,
        evidence_assessment: row.evidence_assessment, index_health: state.index_health },
      freshness: { status: 'current' },
      snapshot: current,
    }));
    return {
      completeness: rows.length > 50 ? 'partial' : 'complete',
      index_health: state.index_health,
      source_reconciliation: state.source_reconciliation,
      scope: { world_id: scope.world_id, subject_id: scope.subject_id, purpose: scope.purpose },
      snapshot: current,
      candidates,
    };
  }
}
