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
  COMETAPI: 'cometapi',
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

const ROUTE_BY_HOST_ROUTE = Object.freeze({
  'text-completions': 'text-completions',
  kobold: 'kobold',
  'novelai-text': 'novelai-text',
  'horde-text': 'horde-text',
});

const UNREGISTERED_SENDER_ROUTE = 'unregistered';

function assertAuthenticatedHostRequest(request) {
  const handle = request?.user?.profile?.handle;
  const session = request?.session;
  if (!session || typeof handle !== 'string' || !handle.trim()
    || (session.handle !== undefined && session.handle !== handle)) {
    throw new Error('LOGIC_ENGINE_HOST_SESSION_NOT_AUTHENTICATED');
  }
  const body = request.body;
  if (body && typeof body === 'object' && (
    Object.hasOwn(body, 'logic_engine_memory')
    || Object.hasOwn(body, 'logic_engine_protected_context')
    || Object.hasOwn(body, 'memory_dispatch')
  )) {
    throw new Error('LOGIC_ENGINE_UNTRUSTED_MEMORY_MARKER');
  }
}

function resolveHostRoute(request) {
  const rawPath = typeof request?.originalUrl === 'string'
    ? request.originalUrl
    : typeof request?.baseUrl === 'string' && typeof request?.path === 'string'
      ? request.baseUrl + request.path : '';
  const path = rawPath.split('?')[0];
  switch (path) {
    case '/api/backends/chat-completions/generate': return 'chat-completions';
    case '/api/backends/text-completions/generate': return 'text-completions';
    case '/api/backends/kobold/generate': return 'kobold';
    case '/api/novelai/generate': return 'novelai-text';
    case '/api/horde/generate-text': return 'horde-text';
    default: return null;
  }
}

function terminalError(error) {
  const value = error instanceof Error ? error : new Error(String(error));
  try {
    Object.defineProperty(value, 'logicEngineFinalSendTerminal', { value: true });
    return value;
  } catch {
    const wrapped = new Error(value.message, { cause: value });
    Object.defineProperty(wrapped, 'logicEngineFinalSendTerminal', { value: true });
    return wrapped;
  }
}

function assertSourceMap(sources) {
  if (!sources || typeof sources !== 'object' || Array.isArray(sources)) {
    throw new TypeError('SillyTavern CHAT_COMPLETION_SOURCES is required.');
  }
  const map = new Map();
  for (const [key, senderRoute] of Object.entries(ROUTE_BY_SOURCE_KEY)) {
    const sourceValue = sources[key];
    if (typeof sourceValue !== 'string' || !sourceValue.trim()) {
      throw new Error('SILLYTAVERN_SOURCE_REGISTRY_SOURCE_KEY_MISSING: ' + key);
    }
    if (!PROTECTED_MEMORY_SENDER_ROUTES.includes(senderRoute)) {
      throw new Error('SILLYTAVERN_SOURCE_REGISTRY_ROUTE_UNSUPPORTED: ' + key + ':' + senderRoute);
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
  prepareHostContext = async () => null,
  runWithAuthenticatedHostSession = null,
}) {
  if (typeof nativeForwardFetchResponse !== 'function'
    || typeof prepareHostContext !== 'function'
    || (runWithAuthenticatedHostSession !== null && typeof runWithAuthenticatedHostSession !== 'function')) {
    throw new TypeError('Native SillyTavern response writer and trusted Host preparation callback are required.');
  }
  const sourceMap = assertSourceMap(chatCompletionSources);
  const requestIdByResponse = new WeakMap();
  // A protected generation may hand off to the model only once per Host
  // response. This closes retry loops that could otherwise mint a new request
  // ID after a completed first dispatch and send the same prompt again.
  const protectedDispatchByResponse = new WeakSet();
  const preparedContextByRequest = new WeakMap();
  const finalSend = createProtectedMemoryFinalSend({
    gateway,
    resolveProtectedMemory,
    fetchImpl: globalThis.fetch,
  });

  return Object.freeze({
    async prepare(request, response) {
      if (!request || typeof request !== 'object' || !response || typeof response !== 'object') {
        throw new TypeError('Invalid authenticated SillyTavern request context.');
      }
      assertAuthenticatedHostRequest(request);
      const hostRoute = prepareHostContext ? resolveHostRoute(request) : null;
      const hostContext = prepareHostContext
        ? await prepareHostContext(request, response, hostRoute) : null;
      if (hostContext?.status === 'NON_READY') {
        throw terminalError(new Error(hostContext.code || 'MEMORY_DISPATCH_NOT_READY'));
      }
      preparedContextByRequest.set(request, Object.freeze({ request, response, hostContext: hostContext ?? null, hostRoute }));
    },

    resolveSenderRoute(request, hostRoute = 'chat-completions') {
      if (hostRoute !== 'chat-completions') {
        return ROUTE_BY_HOST_ROUTE[hostRoute] ?? UNREGISTERED_SENDER_ROUTE;
      }
      const source = request?.body?.chat_completion_source;
      // Unregistered ST senders remain native for explicitly unprotected
      // generations. Protected classification happens before route admission
      // in createProtectedMemoryFinalSend, which rejects this sentinel.
      return sourceMap.get(source) ?? UNREGISTERED_SENDER_ROUTE;
    },

    dispatch(args) {
      if (!args || typeof args.senderRoute !== 'string' || !args.senderRoute
        || typeof args.transport !== 'function') {
        const error = new Error('MEMORY_DISPATCH_NOT_READY');
        if (args?.response && typeof args.response === 'object') {
          requestIdByResponse.set(args.response, { requestId: null, state: 'denied' });
          throw terminalError(error);
        }
        throw error;
      }

      const prepared = args.request && typeof args.request === 'object'
        ? preparedContextByRequest.get(args.request) : null;
      if (prepared && prepared.response !== args.response) {
        if (args.response && typeof args.response === 'object') {
          requestIdByResponse.set(args.response, { requestId: null, state: 'denied' });
        }
        throw terminalError(new Error('LOGIC_ENGINE_FINAL_SEND_RESPONSE_CONTEXT_MISMATCH'));
      }
      const execute = () => {
      let protectedMemory;
      try {
        protectedMemory = resolveProtectedMemory(
          args.request,
          preparedContextByRequest.get(args.request),
        );
      } catch (error) {
        if (args.response && typeof args.response === 'object') {
          requestIdByResponse.set(args.response, { requestId: null, state: 'denied' });
          throw terminalError(error);
        }
        throw error;
      }
      if (protectedMemory && typeof protectedMemory.then === 'function') {
        if (args.response && typeof args.response === 'object') {
          requestIdByResponse.set(args.response, { requestId: null, state: 'denied' });
          throw terminalError(new Error('MEMORY_DISPATCH_NOT_READY'));
        }
        throw new Error('MEMORY_DISPATCH_NOT_READY');
      }
      if (protectedMemory === undefined) {
        if (args.response && typeof args.response === 'object') {
          requestIdByResponse.set(args.response, { requestId: null, state: 'denied' });
          throw terminalError(new Error('MEMORY_DISPATCH_NOT_READY'));
        }
        throw new Error('MEMORY_DISPATCH_NOT_READY');
      }
      if (protectedMemory !== null) {
        if (!args.response || typeof args.response !== 'object'
          || typeof protectedMemory.requestId !== 'string' || !protectedMemory.requestId) {
          if (args.response && typeof args.response === 'object') {
            requestIdByResponse.set(args.response, { requestId: null, state: 'denied' });
          }
          throw terminalError(new Error('MEMORY_DISPATCH_NOT_READY'));
        }
        requestIdByResponse.set(args.response, { requestId: protectedMemory.requestId, state: 'pending' });
      }

      const release = args.response ? requestIdByResponse.get(args.response) : null;
      const deny = (error) => {
        if (!release) throw error;
        release.state = 'denied';
        throw terminalError(error);
      };
      if (protectedMemory !== null && args.response) {
        if (protectedDispatchByResponse.has(args.response)) {
          return deny(new Error('MEMORY_DISPATCH_DUPLICATE_HOST_SEND'));
        }
        // Mark before entering Gateway: even a thrown/ambiguous result is
        // terminal for this Host generation response and cannot be retried.
        protectedDispatchByResponse.add(args.response);
      }

      const hostRoute = args.hostRoute ?? 'chat-completions';
      const expectedRoute = hostRoute === 'chat-completions'
        ? sourceMap.get(args.request?.body?.chat_completion_source)
        : ROUTE_BY_HOST_ROUTE[hostRoute];
      if (expectedRoute
        ? expectedRoute !== args.senderRoute
        : args.senderRoute !== UNREGISTERED_SENDER_ROUTE) {
        return deny(new Error('MEMORY_DISPATCH_NOT_READY'));
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
        return deny(error);
      }
      if (result && typeof result.then === 'function') {
        return result.catch(deny);
      }
      return result;
      };
      const coreConversationId = prepared?.hostContext?.coreConversationId;
      if (runWithAuthenticatedHostSession && coreConversationId) {
        return runWithAuthenticatedHostSession(args.request, coreConversationId, execute);
      }
      return execute();
    },

    authorizeResponseWrite(response, write, final = false) {
      const release = requestIdByResponse.get(response);
      if (!release) return write();
      // SillyTavern's native stream forwarder may call response.end() once
      // when the upstream body ends and again when the client socket closes.
      // After one authorized final end, later final-end calls are idempotent
      // no-ops; they must never invoke the native writer a second time.
      if (release.state === 'completed' && final === true) return undefined;
      if (release.state !== 'pending') {
        throw terminalError(new Error('MEMORY_DISPATCH_FINAL_RESPONSE_REVALIDATION_DENIED'));
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
        throw terminalError(error);
      }
    },

    forwardResponse(upstream, response) {
      return nativeForwardFetchResponse(upstream, response);
    },
  });
}
