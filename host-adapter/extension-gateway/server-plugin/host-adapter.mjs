import path from 'node:path';
import {
  createHostIdentityHandler,
  createHostInventoryHandler,
  createHostRequestAuthenticationGate,
  createHostSessionHandler,
  resolveHostDataDirectories,
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

const PINNED_SILLYTAVERN_COMMIT = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';

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
} = {}) {
  if (!env || typeof env !== 'object' || typeof enumerate !== 'function'
    || typeof fetchImpl !== 'function'
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

  const session = createHostSessionHandler();
  const identity = identityStore
    ? createHostIdentityHandler({ identityStore })
    : unavailable('HOST_IDENTITY_STORE_UNCONFIGURED');
  const inventory = createHostInventoryHandler({
    enumerate,
    pinnedHostCommit: PINNED_SILLYTAVERN_COMMIT,
    hostBuildClaim: env.LOGIC_ENGINE_HOST_BUILD_SHA || '',
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
      resolveConversationId: async (request, requestedConversationUuid) => {
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
        const rootProof = await persistRootInventory({
          userHandle,
          rootPath: directories.root,
          entries: hostInventory.filesystem.entries,
        });
        if (rootProof?.status !== 'AUTHORITATIVE_COMPLETE'
          || rootProof.integrity_status !== 'INTEGRITY_OK'
          || !Number.isSafeInteger(rootProof.sequence)
          || !/^[a-f0-9]{64}$/.test(rootProof.manifest_sha256 ?? '')) {
          return { status: 'NON_READY', code: 'HOST_INVENTORY_NOT_AUTHORITATIVE' };
        }

        if (hostInventory?.source?.status !== 'AUTHORITATIVE_COMPLETE'
          || hostInventory?.authority?.status !== 'AUTHORITATIVE_COMPLETE'
          || !/^[a-f0-9]{64}$/.test(hostInventory?.authority?.manifest_sha256 ?? '')
          || !Array.isArray(hostInventory?.source?.files)
          || hostInventory.source.files.filter(file =>
            file?.logical_identity?.conversation_uuid === conversationUuid).length !== 1) {
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
    async prepareGenerationContext(request, hostRoute) {
      const generationBody = hostRoute === 'horde-text'
        ? request?.body?.params
        : request?.body;
      const conversationUuid = generationBody?.logic_engine_conversation_uuid;
      const requestId = generationBody?.logic_engine_request_id;
      const contextSize = generationBody?.logic_engine_context_size;
      const generationType = generationBody?.logic_engine_generation_type;
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!identityStore || !uuid.test(conversationUuid ?? '') || !uuid.test(requestId ?? '')
        || !Number.isSafeInteger(contextSize) || contextSize < 1 || contextSize > 200000
        || typeof generationType !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(generationType)) {
        return Object.freeze({ status: 'NON_READY', code: 'HOST_GENERATION_ENVELOPE_INVALID' });
      }
      const result = await authentication.authenticate(request, conversationUuid);
      if (result.status !== 'READY') return result;
      const captured = {
        statusCode: null,
        payload: null,
        set() { return this; },
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.payload = payload; return this; },
        sendStatus(code) { this.statusCode = code; return this; },
      };
      await dispatch({
        hostRequest: request,
        body: {
          request_id: requestId,
          conversation_uuid: conversationUuid,
          context_size: contextSize,
          generation_type: generationType,
        },
      }, captured);
      if (captured.statusCode !== 200
        || !captured.payload || typeof captured.payload !== 'object'
        || !captured.payload.host_context || !captured.payload.retrieval) {
        return Object.freeze({
          status: 'NON_READY',
          code: typeof captured.payload?.code === 'string'
            ? captured.payload.code : 'HOST_NPC_CONTEXT_NON_READY',
        });
      }
      return Object.freeze({
        status: 'READY',
        context: result.context,
        coreContext: captured.payload.host_context,
        retrieval: captured.payload.retrieval,
        requestId,
        generationType,
      });
    },
    capture: createHostDigestProxyHandler({ env, fetchImpl }),
    reconcile: createHostInventoryReconcileProxyHandler({ env, fetchImpl }),
  });
}
