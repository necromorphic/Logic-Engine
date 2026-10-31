import { createHash, randomUUID } from 'node:crypto';
import { isVerifiedFileInventory } from './fs-inventory.js';

const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}'
    : JSON.stringify(value);
const physicalId = entry => {
  const id = entry?.identity;
  if (!id || id.ino === undefined || id.ino === null) return null;
  return process.platform === 'win32' ? 'win:' + String(id.ino) : 'posix:' + String(id.dev) + ':' + String(id.ino);
};

function fileDelta(beforeEntries, afterEntries) {
  const before = new Map(beforeEntries.map(entry => [entry.path, entry]));
  const after = new Map(afterEntries.map(entry => [entry.path, entry]));
  const beforeIds = new Map(beforeEntries.map(entry => [physicalId(entry), entry]).filter(([id]) => id));
  const afterIds = new Map(afterEntries.map(entry => [physicalId(entry), entry]).filter(([id]) => id));
  const delta = { added: [], removed: [], modified: [], metadataChanged: [], replaced: [], moved: [] };
  for (const [path, old] of before) {
    const next = after.get(path);
    if (!next) {
      const moved = afterIds.get(physicalId(old));
      if (moved && moved.path !== path) {
        delta.moved.push({
          from: path,
          to: moved.path,
          identity: physicalId(old),
          beforeIdentity: old.identity,
          afterIdentity: moved.identity,
          // A native rename can be followed by a write before the next scan.
          // Preserve both digests so the move record cannot hide that edit.
          sha256: old.sha256,
          beforeSha256: old.sha256,
          afterSha256: moved.sha256,
          contentChanged: old.sha256 !== moved.sha256,
          metadataChanged: canonical(old.identity) !== canonical(moved.identity),
        });
      } else delta.removed.push({ path, identity: old.identity, sha256: old.sha256 });
    } else if (physicalId(old) !== physicalId(next)) {
      delta.replaced.push({ path, before: { identity: old.identity, sha256: old.sha256 }, after: { identity: next.identity, sha256: next.sha256 } });
    } else if (old.sha256 !== next.sha256) {
      delta.modified.push({ path, identity: next.identity, beforeSha256: old.sha256, afterSha256: next.sha256 });
    } else if (canonical(old.identity) !== canonical(next.identity)) {
      delta.metadataChanged.push({ path, beforeIdentity: old.identity, afterIdentity: next.identity, sha256: next.sha256 });
    }
  }
  for (const [path, next] of after) {
    if (before.has(path)) continue;
    const moved = beforeIds.get(physicalId(next));
    if (!moved || moved.path === path) delta.added.push({ path, identity: next.identity, sha256: next.sha256 });
  }
  return delta;
}

/**
 * Persists a full-root baseline and file-level deltas. A delta is evidence of
 * what changed, not authorization to accept that change. Without a matching
 * operation-specific persisted receipt, the conversation remains NON_READY.
 */
export async function reconcileFilesystemInventory({ journal, conversationId, inventory, sourceFingerprint, expectedRoot }) {
  const fail = (reason, details = {}) => ({ status: 'NON_READY', reason, ...details });
  if (!journal || typeof conversationId !== 'string' || !conversationId
    || typeof sourceFingerprint !== 'string' || !sourceFingerprint
    || typeof expectedRoot !== 'string' || !expectedRoot) return fail('invalid filesystem reconciliation arguments');
  if (!isVerifiedFileInventory(inventory)) return fail('filesystem inventory was not produced by the trusted scanner in this process');
  if (inventory.status !== 'complete' || inventory.scope !== 'single-root-regular-files-only'
    || inventory.root !== expectedRoot || !Array.isArray(inventory.entries)
    || inventory.file_count !== inventory.entries.length
    || !/^[a-f0-9]{64}$/.test(inventory.snapshot_sha256 ?? '')) {
    return fail('filesystem inventory is incomplete, unsupported, or outside the approved root');
  }
  if (process.platform === 'win32' && (inventory.snapshot_provider !== 'windows-vss-client-accessible'
    || inventory.snapshot_consistency !== 'VSS_POINT_IN_TIME_READ_ONLY'
    || inventory.reparse_points !== 'ALL_FILE_ATTRIBUTE_REPARSE_POINT_ENTRIES_REJECTED'
    || !/^[{]?[0-9a-f-]{36}[}]?$/i.test(inventory.snapshot_id ?? ''))) {
    return fail('Windows inventory lacks a verified VSS point-in-time snapshot and complete reparse-point audit');
  }
  const paths = new Set();
  let previousPath = null;
  for (const entry of inventory.entries) {
    if (!entry || typeof entry.path !== 'string' || !entry.path || entry.path.startsWith('/')
      || entry.path.split('/').some(part => !part || part === '.' || part === '..')
      || paths.has(entry.path) || (previousPath !== null && entry.path.localeCompare(previousPath) < 0)
      || !physicalId(entry) || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '')) {
      return fail('filesystem inventory contains malformed, duplicate, or unsafe entries');
    }
    paths.add(entry.path);
    previousPath = entry.path;
  }
  if (sha(JSON.stringify(inventory.entries)) !== inventory.snapshot_sha256) return fail('filesystem inventory fingerprint does not match its entries');
  const integrity = await journal.verifyIntegrity(conversationId);
  if (integrity.status !== 'INTEGRITY_OK') return fail('Host lifecycle journal is not integrity-verified', { cause: integrity.reason });
  if (integrity.sourceFingerprint !== sourceFingerprint) return fail('current conversation fingerprint differs from the accepted lifecycle journal head');
  if (typeof journal.pendingMutation !== 'function') return fail('Host lifecycle journal cannot verify whether a mutation is pending');
  const pending = await journal.pendingMutation(conversationId);
  if (pending?.status !== 'NO_PENDING_MUTATION') return fail('Host lifecycle mutation is pending or its state cannot be verified', {
    pendingOperation: pending?.operation ?? null, pendingSequence: pending?.sequence ?? null,
  });

  const ledger = await journal.exportCaptureLedger(conversationId);
  const records = ledger.records ?? [];
  const checkpoints = records.filter(record => record.operation === 'filesystem-inventory-baseline'
    || record.operation === 'filesystem-inventory-reconciled');
  const current = {
    root: expectedRoot, snapshotSha256: inventory.snapshot_sha256, fileCount: inventory.file_count,
    ...(inventory.snapshot_id ? { snapshotId: inventory.snapshot_id } : {}),
    ...(inventory.snapshot_provider ? { snapshotProvider: inventory.snapshot_provider } : {}),
    ...(inventory.snapshot_consistency ? { snapshotConsistency: inventory.snapshot_consistency } : {}),
    ...(inventory.reparse_points ? { reparsePoints: inventory.reparse_points } : {}),
    entries: inventory.entries.map(({ path, identity, sha256 }) => ({ path, identity, sha256 })),
  };
  if (!checkpoints.length) {
    const row = await journal.append({
      conversationId, eventId: randomUUID(), operation: 'filesystem-inventory-baseline',
      sourceFingerprint, requireNoPendingMutation: true, payload: { schemaVersion: 2, inventory: current },
    });
    if (row?.status === 'NON_READY') return fail('filesystem baseline could not be durably recorded', { cause: row.reason });
    return { status: 'BASELINED_REVIEW_ONLY', sequence: row.sequence, snapshotSha256: current.snapshotSha256, fileCount: current.fileCount };
  }

  const previous = checkpoints.at(-1).payload?.inventory;
  if (!previous || previous.root !== current.root || !Array.isArray(previous.entries)) return fail('filesystem inventory root changed or previous checkpoint is malformed');
  const delta = fileDelta(previous.entries, current.entries);
  const counts = Object.fromEntries(Object.entries(delta).map(([key, rows]) => [key, rows.length]));
  const changed = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const finalPending = await journal.pendingMutation(conversationId);
  if (finalPending?.status !== 'NO_PENDING_MUTATION') return fail('Host lifecycle mutation started during filesystem reconciliation', {
    pendingOperation: finalPending?.operation ?? null, pendingSequence: finalPending?.sequence ?? null,
  });
  const unresolvedObservations = records.filter(record => record.operation === 'filesystem-inventory-delta-observed');
  if (!changed && previous.snapshotSha256 === current.snapshotSha256 && unresolvedObservations.length) {
    return fail('a previously observed filesystem delta remains unresolved; restoring baseline bytes does not erase lifecycle history', {
      unresolvedDeltaCount: unresolvedObservations.length,
      lastObservationSequence: unresolvedObservations.at(-1).sequence,
      snapshotSha256: current.snapshotSha256,
    });
  }
  if (!changed && previous.snapshotSha256 === current.snapshotSha256) {
    return { status: 'UNCHANGED_REVIEW_ONLY', sequence: checkpoints.at(-1).sequence, snapshotSha256: current.snapshotSha256, fileCount: current.fileCount };
  }
  if (changed > 5000) return fail('file-level delta exceeds the bounded durable journal limit', {
    counts, maximumChangedFiles: 5000, snapshotSha256: current.snapshotSha256,
  });

  const deltaRecord = {
    schemaVersion: 1, baselineSequence: checkpoints.at(-1).sequence,
    previousSnapshotSha256: previous.snapshotSha256, currentSnapshotSha256: current.snapshotSha256,
    previousFileCount: previous.fileCount, currentFileCount: current.fileCount, counts, delta,
  };
  const deltaSha256 = sha(canonical(deltaRecord));
  const existing = records.find(record => record.operation === 'filesystem-inventory-delta-observed'
    && record.payload?.deltaSha256 === deltaSha256);
  let observationSequence = existing?.sequence ?? null;
  if (!existing) {
    const row = await journal.append({
      conversationId, eventId: randomUUID(), operation: 'filesystem-inventory-delta-observed',
      sourceFingerprint, requireNoPendingMutation: true, payload: { ...deltaRecord, deltaSha256 },
    });
    if (row?.status === 'NON_READY') return fail('file-level filesystem delta could not be durably journaled', { cause: row.reason, deltaSha256 });
    observationSequence = row.sequence;
  }
  const afterAppendPending = await journal.pendingMutation(conversationId);
  if (afterAppendPending?.status !== 'NO_PENDING_MUTATION') return fail('Host lifecycle mutation overlapped file-level reconciliation', {
    pendingOperation: afterAppendPending?.operation ?? null, pendingSequence: afterAppendPending?.sequence ?? null,
    deltaSha256, observationSequence,
  });
  return fail('file-level delta was recorded but no matching operation-specific persisted receipt authorizes it', {
    deltaSha256, observationSequence, baselineSequence: checkpoints.at(-1).sequence, counts, delta,
  });
}
