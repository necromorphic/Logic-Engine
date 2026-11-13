import test from 'node:test';
import assert from 'node:assert/strict';

import { registerHostGenerationIdentity } from '../index.js';

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

test('Gateway generation identity does not register a second CHAT_CHANGED lifecycle handler', async () => {
    const eventSource = createEventSource();
    const eventTypes = {
        CHAT_CHANGED: 'chat_id_changed',
        CHAT_COMPLETION_SETTINGS_READY: 'chat_completion_settings_ready',
        GENERATE_AFTER_DATA: 'generate_after_data',
    };

    const remove = await registerHostGenerationIdentity(
        { eventSource, eventTypes },
        { resolveHostContext: async () => { throw new Error('must not run until a generation event'); } },
    );

    assert.deepEqual([...eventSource.listeners.keys()].sort(), [
        'chat_completion_settings_ready',
        'generate_after_data',
    ]);
    assert.equal(eventSource.listeners.has(eventTypes.CHAT_CHANGED), false);

    remove();
    assert.equal(eventSource.listeners.size, 0);
});
