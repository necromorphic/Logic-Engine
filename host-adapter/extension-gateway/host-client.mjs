const HOST_CONTEXT_PATH = '/api/plugins/logic-engine-extension-gateway/context';

function validConversationUuid(value) {
    return typeof value === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Resolve a server-authenticated Host context through the native ST server
 * plugin. The browser never receives Core credentials and never contacts Core.
 */
export async function resolveAuthenticatedHostContext(conversationUuid, fetchImpl = globalThis.fetch) {
    if (!validConversationUuid(conversationUuid) || typeof fetchImpl !== 'function') {
        throw new TypeError('A valid active conversation UUID and fetch implementation are required.');
    }

    const tokenResponse = await fetchImpl('/csrf-token', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
    });
    if (!tokenResponse?.ok) throw new Error('HOST_CSRF_TOKEN_UNAVAILABLE');
    const tokenPayload = await tokenResponse.json();
    if (typeof tokenPayload?.token !== 'string' || tokenPayload.token.length === 0) {
        throw new Error('HOST_CSRF_TOKEN_INVALID');
    }

    const sessionResponse = await fetchImpl('/api/plugins/logic-engine-extension-gateway/session', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
    });
    if (!sessionResponse?.ok) throw new Error('HOST_SESSION_IDENTITY_UNAVAILABLE');
    const sessionPayload = await sessionResponse.json();
    if (typeof sessionPayload?.host_session_id !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionPayload.host_session_id)) {
        throw new Error('HOST_SESSION_IDENTITY_INVALID');
    }

    const inventoryResponse = await fetchImpl(
        '/api/plugins/logic-engine-extension-gateway/inventory?conversation_uuid=' + encodeURIComponent(conversationUuid),
        {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
            redirect: 'error',
        },
    );
    let inventory;
    try { inventory = await inventoryResponse.json(); } catch { throw new Error('HOST_INVENTORY_RESPONSE_INVALID'); }
    if (!inventoryResponse.ok
        || inventory?.host_user_handle !== sessionPayload.host_user_handle
        || inventory?.status !== 'AUTHORITATIVE_COMPLETE'
        || !Array.isArray(inventory?.blockers) || inventory.blockers.length !== 0
        || inventory?.root_inventory_reconciliation?.status !== 'AUTHORITATIVE_COMPLETE'
        || inventory?.root_inventory_reconciliation?.integrity_status !== 'INTEGRITY_OK') {
        throw new Error('HOST_INVENTORY_NOT_READY');
    }

    const response = await fetchImpl(HOST_CONTEXT_PATH, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        headers: {
            'content-type': 'application/json',
            'x-csrf-token': tokenPayload.token,
        },
        body: JSON.stringify({ conversation_uuid: conversationUuid }),
    });
    let payload;
    try { payload = await response.json(); } catch { throw new Error('HOST_CONTEXT_RESPONSE_INVALID'); }
    if (!response.ok || payload?.status !== 'AUTHENTICATED_HOST_CONTEXT') {
        const code = payload?.code;
        throw new Error(typeof code === 'string' && /^[A-Z0-9_]{1,96}$/.test(code)
            ? code : 'HOST_CONTEXT_NOT_READY');
    }
    return payload;
}
