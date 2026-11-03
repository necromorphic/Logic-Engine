import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SillyTavernPatchManager } from './scripts/sillytavern-patch-manager.mjs';
import { createSillyTavernHostAdapter } from './host-adapter/extension-gateway/server-plugin/host-adapter.mjs';
import { createSillyTavernFinalSendAdapter } from './host-adapter/sillytavern-final-send-adapter.mjs';
import { receiveNpcContext } from './host-adapter/npc-context-receiver.mjs';

const PLUGIN_OWNER = 'logic-engine-extension:host-adapter-v1';
const PLUGIN_ROOT = dirname(fileURLToPath(import.meta.url));
let registeredHook = null;
let registeredAdapter = null;

const unavailableGateway = Object.freeze({
  dispatchProtectedRequest() {
    // This is deliberately not a transport. Until Core/Provider/Host evidence
    // readers are composed with the shared Coordinator, protected context
    // cannot reach a native sender and must not downgrade to direct fetch.
    throw new Error('MEMORY_DISPATCH_NOT_READY');
  },
  authorizeResponseWrite() {
    throw new Error('MEMORY_DISPATCH_NOT_READY');
  },
});

function resolveRequestModel(request, prepared) {
  const body = prepared.hostRoute === 'horde-text'
    ? request?.body?.params
    : request?.body;
  const candidate = body?.model ?? body?.model_name ?? body?.model_id ?? 'native-' + prepared.hostRoute;
  if (typeof candidate !== 'string' || !/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+){0,3}$/.test(candidate)
    || candidate.length > 128) {
    throw new Error('NPC_CONTEXT_MODEL_ID_INVALID');
  }
  return candidate;
}

export const info = Object.freeze({
  id: 'logic-engine',
  name: 'Logic Engine',
  description: 'Core-authorized SillyTavern generation and fail-closed Final-Send integration',
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
  // Native generation modules are imported before server plugins initialize.
  // Startup only verifies the already-installed patch; install/update must
  // happen before restart and normal shutdown never removes it.
  const patchResult = await manager.inspectInstalledReadOnly();
  if (patchResult.status !== 'INSTALLED_AND_BACKUPS_VERIFIED') {
    throw new Error('LOGIC_ENGINE_FINAL_SEND_PATCH_NOT_INSTALLED_OR_VERIFIED_RESTART_REQUIRED');
  }

  const memoryEnabled = process.env.LOGIC_ENGINE_MEMORY_NPC_ENABLED === 'true';
  const hostAdapter = createSillyTavernHostAdapter();
  try {
    const hookPath = join(hostRoot, 'src', 'logic-engine-final-send-hook.js');
    const hook = await import(pathToFileURL(hookPath).href);
    const nativeUtilPath = join(hostRoot, 'src', 'util.js');
    const nativeUtil = await import(pathToFileURL(nativeUtilPath).href);
    const constantsPath = join(hostRoot, 'src', 'constants.js');
    const nativeConstants = await import(pathToFileURL(constantsPath).href);
    if (typeof nativeUtil.forwardFetchResponse !== 'function'
      || !nativeConstants.CHAT_COMPLETION_SOURCES) {
      throw new Error('LOGIC_ENGINE_NATIVE_SILLYTAVERN_CONTRACT_UNAVAILABLE');
    }

    registeredAdapter = createSillyTavernFinalSendAdapter({
      gateway: unavailableGateway,
      chatCompletionSources: nativeConstants.CHAT_COMPLETION_SOURCES,
      nativeForwardFetchResponse: nativeUtil.forwardFetchResponse,
      prepareHostContext: async (request, _response, hostRoute) => {
        if (!memoryEnabled) return null;
        return hostAdapter.prepareGenerationContext(request, hostRoute);
      },
      resolveProtectedMemory: (request, prepared) => {
        if (!memoryEnabled) return null;
        const host = prepared?.hostContext;
        if (!host || host.status !== 'READY') return undefined;
        const received = receiveNpcContext({
          retrieval: host.retrieval,
          hostContext: host.coreContext,
          hostBinding: host.context,
          requestId: host.requestId,
          model: resolveRequestModel(request, prepared),
          purpose: 'npc_decision',
        });
        // A verified complete-empty result carries no protected content and
        // does not need the Memory egress lease. Every non-empty result must
        // pass the in-process Gateway; its current production reader composition
        // is intentionally unavailable, so it is denied without native fallback.
        return received.candidates.length === 0 ? null : received;
      },
    });
    hook.registerLogicEngineFinalSendAdapter(registeredAdapter, PLUGIN_OWNER);
    registeredHook = hook;
  } catch (error) {
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
      gateway: 'NOT_WIRED_FAIL_CLOSED',
      memoryNpc: memoryEnabled ? 'PREPARE_ONLY_FAIL_CLOSED' : 'DISABLED_FAIL_CLOSED',
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
  // Do not uninstall on normal server shutdown/unload. The patched native
  // route modules remain installed for the next process startup.
}
