import { createHostIdentityHandler, createHostInventoryHandler, createHostRequestAuthenticationGate, createHostSessionHandler } from './st-host-inventory-handler.mjs';
import { createHostDigestProxyHandler, createHostInventoryReconcileProxyHandler, createHostMemoryDispatchProxyHandler, createHostLifecycleJournalProxy, createHostRootInventoryPersistence } from './st-server-digest-proxy.mjs';
import { HostIdentityStore } from './st-host-identity-store.mjs';
import { enumerateHostDataInventory } from './host-data-inventory.mjs';

const PINNED_SILLYTAVERN_COMMIT = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';

export const info = Object.freeze({
  id: 'logic-engine-extension-gateway',
  name: 'Logic Engine Extension Gateway',
  description: 'Authenticated SillyTavern Extension Gateway for Host-to-Core transport',
});

export async function init(router) {
  if (typeof router?.get !== 'function' || typeof router?.post !== 'function') {
    throw new TypeError('SillyTavern server plugin requires an Express router');
  }

  // SillyTavern 1.19.0 loads this plugin after requireLoginMiddleware.
  // All browser-facing Host routes live under this one Extension Gateway.
  const identityDirectory = process.env.LOGIC_ENGINE_HOST_IDENTITY_DIR || '';
  const identityStore = identityDirectory ? new HostIdentityStore({ directory: identityDirectory }) : null;
  const persistRootInventory = identityStore ? createHostRootInventoryPersistence({ identityStore }) : null;
  router.get('/session', createHostSessionHandler());
  router.get('/identity', identityStore
    ? createHostIdentityHandler({ identityStore })
    : (_request, response) => response.status(503).json({ status: 'NON_READY', code: 'HOST_IDENTITY_STORE_UNCONFIGURED' }));
  router.get('/inventory', createHostInventoryHandler({
    enumerate: enumerateHostDataInventory,
    pinnedHostCommit: PINNED_SILLYTAVERN_COMMIT,
    hostBuildClaim: process.env.LOGIC_ENGINE_HOST_BUILD_SHA || '',
    persistRootInventory,
  }));
  if (identityStore) {
    const lifecycle = createHostLifecycleJournalProxy({ identityStore });
    router.post('/host-lifecycle/events', lifecycle.append);
    router.get('/host-lifecycle/status', lifecycle.status);
    const hostGate = createHostRequestAuthenticationGate({
      resolveConversationId: async request => {
        const userHandle = request?.user?.profile?.handle;
        const sessionId = request?.session?.logicEngineSessionId;
        const conversationUuid = request?.body?.conversation_uuid;
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (typeof userHandle !== 'string' || !userHandle.trim() || !uuid.test(sessionId ?? '') || !uuid.test(conversationUuid ?? '')) return null;
        const identity = await identityStore.resolveAuthenticatedAccount(userHandle);
        const directories = request.user.directories;
        const inventory = await enumerateHostDataInventory({
          directories: { root: directories.root, chats: directories.chats, groups: directories.groups, groupChats: directories.groupChats },
          hostCommit: PINNED_SILLYTAVERN_COMMIT,
        });
        if (inventory?.filesystem?.status !== 'complete'
          || inventory?.source?.status !== 'AUTHORITATIVE_COMPLETE'
          || inventory?.authority?.status !== 'AUTHORITATIVE_COMPLETE'
          || !/^[a-f0-9]{64}$/.test(inventory?.authority?.manifest_sha256 ?? '')
          || !Array.isArray(inventory?.source?.files)
          || inventory.source.files.filter(file => file?.logical_identity?.conversation_uuid === conversationUuid).length !== 1) return null;
        return {
          host_installation_id: identity.host_installation_id,
          authenticated_account_id: identity.authenticated_account_id,
          host_session_id: sessionId,
          conversation_id: identity.host_installation_id + ':' + identity.authenticated_account_id + ':' + conversationUuid,
        };
      },
    });
    router.post('/dispatch', hostGate.middleware,
      createHostMemoryDispatchProxyHandler({ resolveHostContext: hostGate.resolveHostContext }));
  } else {
    const unavailable = (_request, response) => response.status(503).json({ status: 'NON_READY', code: 'HOST_IDENTITY_STORE_UNCONFIGURED' });
    router.post('/host-lifecycle/events', unavailable);
    router.get('/host-lifecycle/status', unavailable);
    router.post('/dispatch', unavailable);
  }
  router.post('/host-version-ledger/capture', createHostDigestProxyHandler());
  router.post('/host-version-ledger/reconcile', createHostInventoryReconcileProxyHandler());
}
