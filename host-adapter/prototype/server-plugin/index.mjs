import { enumerateHostDataInventory } from './host-data-inventory.mjs';
import {
  createHostIdentityHandler,
  createHostInventoryHandler,
  createHostSessionHandler,
} from './st-host-inventory-handler.mjs';
import { HostIdentityStore } from './st-host-identity-store.mjs';
import { createHostContextTransportHandler } from './host-context-transport.mjs';

const PINNED_SILLYTAVERN_COMMIT = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';
const noStore = (request, response, next) => {
  response.set('Cache-Control', 'no-store, private');
  response.set('Vary', 'Cookie');
  return next();
};

export const info = Object.freeze({
  id: 'logic-engine-extension-gateway',
  name: 'Logic-Engine Extension Gateway',
  description: 'Authenticated SillyTavern ingress for the Logic-Engine Host adapter',
});

export async function init(router) {
  if (typeof router?.get !== 'function' || typeof router?.use !== 'function') {
    throw new TypeError('SillyTavern Extension Gateway requires an Express router');
  }

  // ST mounts server plugins after requireLoginMiddleware and its CSRF layer.
  // No Core URL, Core token, adapter secret, or caller-selected upstream is
  // accepted by these routes. This router is the only ST-side Gateway ingress.
  router.use(noStore);
  router.get('/session', createHostSessionHandler());

  const identityDirectory = process.env.LOGIC_ENGINE_HOST_IDENTITY_DIR || '';
  const identityStore = identityDirectory
    ? new HostIdentityStore({ directory: identityDirectory })
    : null;

  if (identityStore) {
    router.get('/identity', createHostIdentityHandler({ identityStore }));
  } else {
    router.get('/identity', (_request, response) => response.status(503).json({
      status: 'NON_READY',
      code: 'HOST_IDENTITY_STORE_NOT_CONFIGURED',
    }));
  }

  router.get('/inventory', createHostInventoryHandler({
    enumerate: enumerateHostDataInventory,
    pinnedHostCommit: PINNED_SILLYTAVERN_COMMIT,
    hostBuildClaim: process.env.LOGIC_ENGINE_HOST_BUILD_SHA || '',
  }));

  // The only ST→Core call is made server-to-server from this Gateway.
  // Browser input selects only a conversation UUID, which is revalidated
  // against the authenticated account's server-side inventory. World/Actor
  // and credentials are deployment-owned; Core rechecks current bindings.
  router.post('/context', identityStore
    ? createHostContextTransportHandler({
      identityStore,
      enumerate: enumerateHostDataInventory,
    })
    : (_request, response) => response.status(503).json({
      status: 'NON_READY',
      code: 'HOST_IDENTITY_STORE_NOT_CONFIGURED',
    }));
}
