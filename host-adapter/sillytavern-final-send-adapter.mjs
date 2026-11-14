import {
  PROTECTED_MEMORY_SENDER_ROUTES,
} from '../src/security/memory-dispatch-gateway.js';
import { createHostReplayIdentity, createProtectedMemoryFinalSend } from './protected-memory-final-send.mjs';

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
  // Keep the Host source registry and Core's protected sender registry in
  // lockstep. A newly protected chat sender must not silently fall through to
  // the unregistered/native path merely because this adapter was not updated.
  const hostRoutes = new Set(Object.values(ROUTE_BY_HOST_ROUTE));
  const mappedRoutes = new Set(map.values());
  for (const senderRoute of PROTECTED_MEMORY_SENDER_ROUTES) {
    if (!hostRoutes.has(senderRoute) && !mappedRoutes.has(senderRoute)) {
      throw new Error('SILLYTAVERN_SOURCE_REGISTRY_ROUTE_MISSING: ' + senderRoute);
    }
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
  requireProtectedMemory = false,
}) {
  if (typeof nativeForwardFetchResponse !== 'function'
    || typeof prepareHostContext !== 'function'
    || typeof requireProtectedMemory !== 'boolean'
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
  // Host preparation is a one-shot capability for the exact request object.
  // Re-preparing the same request with another response must not replace the
  // response/context binding held by the first preparation.
  const preparedRequests = new WeakSet();
  const finalSend = createProtectedMemoryFinalSend({
    gateway,
    resolveProtectedMemory,
    fetchImpl: globalThis.fetch,
  });

  return Object.freeze({
    async prepare(request, response, signal) {
      if (!request || typeof request !== 'object' || !response || typeof response !== 'object') {
        throw new TypeError('Invalid authenticated SillyTavern request context.');
      }
      // Host preparation is optional enrichment. Invalid/missing Host identity,
      // inventory, Core, Provider or NPC context must never stop native ST generation.
      if (preparedRequests.has(request)) {
        // Duplicate preparation is an integration defect, but it must not
        // become a user-visible generation denial.
        return;
      }
      preparedRequests.add(request);
      const hostRoute = resolveHostRoute(request);
      let replayIdentity = null;
      if (hostRoute) {
        try { replayIdentity = createHostReplayIdentity(request, hostRoute, hostRoute); }
        catch { replayIdentity = null; }
      }
      let hostContext = null;
      if (signal?.aborted !== true && hostRoute) {
        try {
          const candidate = await prepareHostContext(request, response, hostRoute, signal);
          if (signal?.aborted !== true && candidate && candidate.status !== 'NON_READY') hostContext = candidate;
        } catch {
          // Keep the missing capability absent; required mode denies it at dispatch.
        }
      }
      preparedContextByRequest.set(request, Object.freeze({ request, response, hostContext, hostRoute, replayIdentity }));
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

      // Reject a repeated protected send before resolving context or
      // replacing the response's completed release state with a new pending
      // capability. A duplicate attempt also permanently denies later writes.
      if (args.response && typeof args.response === 'object'
        && protectedDispatchByResponse.has(args.response)) {
        const previousRelease = requestIdByResponse.get(args.response);
        if (previousRelease) previousRelease.state = 'denied';
        throw terminalError(new Error('MEMORY_DISPATCH_DUPLICATE_HOST_SEND'));
      }

      const preparedCandidate = args.request && typeof args.request === 'object'
        ? preparedContextByRequest.get(args.request) : null;
      const dispatchHostRoute = args.hostRoute ?? 'chat-completions';
      let providerTransportInvoked = false;
      // In optional mode a missing Host capability permits native generation.
      // Required mode below treats the same condition as a terminal denial.
      const prepared = preparedCandidate
        && (preparedCandidate.hostRoute ?? 'chat-completions') === dispatchHostRoute
        && preparedCandidate.response === args.response
        ? preparedCandidate : null;
      const denyBeforeGateway = error => {
        if (args.response && typeof args.response === 'object') {
          requestIdByResponse.set(args.response, { requestId: null, state: 'denied' });
        }
        throw terminalError(error instanceof Error ? error : new Error('MEMORY_DISPATCH_NOT_READY'));
      };
      const execute = () => {
      let protectedMemory = null;
      let resolutionInvalid = false;
      try {
        const candidate = resolveProtectedMemory(
          args.request,
          preparedContextByRequest.get(args.request),
        );
        if (candidate === undefined || (candidate && typeof candidate.then === 'function')) {
          resolutionInvalid = true;
        } else {
          protectedMemory = candidate;
        }
      } catch {
        resolutionInvalid = true;
      }
      if (resolutionInvalid && requireProtectedMemory) {
        return denyBeforeGateway(new Error('MEMORY_DISPATCH_NOT_READY'));
      }
      if (protectedMemory !== null) {
        if (!args.response || typeof args.response !== 'object'
          || typeof protectedMemory.requestId !== 'string' || !protectedMemory.requestId) {
          if (requireProtectedMemory) {
            return denyBeforeGateway(new Error('MEMORY_DISPATCH_NOT_READY'));
          }
          protectedMemory = null;
        } else {
          requestIdByResponse.set(args.response, {
            requestId: protectedMemory.requestId,
            state: 'pending',
            hostRequest: args.request,
            coreConversationId: prepared?.hostContext?.coreConversationId ?? null,
          });
        }
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

      const hostRoute = dispatchHostRoute;
      if (protectedMemory !== null && (!prepared
        || !/^[a-f0-9]{64}$/.test(prepared.replayIdentity ?? ''))) {
        if (requireProtectedMemory) {
          return deny(new Error('MEMORY_DISPATCH_REPLAY_IDENTITY_UNAVAILABLE'));
        }
        protectedMemory = null;
        if (release) release.state = 'native';
      }
      const expectedRoute = hostRoute === 'chat-completions'
        ? sourceMap.get(args.request?.body?.chat_completion_source)
        : ROUTE_BY_HOST_ROUTE[hostRoute];
      if (expectedRoute
        ? expectedRoute !== args.senderRoute
        : args.senderRoute !== UNREGISTERED_SENDER_ROUTE) {
        if (protectedMemory !== null && requireProtectedMemory) {
          return deny(new Error('MEMORY_DISPATCH_ROUTE_MISMATCH'));
        }
        // An explicitly unprotected native request may use its native sender.
        if (release) release.state = 'native';
        providerTransportInvoked = true;
        return args.transport(args.endpointUrl, args.requestInit);
      }

      const nativeTransport = args.transport;
      const onceOnlyTransport = (...transportArgs) => {
        providerTransportInvoked = true;
        return nativeTransport(...transportArgs);
      };
      const continueNatively = () => {
        if (providerTransportInvoked) throw new Error('LOGIC_ENGINE_NATIVE_FALLBACK_AFTER_EGRESS_FORBIDDEN');
        if (release) release.state = 'native';
        providerTransportInvoked = true;
        return nativeTransport(args.endpointUrl, args.requestInit);
      };
      let result;
      try {
        result = finalSend({
          senderRoute: args.senderRoute,
          endpointUrl: args.endpointUrl,
          requestInit: args.requestInit,
          hostRequestContext: args.request,
          hostRoute,
          replayIdentity: prepared?.replayIdentity,
          stream: args.stream,
          forwardResponse: args.forwardResponse,
          transport: onceOnlyTransport,
          protectedMemoryOverride: protectedMemory,
          hostTransformsStream: args.hostTransformsStream === true,
        });
      } catch (error) {
        if (requireProtectedMemory && protectedMemory !== null) return deny(error);
        return continueNatively();
      }
      if (result && typeof result.then === 'function') {
        return result.catch(error => {
          if (!providerTransportInvoked) {
            if (requireProtectedMemory && protectedMemory !== null) return deny(error);
            return continueNatively();
          }
          return deny(error);
        });
      }
      return result;
      };
      const coreConversationId = prepared?.hostContext?.coreConversationId;
      if (requireProtectedMemory && (!runWithAuthenticatedHostSession
        || typeof coreConversationId !== 'string' || !coreConversationId)) {
        return denyBeforeGateway(new Error('MEMORY_DISPATCH_HOST_SESSION_UNAVAILABLE'));
      }
      if (runWithAuthenticatedHostSession && coreConversationId) {
        let result;
        try {
          result = runWithAuthenticatedHostSession(args.request, coreConversationId, execute);
        } catch (error) {
          if (providerTransportInvoked) throw error;
          if (requireProtectedMemory) return denyBeforeGateway(error);
          const pendingRelease = args.response ? requestIdByResponse.get(args.response) : null;
          if (pendingRelease?.state === 'pending') pendingRelease.state = 'native';
          providerTransportInvoked = true;
          return args.transport(args.endpointUrl, args.requestInit);
        }
        if (result && typeof result.then === 'function') {
          return result.catch(error => {
            if (providerTransportInvoked) throw error;
            if (requireProtectedMemory) return denyBeforeGateway(error);
            const pendingRelease = args.response ? requestIdByResponse.get(args.response) : null;
            if (pendingRelease?.state === 'pending') pendingRelease.state = 'native';
            providerTransportInvoked = true;
            return args.transport(args.endpointUrl, args.requestInit);
          });
        }
        return result;
      }
      return execute();
    },

    authorizeResponseWrite(response, write, final = false) {
      const release = requestIdByResponse.get(response);
      if (release?.state === 'completed') return undefined;
      if (release?.state === 'denied') {
        throw terminalError(new Error('MEMORY_DISPATCH_FINAL_RESPONSE_REVALIDATION_DENIED'));
      }
      if (release?.state === 'pending') {
        try {
          if (typeof gateway?.authorizeResponseWrite !== 'function') {
            throw new Error('MEMORY_DISPATCH_RELEASE_AUTHORITY_UNAVAILABLE');
          }
          const authorize = () => gateway.authorizeResponseWrite(
            release.requestId, write, { final: final === true },
          );
          const result = runWithAuthenticatedHostSession
            && release.hostRequest && typeof release.coreConversationId === 'string'
            ? runWithAuthenticatedHostSession(release.hostRequest, release.coreConversationId, authorize)
            : authorize();
          if (result && typeof result.then === 'function') {
            return Promise.resolve(result).then(value => {
              if (final === true) release.state = 'completed';
              return value;
            }, error => {
              release.state = 'denied';
              throw terminalError(error);
            });
          }
          if (final === true) release.state = 'completed';
          return result;
        } catch (error) {
          release.state = 'denied';
          throw terminalError(error);
        }
      }
      // Native generations without injected Memory remain fully native:
      // Logic Engine never becomes a prerequisite for ordinary ST responses.
      const result = write();
      if (release && final === true) release.state = 'completed';
      return result;
    },

    forwardResponse(upstream, response) {
      return nativeForwardFetchResponse(upstream, response);
    },
  });
}
