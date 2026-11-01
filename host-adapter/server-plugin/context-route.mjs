import path from 'node:path';
import {
    createHostRequestAuthenticationGate,
} from '../prototype/st-host-inventory-handler.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PINNED_HOST_COMMIT = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';

function validText(value, max = 200) {
    return typeof value === 'string' && value === value.trim() && value.length > 0
        && value.length <= max
        && ![...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

function safeFailure(response, code = 'HOST_GATEWAY_NOT_READY', status = 503) {
    return response.status(status).json({ status: 'NON_READY', code });
}

export function createHostConversationResolver({ identityStore, enumerate, pinnedHostCommit = PINNED_HOST_COMMIT }) {
    if (!identityStore || typeof identityStore.resolveAuthenticatedAccount !== 'function'
        || typeof enumerate !== 'function' || !/^[a-f0-9]{40}$/.test(pinnedHostCommit)) {
        throw new TypeError('A persistent identity store and trusted inventory enumerator are required.');
    }
    return async request => {
        const handle = request?.user?.profile?.handle;
        const session = request?.session;
        const directories = request?.user?.directories;
        const body = request?.body;
        const conversationUuid = body?.conversation_uuid;
        if (!body || typeof body !== 'object' || Array.isArray(body)
            || Object.keys(body).some(key => key !== 'conversation_uuid')
            || !validText(handle) || !session || session.logicEngineSessionHandle !== handle
            || !UUID.test(session.logicEngineSessionId ?? '') || !UUID.test(conversationUuid ?? '')
            || !directories || !['root', 'chats', 'groups', 'groupChats'].every(key =>
                typeof directories[key] === 'string' && path.isAbsolute(directories[key]))) {
            throw new Error('HOST_REQUEST_IDENTITY_INVALID');
        }
        const inventory = await enumerate({
            directories: {
                root: directories.root,
                chats: directories.chats,
                groups: directories.groups,
                groupChats: directories.groupChats,
            },
            hostCommit: pinnedHostCommit,
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
        if (!UUID.test(identity?.host_installation_id ?? '')) throw new Error('HOST_INSTALLATION_IDENTITY_INVALID');
        return [
            identity.host_installation_id,
            identity.authenticated_account_id,
            conversationUuid,
        ].join(':');
    };
}

export function createHostContextRoute({ identityStore, enumerate, corePost, config }) {
    if (!identityStore || typeof identityStore.resolveAuthenticatedAccount !== 'function'
        || typeof enumerate !== 'function' || typeof corePost !== 'function'
        || !config || !validText(config.adapterId) || !validText(config.actorEntityId)) {
        throw new TypeError('Host context route dependencies are incomplete.');
    }
    const gate = createHostRequestAuthenticationGate({
        resolveConversationId: createHostConversationResolver({ identityStore, enumerate }),
    });
    const handler = async (request, response) => {
        response.set('Cache-Control', 'no-store, private');
        response.set('Vary', 'Cookie');
        if (!gate.isAuthenticatedHostRequest(request)) return response.sendStatus(403);
        const conversationId = gate.resolveHostConversationId(request);
        if (typeof conversationId !== 'string') return response.sendStatus(403);
        try {
            const bindingResult = await corePost('/v1/host-conversation-bindings/resolve', {
                conversation_id: conversationId,
            });
            const worldId = bindingResult?.binding?.world_id;
            if (!validText(worldId)) return safeFailure(response, 'CORE_WORLD_BINDING_INVALID', 409);
            const actorResult = await corePost(
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
    };
    return Object.freeze({ middleware: gate.middleware, handler });
}
