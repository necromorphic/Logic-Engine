import { enumeratePinnedSillyTavernChatFiles } from './st-source-inventory.mjs';
import { createHostInventoryHandler, createHostSessionHandler } from './st-host-inventory-handler.mjs';
import { createHostDigestProxyHandler, createHostInventoryReconcileProxyHandler } from './st-server-digest-proxy.mjs';

const PINNED_SILLYTAVERN_COMMIT = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';

export const info = Object.freeze({
  id: 'logic-engine-host',
  name: 'Logic Engine Host Adapter',
  description: 'Authenticated, fail-closed SillyTavern source inventory bridge',
});

export async function init(router) {
  if (typeof router?.get !== 'function') {
    throw new TypeError('SillyTavern server plugin requires an Express router');
  }

  // SillyTavern 1.19.0 loads server plugins after requireLoginMiddleware.
  // Keep both routes private; handlers additionally validate the middleware-
  // populated user context and the adapter-owned signed-session identity.
  router.get('/session', createHostSessionHandler());
  router.post('/host-version-ledger/capture', createHostDigestProxyHandler());
  router.post('/host-version-ledger/reconcile', createHostInventoryReconcileProxyHandler());
  router.get('/inventory', createHostInventoryHandler({
    enumerate: enumeratePinnedSillyTavernChatFiles,
    pinnedHostCommit: PINNED_SILLYTAVERN_COMMIT,
    hostBuildClaim: process.env.LOGIC_ENGINE_HOST_BUILD_SHA || '',
  }));
}
