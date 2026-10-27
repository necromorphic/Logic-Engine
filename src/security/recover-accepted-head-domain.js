import { DatabaseSync } from 'node:sqlite';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { beginCoordinatorLock, openCoordinatorDatabase } from '../storage/coordinator-lock.js';
import { finalizeAcceptedHeadSync, getAcceptedHeadStatusSync } from './accepted-head-client-sync.js';

export function recoverAcceptedHeadDomain({ domain, databasePath, coordinatorPath, port, token }) {
  if (!['core', 'provider'].includes(domain)
    || typeof databasePath !== 'string' || !isAbsolute(databasePath)
    || typeof coordinatorPath !== 'string' || !isAbsolute(coordinatorPath)
    || !Number.isInteger(port) || port < 1 || port > 65535
    || typeof token !== 'string' || token.length < 32) {
    throw new TypeError('Invalid accepted-head recovery request.');
  }
  if (!existsSync(databasePath) || !existsSync(coordinatorPath)) {
    throw new Error('ACCEPTED_HEAD_RECOVERY_PATH_UNAVAILABLE');
  }
  const canonicalDatabasePath = resolve(realpathSync(databasePath));
  const canonicalCoordinatorPath = resolve(realpathSync(coordinatorPath));
  if (canonicalDatabasePath === canonicalCoordinatorPath) {
    throw new Error('ACCEPTED_HEAD_RECOVERY_PATH_ALIAS');
  }
  const databaseStat = statSync(canonicalDatabasePath, { bigint: true });
  const coordinatorStat = statSync(canonicalCoordinatorPath, { bigint: true });
  if (databaseStat.dev === coordinatorStat.dev && databaseStat.ino === coordinatorStat.ino) {
    throw new Error('ACCEPTED_HEAD_RECOVERY_PATH_ALIAS');
  }

  const coordinatorDb = openCoordinatorDatabase(canonicalCoordinatorPath);
  let release = null;
  let db = null;
  try {
    release = beginCoordinatorLock(coordinatorDb);
    const status = getAcceptedHeadStatusSync({ port });
    db = new DatabaseSync(canonicalDatabasePath);
    const local = db.prepare('SELECT head,enrolled,last_operation_id,last_operation_digest FROM accepted_head_state WHERE singleton=1').get();
    if (!local || local.enrolled !== 1) throw new Error('ACCEPTED_HEAD_RECOVERY_LOCAL_STATE_INVALID');

    const pending = status.pendingOperations.find((operation) => operation.domain === domain);
    if (!pending) {
      if (!status.pending[domain] && status.enrolled[domain] && status.heads[domain] === local.head) {
        return Object.freeze({ domain, status: 'already_current', head: local.head });
      }
      throw new Error('ACCEPTED_HEAD_RECOVERY_REQUIRES_RECONCILIATION');
    }

    // Only finalize when the local DB proves the exact operation committed in
    // the same transaction as its accepted head. Never auto-repair a lower local
    // head: it may be a restored backup with stale/revoked authorization state.
    if (local.head !== pending.resulting_head
      || local.last_operation_id !== pending.operation_id
      || local.last_operation_digest !== pending.operation_digest) {
      throw new Error('ACCEPTED_HEAD_RECOVERY_REQUIRES_RECONCILIATION');
    }
    finalizeAcceptedHeadSync({
      domain,
      operationId: pending.operation_id,
      operationDigest: pending.operation_digest,
      token,
      port,
    });
    return Object.freeze({ domain, status: 'recovered_committed_operation', head: local.head });
  } finally {
    try { db?.close(); } finally {
      try { release?.(); } finally { coordinatorDb.close(); }
    }
  }
}
