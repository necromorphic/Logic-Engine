import {
  PROTECTED_MEMORY_SENDER_ROUTES,
} from '../src/security/memory-dispatch-gateway.js';
import { createProtectedMemoryFinalSend } from './protected-memory-final-send.mjs';

const ROUTE_BY_SOURCE_KEY = Object.freeze({
  CLAUDE: 'claude',
  AI21: 'ai21',
  MAKERSUITE: 'google-ai-studio',
  VERTEXAI: 'vertex-ai',
  MISTRALAI: 'mistral',
  COHERE: 'cohere',
  DEEPSEEK: 'deepseek',
  AIMLAPI: 'aimlapi',
  XAI: 'xai',
  CHUTES: 'chutes',
  MINIMAX: 'minimax',
  ELECTRONHUB: 'electronhub',
  AZURE_OPENAI: 'azure-openai',
  OPENAI: 'openai',
  OPENROUTER: 'openrouter',
  CUSTOM: 'custom',
  PERPLEXITY: 'perplexity',
  GROQ: 'groq',
  FIREWORKS: 'fireworks',
  NANOGPT: 'nanogpt',
  POLLINATIONS: 'pollinations',
  MOONSHOT: 'moonshot',
  ZAI: 'zai',
  SILICONFLOW: 'siliconflow',
  WORKERS_AI: 'workers-ai',
});

const HOST_ROUTE_SENDER_MAP = Object.freeze({
  'text-completions': 'text-completions',
  kobold: 'kobold',
  'novelai-text': 'novelai-text',
  'horde-text': 'horde-text',
});

const UNREGISTERED_SENDER_ROUTE = 'unregistered';

function assertSourceMap(sources) {
  if (!sources || typeof sources !== 'object' || Array.isArray(sources)) {
    throw new TypeError('SillyTavern CHAT_COMPLETION_SOURCES is required.');
  }
  const map = new Map();
  for (const [key, senderRoute] of Object.entries(ROUTE_BY_SOURCE_KEY)) {
    const sourceValue = sources[key];
    if (typeof sourceValue !== 'string' || !sourceValue.trim()
      || !PROTECTED_MEMORY_SENDER_ROUTES.includes(senderRoute)) {
      throw new Error('SILLYTAVERN_SOURCE_REGISTRY_MISMATCH: ' + key);
    }
    if (map.has(sourceValue)) throw new Error('SILLYTAVERN_SOURCE_REGISTRY_DUPLICATE: ' + key);
    map.set(sourceValue, senderRoute);
  }
  return map;
}

/**
 * Creates the server-side adapter registered by the pinned ST Hook.
 * The caller must supply a trusted, synchronous Host binding resolver and
 * the actual Core MemoryDispatchGateway instance. No HTTP or browser transport
 * is created here.
 */
export function createSillyTavernFinalSendAdapter({
  gateway,
  resolveProtectedMemory,
  chatCompletionSources,
  nativeForwardFetchResponse,
}) {
  if (typeof nativeForwardFetchResponse !== 'function') {
    throw new TypeError('Native SillyTavern response writer is required.');
  }
  const sourceMap = assertSourceMap(chatCompletionSources);
  const requestIdByResponse = new WeakMap();
  const finalSend = createProtectedMemoryFinalSend({
    gateway,
    resolveProtectedMemory,
    fetchImpl: globalThis.fetch,
  });

  return Object.freeze({
    resolveSenderRoute(request, hostRoute) {
      const nativeRoute = HOST_ROUTE_SENDER_MAP[hostRoute];
      if (nativeRoute) return nativeRoute;
      const source = request?.body?.chat_completion_source;
      // Unregistered ST senders remain native for explicitly unprotected
      // generations. Protected classification happens before route admission
      // in createProtectedMemoryFinalSend, which rejects this sentinel.
      return sourceMap.get(source) ?? UNREGISTERED_SENDER_ROUTE;
    },

    dispatch(args) {
      if (!args || typeof args.senderRoute !== 'string' || !args.senderRoute
        || typeof args.transport !== 'function') {
        throw new Error('MEMORY_DISPATCH_NOT_READY');
      }
      const expectedRoute = sourceMap.get(args.request?.body?.chat_completion_source);
      const isNativeGenerationRoute = Object.values(HOST_ROUTE_SENDER_MAP).includes(args.senderRoute);
      if (expectedRoute
        ? expectedRoute !== args.senderRoute
        : !isNativeGenerationRoute && args.senderRoute !== UNREGISTERED_SENDER_ROUTE) {
        throw new Error('MEMORY_DISPATCH_NOT_READY');
      }
      const protectedMemory = resolveProtectedMemory(args.request);
      if (protectedMemory && typeof protectedMemory.then === 'function') {
        throw new Error('MEMORY_DISPATCH_NOT_READY');
      }
      if (protectedMemory === undefined) throw new Error('MEMORY_DISPATCH_NOT_READY');
      if (protectedMemory !== null) {
        if (!args.response || typeof args.response !== 'object'
          || typeof protectedMemory.requestId !== 'string' || !protectedMemory.requestId) {
          throw new Error('MEMORY_DISPATCH_NOT_READY');
        }
        requestIdByResponse.set(args.response, { requestId: protectedMemory.requestId, state: 'pending' });
      }
      let result;
      try {
        result = finalSend({
          senderRoute: args.senderRoute,
          endpointUrl: args.endpointUrl,
          requestInit: args.requestInit,
          hostRequestContext: args.request,
          stream: args.stream,
          forwardResponse: args.forwardResponse,
          transport: args.transport,
          protectedMemoryOverride: protectedMemory,
          hostTransformsStream: args.hostTransformsStream === true,
        });
      } catch (error) {
        if (args.response) {
          const release = requestIdByResponse.get(args.response);
          if (release) release.state = 'denied';
        }
        throw error;
      }
      if (result && typeof result.then === 'function') {
        return result.catch((error) => {
          if (args.response) {
            const release = requestIdByResponse.get(args.response);
            if (release) release.state = 'denied';
          }
          throw error;
        });
      }
      return result;
    },

    authorizeResponseWrite(response, write, final = false) {
      const release = requestIdByResponse.get(response);
      if (!release) return write();
      if (release.state !== 'pending') {
        throw new Error('MEMORY_DISPATCH_FINAL_RESPONSE_REVALIDATION_DENIED');
      }
      try {
        const result = gateway.authorizeResponseWrite(release.requestId, write, { final });
        if (final) release.state = 'completed';
        return result;
      } catch (error) {
        // Keep a terminal tombstone in the WeakMap. Deleting the entry would
        // make a later Express error/fallback write look like an unprotected
        // response and bypass the final-send gate.
        release.state = 'denied';
        throw error;
      }
    },

    forwardResponse(upstream, response) {
      return nativeForwardFetchResponse(upstream, response);
    },
  });
}
