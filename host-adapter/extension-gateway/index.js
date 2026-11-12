import { resolveGatewayHostContext } from './host-context.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertGenerationEnvelope(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('HOST_GENERATION_ENVELOPE_INVALID');
    }
    return data;
}

export async function attachHostConversationLocator(data, getHostContext, resolveHostContext = resolveGatewayHostContext) {
    assertGenerationEnvelope(data);
    try {
        const host = await resolveHostContext({ getHostContext });
        const requestId = globalThis.crypto?.randomUUID?.();
        const generationId = globalThis.crypto?.randomUUID?.();
        if (!UUID.test(host.conversationUuid ?? '') || !UUID.test(requestId ?? '')
            || !UUID.test(generationId ?? '')) return data;
        // These are untrusted locators/correlation metadata only. The server-side
        // Host Adapter re-derives identity and checks the UUID against its complete
        // authoritative inventory before it can retrieve any NPC context.
        data.logic_engine_conversation_uuid = host.conversationUuid;
        data.logic_engine_request_id = requestId;
        data.logic_engine_generation_id = generationId;
        data.logic_engine_context_size = Number.isSafeInteger(host.maxContext)
            ? Math.max(1, Math.min(200000, host.maxContext)) : 200000;
        data.logic_engine_generation_type = typeof data.type === 'string' ? data.type : 'normal';
    } catch {
        // Ordinary generation remains available while protected Memory is
        // disabled. If deployment enables it, the server-side Host Adapter
        // rejects this request as NON_READY because the locator is absent.
    }
    return data;
}

const REGISTRATION_KEY = Symbol.for('logic-engine.host-generation-identity.registration.v1');

export async function registerHostLifecycleAutoCapture(context = null) {
    const hostContext = context ?? (await import(new URL('/scripts/st-context.js', import.meta.url).href)).getContext();
    if (!hostContext?.eventSource || !hostContext?.eventTypes?.CHAT_CHANGED
        || typeof hostContext.getCurrentChatId !== 'function') {
        console.warn('[Logic Engine] Automatic Host inventory capture is unavailable: CHAT_CHANGED context missing.');
        return () => {};
    }

    const activeByLocator = new Map();
    const completedLocators = new Set();
    const notified = new Set();

    const notify = (message) => {
        const toast = globalThis.toastr;
        if (typeof toast?.warning === 'function') {
            toast.warning(message, 'Logic Engine Host');
        } else {
            console.warn('[Logic Engine Host]', message);
        }
    };

    const captureConversation = async locator => {
        const sourceLocator = typeof locator === 'string' && locator.trim()
            ? locator
            : hostContext.getCurrentChatId();
        if (typeof sourceLocator !== 'string' || !sourceLocator.trim()) {
            return { status: 'NO_ACTIVE_CONVERSATION' };
        }
        if (hostContext.getCurrentChatId() !== sourceLocator) {
            return { status: 'STALE_CONVERSATION' };
        }
        if (completedLocators.has(sourceLocator)) {
            return { status: 'ALREADY_CHECKED' };
        }
        const active = activeByLocator.get(sourceLocator);
        if (active) return active;

        const operation = (async () => {
            const lifecycle = globalThis.logicEngineHostLifecycle;
            if (!lifecycle
                || typeof lifecycle.syncCurrentDigestInventory !== 'function'
                || typeof lifecycle.enrollCurrentConversation !== 'function'
                || typeof lifecycle.getCoreCaptureStatus !== 'function') {
                throw new Error('HOST_LIFECYCLE_BRIDGE_UNAVAILABLE');
            }

            // Existing conversations restore their persisted baseline and verify
            // Inventory here. New conversations return NOT_ENROLLED; enrollment
            // then creates the baseline and performs the same persisted check.
            let capture = await lifecycle.syncCurrentDigestInventory();
            if (hostContext.getCurrentChatId() !== sourceLocator) {
                return { status: 'STALE_CONVERSATION' };
            }
            if (capture?.status === 'NOT_ENROLLED') {
                capture = await lifecycle.enrollCurrentConversation();
            }
            if (hostContext.getCurrentChatId() !== sourceLocator) {
                return { status: 'STALE_CONVERSATION' };
            }

            const state = await lifecycle.getCoreCaptureStatus();
            if (hostContext.getCurrentChatId() !== sourceLocator) {
                return { status: 'STALE_CONVERSATION' };
            }

            const diagnostic = state?.diagnostic
                ?? capture?.diagnostic
                ?? (capture?.status === 'NON_READY' ? capture : null)
                ?? (capture?.persistedInventoryStatus === 'NON_READY'
                    ? { code: 'HOST_INVENTORY_NOT_READY', httpStatus: null }
                    : null);

            completedLocators.add(sourceLocator);
            if (diagnostic) {
                const code = typeof diagnostic.code === 'string'
                    ? diagnostic.code
                    : 'HOST_INVENTORY_NOT_READY';
                const httpStatus = Number.isInteger(diagnostic.httpStatus)
                    ? ' (HTTP ' + diagnostic.httpStatus + ')'
                    : '';
                const noticeKey = sourceLocator + ':' + code + ':' + (diagnostic.httpStatus ?? '');
                if (!notified.has(noticeKey)) {
                    notified.add(noticeKey);
                    notify('Persisted Host inventory is not ready: ' + code + httpStatus);
                }
                return { status: 'NON_READY', diagnostic };
            }

            return { status: 'CHECKED', capture, state };
        })();

        activeByLocator.set(sourceLocator, operation);
        try {
            return await operation;
        } catch (error) {
            completedLocators.add(sourceLocator);
            const noticeKey = sourceLocator + ':HOST_AUTO_CAPTURE_FAILED';
            if (!notified.has(noticeKey)) {
                notified.add(noticeKey);
                notify('Automatic Host enrollment/inventory verification failed. See the SillyTavern server log for details.');
            }
            console.warn('[Logic Engine] Automatic Host enrollment/inventory verification failed:', error?.message ?? error);
            return { status: 'NON_READY', reason: error?.message ?? 'HOST_AUTO_CAPTURE_FAILED' };
        } finally {
            if (activeByLocator.get(sourceLocator) === operation) {
                activeByLocator.delete(sourceLocator);
            }
        }
    };

    const onChatChanged = locator => captureConversation(locator);
    hostContext.eventSource.on(hostContext.eventTypes.CHAT_CHANGED, onChatChanged);

    // The initial chat may have loaded before this third-party extension module.
    const initialLocator = hostContext.getCurrentChatId();
    if (typeof initialLocator === 'string' && initialLocator.trim()) {
        void captureConversation(initialLocator);
    }

    return () => {
        hostContext.eventSource.removeListener(hostContext.eventTypes.CHAT_CHANGED, onChatChanged);
        activeByLocator.clear();
        completedLocators.clear();
        notified.clear();
    };
}

export async function registerHostGenerationIdentity(context = null, { resolveHostContext = resolveGatewayHostContext } = {}) {
    const hostContext = context ?? (await import(new URL('/scripts/st-context.js', import.meta.url).href)).getContext();
    if (!hostContext?.eventSource || !hostContext?.eventTypes) {
        throw new Error('HOST_GENERATION_EVENTS_UNAVAILABLE');
    }
    const attach = data => attachHostConversationLocator(data, hostContext, resolveHostContext);
    const removeAutoCapture = await registerHostLifecycleAutoCapture(hostContext);
    // ST awaits each listener before serializing the generation request.
    // CHAT_COMPLETION_SETTINGS_READY is the last mutable point for Chat
    // Completions; GENERATE_AFTER_DATA covers Text Completions, Kobold,
    // NovelAI and Horde before their request payloads are serialized.
    hostContext.eventSource.on(hostContext.eventTypes.CHAT_COMPLETION_SETTINGS_READY, attach);
    hostContext.eventSource.on(hostContext.eventTypes.GENERATE_AFTER_DATA, attach);
    return () => {
        removeAutoCapture();
        hostContext.eventSource.removeListener(hostContext.eventTypes.CHAT_COMPLETION_SETTINGS_READY, attach);
        hostContext.eventSource.removeListener(hostContext.eventTypes.GENERATE_AFTER_DATA, attach);
    };
}

export async function registerHostGenerationIdentityOnce(context = null, options = {}) {
    const existing = globalThis[REGISTRATION_KEY];
    if (existing) return await existing;

    const pending = (async () => {
        const removeListeners = await registerHostGenerationIdentity(context, options);
        const unregister = () => {
            removeListeners();
            if (globalThis[REGISTRATION_KEY] === unregister) {
                delete globalThis[REGISTRATION_KEY];
            }
        };
        globalThis[REGISTRATION_KEY] = unregister;
        globalThis.addEventListener?.('pagehide', unregister, { once: true });
        return unregister;
    })();
    globalThis[REGISTRATION_KEY] = pending;
    try {
        return await pending;
    } catch (error) {
        if (globalThis[REGISTRATION_KEY] === pending) delete globalThis[REGISTRATION_KEY];
        throw error;
    }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    await registerHostGenerationIdentityOnce();
}
