import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAuthenticatedHostContext } from '../host-client.mjs';

const conversationUuid = '4e6b0a80-4e73-4c66-aaf3-7a6e62c7f403';

test('browser client obtains CSRF token and calls only the authenticated ST plugin route', async () => {
    const calls = [];
    const result = await resolveAuthenticatedHostContext(conversationUuid, async (url, options) => {
        calls.push({ url, options });
        if (url === '/csrf-token') {
            return { ok: true, json: async () => ({ token: 'csrf-session-token' }) };
        }
        if (url === '/api/plugins/logic-engine-extension-gateway/session') {
            return { ok: true, json: async () => ({
                host_session_id: '2e6b0a80-4e73-4c66-aaf3-7a6e62c7f401',
                host_user_handle: 'default-user',
            }) };
        }
        if (String(url).startsWith('/api/plugins/logic-engine-extension-gateway/inventory?')) {
            return { ok: true, json: async () => ({
                status: 'AUTHORITATIVE_COMPLETE',
                host_user_handle: 'default-user',
                blockers: [],
                root_inventory_reconciliation: { status: 'AUTHORITATIVE_COMPLETE', integrity_status: 'INTEGRITY_OK' },
            }) };
        }
        return {
            ok: true,
            json: async () => ({ status: 'AUTHENTICATED_HOST_CONTEXT', binding: { world_id: 'w', actor_id: 'a' } }),
        };
    });
    assert.equal(result.status, 'AUTHENTICATED_HOST_CONTEXT');
    assert.equal(calls.length, 4);
    assert.equal(calls[0].url, '/csrf-token');
    assert.equal(calls[1].url, '/api/plugins/logic-engine-extension-gateway/session');
    assert.ok(String(calls[2].url).startsWith('/api/plugins/logic-engine-extension-gateway/inventory?conversation_uuid='));
    assert.equal(calls[2].options.credentials, 'same-origin');
    assert.equal(calls[3].url, '/api/plugins/logic-engine-extension-gateway/context');
    assert.equal(calls[3].options.credentials, 'same-origin');
    assert.equal(calls[3].options.headers['x-csrf-token'], 'csrf-session-token');
    assert.deepEqual(JSON.parse(calls[3].options.body), { conversation_uuid: conversationUuid });
    assert.ok(calls.every(call => !String(call.url).includes('logic-engine/v1')));
});

test('browser client rejects malformed UUID before making a request', async () => {
    let calls = 0;
    await assert.rejects(
        resolveAuthenticatedHostContext('attacker-selected', async () => { calls++; }),
        /valid active conversation UUID/,
    );
    assert.equal(calls, 0);
});

test('browser client fails closed when CSRF token or Host context is unavailable', async () => {
    await assert.rejects(
        resolveAuthenticatedHostContext(conversationUuid, async () => ({ ok: false, json: async () => ({}) })),
        /HOST_CSRF_TOKEN_UNAVAILABLE/,
    );
    let count = 0;
    await assert.rejects(
        resolveAuthenticatedHostContext(conversationUuid, async url => {
            count++;
            return url === '/csrf-token'
                ? { ok: true, json: async () => ({ token: 'csrf' }) }
                : url === '/api/plugins/logic-engine-extension-gateway/session'
                    ? { ok: true, json: async () => ({
                        host_session_id: '2e6b0a80-4e73-4c66-aaf3-7a6e62c7f401',
                        host_user_handle: 'default-user',
                    }) }
                    : String(url).startsWith('/api/plugins/logic-engine-extension-gateway/inventory?')
                        ? { ok: true, json: async () => ({
                            status: 'DOUBLE_SCAN_CANDIDATE',
                            host_user_handle: 'default-user',
                            blockers: ['NO_SHARED_POINT_IN_TIME_SNAPSHOT'],
                            root_inventory_reconciliation: { status: 'BASELINED_REVIEW_ONLY', integrity_status: 'INTEGRITY_OK' },
                        }) }
                        : { ok: true, json: async () => ({ status: 'AUTHENTICATED_HOST_CONTEXT' }) };
        }),
        /HOST_INVENTORY_NOT_READY/,
    );
    assert.equal(count, 3);
});
