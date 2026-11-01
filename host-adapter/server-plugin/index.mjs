import path from 'node:path';
import { HostIdentityStore } from '../prototype/st-host-identity-store.mjs';
import { enumerateHostDataInventory } from '../prototype/host-data-inventory.mjs';
import {
    createHostIdentityHandler,
    createHostSessionHandler,
} from '../prototype/st-host-inventory-handler.mjs';
import { createHostContextRoute } from './context-route.mjs';

export const info = Object.freeze({
    id: 'logic-engine-extension-gateway',
    name: 'Logic Engine Host Adapter',
    description: 'Authenticated SillyTavern Extension Gateway for Logic Engine',
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PINNED_HOST_COMMIT = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';

function validText(value, max = 200) {
    return typeof value === 'string' && value === value.trim() && value.length > 0
        && value.length <= max
        && ![...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

function readConfig() {
    const coreUrl = process.env.LOGIC_ENGINE_CORE_URL;
    const apiToken = process.env.LOGIC_ENGINE_API_TOKEN;
    const adapterId = process.env.LOGIC_ENGINE_ADAPTER_ID;
    const adapterToken = process.env.LOGIC_ENGINE_ADAPTER_TOKEN;
    const actorEntityId = process.env.LOGIC_ENGINE_HOST_ACTOR_ENTITY_ID;
    const identityDirectory = process.env.LOGIC_ENGINE_HOST_IDENTITY_DIR;
    if (!validText(coreUrl, 2048) || !validText(apiToken, 4096) || apiToken.length < 16
        || !validText(adapterId) || !validText(adapterToken, 4096) || adapterToken.length < 16
        || !validText(actorEntityId) || !validText(identityDirectory, 4096)
        || !path.isAbsolute(identityDirectory)) return null;
    let url;
    try { url = new URL(coreUrl); } catch { return null; }
    if (url.username || url.password || url.search || url.hash
        || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) {
        return null;
    }
    return Object.freeze({
        coreUrl: url.toString().replace(/\/$/, ''),
        apiToken,
        adapterId,
        adapterToken,
        actorEntityId,
        identityDirectory: path.resolve(identityDirectory),
    });
}

function coreHeaders(config) {
    return {
        authorization: 'Bearer ' + config.apiToken,
        'content-type': 'application/json',
        'x-adapter-id': config.adapterId,
        'x-adapter-token': config.adapterToken,
    };
}

async function corePost(config, route, body) {
    const response = await fetch(config.coreUrl + route, {
        method: 'POST',
        headers: coreHeaders(config),
        body: JSON.stringify(body),
        redirect: 'error',
    });
    let payload;
    try { payload = await response.json(); } catch { throw new Error('CORE_RESPONSE_INVALID'); }
    if (!response.ok) {
        const code = payload?.error?.code;
        throw new Error(typeof code === 'string' && /^[A-Z0-9_]{1,96}$/.test(code) ? code : 'CORE_REQUEST_REJECTED');
    }
    return payload;
}

function safeFailure(response, code = 'HOST_GATEWAY_NOT_READY', status = 503) {
    return response.status(status).json({ status: 'NON_READY', code });
}

export async function init(router) {
    const config = readConfig();
    const identityDirectory = config?.identityDirectory || process.env.LOGIC_ENGINE_HOST_IDENTITY_DIR;
    const identityStore = typeof identityDirectory === 'string' && path.isAbsolute(identityDirectory)
        ? new HostIdentityStore({ directory: path.resolve(identityDirectory) })
        : null;

    router.get('/health', (_request, response) => {
        response.set('Cache-Control', 'no-store, private');
        return response.status(200).json({
            status: config && identityStore ? 'CONFIGURED' : 'NON_READY',
            gateway: 'LOGIC_ENGINE_EXTENSION_GATEWAY',
        });
    });

    router.get('/session', createHostSessionHandler());

    if (identityStore) {
        router.get('/identity', createHostIdentityHandler({ identityStore }));
    }

    if (!config || !identityStore) {
        router.post('/context', (_request, response) => safeFailure(response));
        return;
    }

    const contextRoute = createHostContextRoute({
        identityStore,
        enumerate: enumerateHostDataInventory,
        config: { adapterId: config.adapterId, actorEntityId: config.actorEntityId, adapterToken: config.adapterToken },
        corePost: (route, body) => corePost(config, route, body),
    });
    router.post('/context', contextRoute.middleware, contextRoute.handler);

}
