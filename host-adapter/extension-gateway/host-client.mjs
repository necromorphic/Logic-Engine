const HOST_CONTEXT_PATH = '/api/plugins/logic-engine-host-adapter/context';

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
