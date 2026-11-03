import path from 'node:path';
import {
  createHostIdentityHandler,
  createHostInventoryHandler,
  createHostRequestAuthenticationGate,
  createHostSessionHandler,
  resolveHostDataDirectories,
  CORE_ATTESTED_SOURCE_BLOCKERS,
} from './st-host-inventory-handler.mjs';
import {
  createHostDigestProxyHandler,
  createHostInventoryReconcileProxyHandler,
  createHostMemoryDispatchProxyHandler,
  createHostLifecycleJournalProxy,
  createHostRootInventoryPersistence,
} from './st-server-digest-proxy.mjs';
import { HostIdentityStore } from './st-host-identity-store.mjs';
import { enumerateHostDataInventory } from './host-data-inventory.mjs';
import { createHostSessionRevocationClient } from './st-host-session-revocation.mjs';
import { verifyPinnedSourceIdentity } from './st-source-attestation.mjs';
import { fileURLToPath } from 'node:url';

const PINNED_SILLYTAVERN_COMMIT = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';
const SILLYTAVERN_INSTALL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const verifySourceIdentity = ({ userExtensionsPath } = {}) => verifyPinnedSourceIdentity({
  installRoot: SILLYTAVERN_INSTALL_ROOT,
  userExtensionsPath,
});

function unavailable(code) {
  return (_request, response) => response.status(503).json({ status: 'NON_READY', code });
}

/**
 * Authenticated Host Adapter.
 *
 * This component owns SillyTavern session authentication, installation/account/
 * conversation identity resolution, Host inventory checks and the authenticated
 * Host-to-Core assertion. It is deliberately not the Extension Gateway and does
 * not mount public routes. The Gateway may only delegate requests to these
 * already-composed handlers.
 */
export function createSillyTavernHostAdapter({
  env = process.env,
  enumerate = enumerateHostDataInventory,
  fetchImpl = globalThis.fetch,
  persistRootInventory: injectedPersistRootInventory = null,
  verifySourceIdentity: injectedVerifySourceIdentity = verifySourceIdentity,
} = {}) {
  if (!env || typeof env !== 'object' || typeof enumerate !== 'function'
    || typeof fetchImpl !== 'function'
    || typeof injectedVerifySourceIdentity !== 'function'
    || (injectedPersistRootInventory !== null && typeof injectedPersistRootInventory !== 'function')) {
    throw new TypeError('SillyTavern Host Adapter configuration is invalid.');
  }

  const identityDirectory = env.LOGIC_ENGINE_HOST_IDENTITY_DIR || '';
  const identityStore = identityDirectory
    ? new HostIdentityStore({ directory: identityDirectory })
    : null;
  const persistRootInventory = identityStore
    ? injectedPersistRootInventory ?? createHostRootInventoryPersistence({ identityStore, env, fetchImpl })
    : null;

  const revokeSession = identityStore
    ? createHostSessionRevocationClient({ env, fetchImpl, identityStore })
    : null;
  const session = createHostSessionHandler({ revokeSession });
  const identity = identityStore
    ? createHostIdentityHandler({ identityStore })
    : unavailable('HOST_IDENTITY_STORE_UNCONFIGURED');
  const inventory = createHostInventoryHandler({
    enumerate,
    pinnedHostCommit: PINNED_SILLYTAVERN_COMMIT,
    hostBuildClaim: env.LOGIC_ENGINE_HOST_BUILD_SHA || '',
    verifySourceIdentity: injectedVerifySourceIdentity,
    persistRootInventory,
  });

  let lifecycleEvents = unavailable('HOST_IDENTITY_STORE_UNCONFIGURED');
  let lifecycleStatus = unavailable('HOST_IDENTITY_STORE_UNCONFIGURED');
  let dispatchMiddleware = (_request, response) =>
    response.status(503).json({ status: 'NON_READY', code: 'HOST_IDENTITY_STORE_UNCONFIGURED' });
  let dispatch = unavailable('HOST_IDENTITY_STORE_UNCONFIGURED');

  if (identityStore) {
    const lifecycle = createHostLifecycleJournalProxy({ identityStore });
    lifecycleEvents = lifecycle.append;
    lifecycleStatus = lifecycle.status;

    const authentication = createHostRequestAuthenticationGate({
      resolveConversationId: async request => {
        const userHandle = request?.user?.profile?.handle;
        const sessionId = request?.session?.logicEngineSessionId;
        const conversationUuid = request?.body?.conversation_uuid;
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (typeof userHandle !== 'string' || !userHandle.trim()
          || !uuid.test(sessionId ?? '') || !uuid.test(conversationUuid ?? '')) return null;

        const directories = resolveHostDataDirectories(request?.user?.directories);
        if (!directories) return { status: 'NON_READY', code: 'HOST_INVENTORY_PATHS_UNAVAILABLE' };
        const dataRoot = typeof globalThis.DATA_ROOT === 'string' && globalThis.DATA_ROOT.trim()
          ? path.resolve(globalThis.DATA_ROOT) : null;
        if (typeof dataRoot !== 'string' || !path.isAbsolute(dataRoot)) {
          return { status: 'NON_READY', code: 'HOST_IDENTITY_DATA_ROOT_UNAVAILABLE' };
        }
        await identityStore.assertOutsideRoot(dataRoot);
        const identityRecord = await identityStore.resolveAuthenticatedAccount(userHandle);
        const hostInventory = await enumerate({
          directories,
          hostCommit: PINNED_SILLYTAVERN_COMMIT,
        });
        if (hostInventory?.filesystem?.status !== 'complete'
          || !Array.isArray(hostInventory?.filesystem?.entries)) {
          return { status: 'NON_READY', code: 'HOST_INVENTORY_NOT_AUTHORITATIVE' };
        }

        // Core must independently accept the full-root manifest before this
        // request can acquire a Host context. A local scan or baseline alone
        // is not proof of completeness and must remain NON_READY.
        let sourceIdentity;
        try { sourceIdentity = await injectedVerifySourceIdentity({ userExtensionsPath: directories.extensions }); }
        catch { return { status: 'NON_READY', code: 'HOST_SOURCE_IDENTITY_UNAVAILABLE' }; }
        const rootProof = await persistRootInventory({
          userHandle,
          rootPath: directories.root,
          entries: hostInventory.filesystem.entries,
          snapshotAlignment: hostInventory.snapshot_alignment,
          snapshotSha256: hostInventory.filesystem.snapshot_sha256,
          sourceIdentity,
        });
        if (rootProof?.status !== 'AUTHORITATIVE_COMPLETE'
          || rootProof.integrity_status !== 'INTEGRITY_OK'
          || !Number.isSafeInteger(rootProof.sequence) || rootProof.sequence < 1
          || !/^[a-f0-9]{64}$/.test(rootProof.manifest_sha256 ?? '')
          || !/^[a-f0-9]{64}$/.test(rootProof.attestation_sha256 ?? '')
          || !Number.isSafeInteger(rootProof.lifecycle_sequence) || rootProof.lifecycle_sequence < 1
          || !/^[a-f0-9]{64}$/.test(rootProof.lifecycle_head_sha256 ?? '')
          || sourceIdentity?.status !== 'CURRENT_IDENTITIES_VERIFIED'
          || !/^[a-f0-9]{64}$/.test(sourceIdentity.manifest_sha256 ?? '')
          || rootProof.source_manifest_sha256 !== sourceIdentity.manifest_sha256
          || hostInventory.snapshot_alignment !== 'SHARED_VSS_SNAPSHOT') {
          return { status: 'NON_READY', code: 'HOST_INVENTORY_NOT_AUTHORITATIVE' };
        }

        const source = hostInventory.source;
        const sourceFiles = Array.isArray(source?.files) ? source.files : null;
        const unresolvedSourceBlockers = Array.isArray(source?.blockers)
          ? source.blockers.filter(code => !CORE_ATTESTED_SOURCE_BLOCKERS.includes(code))
          : null;
        const conversationFiles = sourceFiles?.filter(file =>
          file?.logical_identity?.conversation_uuid === conversationUuid) ?? [];
        if (source?.status !== 'DOUBLE_SCAN_CANDIDATE'
          || source?.authority !== 'NON_AUTHORITATIVE'
          || source?.host_commit !== PINNED_SILLYTAVERN_COMMIT
          || source?.scope !== 'PINNED_SILLYTAVERN_CHAT_DATA_ROOTS'
          || source?.historical_boundary !== 'CURRENT_FILE_SET_ONLY_ENROLLMENT_BASELINE_REQUIRED'
          || source?.logical_identity_status !== 'CURRENT_FILE_IDENTITIES_VERIFIED'
          || unresolvedSourceBlockers === null || unresolvedSourceBlockers.length !== 0
          || !sourceFiles || conversationFiles.length !== 1
          || conversationFiles[0]?.logical_identity?.identity_status !== 'CURRENT_IDENTITIES_VERIFIED'
          || source.snapshot_id !== hostInventory.filesystem.snapshot_id
          || source.snapshot_provider !== 'windows-vss-client-accessible'
          || source.snapshot_consistency !== 'VSS_POINT_IN_TIME_READ_ONLY') {
          return { status: 'NON_READY', code: 'HOST_INVENTORY_NOT_AUTHORITATIVE' };
        }

        return {
          host_installation_id: identityRecord.host_installation_id,
          authenticated_account_id: identityRecord.authenticated_account_id,
          host_session_id: sessionId,
          conversation_id: identityRecord.host_installation_id + ':'
            + identityRecord.authenticated_account_id + ':' + conversationUuid,
        };
      },
    });
    dispatchMiddleware = authentication.middleware;
    dispatch = createHostMemoryDispatchProxyHandler({
      env,
      fetchImpl,
      resolveHostContext: authentication.resolveHostContext,
    });
  }

  return Object.freeze({
    session,
    identity,
    inventory,
    lifecycleEvents,
    lifecycleStatus,
    dispatchMiddleware,
    dispatch,
    capture: createHostDigestProxyHandler({ env, fetchImpl }),
    reconcile: createHostInventoryReconcileProxyHandler({ env, fetchImpl }),
  });
}
