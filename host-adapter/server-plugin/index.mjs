import path from 'node:path';
import { HostIdentityStore } from '../prototype/st-host-identity-store.mjs';
import { enumerateHostDataInventory } from '../prototype/host-data-inventory.mjs';
import {
    createHostIdentityHandler,
    createHostRequestAuthenticationGate,
    createHostSessionHandler,
} from '../prototype/st-host-inventory-handler.mjs';

export const info = Object.freeze({
    id: 'logic-engine-host-adapter',
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

    const resolveConversationId = async request => {
        const handle = request?.user?.profile?.handle;
        const session = request?.session;
        const directories = request?.user?.directories;
        const conversationUuid = request?.body?.conversation_uuid;
        if (!validText(handle) || !session || session.logicEngineSessionHandle !== handle
            || !UUID.test(session.logicEngineSessionId ?? '') || !UUID.test(conversationUuid ?? '')
            || !directories || !['root', 'chats', 'groups', 'groupChats'].every(key =>
                typeof directories[key] === 'string' && path.isAbsolute(directories[key]))) {
            throw new Error('HOST_REQUEST_IDENTITY_INVALID');
        }
        const inventory = await enumerateHostDataInventory({
            directories: {
                root: directories.root,
                chats: directories.chats,
                groups: directories.groups,
                groupChats: directories.groupChats,
            },
            hostCommit: PINNED_HOST_COMMIT,
        });
        if (inventory?.filesystem?.status !== 'complete'
            || inventory?.source?.status !== 'DOUBLE_SCAN_CANDIDATE'
            || !Array.isArray(inventory?.source?.files)) {
            throw new Error('HOST_CONVERSATION_INVENTORY_INCOMPLETE');
        }
        const matches = inventory.source.files.filter(file =>
            file?.logical_identity?.conversation_uuid === conversationUuid);
        if (matches.length !== 1) throw new Error('HOST_CONVERSATION_IDENTITY_AMBIGUOUS');
        const identity = await identityStore.resolveAuthenticatedAccount(handle);
        return [
            session.logicEngineSessionId,
            identity.host_installation_id,
            conversationUuid,
        ].join(':');
    };

    const gate = createHostRequestAuthenticationGate({ resolveConversationId });
    router.post('/context', gate.middleware, async (request, response) => {
        response.set('Cache-Control', 'no-store, private');
        response.set('Vary', 'Cookie');
        if (!gate.isAuthenticatedHostRequest(request)) return response.sendStatus(403);
        const conversationId = gate.resolveHostConversationId(request);
        if (typeof conversationId !== 'string') return response.sendStatus(403);
        try {
            const bindingResult = await corePost(config, '/v1/host-conversation-bindings/resolve', {
                conversation_id: conversationId,
            });
            const worldId = bindingResult?.binding?.world_id;
            if (!validText(worldId)) return safeFailure(response, 'CORE_WORLD_BINDING_INVALID', 409);
            const actorResult = await corePost(
                config,
                '/v1/worlds/' + encodeURIComponent(worldId) + '/actors/resolve',
                { entity_id: config.actorEntityId },
            );
            const actorId = actorResult?.resolution?.actor?.entity_id;
            if (!validText(actorId)) return safeFailure(response, 'CORE_ACTOR_BINDING_INVALID', 409);
            const account = await identityStore.resolveAuthenticatedAccount(request.user.profile.handle);
            return response.status(200).json({
                status: 'AUTHENTICATED_HOST_CONTEXT',
                identity: {
                    installation_id: account.host_installation_id,
                    account_id: account.authenticated_account_id,
                    session_id: request.session.logicEngineSessionId,
                    conversation_id: conversationId,
                },
                binding: {
                    world_id: worldId,
                    actor_id: actorId,
                    adapter_id: config.adapterId,
                },
                authority: 'SERVER_SESSION_AND_CORE_BINDINGS',
            });
        } catch (error) {
            const code = typeof error?.message === 'string' && /^[A-Z0-9_]{1,96}$/.test(error.message)
                ? error.message : 'CORE_CONTEXT_RESOLUTION_FAILED';
            return safeFailure(response, code, 409);
        }
    });
}
