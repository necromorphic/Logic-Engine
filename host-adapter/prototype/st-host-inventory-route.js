import express from 'express';
import { enumeratePinnedSillyTavernChatFiles } from './logic-engine-st-source-inventory.mjs';
import { createHostIdentityHandler, createHostInventoryHandler, createHostSessionHandler } from './logic-engine-host-inventory-handler.mjs';
import { HostIdentityStore } from './logic-engine-host-identity-store.mjs';

const PINNED_SILLYTAVERN_COMMIT = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';

export const router = express.Router();

router.get('/inventory', createHostInventoryHandler({
    enumerate: enumeratePinnedSillyTavernChatFiles,
    pinnedHostCommit: PINNED_SILLYTAVERN_COMMIT,
    hostBuildClaim: process.env.LOGIC_ENGINE_HOST_BUILD_SHA || '',
}));

router.get('/session', createHostSessionHandler());


const identityDirectory = process.env.LOGIC_ENGINE_HOST_IDENTITY_DIR || '';
if (identityDirectory) {
    const identityStore = new HostIdentityStore({ directory: identityDirectory });
    router.get('/identity', createHostIdentityHandler({ identityStore }));
}
