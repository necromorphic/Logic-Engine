import { createHash } from 'node:crypto';
import {
  lstat, open, realpath, readdir,
} from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { withWindowsVssSnapshot, isActiveWindowsVssSnapshot } from './windows-vss-snapshot.mjs';

const MAX_FILE_BYTES = 256 * 1024 * 1024;

// Windows path-based stat/lstat may report st_dev=0 while handle-based fstat
// reports the volume serial. Compare dev when both sources provide it.
const sameFileIdentity = (left, right) => left.ino === right.ino
  && (process.platform === 'win32'
    ? left.dev === 0n || right.dev === 0n || left.dev === right.dev
    : left.dev === right.dev);
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_TOTAL_ENTRIES = 100_000;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

// Reconciliation accepts only the exact immutable object produced by this
// scanner instance. A caller-supplied digest or copied manifest is not proof
// that the filesystem was scanned.
const verifiedInventories = new WeakSet();

export function isVerifiedFileInventory(inventory) {
  return inventory !== null && typeof inventory === 'object'
    && verifiedInventories.has(inventory);
}

function sealVerifiedInventory(inventory) {
  for (const entry of inventory.entries) {
    Object.freeze(entry.identity);
    Object.freeze(entry);
  }
  Object.freeze(inventory.entries);
  Object.freeze(inventory);
  verifiedInventories.add(inventory);
  return inventory;
}


async function readBoundedFile(handle, maxBytes, overflowCode) {
  const chunks = [];
  let total = 0;
  let position = 0;
  while (total <= maxBytes) {
    const length = Math.min(64 * 1024, maxBytes + 1 - total);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > maxBytes) throw new Error(overflowCode);
    chunks.push(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return Buffer.concat(chunks, total);
}
const fail = (code) => ({ status: 'non_ready', code });

function isWithinRoot(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel));
}

function statIdentity(stat) {
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    mode: Number(stat.mode),
    size: Number(stat.size),
    mtimeMs: Number(stat.mtimeMs),
    ctimeMs: Number(stat.ctimeMs),
  };
}

/**
 * Enumerate every regular file below one explicitly configured data root.
 *
 * This is a fail-closed filesystem primitive, not a SillyTavern semantic
 * inventory. Callers must supply the exact approved roots and separately map
 * files to logical conversations/versions. No content bytes leave this
 * function; only SHA-256 digests are returned.
 *
 * Symlinks, non-regular entries, unreadable paths, path escapes and concurrent
 * changes are rejected. A second complete pass must match the first pass.
 */
async function enumerateStableFileInventoryOnRoot(rootPath, options = {}) {
  const { allowSnapshotWithoutNoFollow = false, reportedRoot = null, snapshotId = null } = options;
  if (typeof rootPath !== 'string' || !rootPath.trim() || !isAbsolute(rootPath)) {
    return fail('HOST_INVENTORY_ROOT_INVALID');
  }

  let root;
  let initialRootIdentity;
  try {
    // Node's Windows path resolver strips the trailing separator from VSS device roots.
    // GLOBALROOT shadow-volume roots must retain it or fs.lstat reports ENOENT.
    const requestedRoot = allowSnapshotWithoutNoFollow
      ? (rootPath.endsWith(sep) ? rootPath : rootPath + sep)
      : resolve(rootPath);
    const requestedRootStat = await lstat(requestedRoot, { bigint: true });
    if (!requestedRootStat.isDirectory() || requestedRootStat.isSymbolicLink()) return fail('HOST_INVENTORY_ROOT_UNSAFE');

    // Windows is admitted only when the caller holds a live, process-local
    // VSS lease. That provider has already rejected every FILE_ATTRIBUTE_REPARSE_POINT
    // entry on the immutable snapshot before this scanner can read it.
    if (process.platform === 'win32' && !allowSnapshotWithoutNoFollow) return fail('HOST_INVENTORY_PLATFORM_REPARSE_UNVERIFIED');

    // A VSS GLOBALROOT path is already an attested device path. Do not
    // canonicalize it through realpath: keep the trailing separator required
    // by Windows device paths and avoid rewriting the snapshot namespace.
    root = allowSnapshotWithoutNoFollow ? requestedRoot : await realpath(requestedRoot);
    if (!allowSnapshotWithoutNoFollow && root !== requestedRoot) return fail('HOST_INVENTORY_ROOT_ALIAS_UNSUPPORTED');
    const rootStat = await lstat(root, { bigint: true });
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return fail('HOST_INVENTORY_ROOT_UNSAFE');
    initialRootIdentity = {
      dev: rootStat.dev, ino: rootStat.ino,
      mtimeMs: rootStat.mtimeMs, ctimeMs: rootStat.ctimeMs,
    };
  } catch (error) {
    // Keep the path private while retaining the OS failure class needed to
    // distinguish a missing VSS device path from access/namespace failures.
    const reason = typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
      ? error.code : 'UNKNOWN';
    return fail('HOST_INVENTORY_ROOT_UNAVAILABLE_' + reason);
  }

  // Validate the configured root before platform capability gating so invalid
  // paths retain precise failure codes on every supported OS.
  if (typeof fsConstants.O_NOFOLLOW !== 'number' && !allowSnapshotWithoutNoFollow) return fail('HOST_INVENTORY_PLATFORM_NOFOLLOW_UNAVAILABLE');

  async function scanOnce() {
    const entries = [];
    let totalBytes = 0;
    let totalEntries = 0;

    async function walk(directory) {
      let names;
      try {
        names = await readdir(directory);
      } catch {
        throw new Error('HOST_INVENTORY_UNREADABLE_DIRECTORY');
      }
      if (names.length > MAX_TOTAL_ENTRIES) throw new Error('HOST_INVENTORY_ENTRY_COUNT_LIMIT');
      names.sort();

      for (const name of names) {
        totalEntries++;
        if (totalEntries > MAX_TOTAL_ENTRIES) throw new Error('HOST_INVENTORY_ENTRY_COUNT_LIMIT');
        const fullPath = allowSnapshotWithoutNoFollow ? join(directory, name) : resolve(directory, name);
        if (!isWithinRoot(root, fullPath)) throw new Error('HOST_INVENTORY_PATH_ESCAPE');

        let before;
        try {
          before = await lstat(fullPath, { bigint: true });
        } catch {
          throw new Error('HOST_INVENTORY_ENTRY_CHANGED');
        }
        if (before.isSymbolicLink()) throw new Error('HOST_INVENTORY_SYMLINK_UNSUPPORTED');

        if (before.isDirectory()) {
          await walk(fullPath);
          const afterDirectory = await lstat(fullPath, { bigint: true });
          if (!afterDirectory.isDirectory() || afterDirectory.isSymbolicLink()
            || !sameFileIdentity(afterDirectory, before)
            || afterDirectory.mtimeMs !== before.mtimeMs || afterDirectory.ctimeMs !== before.ctimeMs) {
            throw new Error('HOST_INVENTORY_DIRECTORY_CHANGED');
          }
          continue;
        }

        if (!before.isFile()) throw new Error('HOST_INVENTORY_NON_REGULAR_ENTRY');

        let handle;
        try {
          const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
          // On Windows this path is reachable only through a live VSS lease;
          // the immutable snapshot plus the pre-scan reparse audit replaces O_NOFOLLOW.
          handle = await open(fullPath, fsConstants.O_RDONLY | noFollow);
          const openedBefore = await handle.stat({ bigint: true });
          if (!openedBefore.isFile() || !sameFileIdentity(openedBefore, before)) {
            throw new Error('HOST_INVENTORY_FILE_IDENTITY_CHANGED');
          }
          if (openedBefore.size > MAX_FILE_BYTES) throw new Error('HOST_INVENTORY_FILE_SIZE_LIMIT');
          const remainingTotalBytes = MAX_TOTAL_BYTES - totalBytes;
          if (openedBefore.size > remainingTotalBytes) throw new Error('HOST_INVENTORY_TOTAL_SIZE_LIMIT');
          const bytes = await readBoundedFile(
            handle,
            Math.min(MAX_FILE_BYTES, remainingTotalBytes),
            remainingTotalBytes < MAX_FILE_BYTES ? 'HOST_INVENTORY_TOTAL_SIZE_LIMIT' : 'HOST_INVENTORY_FILE_SIZE_LIMIT',
          );
          const openedAfter = await handle.stat({ bigint: true });
          const pathAfter = await lstat(fullPath, { bigint: true });
          if (!pathAfter.isFile() || pathAfter.isSymbolicLink()
            || !sameFileIdentity(openedAfter, openedBefore)
            || openedAfter.size !== openedBefore.size || openedAfter.mtimeMs !== openedBefore.mtimeMs
            || openedAfter.ctimeMs !== openedBefore.ctimeMs
            || !sameFileIdentity(pathAfter, openedAfter)
            || BigInt(bytes.byteLength) !== openedAfter.size) {
            throw new Error('HOST_INVENTORY_FILE_CHANGED_DURING_READ');
          }
          totalBytes += bytes.byteLength;
          entries.push({
            path: relative(root, fullPath).split(sep).join('/'),
            identity: statIdentity(openedAfter),
            sha256: sha256(bytes),
          });
        } finally {
          await handle?.close();
        }
      }
    }

    await walk(root);
    entries.sort((a, b) => a.path.localeCompare(b.path));
    return entries;
  }

  try {
    const first = await scanOnce();
    const second = await scanOnce();
    const finalRootStat = await lstat(root, { bigint: true });
    if (!finalRootStat.isDirectory() || finalRootStat.isSymbolicLink()
      || !sameFileIdentity(finalRootStat, initialRootIdentity)
      || finalRootStat.mtimeMs !== initialRootIdentity.mtimeMs
      || finalRootStat.ctimeMs !== initialRootIdentity.ctimeMs) {
      return fail('HOST_INVENTORY_ROOT_CHANGED_DURING_SCAN');
    }
    const identities = new Set();
    for (const entry of second) {
      const key = entry.identity.dev + ':' + entry.identity.ino;
      if (identities.has(key)) return fail('HOST_INVENTORY_DUPLICATE_FILE_IDENTITY');
      identities.add(key);
    }
    const firstDigest = sha256(JSON.stringify(first));
    const secondDigest = sha256(JSON.stringify(second));
    if (firstDigest !== secondDigest) return fail('HOST_INVENTORY_UNSTABLE');
    const totalBytes = second.reduce((total, entry) => total + entry.identity.size, 0);
    return sealVerifiedInventory({
      status: 'complete',
      root: reportedRoot ?? root,
      file_count: second.length,
      total_bytes: totalBytes,
      ...(snapshotId ? { snapshot_id: snapshotId } : {}),
      snapshot_sha256: secondDigest,
      entries: second,
      // Completeness is limited to this one configured root and the filesystem
      // semantics supported by the current runtime. It is not an ST-wide claim.
      scope: 'single-root-regular-files-only',
    });
  } catch (error) {
    return fail(typeof error?.message === 'string' && error.message.startsWith('HOST_INVENTORY_')
      ? error.message : 'HOST_INVENTORY_SCAN_FAILED');
  }
}


/**
 * Scan only through an active, process-local VSS lease. Exported for integration
 * tests and tightly-scoped Host orchestration; fabricated or expired leases fail.
 */
export async function enumerateStableFileInventoryFromWindowsSnapshot(lease) {
  if (!isActiveWindowsVssSnapshot(lease)) return fail('HOST_INVENTORY_WINDOWS_SNAPSHOT_UNTRUSTED');
  const inventory = await enumerateStableFileInventoryOnRoot(lease.snapshotRoot, {
    allowSnapshotWithoutNoFollow: true,
    reportedRoot: lease.root,
    snapshotId: lease.snapshotId,
  });
  if (inventory.status !== 'complete') return inventory;
  return sealVerifiedInventory({
    ...inventory,
    snapshot_provider: lease.provider,
    snapshot_consistency: lease.consistency,
    reparse_points: lease.reparsePoints,
  });
}

/**
 * Windows inventory is read only from a VSS point-in-time snapshot. The VSS
 * provider audits FILE_ATTRIBUTE_REPARSE_POINT on every descendant before the
 * scanner opens any file. If VSS or the reparse audit is unavailable, return
 * NON_READY; never fall back to scanning the mutable live tree.
 */
export async function enumerateStableFileInventory(rootPath) {
  if (typeof rootPath !== 'string' || !rootPath.trim() || !isAbsolute(rootPath)) {
    return fail('HOST_INVENTORY_ROOT_INVALID');
  }
  if (process.platform !== 'win32') {
    return enumerateStableFileInventoryOnRoot(rootPath);
  }
  try {
    return await withWindowsVssSnapshot(rootPath, lease =>
      enumerateStableFileInventoryFromWindowsSnapshot(lease));
  } catch (error) {
    const code = typeof error?.message === 'string' && error.message.startsWith('HOST_')
      ? error.message : 'HOST_INVENTORY_WINDOWS_SNAPSHOT_UNAVAILABLE';
    return fail(code);
  }
}
