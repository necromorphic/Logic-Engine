import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

function canonicalFilePath(path) {
  let candidate = resolve(path);
  const suffix = [];
  while (!existsSync(candidate)) {
    const parent = dirname(candidate);
    if (parent === candidate) break;
    suffix.unshift(basename(candidate));
    candidate = parent;
  }
  return resolve(realpathSync(candidate), ...suffix);
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
 * accepted-head-protected canonical database or the shared Coordinator DB.
 */
export class HostAssertionNonceStore {
  #db;

  constructor({ path, coreDatabasePath, coordinatorPath } = {}) {
    if (typeof path !== 'string' || !path.trim() || path === ':memory:') {
      throw new TypeError('Host assertion nonce store requires a durable file path.');
    }
    if (typeof coreDatabasePath !== 'string' || !coreDatabasePath.trim()
      || typeof coordinatorPath !== 'string' || !coordinatorPath.trim()) {
      throw new TypeError('Host assertion nonce store requires Core and Coordinator database paths.');
    }
    const noncePath = resolve(path);
    if (aliasesSameFile(noncePath, coreDatabasePath)
      || aliasesSameFile(noncePath, coordinatorPath)) {
      throw new Error('Host assertion nonce database must be separate from Core and Coordinator databases.');
    }
    mkdirSync(dirname(noncePath), { recursive: true });
    this.#db = new DatabaseSync(noncePath);
    try {
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
      `);
    } catch (error) {
      this.#db.close();
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

  close() {
    this.#db.close();
  }
}
