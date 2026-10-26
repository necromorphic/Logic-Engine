import { DatabaseSync } from 'node:sqlite';
import { dirname, isAbsolute, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

/**
 * Open the shared SQLite coordinator database used to serialize mutations
 * across independent Core/Provider processes. All participants must receive
 * the same absolute path. This database is a lock primitive, not a data store.
 */
export function openCoordinatorDatabase(path) {
  if (typeof path !== 'string' || !path.trim() || path === ':memory:') {
    throw new TypeError('A file-backed coordinator database path is required.');
  }
  if (!isAbsolute(path)) {
    throw new TypeError('The coordinator database path must be absolute and shared by all participants.');
  }
  const absolutePath = resolve(path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  const db = new DatabaseSync(absolutePath);
  try {
    db.exec('PRAGMA busy_timeout=5000;');
    return db;
  } catch (error) {
    try { db.close(); } catch {}
    throw error;
  }
}

/**
 * Acquire the cross-process write lock synchronously. Keep the returned lease
 * until the participant's own local mutation has committed or rolled back.
 * Release with ROLLBACK: the coordinator contains no business data and has no
 * independent commit point. Never await while a lease is held.
 */
export function beginCoordinatorLock(db) {
  if (!db || typeof db.exec !== 'function') throw new TypeError('A coordinator database handle is required.');
  db.exec('BEGIN IMMEDIATE');
  let released = false;
  return () => {
    if (released) return;
    db.exec('ROLLBACK');
    released = true;
  };
}


/**
 * Run one synchronous local mutation while holding the shared coordinator.
 * The callback must include its complete local transaction (commit or
 * rollback); asynchronous work is rejected because the lease cannot span await.
 */
export function withCoordinatorLock(db, callback) {
  if (typeof callback !== 'function') throw new TypeError('A synchronous coordinator callback is required.');
  if (callback.constructor?.name === 'AsyncFunction') {
    throw new TypeError('Coordinator callback must be synchronous; do not await while a coordinator lease is held.');
  }
  const release = beginCoordinatorLock(db);
  try {
    const result = callback();
    if (result !== null && (typeof result === 'object' || typeof result === 'function')
      && typeof result.then === 'function') {
      throw new TypeError('Coordinator callback must be synchronous; do not await while a coordinator lease is held.');
    }
    return result;
  } finally {
    release();
  }
}
