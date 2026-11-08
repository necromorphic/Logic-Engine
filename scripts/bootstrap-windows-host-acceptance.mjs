import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, realpath } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { HostIdentityStore } from '../host-adapter/extension-gateway/server-plugin/st-host-identity-store.mjs';
import { verifyPinnedSourceIdentity } from '../host-adapter/extension-gateway/server-plugin/st-source-attestation.mjs';

const [stRootArg, dataRootArg, identityDirectoryArg, userHandle = 'default-user', adapterId = 'sillytavern-main'] = process.argv.slice(2);
if (!stRootArg || !dataRootArg || !identityDirectoryArg) {
  process.stderr.write('Usage: node scripts/bootstrap-windows-host-acceptance.mjs <st-root> <data-root> <identity-dir> [user-handle] [adapter-id]\n');
  process.exit(2);
}

const stRoot = await realpath(path.resolve(stRootArg));
const dataRoot = path.resolve(dataRootArg);
const identityDirectory = path.resolve(identityDirectoryArg);
if (!path.isAbsolute(dataRoot) || !path.isAbsolute(identityDirectory)) {
  throw new Error('HOST_ACCEPTANCE_PATHS_MUST_BE_ABSOLUTE');
}
if (typeof userHandle !== 'string' || !userHandle.trim() || userHandle !== userHandle.trim()
  || typeof adapterId !== 'string' || !adapterId.trim() || adapterId !== adapterId.trim()) {
  throw new Error('HOST_ACCEPTANCE_IDENTITY_INPUT_INVALID');
}

const userRoot = path.resolve(dataRoot, userHandle);
const extensionsRoot = path.resolve(userRoot, 'extensions');
await mkdir(dataRoot, { recursive: true });

// Provision the complete directory layout from the exact pinned SillyTavern
// checkout. Host lifecycle intentionally rejects a partially populated existing
// user root, so creating only chats/groups/extensions is not a valid bootstrap.
const { USER_DIRECTORY_TEMPLATE } = await import(
  pathToFileURL(path.join(stRoot, 'src/constants.js')).href
);
for (const relativeDirectory of Object.values(USER_DIRECTORY_TEMPLATE)) {
  const directory = path.resolve(userRoot, relativeDirectory);
  const relative = path.relative(userRoot, directory);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error('HOST_ACCEPTANCE_USER_DIRECTORY_PATH_ESCAPE');
  }
  await mkdir(directory, { recursive: true });
}

// A fresh SillyTavern user needs these two root-level files before the browser
// can complete firstLoadInit(). Seed them from the exact pinned ST checkout;
// never overwrite files already present in the disposable user data root.
async function provisionDefaultUserFile(fileName) {
  const source = path.resolve(stRoot, 'default', 'content', fileName);
  const destination = path.resolve(userRoot, fileName);
  const sourceRelative = path.relative(stRoot, source);
  const destinationRelative = path.relative(userRoot, destination);
  if (sourceRelative.startsWith('..' + path.sep) || path.isAbsolute(sourceRelative)
    || destinationRelative.startsWith('..' + path.sep) || path.isAbsolute(destinationRelative)) {
    throw new Error('HOST_ACCEPTANCE_DEFAULT_USER_FILE_PATH_ESCAPE');
  }

  const sourceStat = await lstat(source).catch(() => null);
  if (!sourceStat?.isFile()) {
    throw new Error('HOST_ACCEPTANCE_DEFAULT_USER_TEMPLATE_MISSING: ' + fileName);
  }

  try {
    await copyFile(source, destination, fsConstants.COPYFILE_EXCL);
  } catch (error) {
    if (error?.code !== 'EEXIST') {
      throw error;
    }
    const destinationStat = await lstat(destination).catch(() => null);
    if (!destinationStat?.isFile()) {
      throw new Error('HOST_ACCEPTANCE_DEFAULT_USER_FILE_INVALID: ' + fileName);
    }
  }
}

await provisionDefaultUserFile('settings.json');
await provisionDefaultUserFile('user.css');

const identityStore = new HostIdentityStore({ directory: identityDirectory });
await identityStore.assertOutsideRoot(dataRoot);
const identity = await identityStore.resolveAuthenticatedAccount(userHandle);
const sourceIdentity = await verifyPinnedSourceIdentity({
  installRoot: stRoot,
  userExtensionsPath: extensionsRoot,
});
if (sourceIdentity?.status !== 'CURRENT_IDENTITIES_VERIFIED'
  || !/^[a-f0-9]{64}$/.test(sourceIdentity.manifest_sha256 ?? '')) {
  throw new Error('HOST_ACCEPTANCE_PINNED_SOURCE_NOT_VERIFIED: ' + (sourceIdentity?.code ?? 'UNKNOWN'));
}

const rootId = createHash('sha256').update(userRoot, 'utf8').digest('hex');
const registry = [{
  adapter_id: adapterId,
  host_installation_id: identity.host_installation_id,
  authenticated_account_id: identity.authenticated_account_id,
  root_id: rootId,
  source_manifest_sha256: sourceIdentity.manifest_sha256,
}];

process.stdout.write(JSON.stringify({
  status: 'LOCAL_HOST_ACCEPTANCE_IDENTITY_PREPARED',
  user_handle: userHandle,
  adapter_id: adapterId,
  host_installation_id: identity.host_installation_id,
  authenticated_account_id: identity.authenticated_account_id,
  root_id: rootId,
  source_manifest_sha256: sourceIdentity.manifest_sha256,
  registry,
}) + '\n');
