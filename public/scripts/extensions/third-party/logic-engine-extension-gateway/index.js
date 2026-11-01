import { getRequestHeaders } from '../../../script.js';

const GATEWAY_PATH = '/api/logic-engine/extension';
const MAX_ENVELOPE_BYTES = 256 * 1024;
let active = true;

function makeRequestId() {
    if (!globalThis.crypto?.randomUUID) {
        throw new Error('Logic-Engine Gateway requires crypto.randomUUID.');
    }
    return globalThis.crypto.randomUUID();
}

/**
 * Untrusted client transport only. No identity, World, Actor, Core or Provider
 * authority is stored here; the server derives all trusted bindings.
 */
export async function request(operation, payload = {}) {
    if (!active) throw new Error('Logic-Engine Extension is inactive.');
    if (typeof operation !== 'string' || !/^[a-z][a-z0-9._-]{0,63}$/.test(operation)
        || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new TypeError('Invalid Logic-Engine Extension request.');
    }

    const envelope = {
        schema_version: 1,
        request_id: makeRequestId(),
        operation,
        payload,
    };
    const body = JSON.stringify(envelope);
    if (new TextEncoder().encode(body).byteLength > MAX_ENVELOPE_BYTES) {
        throw new Error('Logic-Engine Extension request exceeds the Gateway limit.');
    }

    const response = await fetch(GATEWAY_PATH, {
        method: 'POST',
        headers: {
            ...getRequestHeaders(),
            'Content-Type': 'application/json',
        },
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        body,
    });
    const result = await response.json().catch(() => ({ error: 'INVALID_GATEWAY_RESPONSE' }));
    if (!response.ok) {
        const error = new Error(result?.error || 'LOGIC_ENGINE_GATEWAY_REQUEST_FAILED');
        error.status = response.status;
        throw error;
    }
    return result;
}

export function init() {
    active = true;
    Object.defineProperty(window, 'logicEngineExtensionGateway', {
        configurable: true,
        enumerable: false,
        writable: false,
        value: Object.freeze({ request }),
    });
}

export function teardown() {
    active = false;
    try { delete window.logicEngineExtensionGateway; } catch { /* best-effort client cleanup */ }
}
