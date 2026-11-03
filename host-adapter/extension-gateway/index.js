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

const PROTECTED_GENERATION_PATHS = new Set([
    '/api/backends/chat-completions/generate',
    '/api/backends/text-completions/generate',
    '/api/backends/kobold/generate',
    '/api/novelai/generate',
    '/api/horde/generate-text',
]);

function installGenerationFetchEnvelope(hostContext, resolveHostContext) {
    const originalFetch = globalThis.fetch;
    if (typeof originalFetch !== 'function') throw new Error('HOST_GENERATION_FETCH_UNAVAILABLE');
    const origin = globalThis.location?.origin || 'http://localhost';
    const wrappedFetch = async function (input, init = {}) {
        let url;
        try {
            url = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
            const parsed = new URL(url, origin);
            if (parsed.origin !== origin || !PROTECTED_GENERATION_PATHS.has(parsed.pathname)
                || String(init?.method || input?.method || 'GET').toUpperCase() !== 'POST'
                || typeof init?.body !== 'string') {
                return originalFetch.call(this, input, init);
            }
            const payload = JSON.parse(init.body);
            assertGenerationEnvelope(payload);
            const alreadyBound = UUID.test(payload.logic_engine_conversation_uuid ?? '')
                && UUID.test(payload.logic_engine_request_id ?? '')
                && UUID.test(payload.logic_engine_generation_id ?? '');
            if (alreadyBound) return originalFetch.call(this, input, init);
            const enriched = await attachHostConversationLocator(payload, hostContext, resolveHostContext);
            return originalFetch.call(this, input, { ...init, body: JSON.stringify(enriched) });
        } catch {
            // Preserve the original request only when envelope preparation itself
            // is unavailable. The server-side Host Adapter then rejects it as
            // NON_READY while protected Memory is enabled; it never falls back.
            return originalFetch.call(this, input, init);
        }
    };
    globalThis.fetch = wrappedFetch;
    return () => {
        if (globalThis.fetch === wrappedFetch) globalThis.fetch = originalFetch;
    };
}

export async function registerHostGenerationIdentity(context = null, { resolveHostContext = resolveGatewayHostContext } = {}) {
    const hostContext = context ?? (await import('../../../st-context.js')).getContext();
    if (!hostContext?.eventSource || !hostContext?.eventTypes) {
        throw new Error('HOST_GENERATION_EVENTS_UNAVAILABLE');
    }
    const attach = data => attachHostConversationLocator(data, hostContext, resolveHostContext);
    // ST awaits each listener before serializing the generation request.
    // CHAT_COMPLETION_SETTINGS_READY is the last mutable point for Chat
    // Completions; GENERATE_AFTER_DATA covers Text Completions, Kobold,
    // NovelAI and Horde before their request payloads are serialized.
    hostContext.eventSource.on(hostContext.eventTypes.CHAT_COMPLETION_SETTINGS_READY, attach);
    hostContext.eventSource.on(hostContext.eventTypes.GENERATE_AFTER_DATA, attach);
    const unregisterFetch = installGenerationFetchEnvelope(hostContext, resolveHostContext);
    return () => {
        hostContext.eventSource.removeListener(hostContext.eventTypes.CHAT_COMPLETION_SETTINGS_READY, attach);
        hostContext.eventSource.removeListener(hostContext.eventTypes.GENERATE_AFTER_DATA, attach);
        unregisterFetch();
    };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const unregister = await registerHostGenerationIdentity();
    globalThis.addEventListener?.('pagehide', unregister, { once: true });
}
