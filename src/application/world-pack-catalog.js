import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { EngineError } from '../core/errors.js';

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function fail(code, message) {
  throw new EngineError(code, message, 503);
}

function safeArtifactPath(root, candidate) {
  if (typeof candidate !== 'string' || !candidate.trim() || isAbsolute(candidate)) {
    fail('WORLD_PACK_CATALOG_INVALID', 'Each catalog artifact_path must be a non-empty relative path.');
  }
  const rootReal = realpathSync(root);
  const requested = resolve(rootReal, candidate);
  const lexicalRel = relative(rootReal, requested);
  if (!lexicalRel || lexicalRel === '..' || lexicalRel.startsWith('..' + sep) || isAbsolute(lexicalRel)) {
    fail('WORLD_PACK_ARTIFACT_PATH_INVALID', 'World Pack artifacts must be files below the catalog directory.');
  }
  let artifactReal;
  try { artifactReal = realpathSync(requested); } catch {
    fail('WORLD_PACK_ARTIFACT_UNAVAILABLE', 'A trusted World Pack artifact cannot be resolved.');
  }
  const rel = relative(rootReal, artifactReal);
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
    fail('WORLD_PACK_ARTIFACT_PATH_INVALID', 'World Pack artifacts must be files below the catalog directory.');
  }
  let stat;
  try { stat = statSync(artifactReal); } catch {
    fail('WORLD_PACK_ARTIFACT_UNAVAILABLE', 'A trusted World Pack artifact cannot be read.');
  }
  if (!stat.isFile()) fail('WORLD_PACK_ARTIFACT_INVALID', 'A World Pack artifact must be a regular file.');
  return artifactReal;
}

/**
 * Load an immutable, deployment-controlled catalog of exact World Pack artifacts.
 * Catalog records are authority only because the catalog file is supplied by the
 * deployment, not because its JSON or hashes are self-authenticating.
 */
export function loadTrustedWorldPackCatalog(catalogPath) {
  if (typeof catalogPath !== 'string' || !catalogPath.trim() || !isAbsolute(resolve(catalogPath))) {
    throw new TypeError('World Pack catalog path must be a non-empty filesystem path.');
  }
  let catalogReal;
  let catalogBytes;
  try {
    catalogReal = realpathSync(resolve(catalogPath));
    catalogBytes = readFileSync(catalogReal);
  } catch {
    throw new Error('WORLD_PACK_CATALOG_UNAVAILABLE');
  }

  let catalog;
  try { catalog = JSON.parse(catalogBytes.toString('utf8')); } catch {
    throw new Error('WORLD_PACK_CATALOG_INVALID_JSON');
  }
  if (!isPlainObject(catalog) || Object.keys(catalog).some((key) => !['schema_version', 'entries'].includes(key))
    || catalog.schema_version !== 1 || !Array.isArray(catalog.entries) || catalog.entries.length === 0) {
    throw new Error('WORLD_PACK_CATALOG_INVALID');
  }

  const root = dirname(catalogReal);
  const entries = new Map();
  for (const entry of catalog.entries) {
    if (!isPlainObject(entry) || Object.keys(entry).some((key) => !['world_pack_id', 'version', 'artifact_path', 'sha256'].includes(key))
      || typeof entry.world_pack_id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,127}$/.test(entry.world_pack_id)
      || typeof entry.version !== 'string' || !entry.version.trim() || entry.version.length > 128
      || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error('WORLD_PACK_CATALOG_ENTRY_INVALID');
    }
    const key = entry.world_pack_id + '\u0000' + entry.version;
    if (entries.has(key)) throw new Error('WORLD_PACK_CATALOG_DUPLICATE_ENTRY');

    const artifactPath = safeArtifactPath(root, entry.artifact_path);
    let bytes;
    try { bytes = readFileSync(artifactPath); } catch {
      throw new Error('WORLD_PACK_ARTIFACT_UNAVAILABLE');
    }
    const digest = sha256(bytes);
    if (digest !== entry.sha256) throw new Error('WORLD_PACK_ARTIFACT_DIGEST_MISMATCH');

    let artifact;
    try { artifact = JSON.parse(bytes.toString('utf8')); } catch {
      throw new Error('WORLD_PACK_ARTIFACT_INVALID_JSON');
    }
    if (!isPlainObject(artifact) || artifact.world_pack_id !== entry.world_pack_id || artifact.version !== entry.version) {
      throw new Error('WORLD_PACK_ARTIFACT_IDENTITY_MISMATCH');
    }
    entries.set(key, Object.freeze({
      world_pack_id: entry.world_pack_id,
      version: entry.version,
      sha256: digest,
      artifact_path: artifactPath,
      catalog_artifact_path: entry.artifact_path,
    }));
  }

  const catalogDigest = sha256(catalogBytes);
  return Object.freeze({
    catalog_sha256: catalogDigest,
    resolve(worldPackId, version) {
      const entry = entries.get(String(worldPackId) + '\u0000' + String(version));
      if (!entry) {
        throw new EngineError('WORLD_PACK_NOT_TRUSTED', 'The requested World Pack ID/version is not present in the deployment-controlled catalog.', 400);
      }
      // Re-check at resolution time so a file changed after process startup cannot
      // be treated as the artifact that was originally verified.
      const currentPath = safeArtifactPath(root, entry.catalog_artifact_path);
      let currentBytes;
      try { currentBytes = readFileSync(currentPath); } catch {
        fail('WORLD_PACK_ARTIFACT_UNAVAILABLE', 'A trusted World Pack artifact cannot be read.');
      }
      if (sha256(currentBytes) !== entry.sha256) {
        fail('WORLD_PACK_ARTIFACT_DIGEST_MISMATCH', 'A trusted World Pack artifact changed after catalog validation.');
      }
      return Object.freeze({
        world_pack_id: entry.world_pack_id,
        version: entry.version,
        sha256: entry.sha256,
        artifact_path: currentPath,
      });
    },
  });
}
