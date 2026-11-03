import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SillyTavernPatchManager } from './scripts/sillytavern-patch-manager.mjs';
import { createSillyTavernHostAdapter } from './host-adapter/extension-gateway/server-plugin/host-adapter.mjs';
import { createSillyTavernFinalSendAdapter } from './host-adapter/sillytavern-final-send-adapter.mjs';
import { createEmbeddedGatewayRuntime } from './host-adapter/embedded-gateway-runtime.mjs';

const PLUGIN_OWNER = 'logic-engine-extension:host-adapter-v1';
const PLUGIN_ROOT = dirname(fileURLToPath(import.meta.url));
let registeredHook = null;
let registeredAdapter = null;
let registeredRuntime = null;
const npcHandoffsByRequest = new WeakMap();
const preparedNpcRequests = new WeakSet();

const unavailableGateway = Object.freeze({
  dispatchProtectedRequest() {
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

function generationBody(request) {
  const body = request?.body;
  if (body && typeof body === 'object' && typeof body.logic_engine_request_id === 'string') return body;
  const params = body?.params;
  if (params && typeof params === 'object') return params;
  return null;
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
  const patchResult = await manager.inspectInstalledReadOnly();
  if (patchResult.status !== 'INSTALLED_AND_BACKUPS_VERIFIED') {
    throw new Error('LOGIC_ENGINE_FINAL_SEND_PATCH_NOT_INSTALLED_OR_VERIFIED_RESTART_REQUIRED');
  }

  const memoryEnabled = process.env.LOGIC_ENGINE_MEMORY_NPC_ENABLED === 'true';
  const hostAdapter = createSillyTavernHostAdapter();
  try {
    if (memoryEnabled) {
      registeredRuntime = createEmbeddedGatewayRuntime({
        hostAdapter,
        adapterId: process.env.LOGIC_ENGINE_ADAPTER_ID,
      });
      if (typeof registeredRuntime.providerAdapter?.npcGenerationContext?.prepareForDispatch !== 'function'
        || typeof registeredRuntime.providerAdapter?.runWithAuthenticatedHostSession !== 'function') {
        throw new Error('EMBEDDED_GATEWAY_NPC_CONTEXT_RUNTIME_UNAVAILABLE');
      }
    }

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
      gateway: memoryEnabled ? registeredRuntime.gateway : unavailableGateway,
      chatCompletionSources: nativeConstants.CHAT_COMPLETION_SOURCES,
      nativeForwardFetchResponse: nativeUtil.forwardFetchResponse,
      runWithAuthenticatedHostSession: memoryEnabled
        ? registeredRuntime.providerAdapter.runWithAuthenticatedHostSession
        : null,
      prepareHostContext: async (request, response, hostRoute) => {
        if (!memoryEnabled) return Object.freeze({ status: 'UNPROTECTED' });
        if (!request || typeof request !== 'object' || !response || typeof response !== 'object'
          || preparedNpcRequests.has(request)) {
          return { status: 'NON_READY', code: 'NPC_HOST_REQUEST_REUSED' };
        }
        preparedNpcRequests.add(request);
        const host = await hostAdapter.prepareGenerationContext(request, hostRoute);
        if (host?.status !== 'READY' || !host.context || !host.coreContext) {
          return { status: 'NON_READY', code: host?.code || 'HOST_NPC_CONTEXT_NON_READY' };
        }
        const coreConversationId = hostAdapter.resolveCoreConversationId(request);
        if (typeof coreConversationId !== 'string' || !coreConversationId
          || coreConversationId !== host.coreContext.conversation_id) {
          return { status: 'NON_READY', code: 'HOST_CORE_CONVERSATION_UNAVAILABLE' };
        }
        const body = generationBody(request);
        const generationRequest = Object.freeze({
          request_id: body?.logic_engine_request_id,
          generation_id: body?.logic_engine_generation_id,
          generation_type: body?.logic_engine_generation_type,
        });
        let preparedNpc;
        try {
          preparedNpc = await registeredRuntime.providerAdapter.runWithAuthenticatedHostSession(
            request,
            coreConversationId,
            () => registeredRuntime.providerAdapter.npcGenerationContext.prepareForDispatch(generationRequest),
          );
        } catch {
          return { status: 'NON_READY', code: 'NPC_CONTEXT_PREPARATION_FAILED' };
        }
        if (preparedNpc?.status !== 'ready' || !preparedNpc.handoff) {
          return { status: 'NON_READY', code: preparedNpc?.reason || 'NPC_CONTEXT_NOT_READY' };
        }
        npcHandoffsByRequest.set(request, Object.freeze({
          response,
          handoff: preparedNpc.handoff,
          generationRequest,
          host,
        }));
        return Object.freeze({ status: 'READY', host, coreConversationId });
      },
      resolveProtectedMemory: (request, prepared) => {
        if (!memoryEnabled) return Object.freeze({ status: 'unprotected' });
        const host = prepared?.hostContext?.host;
        const handoff = request && typeof request === 'object' ? npcHandoffsByRequest.get(request) : null;
        if (!host || host.status !== 'READY' || !prepared?.response
          || !handoff || handoff.response !== prepared.response || handoff.host !== host) {
          return Object.freeze({ status: 'non_ready' });
        }
        npcHandoffsByRequest.delete(request);
        const hostBinding = host.context;
        const coreContext = host.coreContext;
        if (!hostBinding || !coreContext
          || typeof host.requestId !== 'string' || !host.requestId) {
          return Object.freeze({ status: 'non_ready' });
        }
        const hostContext = Object.freeze({
          adapter_id: coreContext.adapter_id,
          core_conversation_id: coreContext.conversation_id,
          world_id: coreContext.world_id,
          actor_id: coreContext.actor_id,
          actor_type: coreContext.actor_type,
          host_installation_id: hostBinding.host_installation_id,
          authenticated_account_id: hostBinding.authenticated_account_id,
          host_session_id: hostBinding.host_session_id,
          host_conversation_id: hostBinding.conversation_id,
          conversation_uuid: hostBinding.conversation_uuid,
          root_id: hostBinding.root_id,
          root_inventory_sequence: hostBinding.root_inventory_sequence,
          root_manifest_sha256: hostBinding.root_manifest_sha256,
        });
        let model;
        try { model = resolveRequestModel(request, prepared); }
        catch { return Object.freeze({ status: 'non_ready' }); }
        return Object.freeze({
          status: 'ready',
          context: Object.freeze({
            requestId: host.requestId,
            generationRequest: handoff.generationRequest,
            npcContextHandoff: handoff.handoff,
            model,
            worldId: coreContext.world_id,
            actorId: coreContext.actor_id,
            purpose: 'npc_decision',
            conversationId: coreContext.conversation_id,
            adapterId: coreContext.adapter_id,
            hostContext,
          }),
        });
      },
    });
    hook.registerLogicEngineFinalSendAdapter(registeredAdapter, PLUGIN_OWNER);
    registeredHook = hook;
  } catch (error) {
    try { registeredRuntime?.close?.(); } catch {}
    registeredRuntime = null;
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
      gateway: memoryEnabled ? 'EMBEDDED_GATEWAY_FAIL_CLOSED_ON_EVIDENCE' : 'DISABLED_FAIL_CLOSED',
      memoryNpc: memoryEnabled ? 'LOCAL_ONE_SHOT_HANDOFF' : 'DISABLED_FAIL_CLOSED',
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
  try { registeredRuntime?.close?.(); } finally { registeredRuntime = null; }
}
