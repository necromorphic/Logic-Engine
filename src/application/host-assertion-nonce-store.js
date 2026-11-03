import { DatabaseSync } from 'node:sqlite';
import { existsSync, lstatSync, mkdirSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { beginCoordinatorLock, openCoordinatorDatabase } from '../storage/coordinator-lock.js';

function canonicalFilePath(path) {
  let candidate = resolve(path);
  const suffix = [];
  const seenSymlinks = new Set();
  for (let attempt = 0; attempt < 64; attempt += 1) {
    try {
      const stat = lstatSync(candidate);
      if (stat.isSymbolicLink()) {
        if (seenSymlinks.has(candidate)) {
          throw new Error('Host assertion nonce database path contains a symbolic-link cycle.');
        }
        seenSymlinks.add(candidate);
        candidate = resolve(dirname(candidate), readlinkSync(candidate));
        continue;
      }
      return resolve(realpathSync(candidate), ...suffix);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = dirname(candidate);
      if (parent === candidate) return resolve(candidate, ...suffix);
      suffix.unshift(basename(candidate));
      candidate = parent;
    }
  }
  throw new Error('Host assertion nonce database path contains too many symbolic links.');
}

function aliasesSameFile(left, right) {
  const canonicalLeft = canonicalFilePath(left);
  const canonicalRight = canonicalFilePath(right);
  if (canonicalLeft === canonicalRight) return true;
  if (!existsSync(canonicalLeft) || !existsSync(canonicalRight)) return false;
  const leftStat = statSync(canonicalLeft, { bigint: true });
  const rightStat = statSync(canonicalRight, { bigint: true });
  return leftStat.ino !== 0n && rightStat.ino !== 0n
    && leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino;
}

/**
 * Durable, process-independent replay guard for short-lived Host assertions.
 * It owns a separate SQLite file so nonce writes do not mutate Core's
 * accepted-head-protected canonical database, the shared Coordinator DB,
 * or the Memory Provider's record/index database.
 */
export class HostAssertionNonceStore {
  #db;
  #coordinatorDb;

  constructor({ path, coreDatabasePath, coordinatorPath, providerDatabasePath = null } = {}) {
    if (typeof path !== 'string' || !path.trim() || path === ':memory:') {
      throw new TypeError('Host assertion nonce store requires a durable file path.');
    }
    if (typeof coreDatabasePath !== 'string' || !coreDatabasePath.trim()
      || typeof coordinatorPath !== 'string' || !coordinatorPath.trim()
      || (providerDatabasePath !== null
        && (typeof providerDatabasePath !== 'string' || !providerDatabasePath.trim()))) {
      throw new TypeError('Host assertion nonce store requires Core, Coordinator, and optional Provider database paths.');
    }
    const noncePath = resolve(path);
    if (aliasesSameFile(noncePath, coreDatabasePath)
      || aliasesSameFile(noncePath, coordinatorPath)
      || (providerDatabasePath !== null && aliasesSameFile(noncePath, providerDatabasePath))) {
      throw new Error('Host assertion nonce database must be separate from Core, Coordinator, and Provider databases.');
    }
    mkdirSync(dirname(noncePath), { recursive: true });
    this.#coordinatorDb = openCoordinatorDatabase(coordinatorPath);
    try {
      this.#db = new DatabaseSync(noncePath);
      this.#db.exec(`
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS host_assertion_nonces (
          adapter_id TEXT NOT NULL,
          nonce TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          consumed_at INTEGER NOT NULL,
          PRIMARY KEY(adapter_id, nonce)
        ) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS host_assertion_nonces_expiry
          ON host_assertion_nonces(expires_at);
        CREATE TABLE IF NOT EXISTS host_session_revocations (
          adapter_id TEXT NOT NULL,
          host_installation_id TEXT NOT NULL,
          authenticated_account_id TEXT NOT NULL,
          host_session_id TEXT NOT NULL,
          revoked_at INTEGER NOT NULL,
          reason TEXT NOT NULL CHECK(reason IN ('logout', 'session_rotation')),
          event_nonce TEXT NOT NULL,
          PRIMARY KEY(adapter_id, host_installation_id, authenticated_account_id, host_session_id)
        ) WITHOUT ROWID;
      `);
    } catch (error) {
      try { this.#db?.close(); } catch {}
      this.#coordinatorDb.close();
      throw error;
    }
  }

  consume(adapterId, nonce, expiresAt, currentSeconds) {
    if (typeof adapterId !== 'string' || !adapterId.trim()
      || typeof nonce !== 'string' || !nonce.trim()
      || !Number.isSafeInteger(expiresAt) || expiresAt < 0
      || !Number.isSafeInteger(currentSeconds) || currentSeconds < 0) {
      throw new TypeError('Host assertion nonce input is invalid.');
    }
    this.#db.prepare('DELETE FROM host_assertion_nonces WHERE expires_at < ?').run(currentSeconds);
    const result = this.#db.prepare(`
      INSERT OR IGNORE INTO host_assertion_nonces(adapter_id, nonce, expires_at, consumed_at)
      VALUES(?, ?, ?, ?)
    `).run(adapterId, nonce, expiresAt, currentSeconds);
    return result.changes === 1;
  }

  revokeSession(adapterId, identity, eventNonce, revokedAt, reason) {
    const uuid = value => typeof value === 'string'
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    if (typeof adapterId !== 'string' || !adapterId.trim()
      || !identity || !uuid(identity.host_installation_id)
      || !uuid(identity.authenticated_account_id) || !uuid(identity.host_session_id)
      || !uuid(eventNonce) || !Number.isSafeInteger(revokedAt) || revokedAt < 0
      || !['logout', 'session_rotation'].includes(reason)) {
      throw new TypeError('Host session revocation input is invalid.');
    }
    const releaseCoordinator = beginCoordinatorLock(this.#coordinatorDb);
    try {
      this.#db.exec('BEGIN IMMEDIATE');
      try {
        const nonce = this.#db.prepare(`
          INSERT OR IGNORE INTO host_assertion_nonces(adapter_id, nonce, expires_at, consumed_at)
          VALUES(?, ?, ?, ?)
        `).run(adapterId, eventNonce, revokedAt + 120, revokedAt);
        if (nonce.changes !== 1) {
          this.#db.exec('ROLLBACK');
          return false;
        }
        this.#db.prepare(`
          INSERT INTO host_session_revocations(
            adapter_id, host_installation_id, authenticated_account_id,
            host_session_id, revoked_at, reason, event_nonce
          ) VALUES(?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(adapter_id, host_installation_id, authenticated_account_id, host_session_id)
          DO UPDATE SET revoked_at = MIN(revoked_at, excluded.revoked_at),
            reason = excluded.reason, event_nonce = excluded.event_nonce
        `).run(adapterId, identity.host_installation_id, identity.authenticated_account_id,
          identity.host_session_id, revokedAt, reason, eventNonce);
        this.#db.exec('COMMIT');
        return true;
      } catch (error) {
        try { this.#db.exec('ROLLBACK'); } catch {}
        throw error;
      }
    } finally {
      releaseCoordinator();
    }
  }

  isSessionRevoked(adapterId, identity) {
    const uuid = value => typeof value === 'string'
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    if (typeof adapterId !== 'string' || !adapterId.trim()
      || !identity || !uuid(identity.host_installation_id)
      || !uuid(identity.authenticated_account_id) || !uuid(identity.host_session_id)) {
      return true;
    }
    return Boolean(this.#db.prepare(`
      SELECT 1 FROM host_session_revocations
      WHERE adapter_id = ? AND host_installation_id = ?
        AND authenticated_account_id = ? AND host_session_id = ?
      LIMIT 1
    `).get(adapterId, identity.host_installation_id, identity.authenticated_account_id,
      identity.host_session_id));
  }

  close() {
    try { this.#db.close(); } finally { this.#coordinatorDb.close(); }
  }
}

/** Read-only view of the durable Host session revocation ledger for Gateway revalidation. */
export class HostSessionRevocationReader {
  #db;

  constructor({ path } = {}) {
    if (typeof path !== 'string' || !path.trim() || !isAbsolute(path) || !existsSync(path)) {
      throw new TypeError('Host session revocation reader requires an existing absolute database path.');
    }
    this.#db = new DatabaseSync(resolve(path), { readOnly: true });
    try {
      this.#db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000;');
      const table = this.#db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name='host_session_revocations'\").get();
      if (!table) throw new Error('HOST_SESSION_REVOCATION_LEDGER_UNAVAILABLE');
    } catch (error) {
      this.#db.close();
      throw error;
    }
  }

  isSessionRevoked(adapterId, identity) {
    const uuid = value => typeof value === 'string'
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    if (typeof adapterId !== 'string' || !adapterId.trim()
      || !identity || !uuid(identity.host_installation_id)
      || !uuid(identity.authenticated_account_id) || !uuid(identity.host_session_id)) return true;
    return Boolean(this.#db.prepare(`
      SELECT 1 FROM host_session_revocations
      WHERE adapter_id = ? AND host_installation_id = ?
        AND authenticated_account_id = ? AND host_session_id = ?
      LIMIT 1
    `).get(adapterId, identity.host_installation_id, identity.authenticated_account_id,
      identity.host_session_id));
  }

  close() {
    this.#db.close();
  }
}
