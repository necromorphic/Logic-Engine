import { resolveGatewayHostContext } from './host-context.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertGenerationEnvelope(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('HOST_GENERATION_ENVELOPE_INVALID');
    }
    return data;
}

async function attachHostConversationLocator(data, getHostContext) {
    assertGenerationEnvelope(data);
    try {
        const host = await resolveGatewayHostContext({ getHostContext });
        const requestId = globalThis.crypto?.randomUUID?.();
        if (!UUID.test(host.conversationUuid ?? '') || !UUID.test(requestId ?? '')) return data;
        // These are untrusted locators/correlation metadata only. The server-side
        // Host Adapter re-derives identity and checks the UUID against its complete
        // authoritative inventory before it can retrieve any NPC context.
        data.logic_engine_conversation_uuid = host.conversationUuid;
        data.logic_engine_request_id = requestId;
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

export async function registerHostGenerationIdentity(context = null) {
    const hostContext = context ?? (await import('../../../st-context.js')).getContext();
    if (!hostContext?.eventSource || !hostContext?.eventTypes) {
        throw new Error('HOST_GENERATION_EVENTS_UNAVAILABLE');
    }
    const attach = data => attachHostConversationLocator(data, hostContext);
    // ST awaits each listener before serializing the generation request.
    // CHAT_COMPLETION_SETTINGS_READY is the last mutable point for Chat
    // Completions; GENERATE_AFTER_DATA covers Text Completions, Kobold,
    // NovelAI and Horde before their request payloads are serialized.
    hostContext.eventSource.on(hostContext.eventTypes.CHAT_COMPLETION_SETTINGS_READY, attach);
    hostContext.eventSource.on(hostContext.eventTypes.GENERATE_AFTER_DATA, attach);
    return () => {
        hostContext.eventSource.removeListener(hostContext.eventTypes.CHAT_COMPLETION_SETTINGS_READY, attach);
        hostContext.eventSource.removeListener(hostContext.eventTypes.GENERATE_AFTER_DATA, attach);
    };
}

const unregister = await registerHostGenerationIdentity();
globalThis.addEventListener?.('pagehide', unregister, { once: true });
