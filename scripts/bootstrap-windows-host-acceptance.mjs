import { createHash } from 'node:crypto';
import { mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
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
await mkdir(extensionsRoot, { recursive: true });

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
