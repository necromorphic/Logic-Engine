import { createHash, randomUUID } from 'node:crypto';

/**
 * Conservative bridge between the generic filesystem scanner and the existing
 * HostLifecycleJournal. It never blesses unexplained filesystem changes.
 *
 * A first complete scan establishes a filesystem baseline after conversation
 * enrollment. Later scans must match it exactly. Until operation-specific
 * before/after file deltas are durably linked to the journal, any delta is
 * NON_READY rather than being guessed as legitimate.
 */
export async function reconcileFilesystemInventory({
  journal,
  conversationId,
  inventory,
  sourceFingerprint,
  expectedRoot,
}) {
  const fail = (reason, details = {}) => ({ status: 'NON_READY', reason, ...details });
  if (!journal || typeof conversationId !== 'string' || !conversationId
    || typeof sourceFingerprint !== 'string' || !sourceFingerprint
    || typeof expectedRoot !== 'string' || !expectedRoot) {
    return fail('invalid filesystem reconciliation arguments');
  }
  if (!inventory || inventory.status !== 'complete'
    || inventory.scope !== 'single-root-regular-files-only'
    || inventory.root !== expectedRoot
    || !Array.isArray(inventory.entries)
    || !Number.isInteger(inventory.file_count)
    || inventory.file_count !== inventory.entries.length
    || !/^[a-f0-9]{64}$/.test(inventory.snapshot_sha256 ?? '')) {
    return fail('filesystem inventory is incomplete, unsupported, or outside the approved root');
  }
  const paths = new Set();
  let previousPath = null;
  for (const entry of inventory.entries) {
    if (!entry || typeof entry.path !== 'string' || !entry.path
      || entry.path.startsWith('/') || entry.path.split('/').some(part => !part || part === '.' || part === '..')
      || paths.has(entry.path) || (previousPath !== null && entry.path.localeCompare(previousPath) < 0)
      || !entry.identity || typeof entry.identity !== 'object'
      || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '')) {
      return fail('filesystem inventory contains malformed, duplicate, or unsafe entries');
    }
    paths.add(entry.path);
    previousPath = entry.path;
  }
  const computedSnapshot = createHash('sha256').update(JSON.stringify(inventory.entries)).digest('hex');
  if (computedSnapshot !== inventory.snapshot_sha256) {
    return fail('filesystem inventory fingerprint does not match its entries');
  }
  const integrity = await journal.verifyIntegrity(conversationId);
  if (integrity.status !== 'INTEGRITY_OK') return fail('Host lifecycle journal is not integrity-verified', { cause: integrity.reason });
  const ledger = await journal.exportCaptureLedger(conversationId);
  const checkpoints = ledger.records.filter(record =>
    record.operation === 'filesystem-inventory-baseline'
    || record.operation === 'filesystem-inventory-reconciled');
  const current = {
    root: expectedRoot,
    snapshotSha256: inventory.snapshot_sha256,
    fileCount: inventory.file_count,
    entries: inventory.entries.map(entry => ({
      path: entry.path,
      identity: entry.identity,
      sha256: entry.sha256,
    })),
  };
  if (!checkpoints.length) {
    const row = await journal.append({
      conversationId,
      eventId: randomUUID(),
      operation: 'filesystem-inventory-baseline',
      sourceFingerprint,
      payload: { schemaVersion: 1, inventory: current },
    });
    if (row?.status === 'NON_READY') return fail('filesystem baseline could not be durably recorded', { cause: row.reason });
    return { status: 'BASELINED_REVIEW_ONLY', sequence: row.sequence, snapshotSha256: current.snapshotSha256 };
  }
  const previous = checkpoints.at(-1).payload?.inventory;
  if (!previous || previous.root !== current.root) {
    return fail('filesystem inventory root changed or previous checkpoint is malformed');
  }
  if (previous.snapshotSha256 !== current.snapshotSha256
    || JSON.stringify(previous.entries) !== JSON.stringify(current.entries)) {
    return fail('unexplained filesystem change detected; no operation-specific durable delta proof exists', {
      previousSnapshotSha256: previous.snapshotSha256,
      currentSnapshotSha256: current.snapshotSha256,
      previousFileCount: previous.fileCount,
      currentFileCount: current.fileCount,
    });
  }
  return {
    status: 'UNCHANGED_REVIEW_ONLY',
    sequence: checkpoints.at(-1).sequence,
    snapshotSha256: current.snapshotSha256,
  };
}
