import { resolveAuthenticatedHostContext } from './host-client.mjs';
import { interceptProtectedGeneration } from './gateway-policy.mjs';

/**
 * Review-only SillyTavern Extension Gateway.
 *
 * This module exposes no global arm/cancel API. Its exported helpers are an
 * integration seam, not an authorization boundary: any code running in the
 * same SillyTavern page/module environment may call them. Host context resolution
 * now verifies the ST server session and Core bindings, but does not prove
 * lifecycle completeness or acquire a Core Memory Dispatch lease. Do not wire
 * production protected dispatch until those contracts are implemented.
 */
const gatewayState = {
    pendingRequest: null,
    dispatch: null,
    dispatchInFlight: false,
    protectedFailureLockout: false,
    lastStatus: 'IDLE',
};

export function armProtectedRequest(requestId, dispatch) {
    if (gatewayState.protectedFailureLockout) {
        throw new Error('Logic Engine Extension Gateway: protected dispatch failed; reload required');
    }
    if (gatewayState.pendingRequest) {
        throw new Error('Logic Engine Extension Gateway: a request is already armed');
    }
    if (typeof requestId !== 'string' || requestId.length === 0) {
        throw new Error('Logic Engine Extension Gateway: requestId is required');
    }
    gatewayState.pendingRequest = { requestId };
    gatewayState.dispatch = typeof dispatch === 'function' ? dispatch : null;
    gatewayState.lastStatus = 'ARMED';
}

/**
 * Arm the protected generation interceptor with a server-authenticated Host
 * context. The browser sends only the current chat UUID to the ST server plugin;
 * the plugin derives installation/account/session identity and resolves Core
 * world/actor bindings. The supplied consumer is still an integration seam,
 * not a Core authorization capability or a production model-dispatch path.
 */
export function armAuthenticatedHostRequest(requestId, dispatch) {
    if (typeof dispatch !== 'function') {
        throw new TypeError('An explicit protected dispatch consumer is required.');
    }
    armProtectedRequest(requestId, async generation => {
        const header = Array.isArray(generation?.chat) ? generation.chat[0] : null;
        let conversationUuid = header?.chat_metadata?.logic_engine_conversation_id;
        if (typeof conversationUuid !== 'string') {
            const { getContext } = await import('../../../extensions.js');
            conversationUuid = getContext()?.chatMetadata?.logic_engine_conversation_id;
        }
        const hostContext = await resolveAuthenticatedHostContext(conversationUuid);
        return dispatch({ ...generation, hostContext });
    });
}

export function cancelProtectedRequest(requestId) {
    if (!gatewayState.pendingRequest || gatewayState.pendingRequest.requestId !== requestId) {
        return false;
    }
    gatewayState.pendingRequest = null;
    gatewayState.dispatch = null;
    gatewayState.lastStatus = 'CANCELLED';
    return true;
}

export function getStatus() {
    return {
        status: gatewayState.lastStatus,
        hasPendingRequest: Boolean(gatewayState.pendingRequest),
        dispatchInFlight: gatewayState.dispatchInFlight,
        protectedFailureLockout: gatewayState.protectedFailureLockout,
    };
}

// SillyTavern resolves this global name from the extension manifest.
// This is the only global intentionally registered by the prototype.
globalThis.logicEngineExtensionGatewayGenerationInterceptor = async function (chat, contextSize, abort, type) {
    const pendingRequest = gatewayState.pendingRequest;
    if (!pendingRequest) {
        // A failed protected dispatch must not turn the next user retry into
        // an ordinary native-provider send. Keep this extension instance
        // locked until reload; do not add a reset API to this review prototype.
        if (gatewayState.protectedFailureLockout) {
            abort(true);
            gatewayState.lastStatus = 'BLOCKED_AFTER_PROTECTED_FAILURE';
            return;
        }
        // A second generation must not bypass the protected dispatch while it
        // is in flight. This is a local concurrency guard, not authorization
        // and not protection against other extensions or server-side callers.
        if (gatewayState.dispatchInFlight) {
            abort(true);
            gatewayState.lastStatus = 'BLOCKED_DISPATCH_IN_FLIGHT';
        }
        return;
    }

    // Consume the arm and close the generation gate before awaiting anything.
    // This prevents concurrent generation from taking the native provider path
    // while the protected callback is still running.
    const dispatch = gatewayState.dispatch;
    gatewayState.pendingRequest = null;
    gatewayState.dispatch = null;
    gatewayState.dispatchInFlight = true;

    try {
        const result = await interceptProtectedGeneration({
            pendingRequest,
            chat,
            contextSize,
            type,
            abort,
            dispatch,
        });
        gatewayState.lastStatus = result.status;
        if (result.status !== 'DISPATCH_DELEGATED') {
            gatewayState.protectedFailureLockout = true;
        }
    } finally {
        gatewayState.dispatchInFlight = false;
    }
};

// No automatic activation, network side effects, or authorization claims.
