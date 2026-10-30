import { createHash } from 'node:crypto';
import {
  lstat, open, realpath, readdir,
} from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const fail = (code) => ({ status: 'non_ready', code });

function isWithinRoot(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel));
}

function statIdentity(stat) {
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    mode: stat.mode,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
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
export async function enumerateStableFileInventory(rootPath) {
  if (typeof rootPath !== 'string' || !rootPath.trim() || !isAbsolute(rootPath)) {
    return fail('HOST_INVENTORY_ROOT_INVALID');
  }

  if (process.platform === 'win32') return fail('HOST_INVENTORY_PLATFORM_REPARSE_UNVERIFIED');
  if (typeof fsConstants.O_NOFOLLOW !== 'number') return fail('HOST_INVENTORY_PLATFORM_NOFOLLOW_UNAVAILABLE');

  let root;
  try {
    const requestedRoot = resolve(rootPath);
    const requestedRootStat = await lstat(requestedRoot);
    if (!requestedRootStat.isDirectory() || requestedRootStat.isSymbolicLink()) return fail('HOST_INVENTORY_ROOT_UNSAFE');
    root = await realpath(requestedRoot);
    if (root !== requestedRoot) return fail('HOST_INVENTORY_ROOT_ALIAS_UNSUPPORTED');
    const rootStat = await lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return fail('HOST_INVENTORY_ROOT_UNSAFE');
    var initialRootIdentity = {
      dev: rootStat.dev, ino: rootStat.ino,
      mtimeMs: rootStat.mtimeMs, ctimeMs: rootStat.ctimeMs,
    };
  } catch {
    return fail('HOST_INVENTORY_ROOT_UNAVAILABLE');
  }

  async function scanOnce() {
    const entries = [];

    async function walk(directory) {
      let names;
      try {
        names = await readdir(directory);
      } catch {
        throw new Error('HOST_INVENTORY_UNREADABLE_DIRECTORY');
      }
      names.sort();

      for (const name of names) {
        const fullPath = resolve(directory, name);
        if (!isWithinRoot(root, fullPath)) throw new Error('HOST_INVENTORY_PATH_ESCAPE');

        let before;
        try {
          before = await lstat(fullPath);
        } catch {
          throw new Error('HOST_INVENTORY_ENTRY_CHANGED');
        }
        if (before.isSymbolicLink()) throw new Error('HOST_INVENTORY_SYMLINK_UNSUPPORTED');

        if (before.isDirectory()) {
          await walk(fullPath);
          const afterDirectory = await lstat(fullPath);
          if (!afterDirectory.isDirectory() || afterDirectory.isSymbolicLink()
            || afterDirectory.dev !== before.dev || afterDirectory.ino !== before.ino
            || afterDirectory.mtimeMs !== before.mtimeMs || afterDirectory.ctimeMs !== before.ctimeMs) {
            throw new Error('HOST_INVENTORY_DIRECTORY_CHANGED');
          }
          continue;
        }

        if (!before.isFile()) throw new Error('HOST_INVENTORY_NON_REGULAR_ENTRY');

        let handle;
        try {
          const noFollow = fsConstants.O_NOFOLLOW;
          handle = await open(fullPath, fsConstants.O_RDONLY | noFollow);
          const openedBefore = await handle.stat();
          if (!openedBefore.isFile() || openedBefore.dev !== before.dev || openedBefore.ino !== before.ino) {
            throw new Error('HOST_INVENTORY_FILE_IDENTITY_CHANGED');
          }
          const bytes = await handle.readFile();
          const openedAfter = await handle.stat();
          const pathAfter = await lstat(fullPath);
          if (!pathAfter.isFile() || pathAfter.isSymbolicLink()
            || openedAfter.dev !== openedBefore.dev || openedAfter.ino !== openedBefore.ino
            || openedAfter.size !== openedBefore.size || openedAfter.mtimeMs !== openedBefore.mtimeMs
            || openedAfter.ctimeMs !== openedBefore.ctimeMs
            || pathAfter.dev !== openedAfter.dev || pathAfter.ino !== openedAfter.ino
            || bytes.byteLength !== openedAfter.size) {
            throw new Error('HOST_INVENTORY_FILE_CHANGED_DURING_READ');
          }
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
    const finalRootStat = await lstat(root);
    if (!finalRootStat.isDirectory() || finalRootStat.isSymbolicLink()
      || finalRootStat.dev !== initialRootIdentity.dev || finalRootStat.ino !== initialRootIdentity.ino
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
    return Object.freeze({
      status: 'complete',
      root,
      file_count: second.length,
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
