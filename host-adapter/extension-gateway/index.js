import { interceptProtectedGeneration } from './gateway-policy.mjs';

/**
 * Review-only SillyTavern extension gateway.
 *
 * This module intentionally exposes no global arm/cancel API. Its exported
 * helpers are an integration seam, not an authorization boundary: any code
 * running in the same SillyTavern page/module environment must be treated as
 * potentially able to call them. Do not wire protected dispatch until a
 * separately approved Host contract supplies authorization and freshness checks.
 */
const gatewayState = {
    pendingRequest: null,
    dispatch: null,
    lastStatus: 'IDLE',
};

export function armProtectedRequest(requestId, dispatch) {
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
    };
}

// SillyTavern resolves this global name from the extension manifest.
// This is the only global intentionally registered by the prototype.
globalThis.logicEngineExtensionGatewayGenerationInterceptor = async function (chat, contextSize, abort, type) {
    const pendingRequest = gatewayState.pendingRequest;
    if (!pendingRequest) {
        return;
    }

    // Consume the arm before dispatch so a second generation cannot replay it.
    const dispatch = gatewayState.dispatch;
    gatewayState.pendingRequest = null;
    gatewayState.dispatch = null;

    const result = await interceptProtectedGeneration({
        pendingRequest,
        chat,
        contextSize,
        type,
        abort,
        dispatch,
    });
    gatewayState.lastStatus = result.status;
};

// No automatic activation, network side effects, or authorization claims.
