import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SillyTavernPatchManager } from './scripts/sillytavern-patch-manager.mjs';

const PLUGIN_OWNER = 'logic-engine-extension:host-adapter-v1';
const PLUGIN_ROOT = dirname(fileURLToPath(import.meta.url));
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

const HOST_ROUTE_MAP = Object.freeze({
  'text-completions': 'text-completions',
  kobold: 'kobold',
  'novelai-text': 'novelai-text',
  'horde-text': 'horde-text',
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
    resolveSenderRoute(request, hostRoute = 'chat-completions') {
      if (hostRoute !== 'chat-completions') {
        const route = HOST_ROUTE_MAP[hostRoute];
        if (!route) throw new Error('LOGIC_ENGINE_FINAL_SEND_SENDER_UNKNOWN');
        return route;
      }
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

  const hostRoot = resolve(PLUGIN_ROOT, '..', '..');
  const legacyStateRoot = join(PLUGIN_ROOT, 'data', 'final-send-patch');
  if (existsSync(join(legacyStateRoot, 'manifest.json'))
    || existsSync(join(legacyStateRoot, 'pending.json'))) {
    throw new Error('LOGIC_ENGINE_LEGACY_PATCH_MANAGER_STATE_PRESENT; restore with the pre-consolidation plugin before upgrading');
  }
  const manager = new SillyTavernPatchManager({
    extensionRoot: PLUGIN_ROOT,
    stRoot: hostRoot,
  });
  // The same manager/state/journal is used by the native Extension lifecycle
  // Hook. Startup is the bootstrap; it never applies a second independent patch.
  // Native generation modules are imported before server plugins initialize.
  // Applying the patch here would change files on disk but leave this process's
  // already-loaded routers unpatched. Startup must only verify a patch installed
  // before process start; install/update lifecycle changes require a restart.
  const patchResult = await manager.inspectInstalledReadOnly();
  if (patchResult.status !== 'INSTALLED_AND_BACKUPS_VERIFIED') {
    throw new Error('LOGIC_ENGINE_FINAL_SEND_PATCH_NOT_INSTALLED_OR_VERIFIED_RESTART_REQUIRED');
  }

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
    // Keep the managed source patch and its durable journal intact. A missing
    // or conflicting adapter leaves the Hook fail-closed; uninstall is owned
    // only by the Extension delete lifecycle, never by plugin startup failure.
    throw error;
  }

  router.get('/final-send/status', async (_request, response) => {
    const patch = await manager.inspectInstalledReadOnly();
    const installed = patch.status === 'INSTALLED_AND_BACKUPS_VERIFIED';
    response.set('Cache-Control', 'no-store, private');
    return response.status(installed ? 200 : 503).json({
      patch: patch.status,
      hostCommit: patch.hostCommit ?? null,
      patchVersion: patch.patchVersion ?? null,
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
  // Do not uninstall on normal server shutdown/unload. The patched native
  // route modules are loaded for this process and must remain patched on disk
  // for the next startup. Extension deletion owns explicit uninstall.
}
