import path from 'node:path';
import { createHash } from 'node:crypto';
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
import { HostLifecycleReceiptStore } from './st-host-lifecycle-receipt-store.mjs';
import { createHostMutationRuntimeAcceptanceVerifier } from './st-host-mutation-runtime-acceptance.mjs';
import { HostAccountMutationReceiptStore, verifySingleTargetMutationTransition } from './st-host-account-mutation-receipt-store.mjs';
import { enumerateHostDataInventory } from './host-data-inventory.mjs';
import { createHostSessionRevocationClient } from './st-host-session-revocation.mjs';
import { verifyPinnedSourceIdentity } from './st-source-attestation.mjs';
import {
  PINNED_ST_MUTATION_COVERAGE_SHA256,
  PINNED_ST_MUTATION_ROUTE_COUNT,
  verifyPinnedSillyTavernMutationCoverage,
} from './st-mutation-route-contract.mjs';
import { fileURLToPath } from 'node:url';

const PINNED_SILLYTAVERN_COMMIT = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';
const validCharacterAvatarId = value => typeof value === 'string' && value === value.trim()
  && value.length > 0 && value.length <= 200 && value !== '.' && value !== '..'
  && !value.includes('/') && !value.includes('\\')
  && ![...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const SILLYTAVERN_INSTALL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const verifySourceIdentity = ({ userExtensionsPath } = {}) => verifyPinnedSourceIdentity({
  installRoot: SILLYTAVERN_INSTALL_ROOT,
  userExtensionsPath,
});

function unavailable(code) {
  return (_request, response) => response.status(503).json({ status: 'NON_READY', code });
}

/**
 * Ensure Core has a durable World/Actor binding before the read-only embedded
 * Gateway resolves it. Credentials and the default World stay server-owned;
 * only authenticated Host identity components are sent.
 */
export async function ensureCoreConversationWorldBinding({ env = process.env, fetchImpl = globalThis.fetch, context } = {}) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const coreUrl = env?.LOGIC_ENGINE_CORE_URL;
  const apiToken = env?.LOGIC_ENGINE_API_TOKEN;
  const adapterId = env?.LOGIC_ENGINE_ADAPTER_ID;
  const adapterToken = env?.LOGIC_ENGINE_ADAPTER_TOKEN;
  if (typeof fetchImpl !== 'function' || typeof coreUrl !== 'string' || !coreUrl.trim()
    || typeof apiToken !== 'string' || apiToken.length < 16
    || typeof adapterId !== 'string' || !adapterId.trim()
    || typeof adapterToken !== 'string' || adapterToken.length < 16 || adapterToken === apiToken) {
    return Object.freeze({ status: 'NON_READY', code: 'LOGIC_ENGINE_PROXY_UNCONFIGURED' });
  }
  if (!uuid.test(context?.host_session_id ?? '')
    || !uuid.test(context?.host_installation_id ?? '')
    || !uuid.test(context?.conversation_uuid ?? '')) {
    return Object.freeze({ status: 'NON_READY', code: 'HOST_CONTEXT_IDENTITY_INVALID' });
  }
  let url;
  try { url = new URL(coreUrl); } catch {
    return Object.freeze({ status: 'NON_READY', code: 'LOGIC_ENGINE_PROXY_UNCONFIGURED' });
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    return Object.freeze({ status: 'NON_READY', code: 'LOGIC_ENGINE_PROXY_UNCONFIGURED' });
  }
  url.pathname = '/v1/host-context/resolve';
  const conversationId = [
    context.host_session_id, context.host_installation_id, context.conversation_uuid,
  ].join(':');
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + apiToken,
        'content-type': 'application/json',
        'x-adapter-id': adapterId,
        'x-adapter-token': adapterToken,
      },
      body: JSON.stringify({
        conversation_id: conversationId,
        host_session_id: context.host_session_id,
        host_installation_id: context.host_installation_id,
        conversation_uuid: context.conversation_uuid,
      }),
      signal: AbortSignal.timeout(5000),
    });
    const payload = await response.json().catch(() => null);
    const binding = payload?.context;
    const validId = value => typeof value === 'string' && value.length > 0
      && value === value.trim() && value.length <= 200
      && ![...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
    if (!response.ok || !binding || typeof binding !== 'object' || Array.isArray(binding)
      || Object.keys(binding).sort().join(',') !== 'actor_id,actor_type,adapter_id,conversation_id,world_id'
      || binding.adapter_id !== adapterId || binding.conversation_id !== conversationId
      || !validId(binding.world_id) || !validId(binding.actor_id)
      || typeof binding.actor_type !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/i.test(binding.actor_type)) {
      return Object.freeze({
        status: 'NON_READY',
        code: /^[A-Z][A-Z0-9_]{2,95}$/.test(payload?.error?.code ?? '')
          ? payload.error.code : 'HOST_WORLD_ACTOR_BINDING_UNAVAILABLE',
      });
    }
    return Object.freeze({
      status: 'READY',
      coreConversationId: conversationId,
      binding: Object.freeze({
        adapter_id: binding.adapter_id,
        conversation_id: binding.conversation_id,
        world_id: binding.world_id,
        actor_id: binding.actor_id,
        actor_type: binding.actor_type,
      }),
    });
  } catch {
    return Object.freeze({ status: 'NON_READY', code: 'LOGIC_ENGINE_UNREACHABLE' });
  }
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
  verifyMutationCoverage: injectedVerifyMutationCoverage = null,
  verifyMutationRuntimeAcceptance: injectedVerifyMutationRuntimeAcceptance = null,
} = {}) {
  if (!env || typeof env !== 'object' || typeof enumerate !== 'function'
    || typeof fetchImpl !== 'function'
    || typeof injectedVerifySourceIdentity !== 'function'
    || (injectedVerifyMutationCoverage !== null && injectedVerifyMutationCoverage !== undefined && typeof injectedVerifyMutationCoverage !== 'function')
    || (injectedVerifyMutationRuntimeAcceptance !== null && typeof injectedVerifyMutationRuntimeAcceptance !== 'function')
    || (injectedPersistRootInventory !== null && typeof injectedPersistRootInventory !== 'function')) {
    throw new TypeError('SillyTavern Host Adapter configuration is invalid.');
  }

  const identityDirectory = env.LOGIC_ENGINE_HOST_IDENTITY_DIR || '';
  const identityStore = identityDirectory
    ? new HostIdentityStore({ directory: identityDirectory })
    : null;
  const lifecycleSourceEvidenceProvider = async ({ directories } = {}) => {
    try {
      const sourceIdentity = await injectedVerifySourceIdentity({ userExtensionsPath: directories?.extensions });
      const mutationCoverage = await (injectedVerifyMutationCoverage ?? verifyPinnedSillyTavernMutationCoverage)();
      if (sourceIdentity?.status !== 'CURRENT_IDENTITIES_VERIFIED'
        || !/^[a-f0-9]{64}$/.test(sourceIdentity.manifest_sha256 ?? '')
        || mutationCoverage?.status !== 'VERIFIED'
        || mutationCoverage.source_commit !== PINNED_SILLYTAVERN_COMMIT
        || mutationCoverage.coverage_manifest_sha256 !== PINNED_ST_MUTATION_COVERAGE_SHA256
        || !/^[a-f0-9]{64}$/.test(mutationCoverage.source_files_sha256 ?? '')
        || mutationCoverage.route_count !== PINNED_ST_MUTATION_ROUTE_COUNT) return { status: 'NON_READY' };
      return {
        status: 'VERIFIED',
        source_manifest_sha256: sourceIdentity.manifest_sha256,
        mutation_coverage_manifest_sha256: mutationCoverage.coverage_manifest_sha256,
        mutation_coverage_source_files_sha256: mutationCoverage.source_files_sha256,
      };
    } catch {
      return { status: 'NON_READY' };
    }
  };
  const lifecycleReceiptStore = identityDirectory
    ? new HostLifecycleReceiptStore({
      directory: path.join(identityDirectory, 'lifecycle-receipts'),
      enumerate,
      sourceEvidenceProvider: lifecycleSourceEvidenceProvider,
      hostCommit: PINNED_SILLYTAVERN_COMMIT,
    })
    : null;
  const verifyMutationRuntimeAcceptance = injectedVerifyMutationRuntimeAcceptance
    ?? (lifecycleReceiptStore
      ? createHostMutationRuntimeAcceptanceVerifier({ receiptStore: lifecycleReceiptStore })
      : null);
  const accountMutationReceiptStore = identityDirectory
    ? new HostAccountMutationReceiptStore({
      directory: path.join(identityDirectory, 'account-mutations'),
      enumerate: async ({ directories }) => {
        const inventory = await enumerate({ directories, hostCommit: PINNED_SILLYTAVERN_COMMIT });
        if (inventory?.filesystem?.status !== 'complete'
          || !Array.isArray(inventory.filesystem.entries)) return { status: 'non_ready', entries: [] };
        return {
          status: 'complete',
          entries: inventory.filesystem.entries.map(entry => ({ path: entry.path, sha256: entry.sha256 })),
        };
      },
      verifyTransition: verifySingleTargetMutationTransition,
    })
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
    verifyMutationCoverage: injectedVerifyMutationCoverage ?? verifyPinnedSillyTavernMutationCoverage,
    persistRootInventory,
  });

  let lifecycleEvents = unavailable('HOST_IDENTITY_STORE_UNCONFIGURED');
  let lifecycleStatus = unavailable('HOST_IDENTITY_STORE_UNCONFIGURED');
  let dispatchMiddleware = (_request, response) =>
    response.status(503).json({ status: 'NON_READY', code: 'HOST_IDENTITY_STORE_UNCONFIGURED' });
  let dispatch = unavailable('HOST_IDENTITY_STORE_UNCONFIGURED');
  let authentication = null;

  if (identityStore) {
    const lifecycle = createHostLifecycleJournalProxy({
      identityStore,
      receiptStore: lifecycleReceiptStore,
      ensureRootInventory: (request, conversationUuid) => authentication
        ? authentication.authenticate(request, conversationUuid)
        : Promise.resolve({ status: 'NON_READY', code: 'HOST_IDENTITY_STORE_UNCONFIGURED' }),
      resolveCommunicationRecipient: async ({ identity, hostSessionId, conversationUuid, targetLocator }) => {
        const configuredAvatarId = env.LOGIC_ENGINE_HOST_CHARACTER_AVATAR_ID;
        const targetAvatarId = typeof targetLocator === 'string' ? targetLocator.split('/')[0] : null;
        if (!validCharacterAvatarId(configuredAvatarId) || targetAvatarId !== configuredAvatarId) return null;
        const resolved = await ensureCoreConversationWorldBinding({
          env,
          fetchImpl,
          context: {
            host_installation_id: identity.host_installation_id,
            authenticated_account_id: identity.authenticated_account_id,
            host_session_id: hostSessionId,
            conversation_uuid: conversationUuid,
          },
        });
        return resolved.status === 'READY'
          ? Object.freeze({ ...resolved.binding, host_character_avatar_id: configuredAvatarId })
          : null;
      },
    });
    lifecycleEvents = lifecycle.append;
    lifecycleStatus = lifecycle.status;

    authentication = createHostRequestAuthenticationGate({
      resolveConversationId: async (request, requestedConversationUuid, signal) => {
        const cancelled = () => signal?.aborted === true;
        if (cancelled()) return { status: 'NON_READY', code: 'HOST_GENERATION_CANCELLED' };
        const userHandle = request?.user?.profile?.handle;
        const sessionId = request?.session?.logicEngineSessionId;
        const conversationUuid = requestedConversationUuid;
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
        let identityRecord;
        let hostInventory;
        try {
          await identityStore.assertOutsideRoot(dataRoot);
          if (cancelled()) return { status: 'NON_READY', code: 'HOST_GENERATION_CANCELLED' };
          identityRecord = await identityStore.resolveAuthenticatedAccount(userHandle);
          if (cancelled()) return { status: 'NON_READY', code: 'HOST_GENERATION_CANCELLED' };
          const mutationRecovery = await accountMutationReceiptStore.recoverPending(identityRecord, { directories });
          if (mutationRecovery.status === 'RECOVERY_REQUIRED') {
            return { status: 'NON_READY', code: mutationRecovery.reason === 'HOST_ACCOUNT_MUTATION_OWNER_STILL_ACTIVE'
              ? 'HOST_ACCOUNT_MUTATION_PENDING' : 'HOST_ACCOUNT_MUTATION_RECOVERY_REQUIRED' };
          }
          if (await accountMutationReceiptStore.hasPending(identityRecord)) {
            return { status: 'NON_READY', code: 'HOST_ACCOUNT_MUTATION_PENDING' };
          }
          if (cancelled()) return { status: 'NON_READY', code: 'HOST_GENERATION_CANCELLED' };
          hostInventory = await enumerate({
            directories,
            hostCommit: PINNED_SILLYTAVERN_COMMIT,
            signal,
          });
          if (cancelled()) return { status: 'NON_READY', code: 'HOST_GENERATION_CANCELLED' };
        } catch {
          return { status: 'NON_READY', code: 'HOST_INVENTORY_NOT_AUTHORITATIVE' };
        }
        if (hostInventory?.filesystem?.status !== 'complete'
          || !Array.isArray(hostInventory?.filesystem?.entries)) {
          return { status: 'NON_READY', code: 'HOST_INVENTORY_NOT_AUTHORITATIVE' };
        }
        let mutationCoverage;
        try {
          mutationCoverage = await (injectedVerifyMutationCoverage ?? verifyPinnedSillyTavernMutationCoverage)();
        } catch {
          return { status: 'NON_READY', code: 'HOST_MUTATION_ROUTE_COVERAGE_UNVERIFIED' };
        }
        if (mutationCoverage?.status !== 'VERIFIED'
          || mutationCoverage.source_commit !== PINNED_SILLYTAVERN_COMMIT
          || mutationCoverage.coverage_manifest_sha256 !== PINNED_ST_MUTATION_COVERAGE_SHA256
          || mutationCoverage.route_count !== PINNED_ST_MUTATION_ROUTE_COUNT
          || !/^[a-f0-9]{64}$/.test(mutationCoverage.source_files_sha256 ?? '')) {
          return { status: 'NON_READY', code: 'HOST_MUTATION_ROUTE_COVERAGE_UNVERIFIED' };
        }

        // Core must independently accept the full-root manifest before this
        // request can acquire a Host context. A local scan or baseline alone
        // is not proof of completeness and must remain NON_READY.
        let sourceIdentity;
        try { sourceIdentity = await injectedVerifySourceIdentity({ userExtensionsPath: directories.extensions, signal }); }
        catch { return { status: 'NON_READY', code: 'HOST_SOURCE_IDENTITY_UNAVAILABLE' }; }
        if (cancelled()) return { status: 'NON_READY', code: 'HOST_GENERATION_CANCELLED' };
        if (sourceIdentity?.status !== 'CURRENT_IDENTITIES_VERIFIED'
          || !/^[a-f0-9]{64}$/.test(sourceIdentity.manifest_sha256 ?? '')) {
          return { status: 'NON_READY', code: 'HOST_SOURCE_IDENTITY_UNAVAILABLE' };
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

        // Static route presence is not runtime acceptance. The production
        // verifier audits durable operation receipts, real-file before/after
        // evidence, restart recovery, pinned source identity and the current
        // shared VSS snapshot before this request may acquire a Host context.
        if (typeof verifyMutationRuntimeAcceptance !== 'function') {
          return { status: 'NON_READY', code: 'HOST_MUTATION_RUNTIME_ACCEPTANCE_UNVERIFIED' };
        }
        let mutationRuntimeAcceptance;
        try {
          mutationRuntimeAcceptance = await verifyMutationRuntimeAcceptance({
            pinnedHostCommit: PINNED_SILLYTAVERN_COMMIT,
            rootPath: directories.root,
            entries: hostInventory.filesystem.entries,
            snapshotAlignment: hostInventory.snapshot_alignment,
            snapshotSha256: hostInventory.filesystem.snapshot_sha256,
            snapshotId: hostInventory.filesystem.snapshot_id,
            rootId: createHash('sha256').update(path.resolve(directories.root), 'utf8').digest('hex'),
            sourceIdentity,
            mutationCoverage,
            hostInstallationId: identityRecord.host_installation_id,
            authenticatedAccountId: identityRecord.authenticated_account_id,
            signal,
          });
        } catch {
          return { status: 'NON_READY', code: 'HOST_MUTATION_RUNTIME_ACCEPTANCE_UNVERIFIED' };
        }
        if (cancelled()) return { status: 'NON_READY', code: 'HOST_GENERATION_CANCELLED' };
        if (mutationRuntimeAcceptance?.status !== 'VERIFIED'
          || mutationRuntimeAcceptance.source_commit !== PINNED_SILLYTAVERN_COMMIT
          || mutationRuntimeAcceptance.snapshot_sha256 !== hostInventory.filesystem.snapshot_sha256
          || mutationRuntimeAcceptance.snapshot_id !== hostInventory.filesystem.snapshot_id
          || mutationRuntimeAcceptance.root_id !== createHash('sha256').update(path.resolve(directories.root), 'utf8').digest('hex')
          || mutationRuntimeAcceptance.source_manifest_sha256 !== sourceIdentity.manifest_sha256
          || mutationRuntimeAcceptance.mutation_coverage_manifest_sha256 !== mutationCoverage.coverage_manifest_sha256
          || !/^[a-f0-9]{64}$/.test(mutationRuntimeAcceptance.evidence_sha256 ?? '')) {
          return { status: 'NON_READY', code: 'HOST_MUTATION_RUNTIME_ACCEPTANCE_UNVERIFIED' };
        }

        let rootProof;
        try {
          if (typeof persistRootInventory !== 'function') {
            return { status: 'NON_READY', code: 'HOST_INVENTORY_NOT_AUTHORITATIVE' };
          }
          rootProof = await persistRootInventory({
            userHandle,
            rootPath: directories.root,
            entries: hostInventory.filesystem.entries,
            snapshotAlignment: hostInventory.snapshot_alignment,
            snapshotSha256: hostInventory.filesystem.snapshot_sha256,
            sourceIdentity,
            mutationCoverage,
            signal,
          });
          if (cancelled()) return { status: 'NON_READY', code: 'HOST_GENERATION_CANCELLED' };
        } catch {
          return { status: 'NON_READY', code: 'HOST_INVENTORY_NOT_AUTHORITATIVE' };
        }
        if (rootProof?.status !== 'AUTHORITATIVE_COMPLETE'
          || rootProof.integrity_status !== 'INTEGRITY_OK'
          || !Number.isSafeInteger(rootProof.sequence) || rootProof.sequence < 1
          || !/^[a-f0-9]{64}$/.test(rootProof.manifest_sha256 ?? '')
          || !/^[a-f0-9]{64}$/.test(rootProof.attestation_sha256 ?? '')
          || !Number.isSafeInteger(rootProof.lifecycle_sequence) || rootProof.lifecycle_sequence < 0
          || !/^[a-f0-9]{64}$/.test(rootProof.lifecycle_head_sha256 ?? '')
          || (rootProof.lifecycle_sequence === 0 && rootProof.lifecycle_head_sha256 !== '0'.repeat(64))
          || sourceIdentity?.status !== 'CURRENT_IDENTITIES_VERIFIED'
          || !/^[a-f0-9]{64}$/.test(sourceIdentity.manifest_sha256 ?? '')
          || rootProof.source_manifest_sha256 !== sourceIdentity.manifest_sha256
          || hostInventory.snapshot_alignment !== 'SHARED_VSS_SNAPSHOT') {
          return { status: 'NON_READY', code: 'HOST_INVENTORY_NOT_AUTHORITATIVE' };
        }

        return {
          host_installation_id: identityRecord.host_installation_id,
          authenticated_account_id: identityRecord.authenticated_account_id,
          host_session_id: sessionId,
          conversation_id: identityRecord.host_installation_id + ':'
            + identityRecord.authenticated_account_id + ':' + conversationUuid,
          root_id: createHash('sha256').update(path.resolve(directories.root), 'utf8').digest('hex'),
          root_inventory_sequence: rootProof.sequence,
          root_manifest_sha256: rootProof.manifest_sha256,
          conversation_kind: conversationFiles[0].kind,
          conversation_locator: conversationFiles[0].locator,
        };
      },
    });
    dispatchMiddleware = authentication.middleware;
    dispatch = createHostMemoryDispatchProxyHandler({
      env,
      fetchImpl,
      resolveHostContext: request => authentication.resolveHostContext(request?.hostRequest ?? request),
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
    async authenticateGenerationRequest(request, conversationUuid) {
      if (!authentication) return Object.freeze({ status: 'NON_READY', code: 'HOST_IDENTITY_STORE_UNCONFIGURED' });
      return authentication.authenticate(request, conversationUuid);
    },
    isAuthenticatedHostRequest(request) {
      return authentication?.isAuthenticatedHostRequest(request) === true;
    },
    resolveCoreConversationId(request) {
      return authentication?.resolveCoreConversationId(request) ?? null;
    },
    resolveHostIdentity(request) {
      const context = authentication?.resolveHostContext(request);
      if (!context) return null;
      return Object.freeze({
        host_installation_id: context.host_installation_id,
        authenticated_account_id: context.authenticated_account_id,
      });
    },
    async prepareGenerationContext(request, hostRoute, signal) {
      if (signal?.aborted === true) return Object.freeze({ status: 'NON_READY', code: 'HOST_GENERATION_CANCELLED' });
      if (!['chat-completions', 'text-completions', 'kobold', 'novelai-text', 'horde-text'].includes(hostRoute)) {
        return Object.freeze({ status: 'NON_READY', code: 'HOST_GENERATION_ROUTE_UNREGISTERED' });
      }
      // SillyTavern's pinned /api/horde/generate-text handler sends request.body
      // directly to Horde; its prompt and Logic Engine envelope are not under params.
      const generationBody = request?.body;
      const conversationUuid = generationBody?.logic_engine_conversation_uuid;
      const requestId = generationBody?.logic_engine_request_id;
      const generationId = generationBody?.logic_engine_generation_id;
      const contextSize = generationBody?.logic_engine_context_size;
      const generationType = generationBody?.logic_engine_generation_type;
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!identityStore || !uuid.test(conversationUuid ?? '') || !uuid.test(requestId ?? '')
        || !uuid.test(generationId ?? '') || !Number.isSafeInteger(contextSize) || contextSize < 1 || contextSize > 200000
        || typeof generationType !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(generationType)) {
        return Object.freeze({ status: 'NON_READY', code: 'HOST_GENERATION_ENVELOPE_INVALID' });
      }
      // This is the Host half of preparation only. World/Actor binding and both
      // NPC evidence lanes are resolved by the embedded Core runtime in-process;
      // generation must never fall back to the legacy HTTP resolve/retrieve proxy.
      const result = await authentication.authenticate(request, conversationUuid, signal);
      if (signal?.aborted === true) return Object.freeze({ status: 'NON_READY', code: 'HOST_GENERATION_CANCELLED' });
      if (result.status !== 'READY') return result;
      if (env.LOGIC_ENGINE_MEMORY_NPC_ENABLED === 'true') {
        const configuredAvatarId = env.LOGIC_ENGINE_HOST_CHARACTER_AVATAR_ID;
        const targetAvatarId = typeof result.context?.conversation_locator === 'string'
          ? result.context.conversation_locator.split('/')[0] : null;
        if (!validCharacterAvatarId(configuredAvatarId)
          || result.context?.conversation_kind !== 'character-chat'
          || targetAvatarId !== configuredAvatarId) {
          return Object.freeze({ status: 'NON_READY', code: 'HOST_NPC_RECIPIENT_BINDING_REQUIRED' });
        }
      }
      // The embedded Gateway opens Core read-only. Persist the first-time
      // conversation→World binding through Core's authenticated API before the
      // in-process reader resolves that binding from the shared SQLite file.
      const coreBinding = await ensureCoreConversationWorldBinding({ env, fetchImpl, context: result.context });
      if (signal?.aborted === true) return Object.freeze({ status: 'NON_READY', code: 'HOST_GENERATION_CANCELLED' });
      if (coreBinding.status !== 'READY') return coreBinding;
      return Object.freeze({
        status: 'READY',
        context: result.context,
        requestId,
        generationType,
      });
    },
    capture: createHostDigestProxyHandler({ env, fetchImpl }),
    reconcile: createHostInventoryReconcileProxyHandler({ env, fetchImpl }),
  });
}
