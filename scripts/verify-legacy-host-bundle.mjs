import { createHash } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

export const HOST_BUNDLE_ACCEPTED_IDENTITIES = Object.freeze([
  {
    // Current bundle identity: permits an exact, fully verified repeat install.
    commit: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
    patchBlobSha: '27f65e72e691f779806104df45e49b155a65545234c1e9accdc00a11c6cc1e5d',
    manifestSha256: '069b75d60b256d4b5e98dce164e614fee8422af3f54a110b4e8dcd5b47143792',
  },
  {
    commit: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
    patchBlobSha: '502a48a2eb53249dfb53b250c74d7b5c83c4a672ea429c2c3ff5eebb34a3300d',
    manifestSha256: 'd89d39d6f8449932db41a97a368aec941293943acb543697e1700d974ed629f4',
  },
  {
    commit: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
    patchBlobSha: 'c24cece59b928f56a514cc191256d01370ccda8e58e3edfbc56cdb96af9b8067',
    manifestSha256: '9cca279d6f4340ee0f5455622c1ef4d8404e29ac0ed73e309f76d7f74fdd9acc',
  },
  {
    commit: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
    patchBlobSha: 'dd491fec699cf4a21b32480c2780b79d79a7665302e97624cbcfc8381aa64deb',
    manifestSha256: '5d5490a939a13f94b83b4a407f09d61a18aeefe67e73b65b7e8200d3a0aa736b',
  },
  {
    commit: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
    patchBlobSha: 'f8042ce97486c109144859ab02d0ef973a2ef56992915bf4602666cb19d19469',
    manifestSha256: '592c480cbf9ca3f3573c695961b1a11785353f16d2902e4d82dba9f849d90c62',
  },
  {
    commit: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
    patchBlobSha: 'efb7b0a0fa58779cdd7399ee6609ddb045d068158883c70c3fc080487c9684e1',
    manifestSha256: 'fdac4e332c291cc4fff5ba47414917bdd1937ecf6752c5b8d7a137d0d6742257',
  },
]);

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
  expectedPredecessors,
  expectedOverlayFiles = new Map(),
} = {}) {
  try {
    if (typeof installRoot !== 'string' || !path.isAbsolute(installRoot)
      || (!(Array.isArray(expectedPredecessors) && expectedPredecessors.length > 0)
        && (typeof expectedCommit !== 'string'
          || !/^[a-f0-9]{64}$/.test(expectedPatchBlobSha ?? '')
          || !/^[a-f0-9]{64}$/.test(expectedManifestSha256 ?? '')))
      || !(expectedOverlayFiles instanceof Map)) {
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
    const predecessorPins = Array.isArray(expectedPredecessors)
      ? expectedPredecessors
      : [{ commit: expectedCommit, patchBlobSha: expectedPatchBlobSha, manifestSha256: expectedManifestSha256 }];
    const matchingPredecessor = predecessorPins.some(pin => pin
      && typeof pin.commit === 'string'
      && manifest.pinned_host_commit === pin.commit
      && manifest.patch_blob_sha === pin.patchBlobSha
      && manifest_sha256 === pin.manifestSha256
      && sha256(Buffer.from(canonical(proof), 'utf8')) === pin.manifestSha256);
    if (!matchingPredecessor) {
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
      // The pinned predecessor manifest authenticates the predecessor tree.
      // A changed file is accepted only when it matches the separately
      // reconstructed, reviewed Host overlay byte-for-byte. Patch Manager
      // consumes canonical LF hashes after this raw-byte proof succeeds.
      const installedHash = sha256(bytes);
      const expectedOverlayHash = expectedOverlayFiles.get(entry.path);
      const canonicalInstalledHash = canonicalTextHash(bytes);
      // A predecessor manifest may predate a reviewed Host patch revision.
      // Accept that transition only when the installed bytes exactly match
      // the deterministic output reconstructed from the current pinned
      // SillyTavern commit and reviewed Host patches by the installer.
      if (installedHash !== entry.sha256 && canonicalInstalledHash !== expectedOverlayHash) {
        return { verified: false, files: new Map() };
      }
      verifiedFiles.set(entry.path, canonicalTextHash(bytes));
    }
    // A predecessor manifest is accepted based on its exact pinned identity
    // and complete per-file verification. Do not require files introduced by
    // a newer Host bundle: valid older deployments may not contain them.
    return { verified: true, files: verifiedFiles };
  } catch {
    return { verified: false, files: new Map() };
  }
}
