import express from 'express';
import { enumerateHostDataInventory } from './host-data-inventory.mjs';
import {
    createHostIdentityHandler,
    createHostInventoryHandler,
    createHostSessionHandler,
} from './logic-engine-host-inventory-handler.mjs';
import { HostIdentityStore } from './logic-engine-host-identity-store.mjs';
import { createHostRootInventoryPersistence, createHostLifecycleJournalProxy } from './logic-engine-lifecycle-proxy.mjs';

const PINNED_SILLYTAVERN_COMMIT = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';

export const router = express.Router();

const identityDirectory = process.env.LOGIC_ENGINE_HOST_IDENTITY_DIR || '';
const identityStore = identityDirectory
    ? new HostIdentityStore({ directory: identityDirectory })
    : null;
const persistRootInventory = identityStore
    ? createHostRootInventoryPersistence({ identityStore })
    : null;

router.get('/inventory', createHostInventoryHandler({
    enumerate: enumerateHostDataInventory,
    pinnedHostCommit: PINNED_SILLYTAVERN_COMMIT,
    hostBuildClaim: process.env.LOGIC_ENGINE_HOST_BUILD_SHA || '',
    persistRootInventory,
}));

router.get('/session', createHostSessionHandler());

if (identityStore) {
    router.get('/identity', createHostIdentityHandler({ identityStore }));
    const lifecycleProxy = createHostLifecycleJournalProxy({ identityStore });
    router.post('/host-lifecycle/events', lifecycleProxy.append);
    router.get('/host-lifecycle/status', lifecycleProxy.status);
}
