import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { openCoordinatorDatabase, beginCoordinatorLock } from '../storage/coordinator-lock.js';

const validId = (v) => typeof v === 'string' && v === v.trim() && v.length > 0 && v.length <= 200;
const validDigest = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const tuple = (v) => [v.world_id, v.conversation_id, v.message_id, v.version_id];
const validTuple = (v) => v && validId(v.world_id) && validId(v.conversation_id)
  && validId(v.message_id) && validId(v.version_id);
const digest = (v) => createHash('sha256').update(v).digest('hex');
const canonicalFilePath = (path) => {
  let candidate = resolve(path);
  const suffix = [];
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

/**
 * Draft-only digest ledger. Stores Host identity, digests and lifecycle state,
 * never raw message text. It is not the semantic Memory-record store and is
 * intentionally not wired to a public route or default runtime.
 * The inventory verifier must be a trusted Host/Core integration.
 */
export class HostVersionDigestLedger {
  constructor({ path, coordinatorPath, verifyInventorySnapshot }) {
    if (typeof path !== 'string' || !path.trim() || path === ':memory:') {
      throw new TypeError('A file-backed ledger path is required');
    }
    if (typeof coordinatorPath !== 'string' || !coordinatorPath.trim() || !isAbsolute(coordinatorPath)) {
      throw new TypeError('The shared coordinator path must be absolute');
    }
    if (aliasesSameFile(path, coordinatorPath)) {
      throw new Error('Coordinator DB must be separate from the Host version ledger DB, including filesystem aliases.');
    }
    if (typeof verifyInventorySnapshot !== 'function') {
      throw new TypeError('A trusted inventory verifier is required');
    }
    this.verifyInventorySnapshot = verifyInventorySnapshot;
    this.coordinator = openCoordinatorDatabase(coordinatorPath);
    this.db = null;
    let startupError = null;
    let release = null;
    try {
      release = beginCoordinatorLock(this.coordinator);
      this.db = new DatabaseSync(resolve(path));
      this.db.exec([
        'PRAGMA foreign_keys=ON;',
        'PRAGMA busy_timeout=5000;',
        "CREATE TABLE IF NOT EXISTS host_version_digest_ledger (world_id TEXT NOT NULL, conversation_id TEXT NOT NULL, message_id TEXT NOT NULL, version_id TEXT NOT NULL, content_sha256 TEXT NOT NULL, lifecycle TEXT NOT NULL CHECK(lifecycle IN ('present','tombstoned')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, tombstoned_at TEXT, PRIMARY KEY(world_id,conversation_id,message_id,version_id));",
        'CREATE TABLE IF NOT EXISTS host_version_active_pointer (world_id TEXT NOT NULL, conversation_id TEXT NOT NULL, message_id TEXT NOT NULL, version_id TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(world_id,conversation_id,message_id), FOREIGN KEY(world_id,conversation_id,message_id,version_id) REFERENCES host_version_digest_ledger(world_id,conversation_id,message_id,version_id));',
        'CREATE TABLE IF NOT EXISTS host_version_ledger_conflicts (id INTEGER PRIMARY KEY AUTOINCREMENT, world_id TEXT NOT NULL, conversation_id TEXT NOT NULL, message_id TEXT NOT NULL, version_id TEXT NOT NULL, persisted_digest TEXT NOT NULL, observed_digest TEXT NOT NULL, observed_at TEXT NOT NULL);',
        "CREATE TABLE IF NOT EXISTS host_version_inventory_state (world_id TEXT NOT NULL, conversation_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('NON_READY','READY')), snapshot_digest TEXT, failure_code TEXT, updated_at TEXT NOT NULL, PRIMARY KEY(world_id,conversation_id));"
      ].join('\n'));
    } catch (error) {
      startupError = error;
    } finally {
      try { release?.(); } catch (error) { startupError ??= error; }
    }
    if (startupError) {
      try { this.db?.close(); } catch {}
      try { this.coordinator?.close(); } catch {}
      throw startupError;
    }
  }

  #write(work) {
    const release = beginCoordinatorLock(this.coordinator);
    try {
      this.db.exec('BEGIN IMMEDIATE');
      try { const result = work(); this.db.exec('COMMIT'); return result; }
      catch (error) { try { this.db.exec('ROLLBACK'); } catch {} throw error; }
    } finally { release(); }
  }

  #get(v) {
    return this.db.prepare('SELECT * FROM host_version_digest_ledger WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?').get(...tuple(v));
  }

  #fingerprint(worldId, conversationId) {
    const versions = this.db.prepare('SELECT message_id,version_id,content_sha256,lifecycle,created_at,updated_at,tombstoned_at FROM host_version_digest_ledger WHERE world_id=? AND conversation_id=? ORDER BY message_id,version_id')
      .all(worldId, conversationId);
    const pointers = this.db.prepare('SELECT message_id,version_id,updated_at FROM host_version_active_pointer WHERE world_id=? AND conversation_id=? ORDER BY message_id')
      .all(worldId, conversationId);
    // Inventory-state writes are publication outcomes, not Host ledger
    // mutations. Excluding them lets identical concurrent reconciliations
    // converge instead of one invalidating the other's READY result.
    return digest(JSON.stringify({ versions, pointers }));
  }

  #matchesSnapshot(snapshot) {
    const stored = this.db.prepare('SELECT world_id,conversation_id,message_id,version_id,content_sha256,lifecycle FROM host_version_digest_ledger WHERE world_id=? AND conversation_id=? ORDER BY message_id,version_id')
      .all(snapshot.world_id, snapshot.conversation_id);
    const expected = snapshot.versions.map((v) => ({
      world_id: v.world_id, conversation_id: v.conversation_id, message_id: v.message_id,
      version_id: v.version_id, content_sha256: v.content_sha256, lifecycle: v.deleted ? 'tombstoned' : 'present'
    })).sort((a, b) => a.message_id.localeCompare(b.message_id) || a.version_id.localeCompare(b.version_id));
    if (JSON.stringify(stored) !== JSON.stringify(expected)) return false;
    const pointers = this.db.prepare('SELECT message_id,version_id FROM host_version_active_pointer WHERE world_id=? AND conversation_id=? ORDER BY message_id')
      .all(snapshot.world_id, snapshot.conversation_id);
    const expectedPointers = snapshot.versions.filter((v) => v.active && !v.deleted)
      .map((v) => ({ message_id: v.message_id, version_id: v.version_id }))
      .sort((a, b) => a.message_id.localeCompare(b.message_id));
    return JSON.stringify(pointers) === JSON.stringify(expectedPointers);
  }

  #nextStateTimestamp(worldId, conversationId) {
    const prior = this.db.prepare('SELECT updated_at FROM host_version_inventory_state WHERE world_id=? AND conversation_id=?')
      .get(worldId, conversationId);
    const now = Date.now();
    const priorTime = prior ? Date.parse(prior.updated_at) : NaN;
    // This durable state stamp must change even when two invalidations occur
    // within one clock millisecond; it is used to detect invalidation during
    // the asynchronous trusted-inventory verification window.
    return new Date(Number.isFinite(priorTime) && priorTime >= now ? priorTime + 1 : now).toISOString();
  }

  #invalidateReadiness(worldId, conversationId, now) {
    this.db.prepare("UPDATE host_version_inventory_state SET status='NON_READY',failure_code='HOST_LEDGER_MUTATED_AFTER_RECONCILIATION',updated_at=? WHERE world_id=? AND conversation_id=?")
      .run(this.#nextStateTimestamp(worldId, conversationId), worldId, conversationId);
  }

  #markNonReady(worldId, conversationId, code, now, snapshotDigest = null) {
    this.db.prepare("INSERT INTO host_version_inventory_state (world_id,conversation_id,status,snapshot_digest,failure_code,updated_at) VALUES(?,?,'NON_READY',?,?,?) ON CONFLICT(world_id,conversation_id) DO UPDATE SET status='NON_READY',snapshot_digest=COALESCE(excluded.snapshot_digest,host_version_inventory_state.snapshot_digest),failure_code=excluded.failure_code,updated_at=excluded.updated_at")
      .run(worldId, conversationId, snapshotDigest, code, this.#nextStateTimestamp(worldId, conversationId));
  }

  #rejectSnapshot(snapshot, code) {
    if (validId(snapshot?.world_id) && validId(snapshot?.conversation_id)) {
      this.#write(() => this.#markNonReady(snapshot.world_id, snapshot.conversation_id, code, new Date().toISOString()));
    }
    return { status: 'non_ready', code };
  }

  #put(v, now) {
    const prior = this.#get(v);
    if (prior && prior.content_sha256 !== v.content_sha256) {
      this.db.prepare('INSERT INTO host_version_ledger_conflicts (world_id,conversation_id,message_id,version_id,persisted_digest,observed_digest,observed_at) VALUES(?,?,?,?,?,?,?)')
        .run(...tuple(v), prior.content_sha256, v.content_sha256, now);
      this.db.prepare("INSERT INTO host_version_inventory_state (world_id,conversation_id,status,failure_code,updated_at) VALUES(?,?,'NON_READY','HOST_VERSION_DIGEST_CONFLICT',?) ON CONFLICT(world_id,conversation_id) DO UPDATE SET status='NON_READY',failure_code='HOST_VERSION_DIGEST_CONFLICT',updated_at=excluded.updated_at")
        .run(v.world_id, v.conversation_id, this.#nextStateTimestamp(v.world_id, v.conversation_id));
      return { status: 'conflict', code: 'HOST_VERSION_DIGEST_CONFLICT' };
    }
    if (prior) {
      if (prior.lifecycle === 'tombstoned' && !v.deleted) {
        this.#markNonReady(v.world_id, v.conversation_id, 'HOST_TOMBSTONE_REAPPEARED', now);
        return { status: 'non_ready', code: 'HOST_TOMBSTONE_REAPPEARED' };
      }
      if (v.deleted && prior.lifecycle !== 'tombstoned') {
        this.db.prepare("UPDATE host_version_digest_ledger SET lifecycle='tombstoned',updated_at=?,tombstoned_at=? WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?")
          .run(now, now, ...tuple(v));
        this.db.prepare('DELETE FROM host_version_active_pointer WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?').run(...tuple(v));
        return { status: 'tombstoned' };
      }
      return { status: prior.lifecycle === 'tombstoned' ? 'tombstoned' : 'duplicate' };
    }
    this.db.prepare('INSERT INTO host_version_digest_ledger (world_id,conversation_id,message_id,version_id,content_sha256,lifecycle,created_at,updated_at,tombstoned_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(...tuple(v), v.content_sha256, v.deleted ? 'tombstoned' : 'present', now, now, v.deleted ? now : null);
    if (v.active && !v.deleted) this.#setActive(v, now);
    return { status: v.deleted ? 'tombstoned' : 'captured' };
  }

  #setActive(v, now) {
    this.db.prepare('INSERT INTO host_version_active_pointer (world_id,conversation_id,message_id,version_id,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(world_id,conversation_id,message_id) DO UPDATE SET version_id=excluded.version_id,updated_at=excluded.updated_at')
      .run(v.world_id, v.conversation_id, v.message_id, v.version_id, now);
  }

  captureVersion(v) {
    if (!validTuple(v) || !validDigest(v.content_sha256) || typeof v.active !== 'boolean' || typeof v.deleted !== 'boolean') {
      throw new TypeError('Invalid digest-only Host version entry');
    }
    return this.#write(() => this.#captureVersionInWrite(v));
  }

  /**
   * Resolve Core's adapter-scoped binding while the shared coordinator lease is
   * held, then persist the digest event before another Core binding mutation
   * (including revocation) can interleave. The callback must be synchronous.
   */
  captureBoundVersion(v) {
    const allowedKeys = new Set(['adapterId', 'conversationId', 'message_id', 'version_id', 'content_sha256', 'active', 'deleted', 'resolveBinding']);
    if (!v || typeof v !== 'object' || Array.isArray(v)
      || Object.keys(v).some((key) => !allowedKeys.has(key))
      || !validId(v.adapterId) || !validId(v.conversationId)
      || typeof v.resolveBinding !== 'function'
      || typeof v.message_id !== 'string' || !validId(v.message_id)
      || typeof v.version_id !== 'string' || !validId(v.version_id)
      || !validDigest(v.content_sha256)
      || typeof v.active !== 'boolean' || typeof v.deleted !== 'boolean'
      || (v.deleted && v.active)) {
      throw new TypeError('Invalid bound Host version entry');
    }
    if (v.resolveBinding.constructor?.name === 'AsyncFunction') {
      throw new TypeError('Host binding resolution must be synchronous under the coordinator lease');
    }
    return this.#write(() => {
      const binding = v.resolveBinding({ adapterId: v.adapterId, conversationId: v.conversationId });
      if (!binding || typeof binding.then === 'function'
        || binding.conversation_id !== v.conversationId
        || !validId(binding.world_id)) {
        throw new Error('HOST_CONVERSATION_NOT_AUTHORIZED');
      }
      const entry = {
        world_id: binding.world_id,
        conversation_id: binding.conversation_id,
        message_id: v.message_id,
        version_id: v.version_id,
        content_sha256: v.content_sha256,
        active: v.active,
        deleted: v.deleted,
      };
      if (!validTuple(entry)) throw new TypeError('Invalid resolved Host version tuple');
      return this.#captureVersionInWrite(entry);
    });
  }

  #captureVersionInWrite(v) {
    const now = new Date().toISOString();
    const prior = this.#get(v);
    if (v.deleted && v.active) {
      this.#markNonReady(v.world_id, v.conversation_id, 'HOST_VERSION_DELETED_ACTIVE', now);
      return { status: 'non_ready', code: 'HOST_VERSION_DELETED_ACTIVE' };
    }
    // A lifecycle event cannot establish the original identity/digest of a
    // version first observed as deleted. Only a trusted complete inventory
    // may introduce historical tombstones; an event-only capture must fail
    // closed when the corresponding live version was never recorded.
    if (!prior && v.deleted) {
      this.#markNonReady(v.world_id, v.conversation_id, 'HOST_VERSION_UNKNOWN', now);
      return { status: 'non_ready', code: 'HOST_VERSION_UNKNOWN' };
    }
    // A newly captured identity or a newly observed deletion changes the
    // ledger beyond the last verified inventory; never leave stale READY.
    if (!prior || (prior.lifecycle === 'present' && v.deleted)) {
      this.#invalidateReadiness(v.world_id, v.conversation_id, now);
    }
    // A conflicting digest must never be allowed to mutate the active pointer
    // from the same untrusted event. Record the conflict first; reconciliation
    // can rebuild pointers only from a trusted complete inventory.
    if (prior && prior.content_sha256 !== v.content_sha256) return this.#put(v, now);
    // Host may report an existing swipe with a changed active flag. Reflect
    // that pointer mutation here as well as through selectActiveVersion.
    if (prior?.lifecycle === 'present' && !v.deleted) {
      const current = this.db.prepare('SELECT version_id FROM host_version_active_pointer WHERE world_id=? AND conversation_id=? AND message_id=?')
        .get(v.world_id, v.conversation_id, v.message_id);
      if (v.active && current?.version_id !== v.version_id) {
        this.#invalidateReadiness(v.world_id, v.conversation_id, now);
        this.#setActive(v, now);
      } else if (!v.active && current?.version_id === v.version_id) {
        this.#invalidateReadiness(v.world_id, v.conversation_id, now);
        this.db.prepare('DELETE FROM host_version_active_pointer WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?')
          .run(...tuple(v));
      }
    }
    return this.#put(v, now);

  }

  selectActiveVersion(v) {
    if (!validTuple(v)) throw new TypeError('Invalid Host version tuple');
    return this.#write(() => {
      const row = this.#get(v);
      if (!row || row.lifecycle !== 'present') {
        const now = new Date().toISOString();
        // An attempted selection of an uncaptured or deleted version is
        // inconsistent with the current inventory; do not keep prior READY.
        this.#markNonReady(v.world_id, v.conversation_id, 'HOST_VERSION_UNAVAILABLE', now);
        return { status: 'non_ready', code: 'HOST_VERSION_UNAVAILABLE' };
      }
      const current = this.db.prepare('SELECT version_id FROM host_version_active_pointer WHERE world_id=? AND conversation_id=? AND message_id=?')
        .get(v.world_id, v.conversation_id, v.message_id);
      if (current?.version_id !== v.version_id) {
        const now = new Date().toISOString();
        this.#invalidateReadiness(v.world_id, v.conversation_id, now);
        this.#setActive(v, now);
      }
      return { status: 'selected' };
    });
  }

  tombstoneVersion(v) {
    if (!validTuple(v)) throw new TypeError('Invalid Host version tuple');
    return this.#write(() => {
      const row = this.#get(v);
      if (!row) {
        const now = new Date().toISOString();
        // A deletion for an identity absent from the ledger means capture and
        // lifecycle history are incomplete. Do not leave a prior READY snapshot
        // published merely because the tombstone target was unknown locally.
        this.#markNonReady(v.world_id, v.conversation_id, 'HOST_VERSION_UNKNOWN', now);
        return { status: 'non_ready', code: 'HOST_VERSION_UNKNOWN' };
      }
      if (row.lifecycle === 'tombstoned') return { status: 'tombstoned' };
      const now = new Date().toISOString();
      this.#invalidateReadiness(v.world_id, v.conversation_id, now);
      this.db.prepare("UPDATE host_version_digest_ledger SET lifecycle='tombstoned',updated_at=?,tombstoned_at=? WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?")
        .run(now, now, ...tuple(v));
      this.db.prepare('DELETE FROM host_version_active_pointer WHERE world_id=? AND conversation_id=? AND message_id=? AND version_id=?').run(...tuple(v));
      return { status: 'tombstoned' };
    });
  }

  async reconcileConversation(input) {
    // Snapshot caller input synchronously before the first await. Validation,
    // trust verification, hashing and reconciliation must use the same immutable
    // version inventory; otherwise the caller could mutate rows while the
    // verifier is awaiting and introduce unverified versions.
    let snapshot = input;
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      const rawVersions = input.versions;
      const versions = Array.isArray(rawVersions)
        ? Object.freeze(rawVersions.map((v) => v && typeof v === 'object' && !Array.isArray(v)
          ? Object.freeze({ ...v }) : v))
        : rawVersions;
      snapshot = Object.freeze({
        world_id: input.world_id,
        conversation_id: input.conversation_id,
        complete: input.complete,
        versions
      });
    }
    if (!snapshot || !validId(snapshot.world_id) || !validId(snapshot.conversation_id)
      || snapshot.complete !== true || !Array.isArray(snapshot.versions)) {
      return this.#rejectSnapshot(snapshot, 'HOST_INVENTORY_INCOMPLETE');
    }
    const seen = new Set();
    for (const v of snapshot.versions) {
      if (!validTuple(v) || v.world_id !== snapshot.world_id || v.conversation_id !== snapshot.conversation_id
        || !validDigest(v.content_sha256) || typeof v.active !== 'boolean' || typeof v.deleted !== 'boolean') {
        return this.#rejectSnapshot(snapshot, 'HOST_INVENTORY_INVALID');
      }
      // A deleted version cannot be the active version in a complete inventory.
      // Accepting that contradictory pair would silently discard the active flag
      // while rebuilding pointers and could publish READY for an inconsistent Host snapshot.
      if (v.deleted && v.active) {
        return this.#rejectSnapshot(snapshot, 'HOST_INVENTORY_DELETED_VERSION_ACTIVE');
      }
      const key = JSON.stringify(tuple(v));
      if (seen.has(key)) return this.#rejectSnapshot(snapshot, 'HOST_INVENTORY_DUPLICATE_IDENTITY');
      seen.add(key);
    }
    const activeByMessage = new Set();
    for (const v of snapshot.versions) {
      if (!v.active || v.deleted) continue;
      const key = JSON.stringify([v.world_id, v.conversation_id, v.message_id]);
      if (activeByMessage.has(key)) return this.#rejectSnapshot(snapshot, 'HOST_INVENTORY_MULTIPLE_ACTIVE_VERSIONS');
      activeByMessage.add(key);
    }
    // Capture the local state before the asynchronous trust check. If another
    // writer changes versions, pointers, or readiness while verification awaits,
    // this snapshot must not publish READY against a different local state.
    const preVerification = this.#write(() => ({
      fingerprint: this.#fingerprint(snapshot.world_id, snapshot.conversation_id),
      state: this.db.prepare('SELECT status,failure_code,updated_at FROM host_version_inventory_state WHERE world_id=? AND conversation_id=?')
        .get(snapshot.world_id, snapshot.conversation_id) ?? null
    }));
    const preVerificationFingerprint = preVerification.fingerprint;
    let trusted = false;
    try {
      trusted = await this.verifyInventorySnapshot(Object.freeze({
        world_id: snapshot.world_id, conversation_id: snapshot.conversation_id, complete: true,
        versions: snapshot.versions.map((v) => Object.freeze({ ...v }))
      })) === true;
    } catch { trusted = false; }
    if (!trusted) return this.#rejectSnapshot(snapshot, 'HOST_INVENTORY_NOT_AUTHORIZED');
    const canonical = snapshot.versions.map((v) => [...tuple(v), v.content_sha256, v.active, v.deleted])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const snapshotDigest = digest(JSON.stringify(canonical));
    return this.#write(() => {
      const currentState = this.db.prepare('SELECT status,failure_code,updated_at FROM host_version_inventory_state WHERE world_id=? AND conversation_id=?')
        .get(snapshot.world_id, snapshot.conversation_id) ?? null;
      const invalidatedDuringVerification = currentState?.status === 'NON_READY'
        && currentState.updated_at !== (preVerification.state?.updated_at ?? null);
      if (invalidatedDuringVerification
        || (this.#fingerprint(snapshot.world_id, snapshot.conversation_id) !== preVerificationFingerprint
          && !this.#matchesSnapshot(snapshot))) {
        this.#markNonReady(snapshot.world_id, snapshot.conversation_id, 'HOST_LEDGER_CHANGED_DURING_VERIFICATION', new Date().toISOString(), snapshotDigest);
        return { status: 'non_ready', code: 'HOST_LEDGER_CHANGED_DURING_VERIFICATION' };
      }
      const known = this.db.prepare('SELECT * FROM host_version_digest_ledger WHERE world_id=? AND conversation_id=?')
        .all(snapshot.world_id, snapshot.conversation_id);
      const now = new Date().toISOString();
      for (const row of known) {
        const key = JSON.stringify([row.world_id, row.conversation_id, row.message_id, row.version_id]);
        if (!seen.has(key)) {
          this.#markNonReady(snapshot.world_id, snapshot.conversation_id, 'HOST_INVENTORY_DISAPPEARANCE', now, snapshotDigest);
          return { status: 'non_ready', code: 'HOST_INVENTORY_DISAPPEARANCE' };
        }
      }
      // Preflight the whole snapshot before applying any version mutations. A conflict
      // must not leave earlier entries from the same snapshot partially applied.
      for (const v of snapshot.versions) {
        const prior = this.#get(v);
        if (prior && prior.content_sha256 !== v.content_sha256) {
          this.db.prepare('INSERT INTO host_version_ledger_conflicts (world_id,conversation_id,message_id,version_id,persisted_digest,observed_digest,observed_at) VALUES(?,?,?,?,?,?,?)')
            .run(...tuple(v), prior.content_sha256, v.content_sha256, now);
          this.#markNonReady(snapshot.world_id, snapshot.conversation_id, 'HOST_VERSION_DIGEST_CONFLICT', now, snapshotDigest);
          return { status: 'non_ready', code: 'HOST_VERSION_DIGEST_CONFLICT' };
        }
        if (prior?.lifecycle === 'tombstoned' && !v.deleted) {
          this.#markNonReady(snapshot.world_id, snapshot.conversation_id, 'HOST_TOMBSTONE_REAPPEARED', now, snapshotDigest);
          return { status: 'non_ready', code: 'HOST_TOMBSTONE_REAPPEARED' };
        }
      }
      // The verified snapshot is authoritative for active pointers: remove stale
      // pointers for this conversation, then rebuild them from the validated inventory.
      this.db.prepare('DELETE FROM host_version_active_pointer WHERE world_id=? AND conversation_id=?')
        .run(snapshot.world_id, snapshot.conversation_id);
      for (const v of snapshot.versions) {
        const result = this.#put(v, now);
        if (result.status === 'conflict' || result.status === 'non_ready') return { status: 'non_ready', code: result.code };
        if (v.active && !v.deleted) this.#setActive(v, now);
      }
      this.db.prepare("INSERT INTO host_version_inventory_state (world_id,conversation_id,status,snapshot_digest,failure_code,updated_at) VALUES(?,?,'READY',?,NULL,?) ON CONFLICT(world_id,conversation_id) DO UPDATE SET status='READY',snapshot_digest=excluded.snapshot_digest,failure_code=NULL,updated_at=excluded.updated_at")
        .run(snapshot.world_id, snapshot.conversation_id, snapshotDigest, this.#nextStateTimestamp(snapshot.world_id, snapshot.conversation_id));
      return { status: 'ready', snapshot_sha256: snapshotDigest, version_count: snapshot.versions.length };
    });
  }

  getInventoryState(worldId, conversationId) {
    return this.db.prepare('SELECT * FROM host_version_inventory_state WHERE world_id=? AND conversation_id=?')
      .get(worldId, conversationId) ?? null;
  }

  close() { this.db.close(); this.coordinator.close(); }
}
