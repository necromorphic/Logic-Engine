import test from 'node:test';
import assert from 'node:assert/strict';

import { registerHostLifecycleAutoCapture } from '../index.js';

function createEventSource() {
    const listeners = new Map();
    return {
        listeners,
        on(event, listener) {
            listeners.set(event, listener);
        },
        removeListener(event, listener) {
            if (listeners.get(event) === listener) listeners.delete(event);
        },
    };
}

test('CHAT_CHANGED automatically enrolls a new chat and surfaces Inventory transport diagnostics', async () => {
    const previousLifecycle = globalThis.logicEngineHostLifecycle;
    const previousToastr = globalThis.toastr;
    const eventSource = createEventSource();
    const notices = [];
    const calls = [];
    let currentLocator = null;

    globalThis.logicEngineHostLifecycle = {
        async syncCurrentDigestInventory() {
            calls.push('sync');
            return { status: 'NOT_ENROLLED' };
        },
        async enrollCurrentConversation() {
            calls.push('enroll');
            return { status: 'REVIEW_ONLY', persistedInventoryStatus: 'NON_READY' };
        },
        async getCoreCaptureStatus() {
            calls.push('status');
            return {
                status: 'NON_READY',
                diagnostic: {
                    code: 'HOST_INVENTORY_HTTP_503',
                    httpStatus: 503,
                    reason: 'persisted Host inventory request failed',
                },
            };
        },
    };
    globalThis.toastr = {
        warning(message, title) {
            notices.push({ message, title });
        },
    };

    try {
        const remove = await registerHostLifecycleAutoCapture({
            eventSource,
            eventTypes: { CHAT_CHANGED: 'chat_id_changed' },
            getCurrentChatId: () => currentLocator,
        });
        currentLocator = 'chat-a';
        const listener = eventSource.listeners.get('chat_id_changed');
        assert.equal(typeof listener, 'function');

        const result = await listener('chat-a');
        assert.equal(result.status, 'NON_READY');
        assert.deepEqual(calls, ['sync', 'enroll', 'status']);
        assert.equal(notices.length, 1);
        assert.equal(notices[0].title, 'Logic Engine Host');
        assert.match(notices[0].message, /HOST_INVENTORY_HTTP_503/);
        assert.match(notices[0].message, /HTTP 503/);

        const repeated = await listener('chat-a');
        assert.equal(repeated.status, 'ALREADY_CHECKED');
        assert.deepEqual(calls, ['sync', 'enroll', 'status']);

        remove();
        assert.equal(eventSource.listeners.has('chat_id_changed'), false);
    } finally {
        if (previousLifecycle === undefined) delete globalThis.logicEngineHostLifecycle;
        else globalThis.logicEngineHostLifecycle = previousLifecycle;
        if (previousToastr === undefined) delete globalThis.toastr;
        else globalThis.toastr = previousToastr;
    }
});

test('CHAT_CHANGED verifies an enrolled chat without creating a second baseline', async () => {
    const previousLifecycle = globalThis.logicEngineHostLifecycle;
    const previousToastr = globalThis.toastr;
    const eventSource = createEventSource();
    const notices = [];
    const calls = [];
    let currentLocator = null;

    globalThis.logicEngineHostLifecycle = {
        async syncCurrentDigestInventory() {
            calls.push('sync');
            return {
                status: 'NON_READY',
                code: 'HOST_INVENTORY_HTTP_503',
                httpStatus: 503,
            };
        },
        async enrollCurrentConversation() {
            calls.push('enroll');
            throw new Error('ENROLLMENT_MUST_NOT_RUN_FOR_EXISTING_CHAT');
        },
        async getCoreCaptureStatus() {
            calls.push('status');
            return {
                status: 'NON_READY',
                diagnostic: {
                    code: 'HOST_INVENTORY_HTTP_503',
                    httpStatus: 503,
                },
            };
        },
    };
    globalThis.toastr = {
        warning(message, title) {
            notices.push({ message, title });
        },
    };

    try {
        const remove = await registerHostLifecycleAutoCapture({
            eventSource,
            eventTypes: { CHAT_CHANGED: 'chat_id_changed' },
            getCurrentChatId: () => currentLocator,
        });
        currentLocator = 'chat-existing';
        const listener = eventSource.listeners.get('chat_id_changed');
        const result = await listener('chat-existing');

        assert.equal(result.status, 'NON_READY');
        assert.deepEqual(calls, ['sync', 'status']);
        assert.equal(notices.length, 1);
        assert.match(notices[0].message, /HOST_INVENTORY_HTTP_503/);

        remove();
    } finally {
        if (previousLifecycle === undefined) delete globalThis.logicEngineHostLifecycle;
        else globalThis.logicEngineHostLifecycle = previousLifecycle;
        if (previousToastr === undefined) delete globalThis.toastr;
        else globalThis.toastr = previousToastr;
    }
});
