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
  const finalSend = createProtectedMemoryFinalSend({
    gateway,
    resolveProtectedMemory,
    fetchImpl: globalThis.fetch,
  });

  return Object.freeze({
    resolveSenderRoute(request) {
      const source = request?.body?.chat_completion_source;
      const route = sourceMap.get(source);
      if (!route) throw new Error('MEMORY_DISPATCH_NOT_READY');
      return route;
    },

    dispatch(args) {
      if (!args || sourceMap.get(args.request?.body?.chat_completion_source) !== args.senderRoute
        || !PROTECTED_MEMORY_SENDER_ROUTES.includes(args.senderRoute)
        || typeof args.transport !== 'function') {
        throw new Error('MEMORY_DISPATCH_NOT_READY');
      }
      return finalSend({
        senderRoute: args.senderRoute,
        endpointUrl: args.endpointUrl,
        requestInit: args.requestInit,
        hostRequestContext: args.request,
        stream: args.stream,
        forwardResponse: args.forwardResponse,
        transport: args.transport,
      });
    },

    forwardResponse(upstream, response) {
      return nativeForwardFetchResponse(upstream, response);
    },
  });
}
