import express from 'express';
import { enumerateHostDataInventory } from './host-data-inventory.mjs';
import { createHostInventoryHandler, createHostSessionHandler } from './logic-engine-host-inventory-handler.mjs';

const PINNED_SILLYTAVERN_COMMIT = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';

export const router = express.Router();

router.get('/inventory', createHostInventoryHandler({
    enumerate: enumerateHostDataInventory,
    pinnedHostCommit: PINNED_SILLYTAVERN_COMMIT,
    hostBuildClaim: process.env.LOGIC_ENGINE_HOST_BUILD_SHA || '',
}));

router.get('/session', createHostSessionHandler());
