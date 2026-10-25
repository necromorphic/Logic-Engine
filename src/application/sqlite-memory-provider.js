import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';

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
  constructor({ path = ':memory:', getSnapshot, validateSourceVersion, validateInventory }) {
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
    `);
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
