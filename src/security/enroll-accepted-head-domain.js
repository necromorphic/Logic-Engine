import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { beginCoordinatorLock, openCoordinatorDatabase } from '../storage/coordinator-lock.js';
import {
  enrollAcceptedHeadSync,
  finalizeAcceptedHeadSync,
  getAcceptedHeadStatusSync,
} from './accepted-head-client-sync.js';

const validText = (value, max = 200) => typeof value === 'string'
  && value === value.trim()
  && value.length > 0
  && value.length <= max
  && ![...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });

/**
 * Explicit one-time baseline enrollment for a Core or Provider file-backed DB.
 * Caller must provide an approval ID and digest of independently reviewed
 * current-state/source-inventory evidence. This function does not manufacture
 * that evidence and must never be called automatically during startup.
 */
export function enrollAcceptedHeadDomain({
  domain,
  databasePath,
  coordinatorPath,
  port,
  token,
  approvalId,
  baselineDigest,
}) {
  if (!['core', 'provider'].includes(domain)
    || typeof databasePath !== 'string' || !isAbsolute(databasePath)
    || typeof coordinatorPath !== 'string' || !isAbsolute(coordinatorPath)
    || !Number.isInteger(port) || port < 1 || port > 65535
    || typeof token !== 'string' || token.length < 32
    || !validText(approvalId, 160)
    || typeof baselineDigest !== 'string' || !/^[a-f0-9]{64}$/.test(baselineDigest)) {
    throw new TypeError('Invalid accepted-head enrollment request.');
  }
  if (!existsSync(databasePath) || !existsSync(coordinatorPath)) {
    throw new Error('ACCEPTED_HEAD_ENROLLMENT_PATH_UNAVAILABLE');
  }
  const canonicalDatabasePath = resolve(realpathSync(databasePath));
  const canonicalCoordinatorPath = resolve(realpathSync(coordinatorPath));
  if (canonicalDatabasePath === canonicalCoordinatorPath) {
    throw new Error('ACCEPTED_HEAD_ENROLLMENT_PATH_ALIAS');
  }
  const databaseStat = statSync(canonicalDatabasePath, { bigint: true });
  const coordinatorStat = statSync(canonicalCoordinatorPath, { bigint: true });
  if (databaseStat.dev === coordinatorStat.dev && databaseStat.ino === coordinatorStat.ino) {
    throw new Error('ACCEPTED_HEAD_ENROLLMENT_PATH_ALIAS');
  }

  const coordinatorDb = openCoordinatorDatabase(canonicalCoordinatorPath);
  let release = null;
  let db = null;
  let localCommitted = false;
  try {
    release = beginCoordinatorLock(coordinatorDb);
    const authority = getAcceptedHeadStatusSync({ port, token });
    if (authority.pending.core || authority.pending.provider
      || authority.enrolled[domain] || authority.heads[domain] !== 0) {
      throw new Error('ACCEPTED_HEAD_ENROLLMENT_AUTHORITY_NOT_FRESH');
    }

    db = new DatabaseSync(canonicalDatabasePath);
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='accepted_head_state'").get();
    if (!table) throw new Error('ACCEPTED_HEAD_LOCAL_STATE_MISSING');
    const local = db.prepare('SELECT head,enrolled FROM accepted_head_state WHERE singleton=1').get();
    if (!local || local.head !== 0 || local.enrolled !== 0) {
      throw new Error('ACCEPTED_HEAD_LOCAL_STATE_NOT_FRESH');
    }

    const operationId = 'enroll:' + domain + ':' + approvalId;
    const operationDigest = createHash('sha256').update(JSON.stringify({
      domain,
      operation_id: operationId,
      approval_id: approvalId,
      baseline_digest: baselineDigest,
      expected_head: 0,
    })).digest('hex');

    const advanced = enrollAcceptedHeadSync({
      domain, operationId, operationDigest, token, port,
    });
    if (advanced.status !== 'pending' || advanced.head !== 1 || advanced.replayed) {
      throw new Error('ACCEPTED_HEAD_ENROLLMENT_ADVANCE_INVALID');
    }

    db.exec('BEGIN IMMEDIATE');
    try {
      const updated = db.prepare('UPDATE accepted_head_state SET head=1,enrolled=1,last_operation_id=?,last_operation_digest=? WHERE singleton=1 AND head=0 AND enrolled=0')
        .run(operationId, operationDigest);
      if (updated.changes !== 1) throw new Error('ACCEPTED_HEAD_LOCAL_STATE_CHANGED');
      db.exec("CREATE TABLE IF NOT EXISTS accepted_head_enrollment_audit(singleton INTEGER PRIMARY KEY CHECK(singleton=1),domain TEXT NOT NULL CHECK(domain IN ('core','provider')),approval_id TEXT NOT NULL,baseline_digest TEXT NOT NULL,operation_id TEXT NOT NULL,enrolled_head INTEGER NOT NULL CHECK(enrolled_head=1),enrolled_at TEXT NOT NULL)");
      db.prepare('INSERT INTO accepted_head_enrollment_audit(singleton,domain,approval_id,baseline_digest,operation_id,enrolled_head,enrolled_at) VALUES(1,?,?,?,?,1,?)')
        .run(domain, approvalId, baselineDigest, operationId, new Date().toISOString());
      db.exec('COMMIT');
      localCommitted = true;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }

    try {
      finalizeAcceptedHeadSync({ domain, operationId, operationDigest, token, port });
    } catch {
      throw new Error('ACCEPTED_HEAD_ENROLLMENT_PENDING');
    }
    return Object.freeze({
      domain,
      head: 1,
      approval_id: approvalId,
      baseline_digest: baselineDigest,
      operation_id: operationId,
      status: 'committed',
    });
  } finally {
    try { db?.close(); } finally {
      try { release?.(); } finally { coordinatorDb.close(); }
    }
    void localCommitted;
  }
}
