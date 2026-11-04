import { AsyncLocalStorage } from 'node:async_hooks';
const nativeFetch = (...args) => globalThis.fetch(...args);

const generationContext = new AsyncLocalStorage();
let adapter = null;
let adapterOwner = null;

function composeAbortSignals(signals, registerCleanup) {
    const controller = new AbortController();
    const subscriptions = [];
    const cleanup = () => {
        for (const [signal, listener] of subscriptions.splice(0)) {
            signal.removeEventListener('abort', listener);
        }
    };
    for (const signal of signals) {
        if (!signal) continue;
        if (signal.aborted) {
            controller.abort(signal.reason);
            cleanup();
            break;
        }
        const listener = () => {
            if (!controller.signal.aborted) controller.abort(signal.reason);
            cleanup();
        };
        signal.addEventListener('abort', listener, { once: true });
        subscriptions.push([signal, listener]);
    }
    registerCleanup(cleanup);
    return controller.signal;
}

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

    const abortController = new AbortController();
    const abortGeneration = () => {
        if (!response.writableEnded && !abortController.signal.aborted) {
            abortController.abort(new Error('LOGIC_ENGINE_HOST_GENERATION_CANCELLED'));
        }
    };
    const cleanupCallbacks = [];
    const cleanup = () => {
        request.off?.('aborted', abortGeneration);
        response.off?.('close', abortGeneration);
        response.off?.('finish', cleanup);
        for (const callback of cleanupCallbacks.splice(0)) {
            try { callback(); } catch {}
        }
    };
    request.once?.('aborted', abortGeneration);
    response.once?.('close', abortGeneration);
    response.once?.('close', cleanup);
    response.once?.('finish', cleanup);
    if (request.aborted === true || (response.destroyed === true && response.writableEnded !== true)) {
        abortGeneration();
    }

    const active = {
        request, response, adapter, abortController, cleanupCallbacks,
        protectedForward: null, dispatchInvoked: false,
    };
    // Bind the Host response to the Gateway's request-scoped release
    // capability. Every byte and the terminal end are re-authorized; a
    // revoked request cannot fall back to Express' native writer.
    if (typeof active.adapter.authorizeResponseWrite === 'function') {
        if (typeof response.write !== 'function' || typeof response.end !== 'function') {
            cleanup();
            throw new TypeError('Invalid Host response writer.');
        }
        const nativeWrite = response.write.bind(response);
        const nativeEnd = response.end.bind(response);
        response.write = function (...args) {
            return active.adapter.authorizeResponseWrite(response, () => nativeWrite(...args), false);
        };
        response.end = function (...args) {
            return active.adapter.authorizeResponseWrite(response, () => nativeEnd(...args), true);
        };
    }

    return generationContext.run(active, async () => {
        try {
            if (abortController.signal.aborted) return undefined;
            try {
                await active.adapter.prepare(request, response);
            } catch {
                if (abortController.signal.aborted || response.destroyed === true) return undefined;
                if (!response.headersSent) {
                    response.status(503).send({ error: { message: 'Protected generation unavailable' } });
                } else if (!response.writableEnded) {
                    response.end();
                }
                return undefined;
            }
            // Disconnect while asynchronous Host preparation was pending:
            // do not enter the native sender or create a dispatch attempt.
            if (abortController.signal.aborted || response.destroyed === true) return undefined;
            try {
                return await handler();
            } catch (error) {
                // A terminal Gateway denial must not reach Express' generic
                // error middleware, which could otherwise attempt a fallback
                // response after the protected release capability was revoked.
                if (abortController.signal.aborted || response.destroyed === true) return undefined;
                if (error?.logicEngineFinalSendTerminal === true) {
                    if (typeof response.destroy === 'function' && !response.destroyed) response.destroy();
                    return undefined;
                }
                throw error;
            }
        } finally {
            cleanup();
        }
    });
}

function resolveHostGenerationRoute(request) {
    const rawPath = typeof request?.originalUrl === 'string'
        ? request.originalUrl
        : typeof request?.baseUrl === 'string' && typeof request?.path === 'string'
            ? request.baseUrl + request.path : '';
    switch (rawPath.split('?')[0]) {
        case '/api/backends/text-completions/generate': return 'text-completions';
        case '/api/backends/kobold/generate': return 'kobold';
        case '/api/novelai/generate': return 'novelai-text';
        case '/api/horde/generate-text': return 'horde-text';
        case '/api/backends/chat-completions/generate': return 'chat-completions';
        default: return null;
    }
}

export function logicEngineFetch(endpointUrl, requestInit) {
    const active = generationContext.getStore();
    if (!active) return nativeFetch(endpointUrl, requestInit);

    if (active.abortController.signal.aborted) {
        throw new Error('LOGIC_ENGINE_HOST_GENERATION_CANCELLED');
    }
    if (active.dispatchInvoked) {
        throw new Error('LOGIC_ENGINE_FINAL_SEND_DUPLICATE_TRANSPORT');
    }
    active.dispatchInvoked = true;

    const hostRoute = resolveHostGenerationRoute(active.request);
    if (hostRoute === null) {
        throw new Error('LOGIC_ENGINE_FINAL_SEND_HOST_ROUTE_UNKNOWN');
    }
    const senderRoute = active.adapter.resolveSenderRoute(active.request, hostRoute);
    if (typeof senderRoute !== 'string' || !senderRoute) {
        throw new Error('LOGIC_ENGINE_FINAL_SEND_SENDER_UNKNOWN');
    }

    const body = active.request.body ?? {};
    const stream = hostRoute === 'kobold' || hostRoute === 'novelai-text'
        ? Boolean(body.streaming)
        : hostRoute === 'horde-text' ? false : Boolean(body.stream);
    const hostTransformsStream = hostRoute === 'text-completions'
        && body.api_type === 'ollama' && stream;
    const signal = requestInit?.signal
        ? composeAbortSignals([requestInit.signal, active.abortController.signal],
            (cleanup) => active.cleanupCallbacks.push(cleanup))
        : active.abortController.signal;
    const outboundInit = { ...requestInit, signal };
    const forwardResponse = stream ? (upstream) => {
        if (active.protectedForward) return active.protectedForward;
        const pending = active.adapter.forwardResponse(upstream, active.response);
        active.protectedForward = Promise.resolve(pending);
        return active.protectedForward;
    } : undefined;

    return active.adapter.dispatch({
        request: active.request,
        response: active.response,
        senderRoute,
        hostRoute,
        endpointUrl,
        requestInit: outboundInit,
        stream,
        transport: () => {
            if (signal.aborted) throw new Error('LOGIC_ENGINE_HOST_GENERATION_CANCELLED');
            return nativeFetch(endpointUrl, outboundInit);
        },
        forwardResponse,
        hostTransformsStream,
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
