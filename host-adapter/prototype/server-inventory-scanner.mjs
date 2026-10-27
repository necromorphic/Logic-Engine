import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sameStat = (a, b) => a.dev === b.dev && a.ino === b.ino
  && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;

/**
 * Enumerate persisted Host artifacts beneath explicitly supplied storage roots.
 *
 * This is a current-state scanner, not a historical ledger. Its successful
 * result is always non-authoritative; callers must not use it as an access or
 * disclosure authorization decision.
 *
 * roots: [{ domain: stable logical name, path: absolute storage directory }]
 */
export async function scanHostArtifactRoots(roots, { fs = { lstat, readdir, readFile, realpath } } = {}) {
  if (!Array.isArray(roots) || roots.length === 0) {
    return { status: 'INVENTORY_INCOMPLETE', complete: false, artifacts: [], errors: ['No inventory roots configured'] };
  }

  const artifacts = [];
  const errors = [];
  const domains = new Set();
  const rootPaths = [];

  for (const root of roots) {
    if (!root || typeof root.domain !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(root.domain)
      || typeof root.path !== 'string' || !path.isAbsolute(root.path) || domains.has(root.domain)) {
      errors.push('Invalid or duplicate inventory root configuration');
      continue;
    }
    domains.add(root.domain);
    try {
      const canonicalRoot = await fs.realpath(root.path);
      const rootStat = await fs.lstat(canonicalRoot);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
        errors.push('Inventory root is not a real directory: ' + root.domain);
        continue;
      }
      rootPaths.push({ domain: root.domain, path: canonicalRoot });
    } catch {
      errors.push('Inventory root unavailable: ' + root.domain);
    }
  }

  for (const root of rootPaths) {
    const walk = async (directory) => {
      let entries;
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch {
        errors.push('Directory enumeration failed: ' + root.domain);
        return;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
      for (const entry of entries) {
        const absolutePath = path.join(directory, entry.name);
        const relativePath = path.relative(root.path, absolutePath).split(path.sep).join('/');
        if (!relativePath || relativePath.startsWith('../') || path.isAbsolute(relativePath)) {
          errors.push('Path escaped inventory root: ' + root.domain);
          continue;
        }
        let before;
        try {
          before = await fs.lstat(absolutePath);
        } catch {
          errors.push('Artifact disappeared during enumeration: ' + root.domain);
          continue;
        }
        if (before.isSymbolicLink()) {
          errors.push('Symbolic link encountered; refusing to follow: ' + root.domain);
          continue;
        }
        if (before.isDirectory()) {
          await walk(absolutePath);
          continue;
        }
        if (!before.isFile()) {
          errors.push('Unsupported filesystem artifact type: ' + root.domain);
          continue;
        }
        try {
          const bytes = await fs.readFile(absolutePath);
          const after = await fs.lstat(absolutePath);
          if (!sameStat(before, after) || bytes.length !== after.size) {
            errors.push('Artifact changed during scan: ' + root.domain);
            continue;
          }
          artifacts.push({
            artifactId: root.domain + ':' + relativePath,
            domain: root.domain,
            locator: relativePath,
            byteLength: bytes.length,
            sha256: sha256(bytes),
          });
        } catch {
          errors.push('Artifact read failed: ' + root.domain);
        }
      }
    };
    await walk(root.path);
  }

  artifacts.sort((a, b) => a.artifactId.localeCompare(b.artifactId, 'en'));
  const complete = errors.length === 0 && rootPaths.length === roots.length;
  return {
    status: complete ? 'CURRENT_SNAPSHOT_NON_AUTHORITATIVE' : 'INVENTORY_INCOMPLETE',
    complete,
    historicalCompleteness: 'UNKNOWN',
    authority: 'NON_AUTHORITATIVE',
    artifacts: complete ? artifacts : [],
    artifactCount: complete ? artifacts.length : null,
    errors,
  };
}
