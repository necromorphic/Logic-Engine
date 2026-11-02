import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { updateFinalSendPatch, getFinalSendPatchStatus } from './host-adapter/patch-manager/manager.mjs';

const PLUGIN_OWNER = 'logic-engine-extension:host-adapter-v1';
const PLUGIN_ROOT = dirname(fileURLToPath(import.meta.url));
const SILLYTAVERN_ROOT = resolve(PLUGIN_ROOT, '..', '..');
// Keep recovery material outside plugins/logic-engine so removing or replacing
// the Extension cannot delete the only byte-exact upstream backup.
const PATCH_STATE = join(SILLYTAVERN_ROOT, 'data', 'logic-engine', 'final-send-patch');
let registeredHook = null;
let registeredAdapter = null;

const SENDER_ROUTE_MAP = Object.freeze({
  claude: 'claude',
  makersuite: 'google-ai-studio',
  vertexai: 'vertex-ai',
  ai21: 'ai21',
  mistralai: 'mistral',
  cohere: 'cohere',
  deepseek: 'deepseek',
  xai: 'xai',
  aimlapi: 'aimlapi',
  electronhub: 'electronhub',
  chutes: 'chutes',
  minimax: 'minimax',
  azure_openai: 'azure-openai',
  openai: 'openai',
  openrouter: 'openrouter',
  custom: 'custom',
  perplexity: 'perplexity',
  groq: 'groq',
  fireworks: 'fireworks',
  nanogpt: 'nanogpt',
  pollinations: 'pollinations',
  moonshot: 'moonshot',
  zai: 'zai',
  siliconflow: 'siliconflow',
  workers_ai: 'workers-ai',
});

function assertAuthenticatedStRequest(request) {
  const handle = request?.user?.profile?.handle;
  const session = request?.session;
  if (!session || typeof handle !== 'string' || !handle.trim()
    || (session.handle !== undefined && session.handle !== handle)) {
    throw new Error('LOGIC_ENGINE_HOST_SESSION_NOT_AUTHENTICATED');
  }
}

function containsUntrustedMemoryMarker(body) {
  if (!body || typeof body !== 'object') return false;
  return Object.hasOwn(body, 'logic_engine_memory')
    || Object.hasOwn(body, 'logic_engine_protected_context')
    || Object.hasOwn(body, 'memory_dispatch');
}

function createFailClosedAdapter() {
  return Object.freeze({
    async prepare(request) {
      assertAuthenticatedStRequest(request);
      if (containsUntrustedMemoryMarker(request.body)) {
        throw new Error('LOGIC_ENGINE_UNTRUSTED_MEMORY_MARKER');
      }
      // No server-side Memory context is created while the deployment gate is
      // DISABLED. The final-send hook still owns the native egress call site.
    },
    resolveSenderRoute(request) {
      const source = request?.body?.chat_completion_source;
      const route = typeof source === 'string' ? SENDER_ROUTE_MAP[source] : null;
      if (!route) throw new Error('LOGIC_ENGINE_FINAL_SEND_SENDER_UNKNOWN');
      return route;
    },
    dispatch({ transport }) {
      // This is the only non-protected path. A future server-owned Memory
      // context must be handed to the in-process Core Gateway; it must never
      // be downgraded to this direct native transport.
      return transport();
    },
    forwardResponse(upstream, response) {
      return registeredNativeForward(upstream, response);
    },
  });
}

let registeredNativeForward = () => {
  throw new Error('LOGIC_ENGINE_NATIVE_RESPONSE_WRITER_UNAVAILABLE');
};

export const info = Object.freeze({
  id: 'logic-engine',
  name: 'Logic Engine',
  description: 'Core-authorized SillyTavern final-send integration with managed pinned Host patch',
});

export async function init(router) {
  if (typeof router?.get !== 'function') {
    throw new TypeError('SillyTavern server plugin requires an Express router');
  }

  const hostRoot = SILLYTAVERN_ROOT;
  const hookSourcePath = join(PLUGIN_ROOT, 'host-adapter', 'patch-manager', 'logic-engine-final-send-hook.js');
  const patchResult = await updateFinalSendPatch({
    hostRoot,
    stateRoot: PATCH_STATE,
    hookSourcePath,
  });

  try {
    const hookPath = join(hostRoot, 'src', 'logic-engine-final-send-hook.js');
    const hook = await import(pathToFileURL(hookPath).href);
    const nativeUtilPath = join(hostRoot, 'src', 'util.js');
    const nativeUtil = await import(pathToFileURL(nativeUtilPath).href);
    if (typeof nativeUtil.forwardFetchResponse !== 'function') {
      throw new Error('LOGIC_ENGINE_NATIVE_RESPONSE_WRITER_UNAVAILABLE');
    }
    registeredNativeForward = nativeUtil.forwardFetchResponse;
    registeredAdapter = createFailClosedAdapter();
    hook.registerLogicEngineFinalSendAdapter(registeredAdapter, PLUGIN_OWNER);
    registeredHook = hook;
  } catch (error) {
    try {
      const { restoreFinalSendPatch } = await import('./host-adapter/patch-manager/manager.mjs');
      await restoreFinalSendPatch({ hostRoot, stateRoot: PATCH_STATE });
    } catch {
      // A drifted patch is never overwritten during rollback. The Host remains
      // fail-closed and Patch Manager status will report the unresolved state.
    }
    throw error;
  }

  router.get('/final-send/status', async (_request, response) => {
    const patch = await getFinalSendPatchStatus({ hostRoot, stateRoot: PATCH_STATE });
    response.set('Cache-Control', 'no-store, private');
    return response.status(patch.status === 'installed' ? 200 : 503).json({
      patch: patch.status,
      hostCommit: patch.hostCommit ?? null,
      gateway: 'NOT_WIRED',
      memoryNpc: 'DISABLED_FAIL_CLOSED',
    });
  });

  console.info('[Logic Engine] Managed SillyTavern Final-Send Hook:', patchResult.status);
}

export async function exit() {
  if (registeredHook && registeredAdapter) {
    registeredHook.unregisterLogicEngineFinalSendAdapter(registeredAdapter, PLUGIN_OWNER);
  }
  registeredHook = null;
  registeredAdapter = null;
  registeredNativeForward = () => {
    throw new Error('LOGIC_ENGINE_NATIVE_RESPONSE_WRITER_UNAVAILABLE');
  };
}
