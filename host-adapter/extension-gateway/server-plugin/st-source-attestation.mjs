import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

export const PINNED_HOST_COMMIT = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';
export const HOST_INVENTORY_COVERAGE_ID = 'ST-1.19.0-HOST-LIFECYCLE-P0-V1';
// Updated together with Core's accepted deployment constants.
export const PINNED_PATCH_BUNDLE_SHA256 = 'f1697d252d4f3c46ead68dea1cd7d1fe9e1fa76339dd1a1f61579aa56ffd155e';
export const PINNED_HOST_HANDLER_GIT_BLOB_SHA = '6f1cd4cbef55134d368a4e200c9ba59b2a6e8b3c';

export const SOURCE_FILE_PATHS = Object.freeze([
  'public/script.js',
  'public/scripts/bookmarks.js',
  'public/scripts/group-chats.js',
  'public/scripts/chat-backups.js',
  'public/scripts/extensions.js',
  'public/scripts/slash-commands.js',
  'src/server-main.js',
  'src/plugin-loader.js',
  'src/users.js',
  'src/endpoints/backends/chat-completions.js',
  'src/endpoints/backends/kobold.js',
  'src/endpoints/openai.js',
  'src/endpoints/speech.js',
  'src/endpoints/tokenizers.js',
  'src/endpoints/chats.js',
  'src/endpoints/groups.js',
  'src/endpoints/characters.js',
  'src/endpoints/backups.js',
  'src/endpoints/data-maid.js',
  'src/endpoints/settings.js',
  'src/endpoints/users-private.js',
  'src/endpoints/users-public.js',
  'src/endpoints/users-admin.js',
  'src/endpoints/logic-engine-host-inventory-handler.mjs',
  'src/endpoints/content-manager.js',
  'src/endpoints/image-metadata.js',
  'src/endpoints/images.js',
  'src/endpoints/moving-ui.js',
  'src/endpoints/presets.js',
  'src/endpoints/quick-replies.js',
  'src/endpoints/secrets.js',
  'src/endpoints/sprites.js',
  'src/endpoints/stable-diffusion.js',
  'src/endpoints/stats.js',
  'src/endpoints/themes.js',
  'src/endpoints/thumbnails.js',
  'src/endpoints/worldinfo.js',
  'src/endpoints/vectors.js',
  'src/endpoints/extensions.js',
  'src/endpoints/backgrounds.js',
  'src/endpoints/avatars.js',
  'src/endpoints/assets.js',
  'src/endpoints/files.js',
  'public/scripts/logic-engine-lifecycle/conversation-identity.mjs',
  'public/scripts/logic-engine-lifecycle/lifecycle-journal.mjs',
  'public/scripts/logic-engine-lifecycle/st-lifecycle-bridge.mjs',
  'plugins/logic-engine-extension-gateway/index.mjs',
  'plugins/logic-engine-extension-gateway/package.json',
  'plugins/logic-engine-extension-gateway/host-adapter.mjs',
  'plugins/logic-engine-extension-gateway/host-data-inventory.mjs',
  'plugins/logic-engine-extension-gateway/st-host-inventory-handler.mjs',
  'plugins/logic-engine-extension-gateway/st-host-lifecycle-receipt-store.mjs',
  'plugins/logic-engine-extension-gateway/st-source-attestation.mjs',
  'plugins/logic-engine-extension-gateway/st-source-inventory.mjs',
  'plugins/logic-engine-extension-gateway/fs-inventory.js',
  'plugins/logic-engine-extension-gateway/windows-vss-snapshot.mjs',
  'plugins/logic-engine-extension-gateway/st-server-digest-proxy.mjs',
  'plugins/logic-engine-extension-gateway/st-host-identity-store.mjs',
  'plugins/logic-engine-extension-gateway/st-host-session-revocation.mjs',
  'plugins/logic-engine-extension-gateway/filesystem-reconciliation.mjs',
  'public/scripts/extensions/third-party/logic-engine-extension-gateway/index.js',
  'public/scripts/extensions/third-party/logic-engine-extension-gateway/host-context.mjs',
  'public/scripts/extensions/third-party/logic-engine-extension-gateway/gateway-policy.mjs',
  'public/scripts/extensions/third-party/logic-engine-extension-gateway/conversation-identity.mjs',
  'public/scripts/extensions/third-party/logic-engine-extension-gateway/manifest.json',
]);

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);
const within = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
};

async function exactDirectoryFiles(root, relativeDirectory, expectedNames) {
  try {
    const directory = path.resolve(root, relativeDirectory);
    if (!within(root, directory)) return false;
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    const actualPath = await realpath(directory);
    if (!within(root, actualPath)) return false;
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.length !== expectedNames.length || entries.some(entry => !entry.isFile())) return false;
    const actual = entries.map(entry => entry.name).sort();
    const expected = [...expectedNames].sort();
    return actual.every((name, index) => name === expected[index]);
  } catch {
    return false;
  }
}

async function exactDirectoryChildren(root, relativeDirectory, expectedNames) {
  try {
    const directory = path.resolve(root, relativeDirectory);
    if (!within(root, directory)) return false;
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    const actualPath = await realpath(directory);
    if (!within(root, actualPath)) return false;
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.length !== expectedNames.length
      || entries.some(entry => !entry.isDirectory() || entry.isSymbolicLink())) return false;
    const actual = entries.map(entry => entry.name).sort();
    const expected = [...expectedNames].sort();
    return actual.every((name, index) => name === expected[index]);
  } catch {
    return false;
  }
}

async function isEmptySafeDirectory(directoryPath) {
  try {
    if (typeof directoryPath !== 'string' || !path.isAbsolute(directoryPath)) return false;
    const resolved = path.resolve(directoryPath);
    const root = path.parse(resolved).root;
    if (!root) return false;
    let cursor = root;
    for (const segment of resolved.slice(root.length).split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, segment);
      const component = await lstat(cursor);
      if (component.isSymbolicLink()) return false;
    }
    const stat = await lstat(resolved);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    return (await readdir(resolved)).length === 0;
  } catch {
    return false;
  }
}

function validManifestShape(manifest) {
  return manifest && typeof manifest === 'object' && !Array.isArray(manifest)
    && Object.keys(manifest).sort().join(',') === [
      'coverage_id', 'files', 'host_handler_blob_sha', 'manifest_sha256',
      'patch_blob_sha', 'pinned_host_commit', 'protocol_version',
    ].sort().join(',')
    && manifest.protocol_version === 1
    && manifest.pinned_host_commit === PINNED_HOST_COMMIT
    && manifest.coverage_id === HOST_INVENTORY_COVERAGE_ID
    && manifest.patch_blob_sha === PINNED_PATCH_BUNDLE_SHA256
    && manifest.host_handler_blob_sha === PINNED_HOST_HANDLER_GIT_BLOB_SHA
    && Array.isArray(manifest.files)
    && manifest.files.length === SOURCE_FILE_PATHS.length
    && manifest.files.every((file, index) => file && typeof file === 'object'
      && Object.keys(file).sort().join(',') === 'path,sha256'
      && file.path === SOURCE_FILE_PATHS[index]
      && /^[a-f0-9]{64}$/.test(file.sha256 ?? ''));
}

/**
 * Verify the exact pinned, patched ST source files against the deployment
 * manifest produced from the immutable pinned checkout by CI. No environment
 * build claim is treated as source evidence.
 */
export async function verifyPinnedSourceIdentity({
  installRoot,
  manifestPath,
  userExtensionsPath,
} = {}) {
  try {
    if (typeof installRoot !== 'string' || !path.isAbsolute(installRoot)) {
      return { status: 'NON_READY', code: 'HOST_SOURCE_ROOT_INVALID' };
    }
    const root = await realpath(installRoot);
    if (userExtensionsPath !== undefined && !await isEmptySafeDirectory(userExtensionsPath)) {
      return { status: 'NON_READY', code: 'HOST_UNREVIEWED_USER_EXTENSION_PRESENT' };
    }
    const manifestFile = path.join(root, 'plugins', 'logic-engine-extension-gateway', 'pinned-source-manifest.json');
    if (manifestPath !== undefined
      && (typeof manifestPath !== 'string' || !path.isAbsolute(manifestPath)
        || path.resolve(manifestPath) !== manifestFile)) {
      return { status: 'NON_READY', code: 'HOST_SOURCE_MANIFEST_PATH_INVALID' };
    }
    const manifestStat = await lstat(manifestFile);
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
      return { status: 'NON_READY', code: 'HOST_SOURCE_MANIFEST_UNAVAILABLE' };
    }
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    if (!validManifestShape(manifest)) {
      return { status: 'NON_READY', code: 'HOST_SOURCE_MANIFEST_INVALID' };
    }
    const pluginPrefix = 'plugins/logic-engine-extension-gateway/';
    const clientPrefix = 'public/scripts/extensions/third-party/logic-engine-extension-gateway/';
    const pluginNames = SOURCE_FILE_PATHS.filter(file => file.startsWith(pluginPrefix))
      .map(file => file.slice(pluginPrefix.length));
    pluginNames.push('pinned-source-manifest.json');
    const clientNames = SOURCE_FILE_PATHS.filter(file => file.startsWith(clientPrefix))
      .map(file => file.slice(clientPrefix.length));
    // SillyTavern server plugins and third-party browser extensions can add
    // routes or mutate account data outside the built-in endpoint patch set.
    // Until each extension has its own reviewed source attestation contract,
    // the only accepted entries in these executable extension roots are the
    // Logic Engine Gateway itself. Unknown extensions make Host authority
    // non-ready; a root data scan cannot attest their code.
    if (!await exactDirectoryChildren(root, 'plugins', ['logic-engine-extension-gateway'])
      || !await exactDirectoryChildren(root, 'public/scripts/extensions/third-party', ['logic-engine-extension-gateway'])
      || !await exactDirectoryFiles(root, 'plugins/logic-engine-extension-gateway', pluginNames)
      || !await exactDirectoryFiles(root, 'public/scripts/extensions/third-party/logic-engine-extension-gateway', clientNames)) {
      return { status: 'NON_READY', code: 'HOST_SOURCE_DIRECTORY_CONTENT_MISMATCH' };
    }
    const { manifest_sha256, ...proof } = manifest;
    if (manifest_sha256 !== sha256(Buffer.from(canonical(proof), 'utf8'))) {
      return { status: 'NON_READY', code: 'HOST_SOURCE_MANIFEST_DIGEST_INVALID' };
    }
    for (const expected of manifest.files) {
      const candidate = path.resolve(root, expected.path);
      if (!within(root, candidate)) return { status: 'NON_READY', code: 'HOST_SOURCE_PATH_ESCAPE' };
      const actualPath = await realpath(candidate);
      if (!within(root, actualPath)) return { status: 'NON_READY', code: 'HOST_SOURCE_PATH_ESCAPE' };
      let cursor = root;
      let stat;
      for (const segment of expected.path.split(/[\\/]/)) {
        cursor = path.join(cursor, segment);
        stat = await lstat(cursor);
        if (stat.isSymbolicLink()) {
          return { status: 'NON_READY', code: 'HOST_SOURCE_FILE_UNSAFE' };
        }
      }
      if (!stat?.isFile()) return { status: 'NON_READY', code: 'HOST_SOURCE_FILE_UNSAFE' };
      if (sha256(await readFile(candidate)) !== expected.sha256) {
        return { status: 'NON_READY', code: 'HOST_SOURCE_FILE_DIGEST_MISMATCH' };
      }
    }
    return {
      status: 'CURRENT_IDENTITIES_VERIFIED',
      pinned_host_commit: manifest.pinned_host_commit,
      coverage_id: manifest.coverage_id,
      patch_blob_sha: manifest.patch_blob_sha,
      host_handler_blob_sha: manifest.host_handler_blob_sha,
      manifest_sha256,
    };
  } catch {
    return { status: 'NON_READY', code: 'HOST_SOURCE_IDENTITY_UNAVAILABLE' };
  }
}

export function createSignedRootInventoryAttestation({
  adapterId,
  adapterToken,
  identity,
  reconciliation,
  snapshotAlignment,
  snapshotSha256,
  sourceIdentity,
  now = Date.now,
  createNonce = randomUUID,
} = {}) {
  if (typeof adapterId !== 'string' || !adapterId.trim()
    || typeof adapterToken !== 'string' || adapterToken.length < 16
    || !identity || typeof identity !== 'object'
    || !reconciliation || typeof reconciliation !== 'object'
    || reconciliation.integrity_status !== 'INTEGRITY_OK'
    || !Number.isSafeInteger(reconciliation.sequence) || reconciliation.sequence < 1
    || !/^[a-f0-9]{64}$/.test(reconciliation.manifest_sha256 ?? '')
    || !/^[a-f0-9]{64}$/.test(reconciliation.journal_head_sha256 ?? '')
    || !Number.isSafeInteger(reconciliation.lifecycle_sequence) || reconciliation.lifecycle_sequence < 0
    || !/^[a-f0-9]{64}$/.test(reconciliation.lifecycle_head_sha256 ?? '')
    || (reconciliation.lifecycle_sequence === 0 && reconciliation.lifecycle_head_sha256 !== '0'.repeat(64))
    || (reconciliation.delta_sha256 !== undefined && !/^[a-f0-9]{64}$/.test(reconciliation.delta_sha256))
    || snapshotAlignment !== 'SHARED_VSS_SNAPSHOT'
    || !/^[a-f0-9]{64}$/.test(snapshotSha256 ?? '')
    || sourceIdentity?.status !== 'CURRENT_IDENTITIES_VERIFIED'
    || !/^[a-f0-9]{64}$/.test(sourceIdentity.manifest_sha256 ?? '')
    || sourceIdentity.patch_blob_sha !== PINNED_PATCH_BUNDLE_SHA256
    || sourceIdentity.host_handler_blob_sha !== PINNED_HOST_HANDLER_GIT_BLOB_SHA) {
    throw new TypeError('HOST_ROOT_INVENTORY_ATTESTATION_INPUT_NON_READY');
  }
  const attestation = {
    protocol_version: 1,
    adapter_id: adapterId,
    host_installation_id: identity.host_installation_id,
    authenticated_account_id: identity.authenticated_account_id,
    root_id: identity.root_id,
    inventory_sequence: reconciliation.sequence,
    manifest_sha256: reconciliation.manifest_sha256,
    inventory_head_sha256: reconciliation.journal_head_sha256,
    covered_delta_sha256: reconciliation.delta_sha256 ?? null,
    coverage_id: HOST_INVENTORY_COVERAGE_ID,
    pinned_host_commit: PINNED_HOST_COMMIT,
    patch_blob_sha: sourceIdentity.patch_blob_sha,
    host_handler_blob_sha: sourceIdentity.host_handler_blob_sha,
    source_identity_status: sourceIdentity.status,
    source_manifest_sha256: sourceIdentity.manifest_sha256,
    snapshot_alignment: snapshotAlignment,
    snapshot_sha256: snapshotSha256,
    lifecycle_sequence: reconciliation.lifecycle_sequence,
    lifecycle_head_sha256: reconciliation.lifecycle_head_sha256,
    issued_at: Math.floor(now() / 1000),
    nonce: createNonce(),
  };
  const signature = createHmac('sha256', adapterToken)
    .update(canonical(attestation), 'utf8').digest('hex');
  return Object.freeze({ ...attestation, signature });
}


/**
 * Verify the exact HMAC envelope persisted by Core's HostLifecycleJournal.
 * The caller must additionally bind source_manifest_sha256 to its
 * deployment-owned root identity registry; a valid signature alone is not
 * deployment enrollment.
 */
export function verifySignedRootInventoryAttestation({ attestation, identity, adapterToken } = {}) {
  if (!attestation || typeof attestation !== 'object' || Array.isArray(attestation)
    || (Object.getPrototypeOf(attestation) !== Object.prototype
      && Object.getPrototypeOf(attestation) !== null)
    || !identity || typeof identity !== 'object' || Array.isArray(identity)
    || typeof adapterToken !== 'string' || adapterToken.length < 16) return false;
  const keys = Reflect.ownKeys(attestation);
  if (keys.some(key => typeof key !== 'string')) return false;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(attestation, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return false;
  }
  if (attestation.adapter_id !== identity.adapter_id
    || attestation.host_installation_id !== identity.host_installation_id
    || attestation.authenticated_account_id !== identity.authenticated_account_id
    || attestation.root_id !== identity.root_id
    || typeof attestation.signature !== 'string'
    || !/^[a-f0-9]{64}$/.test(attestation.signature)) return false;
  const { signature, ...proof } = attestation;
  const expected = createHmac('sha256', adapterToken).update(canonical(proof), 'utf8').digest();
  const actual = Buffer.from(signature, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
