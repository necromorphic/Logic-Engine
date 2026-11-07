import { createHash } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const canonicalTextHash = bytes => {
  if (!isUtf8(bytes)) throw new Error('LEGACY_HOST_SOURCE_ENCODING_INVALID');
  return sha256(Buffer.from(bytes.toString('utf8').replace(/\r\n?/g, '\n'), 'utf8'));
};
const canonical = value => Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);
const within = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith('..' + path.sep)
    && relative !== '..' && !path.isAbsolute(relative);
};

/**
 * Verify a specifically pinned predecessor deployment before allowing an
 * atomic upgrade. A matching file hash alone is never sufficient: the old
 * signed-by-content manifest and every file it covers must match.
 */
export async function verifyLegacyHostBundle({
  installRoot,
  expectedCommit,
  expectedPatchBlobSha,
  expectedManifestSha256,
} = {}) {
  try {
    if (typeof installRoot !== 'string' || !path.isAbsolute(installRoot)
      || typeof expectedCommit !== 'string'
      || !/^[a-f0-9]{64}$/.test(expectedPatchBlobSha ?? '')
      || !/^[a-f0-9]{64}$/.test(expectedManifestSha256 ?? '')) {
      return { verified: false, files: new Map() };
    }
    const root = await realpath(installRoot);
    const manifestSegments = ['plugins', 'logic-engine-extension-gateway', 'pinned-source-manifest.json'];
    let manifestPath = root;
    for (let index = 0; index < manifestSegments.length; index += 1) {
      manifestPath = path.join(manifestPath, manifestSegments[index]);
      const stat = await lstat(manifestPath);
      if (stat.isSymbolicLink()
        || (index < manifestSegments.length - 1 && !stat.isDirectory())
        || (index === manifestSegments.length - 1 && !stat.isFile())) {
        return { verified: false, files: new Map() };
      }
    }
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.files)) {
      return { verified: false, files: new Map() };
    }
    const { manifest_sha256, ...proof } = manifest;
    if (manifest.pinned_host_commit !== expectedCommit
      || manifest.patch_blob_sha !== expectedPatchBlobSha
      || manifest_sha256 !== expectedManifestSha256
      || sha256(Buffer.from(canonical(proof), 'utf8')) !== expectedManifestSha256) {
      return { verified: false, files: new Map() };
    }

    const verifiedFiles = new Map();
    for (const entry of manifest.files) {
      if (!entry || typeof entry.path !== 'string'
        || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '')
        || verifiedFiles.has(entry.path)) {
        return { verified: false, files: new Map() };
      }
      const candidate = path.resolve(root, entry.path);
      if (!within(root, candidate)) return { verified: false, files: new Map() };
      let cursor = root;
      for (const segment of entry.path.split(/[\\/]/)) {
        if (!segment || segment === '.' || segment === '..') {
          return { verified: false, files: new Map() };
        }
        cursor = path.join(cursor, segment);
        const stat = await lstat(cursor);
        if (stat.isSymbolicLink()) return { verified: false, files: new Map() };
      }
      const stat = await lstat(candidate);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        return { verified: false, files: new Map() };
      }
      const bytes = await readFile(candidate);
      // The signed deployment manifest authenticates exact installed bytes.
      // Patch Manager hashes source text canonically (LF), so retain the
      // canonical hash only after the raw-byte manifest proof has succeeded.
      if (sha256(bytes) !== entry.sha256) {
        return { verified: false, files: new Map() };
      }
      verifiedFiles.set(entry.path, canonicalTextHash(bytes));
    }
    if (!verifiedFiles.has('src/plugin-loader.js')) {
      return { verified: false, files: new Map() };
    }
    return { verified: true, files: verifiedFiles };
  } catch {
    return { verified: false, files: new Map() };
  }
}
