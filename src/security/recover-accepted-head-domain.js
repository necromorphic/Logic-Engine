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
    const status = getAcceptedHeadStatusSync({ port, token });
    db = new DatabaseSync(canonicalDatabasePath);
    const local = db.prepare('SELECT head,enrolled,last_operation_id,last_operation_digest FROM accepted_head_state WHERE singleton=1').get();
    if (!local || local.enrolled !== 1) throw new Error('ACCEPTED_HEAD_RECOVERY_LOCAL_STATE_INVALID');

    const otherDomain = domain === 'core' ? 'provider' : 'core';
    if (status.pending[otherDomain]) throw new Error('ACCEPTED_HEAD_RECOVERY_REQUIRES_RECONCILIATION');
    if (!status.pending[domain]) {
      if (status.enrolled[domain] && status.heads[domain] === local.head) {
        return Object.freeze({ domain, status: 'already_current', head: local.head });
      }
      throw new Error('ACCEPTED_HEAD_RECOVERY_REQUIRES_RECONCILIATION');
    }

    // Status readers intentionally receive only a pending bit, not operation
    // metadata. Finalize using the local checkpoint identity; the authority
    // validates the exact operation ID and digest without disclosing them.
    // Never repair a lower local head: it may be a restored stale backup.
    if (local.head !== status.heads[domain]
      || typeof local.last_operation_id !== 'string' || !local.last_operation_id
      || !/^[a-f0-9]{64}$/.test(local.last_operation_digest || '')) {
      throw new Error('ACCEPTED_HEAD_RECOVERY_REQUIRES_RECONCILIATION');
    }
    finalizeAcceptedHeadSync({
      domain,
      operationId: local.last_operation_id,
      operationDigest: local.last_operation_digest,
      token,
      port,
    });
    const after = getAcceptedHeadStatusSync({ port, token });
    if (after.pending.core || after.pending.provider
      || after.heads[domain] !== local.head || !after.enrolled[domain]) {
      throw new Error('ACCEPTED_HEAD_RECOVERY_REQUIRES_RECONCILIATION');
    }
    return Object.freeze({ domain, status: 'recovered_committed_operation', head: local.head });
  } finally {
    try { db?.close(); } finally {
      try { release?.(); } finally { coordinatorDb.close(); }
    }
  }
}
