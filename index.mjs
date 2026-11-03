import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SillyTavernPatchManager } from './scripts/sillytavern-patch-manager.mjs';
import { createSillyTavernHostAdapter } from './host-adapter/extension-gateway/server-plugin/host-adapter.mjs';
import { createSillyTavernFinalSendAdapter } from './host-adapter/sillytavern-final-send-adapter.mjs';
import { createEmbeddedGatewayRuntime } from './host-adapter/embedded-gateway-runtime.mjs';
import { createNpcGenerationContextHostBridge } from './src/application/npc-generation-context-host-bridge.js';

const PLUGIN_OWNER = 'logic-engine-extension:host-adapter-v1';
const PLUGIN_ROOT = dirname(fileURLToPath(import.meta.url));
let registeredHook = null;
let registeredAdapter = null;
let registeredRuntime = null;

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
  if (typeof candidate !== 'string' || !/^[A-Za-z0-9._-]+(?:\\/[A-Za-z0-9._-]+){0,3}$/.test(candidate)
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

function createNpcBridge(providerAdapter) {
  if (typeof providerAdapter?.npcGenerationContext?.prepareForDispatch !== 'function'
    || typeof providerAdapter?.runWithAuthenticatedHostSession !== 'function') {
    throw new Error('EMBEDDED_GATEWAY_NPC_HOST_BRIDGE_UNAVAILABLE');
  }
  return createNpcGenerationContextHostBridge({
    runtime: providerAdapter.npcGenerationContext,
    createRequestMetadata: request => {
      const body = generationBody(request);
      return Object.freeze({
        request_id: body?.logic_engine_request_id,
        generation_id: body?.logic_engine_generation_id,
        generation_type: body?.logic_engine_generation_type,
      });
    },
  });
}

function buildProtectedMemory(request, prepared, npcBridge) {
  const host = prepared?.hostContext?.host;
  if (!host || host.status !== 'READY' || !prepared.response) return undefined;
  const accepted = npcBridge.consume(request, prepared.response);
  if (accepted?.status !== 'accepted' || !accepted.context || accepted.laneB?.status !== 'ready') {
    return undefined;
  }

  const context = accepted.context;
  const laneA = context.lanes?.lane_a;
  const laneBContext = context.lanes?.lane_b;
  if (!laneA || !Array.isArray(laneA.items) || !laneBContext
    || laneBContext.status !== 'ready' || !Array.isArray(laneBContext.candidates)) {
    return undefined;
  }

  // Lane A is fully read and revalidated, but its model projection has not yet
  // been approved. Never silently omit non-empty Lane A from the model context.
  if (laneA.items.length !== 0) return undefined;

  const contentBlocks = laneBContext.candidates.map(candidate => Object.freeze({
    epistemic_kind: candidate.epistemic_kind,
    evidence_assessment: candidate.evidence_assessment,
    content: candidate.content,
  }));

  // A complete, revalidated empty Lane A + Lane B is explicitly unprotected.
  // Any incomplete or unknown state above returns undefined and is terminal.
  if (contentBlocks.length === 0 && accepted.laneB.sources.length === 0
    && accepted.laneB.candidates.length === 0) return null;

  const hostBinding = host.context;
  const coreContext = host.coreContext;
  if (!hostBinding || !coreContext) return undefined;
  const hostContext = Object.freeze({
    adapter_id: coreContext.adapter_id,
    core_conversation_id: coreContext.conversation_id,
    world_id: context.world_id,
    actor_id: context.actor_id,
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

  return Object.freeze({
    requestId: context.request_id,
    model: resolveRequestModel(request, prepared),
    worldId: context.world_id,
    actorId: context.actor_id,
    purpose: 'npc_decision',
    sources: accepted.laneB.sources,
    candidates: accepted.laneB.candidates,
    providerEvidenceCursor: accepted.laneB.provider_evidence_cursor,
    laneA,
    revalidateLaneAUnderCoordinatorLease: accepted.revalidateLaneAUnderCoordinatorLease,
    contentBlocks: Object.freeze(contentBlocks),
    hostContext,
    snapshot: context.snapshot,
  });
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
  let npcBridge = null;
  try {
    if (memoryEnabled) {
      registeredRuntime = createEmbeddedGatewayRuntime({
        hostAdapter,
        adapterId: process.env.LOGIC_ENGINE_ADAPTER_ID,
      });
      npcBridge = createNpcBridge(registeredRuntime.providerAdapter);
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
        if (!memoryEnabled) return null;
        const host = await hostAdapter.prepareGenerationContext(request, hostRoute);
        if (host?.status !== 'READY') {
          return {
            status: 'NON_READY',
            code: host?.code || 'HOST_NPC_CONTEXT_NON_READY',
          };
        }
        const coreConversationId = hostAdapter.resolveCoreConversationId(request);
        if (typeof coreConversationId !== 'string' || !coreConversationId) {
          return { status: 'NON_READY', code: 'HOST_CORE_CONVERSATION_UNAVAILABLE' };
        }
        const prepared = await registeredRuntime.providerAdapter.runWithAuthenticatedHostSession(
          request,
          coreConversationId,
          () => npcBridge.prepare(request, response),
        );
        if (prepared?.status !== 'ready') {
          return { status: 'NON_READY', code: prepared?.reason || 'NPC_CONTEXT_NOT_READY' };
        }
        return Object.freeze({ status: 'READY', host, coreConversationId });
      },
      resolveProtectedMemory: (request, prepared) => {
        if (!memoryEnabled) return null;
        return buildProtectedMemory(request, prepared, npcBridge);
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
