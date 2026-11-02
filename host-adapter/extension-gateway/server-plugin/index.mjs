import { createSillyTavernHostAdapter } from './host-adapter.mjs';

export const info = Object.freeze({
  id: 'logic-engine-extension-gateway',
  name: 'Logic Engine Extension Gateway',
  description: 'Single SillyTavern ingress and bounded request router for the authenticated Host Adapter',
});

/**
 * Extension Gateway.
 *
 * Its only responsibilities are owning the one ST-facing plugin namespace,
 * registering bounded route envelopes, and forwarding each request to the
 * corresponding internal Host Adapter handler. Authentication, identity,
 * inventory authority and Host-to-Core assertions belong to Host Adapter.
 * World/Actor binding and authorization remain Core-owned.
 */
export async function init(router) {
  if (typeof router?.get !== 'function' || typeof router?.post !== 'function') {
    throw new TypeError('SillyTavern Extension Gateway requires an Express router');
  }

  const hostAdapter = createSillyTavernHostAdapter();

  // One public ingress namespace: /api/plugins/logic-engine-extension-gateway/*.
  // The Gateway does not inspect session/user data or construct identity.
  router.get('/session', hostAdapter.session);
  router.get('/identity', hostAdapter.identity);
  router.get('/inventory', hostAdapter.inventory);
  router.post('/host-lifecycle/events', hostAdapter.lifecycleEvents);
  router.get('/host-lifecycle/status', hostAdapter.lifecycleStatus);
  router.post('/dispatch', hostAdapter.dispatchMiddleware, hostAdapter.dispatch);
  router.post('/host-version-ledger/capture', hostAdapter.capture);
  router.post('/host-version-ledger/reconcile', hostAdapter.reconcile);
}
