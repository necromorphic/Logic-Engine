import test from 'node:test';
import assert from 'node:assert/strict';
import { armAuthenticatedHostRequest, getStatus } from '../index.js';

const conversationUuid = '4e6b0a80-4e73-4c66-aaf3-7a6e62c7f403';

test('protected generation is aborted before authenticated Host context dispatch', async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, options) => {
        calls.push({ url, options });
        if (url === '/csrf-token') {
            return { ok: true, json: async () => ({ token: 'csrf-token' }) };
        }
        if (url === '/api/plugins/logic-engine-extension-gateway/session') {
            return { ok: true, json: async () => ({ host_session_id: '2e6b0a80-4e73-4c66-aaf3-7a6e62c7f401', host_user_handle: 'default-user' }) };
        }
        if (url.startsWith('/api/plugins/logic-engine-extension-gateway/inventory?')) {
            // Test-only authoritative fixture for the browser flow. Production
            // inventory remains NON_READY until the Host proves full-root completeness.
            return { ok: true, json: async () => ({
                status: 'AUTHORITATIVE_COMPLETE',
                host_user_handle: 'default-user',
                blockers: [],
                root_inventory_reconciliation: {
                    status: 'AUTHORITATIVE_COMPLETE',
                    integrity_status: 'INTEGRITY_OK',
                },
            }) };
        }
        return {
            ok: true,
            json: async () => ({
                status: 'AUTHENTICATED_HOST_CONTEXT',
                identity: { conversation_id: 'installation:account:conversation' },
                binding: { world_id: 'world', actor_id: 'actor' },
            }),
        };
    };
    try {
        let dispatched = null;
        let aborted = false;
        armAuthenticatedHostRequest('request-1', async value => { dispatched = value; });
        await globalThis.logicEngineExtensionGatewayGenerationInterceptor(
            [{ chat_metadata: { logic_engine_conversation_id: conversationUuid } }],
            4096,
            value => { aborted = value === true; },
            'normal',
        );
        assert.equal(aborted, true);
        assert.equal(dispatched.hostContext.status, 'AUTHENTICATED_HOST_CONTEXT');
        assert.equal(dispatched.hostContext.binding.world_id, 'world');
        assert.equal(calls[2].url.startsWith('/api/plugins/logic-engine-extension-gateway/inventory?'), true);
        assert.equal(calls[3].url, '/api/plugins/logic-engine-extension-gateway/context');
        assert.equal(getStatus().status, 'DISPATCH_DELEGATED');
    } finally {
        globalThis.fetch = originalFetch;
    }
});
