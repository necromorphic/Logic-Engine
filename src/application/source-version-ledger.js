import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const valid = value => typeof value === 'string' && value.length > 0 && value === value.trim()
  && value.length <= 240 && ![...value].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
const tuple = x => [x.world_id, x.conversation_id, x.message_id, x.version_id];
const keyOf = x => JSON.stringify(tuple(x));

/**
 * Provider-owned digest-only ledger for Host source-version identities.
 *
 * This is an archive/reconciliation primitive, not source authority. The
 * injected validator must verify Core-bound world identity, Host installation,
 * complete snapshot evidence, branch/restore lineage and snapshot freshness.
 * No message text is accepted or stored by this class.
 */
export class SQLiteSourceVersionLedger {
  constructor({ path = ':memory:', validateSnapshot, validateVersion }) {
    if (typeof validateSnapshot !== 'function') {
      throw new TypeError('SQLiteSourceVersionLedger requires trusted validateSnapshot');
    }
    if (typeof validateVersion !== 'function') {
      throw new TypeError('SQLiteSourceVersionLedger requires trusted validateVersion');
    }
    this.validateSnapshot = validateSnapshot;
    this.validateVersion = validateVersion;
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS source_versions (
        world_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        payload_sha256 TEXT NOT NULL,
        parent_version_id TEXT,
        lifecycle TEXT NOT NULL CHECK(lifecycle IN ('present','tombstoned')),
        active INTEGER NOT NULL CHECK(active IN (0,1)),
        accepted_snapshot_sequence INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(world_id, conversation_id, message_id, version_id)
      );
      CREATE TABLE IF NOT EXISTS source_ledger_heads (
        world_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        host_installation_id TEXT NOT NULL,
        branch_id TEXT NOT NULL,
        snapshot_sequence INTEGER NOT NULL,
        snapshot_id TEXT NOT NULL,
        inventory_sha256 TEXT NOT NULL,
        readiness TEXT NOT NULL CHECK(readiness IN ('READY','NON_READY')),
        failure_code TEXT,
        PRIMARY KEY(world_id, conversation_id, host_installation_id)
      );
    `);
  }

  close() { this.db.close(); }

  #validateIdentity(x) {
    if (!object(x) || !tuple(x).every(valid) || !/^[a-f0-9]{64}$/.test(x.payload_sha256)
      || (x.parent_version_id != null && !valid(x.parent_version_id))) {
      throw new TypeError('Invalid source version identity/digest');
    }
  }

  #transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { try { this.db.exec('ROLLBACK'); } catch {} throw error; }
  }

  recordVersion(input) {
    this.#validateIdentity(input);
    if (!Number.isSafeInteger(input.snapshot_sequence) || input.snapshot_sequence < 0) {
      throw new TypeError('Invalid snapshot_sequence');
    }
    let verified = false;
    try { verified = this.validateVersion(Object.freeze({ ...input })) === true; } catch { verified = false; }
    if (!verified) return { status: 'NON_READY', reason: 'VERSION_NOT_AUTHORIZED' };
    return this.#transaction(() => {
      const old = this.db.prepare(`SELECT * FROM source_versions
        WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?`).get(...tuple(input));
      if (old) {
        if (old.payload_sha256 !== input.payload_sha256 || old.parent_version_id !== (input.parent_version_id ?? null)) {
          this.#setNonReady(input, 'SOURCE_VERSION_ID_CONFLICT');
          return { status: 'NON_READY', reason: 'SOURCE_VERSION_ID_CONFLICT' };
        }
        if (old.lifecycle === 'tombstoned') return { status: 'NON_READY', reason: 'TOMBSTONED_VERSION_REPLAY' };
        return { status: 'duplicate', payload_sha256: old.payload_sha256 };
      }
      this.db.prepare(`INSERT INTO source_versions
        (world_id,conversation_id,message_id,version_id,payload_sha256,parent_version_id,lifecycle,active,accepted_snapshot_sequence,updated_at)
        VALUES(?,?,?,?,?,?, 'present',0,?,?)`).run(
          ...tuple(input), input.payload_sha256, input.parent_version_id ?? null,
          input.snapshot_sequence, new Date().toISOString());
      return { status: 'recorded', payload_sha256: input.payload_sha256 };
    });
  }

  selectActiveVersion(input) {
    if (!object(input) || !tuple(input).every(valid)) throw new TypeError('Invalid active version identity');
    return this.#transaction(() => {
      const row = this.db.prepare(`SELECT lifecycle FROM source_versions
        WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?`).get(...tuple(input));
      if (!row || row.lifecycle !== 'present') return { status: 'NON_READY', reason: 'VERSION_UNAVAILABLE' };
      this.db.prepare(`UPDATE source_versions SET active=0 WHERE world_id=? AND conversation_id=? AND message_id=?`)
        .run(input.world_id, input.conversation_id, input.message_id);
      this.db.prepare(`UPDATE source_versions SET active=1,updated_at=? WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?`)
        .run(new Date().toISOString(), ...tuple(input));
      return { status: 'active', version_id: input.version_id };
    });
  }

  tombstoneVersion(input) {
    if (!object(input) || !tuple(input).every(valid)) throw new TypeError('Invalid tombstone identity');
    return this.#transaction(() => {
      const result = this.db.prepare(`UPDATE source_versions SET lifecycle='tombstoned',active=0,updated_at=?
        WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?`)
        .run(new Date().toISOString(), ...tuple(input));
      return result.changes ? { status: 'tombstoned' } : { status: 'missing' };
    });
  }

  /**
   * Reconcile only after an injected trusted verifier authenticates the snapshot.
   * Missing rows are tombstoned only when the verifier confirms a complete,
   * same-branch, non-rollback inventory for this exact Host installation.
   */
  reconcileSnapshot(snapshot) {
    if (!object(snapshot) || !valid(snapshot.world_id) || !valid(snapshot.conversation_id)
      || !valid(snapshot.host_installation_id) || !valid(snapshot.branch_id) || !valid(snapshot.snapshot_id)
      || !Number.isSafeInteger(snapshot.snapshot_sequence) || snapshot.snapshot_sequence < 0
      || !Array.isArray(snapshot.versions) || snapshot.complete !== true
      || !/^[a-f0-9]{64}$/.test(snapshot.inventory_sha256)) {
      return { status: 'NON_READY', reason: 'INCOMPLETE_OR_INVALID_SNAPSHOT' };
    }
    let verified = false;
    try { verified = this.validateSnapshot(Object.freeze({ ...snapshot })) === true; } catch { verified = false; }
    if (!verified) return { status: 'NON_READY', reason: 'SNAPSHOT_NOT_AUTHORIZED' };
    const seen = new Set();
    const activeMessages = new Set();
    for (const version of snapshot.versions) {
      try { this.#validateIdentity({ ...version, world_id: snapshot.world_id, conversation_id: snapshot.conversation_id }); }
      catch { return { status: 'NON_READY', reason: 'INVALID_VERSION_INVENTORY' }; }
      if (version.active !== undefined && typeof version.active !== 'boolean') {
        return { status: 'NON_READY', reason: 'INVALID_ACTIVE_VERSION_FLAG' };
      }
      if (version.active === true && activeMessages.has(version.message_id)) {
        return { status: 'NON_READY', reason: 'MULTIPLE_ACTIVE_VERSIONS' };
      }
      if (version.active === true) activeMessages.add(version.message_id);
      const key = keyOf({ ...version, world_id: snapshot.world_id, conversation_id: snapshot.conversation_id });
      if (seen.has(key)) return { status: 'NON_READY', reason: 'DUPLICATE_INVENTORY_IDENTITY' };
      seen.add(key);
    }

    return this.#transaction(() => {
      const foreignHead = this.db.prepare(`SELECT host_installation_id FROM source_ledger_heads
        WHERE world_id=? AND conversation_id=? AND host_installation_id<>? LIMIT 1`)
        .get(snapshot.world_id, snapshot.conversation_id, snapshot.host_installation_id);
      if (foreignHead) {
        this.#setSnapshotNonReady(snapshot, 'HOST_INSTALLATION_CONFLICT');
        return { status: 'NON_READY', reason: 'HOST_INSTALLATION_CONFLICT' };
      }
      const head = this.db.prepare(`SELECT * FROM source_ledger_heads
        WHERE world_id=? AND conversation_id=? AND host_installation_id=?`)
        .get(snapshot.world_id, snapshot.conversation_id, snapshot.host_installation_id);
      if (head && (snapshot.snapshot_sequence <= head.snapshot_sequence || snapshot.branch_id !== head.branch_id)) {
        this.#setSnapshotNonReady(snapshot, 'STALE_OR_DIFFERENT_BRANCH');
        return { status: 'NON_READY', reason: 'STALE_OR_DIFFERENT_BRANCH' };
      }
      for (const version of snapshot.versions) {
        const item = { ...version, world_id: snapshot.world_id, conversation_id: snapshot.conversation_id,
          snapshot_sequence: snapshot.snapshot_sequence };
        const old = this.db.prepare(`SELECT * FROM source_versions WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?`).get(...tuple(item));
        if (old && (old.payload_sha256 !== item.payload_sha256 || old.parent_version_id !== (item.parent_version_id ?? null))) {
          this.#setSnapshotNonReady(snapshot, 'SOURCE_VERSION_ID_CONFLICT');
          return { status: 'NON_READY', reason: 'SOURCE_VERSION_ID_CONFLICT' };
        }
        if (old?.lifecycle === 'tombstoned') {
          this.#setSnapshotNonReady(snapshot, 'TOMBSTONE_REAPPEARED');
          return { status: 'NON_READY', reason: 'TOMBSTONE_REAPPEARED' };
        }
      }
      const incoming = new Set(snapshot.versions.map(v => keyOf({ ...v, world_id:snapshot.world_id, conversation_id:snapshot.conversation_id })));
      const known = this.db.prepare('SELECT * FROM source_versions WHERE world_id=? AND conversation_id=?')
        .all(snapshot.world_id, snapshot.conversation_id);
      for (const old of known) {
        const key = keyOf(old);
        if (!incoming.has(key) && old.lifecycle === 'present') {
          this.db.prepare(`UPDATE source_versions SET lifecycle='tombstoned',active=0,updated_at=?
            WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?`)
            .run(new Date().toISOString(), ...tuple(old));
        }
      }
      this.db.prepare('UPDATE source_versions SET active=0 WHERE world_id=? AND conversation_id=?')
        .run(snapshot.world_id, snapshot.conversation_id);
      for (const version of snapshot.versions) {
        const item = { ...version, world_id:snapshot.world_id, conversation_id:snapshot.conversation_id,
          snapshot_sequence:snapshot.snapshot_sequence };
        const old = this.db.prepare(`SELECT lifecycle FROM source_versions WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?`).get(...tuple(item));
        if (!old) this.db.prepare(`INSERT INTO source_versions
          (world_id,conversation_id,message_id,version_id,payload_sha256,parent_version_id,lifecycle,active,accepted_snapshot_sequence,updated_at)
          VALUES(?,?,?,?,?,?, 'present',?,?,?)`).run(...tuple(item), item.payload_sha256, item.parent_version_id ?? null,
            version.active === true ? 1 : 0, snapshot.snapshot_sequence, new Date().toISOString());
        else this.db.prepare(`UPDATE source_versions SET active=?,accepted_snapshot_sequence=?,updated_at=?
          WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?`)
          .run(version.active === true ? 1 : 0, snapshot.snapshot_sequence, new Date().toISOString(), ...tuple(item));
      }
      this.db.prepare(`INSERT INTO source_ledger_heads
        (world_id,conversation_id,host_installation_id,branch_id,snapshot_sequence,snapshot_id,inventory_sha256,readiness,failure_code)
        VALUES(?,?,?,?,?,?,?,'READY',NULL)
        ON CONFLICT(world_id,conversation_id,host_installation_id) DO UPDATE SET
        branch_id=excluded.branch_id,snapshot_sequence=excluded.snapshot_sequence,snapshot_id=excluded.snapshot_id,
        inventory_sha256=excluded.inventory_sha256,readiness='READY',failure_code=NULL`)
        .run(snapshot.world_id,snapshot.conversation_id,snapshot.host_installation_id,snapshot.branch_id,
          snapshot.snapshot_sequence,snapshot.snapshot_id,snapshot.inventory_sha256);
      return { status: 'READY', sequence: snapshot.snapshot_sequence, known_versions: snapshot.versions.length };
    });
  }

  #setNonReady(input, code) {
    this.db.prepare(`UPDATE source_ledger_heads SET readiness='NON_READY',failure_code=?
      WHERE world_id=? AND conversation_id=?`).run(code,input.world_id,input.conversation_id);
  }
  #setSnapshotNonReady(snapshot, code) {
    this.db.prepare(`INSERT INTO source_ledger_heads
      (world_id,conversation_id,host_installation_id,branch_id,snapshot_sequence,snapshot_id,inventory_sha256,readiness,failure_code)
      VALUES(?,?,?,?,?,?,?,'NON_READY',?)
      ON CONFLICT(world_id,conversation_id,host_installation_id) DO UPDATE SET readiness='NON_READY',failure_code=excluded.failure_code`)
      .run(snapshot.world_id,snapshot.conversation_id,snapshot.host_installation_id,snapshot.branch_id,
        snapshot.snapshot_sequence,snapshot.snapshot_id,snapshot.inventory_sha256,code);
  }

  getVersion(input) {
    if (!object(input) || !tuple(input).every(valid)) throw new TypeError('Invalid version identity');
    const row = this.db.prepare('SELECT * FROM source_versions WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?').get(...tuple(input));
    return row ? Object.freeze({ ...row }) : null;
  }

  getHead(input) {
    if (!object(input) || !valid(input.world_id) || !valid(input.conversation_id) || !valid(input.host_installation_id)) {
      throw new TypeError('Invalid source ledger head identity');
    }
    const row = this.db.prepare('SELECT * FROM source_ledger_heads WHERE world_id=? AND conversation_id=? AND host_installation_id=?')
      .get(input.world_id,input.conversation_id,input.host_installation_id);
    return row ? Object.freeze({ ...row }) : null;
  }
}
