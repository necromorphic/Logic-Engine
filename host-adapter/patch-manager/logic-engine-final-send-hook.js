import { AsyncLocalStorage } from 'node:async_hooks';
import nativeFetch from 'node-fetch';

const generationContext = new AsyncLocalStorage();
let adapter = null;
let adapterOwner = null;

function assertAdapter(candidate) {
    if (!candidate || typeof candidate !== 'object'
        || typeof candidate.prepare !== 'function'
        || typeof candidate.dispatch !== 'function'
        || typeof candidate.forwardResponse !== 'function'
        || typeof candidate.resolveSenderRoute !== 'function') {
        throw new TypeError('Invalid Logic-Engine Final-Send adapter.');
    }
}

export function registerLogicEngineFinalSendAdapter(candidate, owner) {
    assertAdapter(candidate);
    if (typeof owner !== 'string' || !owner.startsWith('logic-engine-extension:')) {
        throw new Error('LOGIC_ENGINE_FINAL_SEND_REGISTRATION_DENIED');
    }
    if (adapter && (adapter !== candidate || adapterOwner !== owner)) {
        throw new Error('LOGIC_ENGINE_FINAL_SEND_ALREADY_REGISTERED');
    }
    adapter = candidate;
    adapterOwner = owner;
    return Object.freeze({ registered: true, owner: adapterOwner });
}

export function unregisterLogicEngineFinalSendAdapter(candidate, owner) {
    if (!adapter || candidate !== adapter || owner !== adapterOwner) {
        throw new Error('LOGIC_ENGINE_FINAL_SEND_REGISTRATION_DENIED');
    }
    adapter = null;
    adapterOwner = null;
}

export function runWithLogicEngineFinalSend(request, response, handler) {
    if (!request || typeof request !== 'object' || !response || typeof response !== 'object'
        || typeof handler !== 'function') {
        throw new TypeError('Invalid SillyTavern generation context.');
    }
    if (!adapter) throw new Error('LOGIC_ENGINE_FINAL_SEND_ADAPTER_UNAVAILABLE');

    const active = {
        request,
        response,
        adapter,
        protectedForward: null,
        dispatchInvoked: false,
    };

    return generationContext.run(active, async () => {
        // Host preparation is asynchronous and happens inside the native
        // authenticated route, before any provider-specific sender is entered.
        await active.adapter.prepare(request, response);
        return handler();
    });
}

export function logicEngineFetch(endpointUrl, requestInit) {
    const active = generationContext.getStore();
    if (!active) return nativeFetch(endpointUrl, requestInit);

    if (active.dispatchInvoked) {
        throw new Error('LOGIC_ENGINE_FINAL_SEND_DUPLICATE_TRANSPORT');
    }
    active.dispatchInvoked = true;

    const senderRoute = active.adapter.resolveSenderRoute(active.request);
    if (typeof senderRoute !== 'string' || !senderRoute) {
        throw new Error('LOGIC_ENGINE_FINAL_SEND_SENDER_UNKNOWN');
    }

    const stream = active.request.body?.stream === true;
    let forwardCalled = false;
    const forwardResponse = stream ? (upstream) => {
        if (forwardCalled) throw new Error('LOGIC_ENGINE_FINAL_SEND_DUPLICATE_RESPONSE_WRITE');
        forwardCalled = true;
        const pending = active.adapter.forwardResponse(upstream, active.response);
        active.protectedForward = Promise.resolve(pending);
        return active.protectedForward;
    } : undefined;

    return active.adapter.dispatch({
        request: active.request,
        response: active.response,
        senderRoute,
        endpointUrl,
        requestInit,
        stream,
        transport: () => nativeFetch(endpointUrl, requestInit),
        forwardResponse,
    });
}

export function logicEngineForwardFetchResponse(upstream, response, nativeForward) {
    const active = generationContext.getStore();
    if (active?.protectedForward) return active.protectedForward;
    if (active && response !== active.response) {
        throw new Error('LOGIC_ENGINE_FINAL_SEND_RESPONSE_CONTEXT_MISMATCH');
    }
    return nativeForward(upstream, response);
}

export function getLogicEngineFinalSendStatus() {
    return Object.freeze({ registered: Boolean(adapter), owner: adapterOwner });
}
