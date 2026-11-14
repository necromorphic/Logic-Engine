import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { initializeMemoryProviderSchema, createMemoryNpcProviderAdapter } from '../src/application/memory-npc-provider-adapter.js';
import { MemoryDispatchGateway } from '../src/security/memory-dispatch-gateway.js';
import { enrollAcceptedHeadDomain } from '../src/security/enroll-accepted-head-domain.js';
import { createSillyTavernFinalSendAdapter } from '../host-adapter/sillytavern-final-send-adapter.mjs';
import { ActorBindingService } from '../src/application/actor-bindings.js';
import { HostConversationWorldBindingService } from '../src/application/host-conversation-world-bindings.js';
import { createHostBoundNpcKnowledgeAuthorizers } from '../src/application/npc-knowledge-authorization.js';
import { createProcessScopedMechanicPolicyAuthority } from '../src/application/mechanic-policy-authority.js';
import { createNpcGenerationContextHostBridge } from '../src/application/npc-generation-context-host-bridge.js';
import { createNpcGenerationRequestMetadata } from '../host-adapter/npc-generation-request-metadata.mjs';
import { buildProtectedMemory } from '../index.mjs';
import { HostAssertionNonceStore } from '../src/application/host-assertion-nonce-store.js';
import { createApiServer } from '../src/api/server.js';
import { createSillyTavernHostAdapter } from '../host-adapter/extension-gateway/server-plugin/host-adapter.mjs';
import { HostIdentityStore } from '../host-adapter/extension-gateway/server-plugin/st-host-identity-store.mjs';
import {
  PINNED_ST_MUTATION_COVERAGE_SHA256,
  PINNED_ST_MUTATION_ROUTE_COUNT,
} from '../host-adapter/extension-gateway/server-plugin/st-mutation-route-contract.mjs';

const API_TOKEN = 'host-bridge-runtime-api-token-long-enough';
const ADAPTER_TOKEN = 'host-bridge-runtime-adapter-token-long-enough';
const ACCEPTED_CORE_TOKEN = 'host-bridge-runtime-accepted-core-token-000000000001';
const ACCEPTED_PROVIDER_TOKEN = 'host-bridge-runtime-accepted-provider-token-000000000002';
const ACCEPTED_READ_TOKEN = 'host-bridge-runtime-accepted-read-token-000000000003';
const CHAT_COMPLETION_SOURCES = Object.freeze({
  CLAUDE: 'claude', AI21: 'ai21', MAKERSUITE: 'makersuite', VERTEXAI: 'vertexai',
  MISTRALAI: 'mistral', COHERE: 'cohere', COMETAPI: 'cometapi', DEEPSEEK: 'deepseek',
  AIMLAPI: 'aimlapi', XAI: 'xai', CHUTES: 'chutes', MINIMAX: 'minimax',
  ELECTRONHUB: 'electronhub', AZURE_OPENAI: 'azure-openai', OPENAI: 'openai',
  OPENROUTER: 'openrouter', CUSTOM: 'custom', PERPLEXITY: 'perplexity', GROQ: 'groq',
  FIREWORKS: 'fireworks', NANOGPT: 'nanogpt', POLLINATIONS: 'pollinations',
  MOONSHOT: 'moonshot', ZAI: 'zai', SILICONFLOW: 'siliconflow', WORKERS_AI: 'workers-ai',
});
const ACCEPTED_HEAD_ENV_KEYS = [
  'LOGIC_ENGINE_ACCEPTED_HEAD_REQUIRED',
  'LOGIC_ENGINE_ACCEPTED_HEAD_PORT',
  'LOGIC_ENGINE_ACCEPTED_HEAD_CORE_TOKEN',
  'LOGIC_ENGINE_ACCEPTED_HEAD_PROVIDER_TOKEN',
];
const ADAPTER_ID = 'st-host-bridge-runtime-e2e';
const SESSION = '33333333-3333-4333-8333-333333333333';
const CONVERSATION = '44444444-4444-4444-8444-444444444444';
const SOURCE_MANIFEST_SHA256 = 'c'.repeat(64);

async function startAcceptedHeadAuthorityProcess(path) {
  const authorityUrl = new URL('../src/security/accepted-head-authority.js', import.meta.url).href;
  const script = [
    'import { AcceptedHeadAuthority, createAcceptedHeadAuthorityServer } from ' + JSON.stringify(authorityUrl) + ';',
    'const args = process.argv.slice(1);',
    'const authority = new AcceptedHeadAuthority({ path: args[0], installationId: "host-bridge-runtime-e2e-authority" });',
    'const server = createAcceptedHeadAuthorityServer({ authority, coreToken: process.env.LE_TEST_CORE_TOKEN, providerToken: process.env.LE_TEST_PROVIDER_TOKEN, readToken: process.env.LE_TEST_READ_TOKEN });',
    'server.listen(0, "127.0.0.1", () => process.stdout.write("LISTENING:" + server.address().port + "\\n"));',
    'process.stdin.on("data", () => server.close(() => { authority.close(); process.exit(0); }));',
  ].join('\n');
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, path], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: {
      PATH: process.env.PATH || '',
      SystemRoot: process.env.SystemRoot || '',
      WINDIR: process.env.WINDIR || '',
      LE_TEST_CORE_TOKEN: ACCEPTED_CORE_TOKEN,
      LE_TEST_PROVIDER_TOKEN: ACCEPTED_PROVIDER_TOKEN,
      LE_TEST_READ_TOKEN: ACCEPTED_READ_TOKEN,
    },
  });
  const [chunk] = await once(child.stdout, 'data');
  const match = String(chunk).match(/LISTENING:(\d+)/);
  if (!match) {
    child.kill();
    throw new Error('Accepted-head test service did not start.');
  }
  return { child, port: Number(match[1]) };
}

function responseRecorder() {
  return {
    statusCode: null,
    payload: null,
    set() { return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

test('one Host run preserves identity through live Core, SQLite Provider, Receiver, Gateway and fake model transport', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'host-bridge-runtime-e2e-'));
  const corePath = join(directory, 'core.sqlite');
  const providerPath = join(directory, 'memory-provider.sqlite');
  const coordinatorPath = resolve(join(directory, 'coordinator.sqlite'));
  const previousCoordinator = process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH;
  const previousDataRoot = globalThis.DATA_ROOT;
  const previousAcceptedHeadEnv = Object.fromEntries(ACCEPTED_HEAD_ENV_KEYS.map(key => [key, process.env[key]]));
  const dataRoot = join(directory, 'st-data');
  const identityDirectory = join(directory, 'host-identity');
  mkdirSync(dataRoot, { recursive: true });
  process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH = coordinatorPath;
  globalThis.DATA_ROOT = dataRoot;
  for (const key of ACCEPTED_HEAD_ENV_KEYS) delete process.env[key];

  let store;
  let providerAdapter;
  let observerAdapter;
  let nonceStore;
  let server;
  let authorityProcess;
  let authorityPort;
  let gateway;
  let finalSendAdapter;
  try {
    authorityProcess = await startAcceptedHeadAuthorityProcess(
      join(directory, 'accepted-head-authority.sqlite'),
    );
    authorityPort = authorityProcess.port;

    // Bootstrap empty Core and Provider schemas first, then perform explicit
    // test-only accepted-head baseline enrollment before reopening them in
    // authoritative mode. This mirrors the deployment lifecycle without
    // treating the Host Root Inventory fixture as production authority.
    store = new SQLiteStore(corePath);
    store.close();
    store = null;
    initializeMemoryProviderSchema({ providerPath, coordinatorPath });
    const baselineDigest = '9'.repeat(64);
    enrollAcceptedHeadDomain({
      domain: 'core', databasePath: corePath, coordinatorPath, port: authorityPort,
      token: ACCEPTED_CORE_TOKEN, approvalId: 'host-bridge-runtime-core-baseline', baselineDigest,
    });
    enrollAcceptedHeadDomain({
      domain: 'provider', databasePath: providerPath, coordinatorPath, port: authorityPort,
      token: ACCEPTED_PROVIDER_TOKEN, approvalId: 'host-bridge-runtime-provider-baseline', baselineDigest,
    });
    process.env.LOGIC_ENGINE_ACCEPTED_HEAD_REQUIRED = '1';
    process.env.LOGIC_ENGINE_ACCEPTED_HEAD_PORT = String(authorityPort);
    process.env.LOGIC_ENGINE_ACCEPTED_HEAD_CORE_TOKEN = ACCEPTED_CORE_TOKEN;
    process.env.LOGIC_ENGINE_ACCEPTED_HEAD_PROVIDER_TOKEN = ACCEPTED_PROVIDER_TOKEN;
    store = new SQLiteStore(corePath);

    const identityStore = new HostIdentityStore({ directory: identityDirectory });
    const hostIdentity = await identityStore.resolveAuthenticatedAccount('bridge-e2e-user');
    const coreConversationId = SESSION + ':' + hostIdentity.host_installation_id + ':' + CONVERSATION;
    const directories = {
      root: join(dataRoot, 'default-user'),
      chats: join(dataRoot, 'default-user', 'chats'),
      groups: join(dataRoot, 'default-user', 'groups'),
      groupChats: join(dataRoot, 'default-user', 'groupChats'),
      extensions: join(dataRoot, 'default-user', 'extensions'),
    };
    for (const path of Object.values(directories)) mkdirSync(path, { recursive: true });

    const npcAuthorizers = createHostBoundNpcKnowledgeAuthorizers({
      store,
      adapterIds: [ADAPTER_ID],
      trustedInitialKnowledgeSources: [],
    });
    const engine = new LogicEngine(store, {
      trustedInitialKnowledgeSources: [],
      npcKnowledgeReadAuthorizer: npcAuthorizers.readAuthorizer,
      npcKnowledgeVisibilityAuthorizer: npcAuthorizers.visibilityAuthorizer,
    });
    const mechanicPolicyAuthority = createProcessScopedMechanicPolicyAuthority({
      authorityId: 'host-bridge-runtime-e2e-policy',
      generation: 1,
      fieldPolicy: (_context, _entity, field) =>
        field === 'entity_id' || field === 'attributes.public_note',
    });

    const worldId = 'host-bridge-runtime-world';
    const actorId = 'host-bridge-runtime-npc';
    const sourceId = 'host-bridge-runtime-source';
    const canary = 'LE_HOST_BRIDGE_RUNTIME_' + randomUUID();
    engine.createWorld({
      world_id: worldId,
      world_pack_id: 'test.host-bridge-runtime-e2e',
      world_pack_version: '1',
      game_time: '2026-01-01T00:00:00Z',
    });
    engine.commitEvent(worldId, {
      idempotency_key: 'host-bridge-runtime-seed',
      turn_id: 'host-bridge-runtime-seed',
      event_type: 'action.completed',
      expected_revision: 0,
      effects: [
        { kind: 'entity.create', entity_id: actorId, entity_type: 'character', attributes: { name: 'NPC' } },
        { kind: 'entity.create', entity_id: sourceId, entity_type: 'character', attributes: { public_note: canary } },
      ],
    });
    new ActorBindingService(engine).bind(worldId, ADAPTER_ID, actorId);
    new HostConversationWorldBindingService(engine).bind({
      adapterId: ADAPTER_ID,
      conversationId: coreConversationId,
      worldId,
    });

    let hostAdapter;
    providerAdapter = createMemoryNpcProviderAdapter({
      engine,
      providerPath,
      coordinatorPath,
      adapterId: ADAPTER_ID,
      trustedInitialKnowledgeSources: [],
      fieldPolicy: mechanicPolicyAuthority,
      contentFields: ['attributes.public_note'],
      isAuthenticatedHostRequest: request => hostAdapter?.isAuthenticatedHostRequest(request) === true,
      resolveHostConversationId: request => hostAdapter?.resolveCoreConversationId(request) ?? null,
      resolveHostIdentity: request => hostAdapter?.resolveHostIdentity(request) ?? null,
    });
    assert.ok(providerAdapter.npcGenerationContext, 'the real Core NPC runtime must be composed');
    assert.equal(typeof providerAdapter.runWithAuthenticatedHostSession, 'function',
      'the real Host session capability must be wired into the Core runtime');

    const source = engine.getSnapshot(worldId, {
      entityIds: [sourceId],
      includeSourceVersions: true,
    }).entities[0];
    const scope = { world_id: worldId, subject_id: actorId, purpose: 'npc_decision' };
    const record = {
      ...scope,
      record_ref: 'memory:host-bridge-runtime-record',
      record_version: 'v1',
      source_kind: 'canonical_entity',
      source_entity_id: sourceId,
      source_version: source.source_version,
      content_kind: 'claim',
      epistemic_kind: 'acquired_report',
      producer_kind: 'host-bridge-runtime-e2e',
      content_disposition: 'usable',
      evidence_assessment: 'supported',
      lineage: [{
        source_kind: 'canonical_entity',
        entity_id: sourceId,
        source_version: source.source_version,
      }],
    };
    providerAdapter.provider.putRecord(record);
    providerAdapter.provider.grantQuery(scope, true);
    providerAdapter.provider.grantRecord(scope, record.record_ref, record.record_version, true);
    assert.equal((await providerAdapter.prepareWorld(worldId)).status, 'current');

    observerAdapter = createMemoryNpcProviderAdapter({
      engine,
      providerPath,
      coordinatorPath,
      adapterId: ADAPTER_ID,
      trustedInitialKnowledgeSources: [],
      fieldPolicy: mechanicPolicyAuthority,
      contentFields: ['attributes.public_note'],
      observerOnly: true,
    });

    nonceStore = new HostAssertionNonceStore({
      path: join(directory, 'host-assertion-nonces.sqlite'),
      coreDatabasePath: corePath,
      coordinatorPath,
    });
    server = createApiServer({
      engine,
      token: API_TOKEN,
      adapterTokens: { [ADAPTER_ID]: ADAPTER_TOKEN },
      memoryNpcConsumers: { [ADAPTER_ID]: providerAdapter.consumer },
      hostAssertionNonceStore: nonceStore,
      defaultHostWorldId: worldId,
      resolveHostLifecycleIdentity: input => ({
        authorized: true,
        adapter_id: ADAPTER_ID,
        host_installation_id: input.host_installation_id,
        authenticated_account_id: input.authenticated_account_id,
        host_session_id: input.host_session_id,
        conversation_uuid: input.conversation_uuid,
        root_id: 'a'.repeat(64),
        authority_id: 'host-bridge-runtime-e2e-authority',
        authority_status: 'REVIEW_ONLY',
        generation: 1,
        snapshot_fingerprint: 'b'.repeat(64),
      }),
      resolveHostMemoryIdentity: input => ({
        authorized: true,
        adapter_id: ADAPTER_ID,
        host_installation_id: input.host_installation_id,
        authenticated_account_id: input.authenticated_account_id,
        host_session_id: input.host_session_id,
        conversation_uuid: input.conversation_uuid,
        root_id: 'a'.repeat(64),
        authority_id: 'host-bridge-runtime-e2e-authority',
        authority_status: 'AUTHORITATIVE_COMPLETE',
        generation: 1,
        snapshot_fingerprint: 'b'.repeat(64),
      }),
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    const env = {
      LOGIC_ENGINE_CORE_URL: 'http://127.0.0.1:' + server.address().port,
      LOGIC_ENGINE_API_TOKEN: API_TOKEN,
      LOGIC_ENGINE_ADAPTER_ID: ADAPTER_ID,
      LOGIC_ENGINE_ADAPTER_TOKEN: ADAPTER_TOKEN,
      LOGIC_ENGINE_HOST_IDENTITY_DIR: identityDirectory,
      LOGIC_ENGINE_HOST_BUILD_SHA: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
    };
    const inventory = {
      filesystem: {
        status: 'complete',
        entries: [],
        snapshot_id: 'host-bridge-runtime-vss-snapshot',
        snapshot_sha256: 'c'.repeat(64),
      },
      snapshot_alignment: 'SHARED_VSS_SNAPSHOT',
      source: {
        status: 'DOUBLE_SCAN_CANDIDATE',
        authority: 'NON_AUTHORITATIVE',
        host_commit: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
        scope: 'PINNED_SILLYTAVERN_CHAT_DATA_ROOTS',
        historical_boundary: 'CURRENT_FILE_SET_ONLY_ENROLLMENT_BASELINE_REQUIRED',
        logical_identity_status: 'CURRENT_FILE_IDENTITIES_VERIFIED',
        files: [{
          logical_identity: {
            conversation_uuid: CONVERSATION,
            identity_status: 'CURRENT_IDENTITIES_VERIFIED',
          },
        }],
        blockers: [],
        snapshot_id: 'host-bridge-runtime-vss-snapshot',
        snapshot_provider: 'windows-vss-client-accessible',
        snapshot_consistency: 'VSS_POINT_IN_TIME_READ_ONLY',
      },
      authority: { status: 'AUTHORITATIVE_COMPLETE', manifest_sha256: 'a'.repeat(64) },
    };
    const hostFetch = async (url, init) => fetch(url, init);
    hostAdapter = createSillyTavernHostAdapter({
      env,
      enumerate: async () => structuredClone(inventory),
      fetchImpl: hostFetch,
      // Test-only fixture for the runtime-acceptance contract. Production remains fail-closed
      // unless a real verifier validates exact installed-source/runtime evidence.
      verifyMutationRuntimeAcceptance: async proof => {
        assert.equal(proof.pinnedHostCommit, '06bde939fb1e9c4c8d8641d810f0a916b5bce127');
        assert.equal(proof.snapshotAlignment, 'SHARED_VSS_SNAPSHOT');
        assert.equal(proof.snapshotSha256, 'c'.repeat(64));
        assert.equal(proof.sourceIdentity.manifest_sha256, SOURCE_MANIFEST_SHA256);
        assert.equal(proof.mutationCoverage.coverage_manifest_sha256, PINNED_ST_MUTATION_COVERAGE_SHA256);
        return {
          status: 'VERIFIED',
          source_commit: proof.pinnedHostCommit,
          snapshot_sha256: proof.snapshotSha256,
          snapshot_id: proof.snapshotId,
          root_id: proof.rootId,
          source_manifest_sha256: proof.sourceIdentity.manifest_sha256,
          mutation_coverage_manifest_sha256: proof.mutationCoverage.coverage_manifest_sha256,
          evidence_sha256: 'e'.repeat(64),
        };
      },
      verifyMutationCoverage: async () => ({
        status: 'VERIFIED',
        source_commit: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
        coverage_manifest_sha256: PINNED_ST_MUTATION_COVERAGE_SHA256,
        route_count: PINNED_ST_MUTATION_ROUTE_COUNT,
        source_files_sha256: 'd'.repeat(64),
      }),
      verifySourceIdentity: async () => ({
        status: 'CURRENT_IDENTITIES_VERIFIED',
        manifest_sha256: SOURCE_MANIFEST_SHA256,
        patch_blob_sha: 'd'.repeat(64),
        host_handler_blob_sha: 'e'.repeat(40),
      }),
      persistRootInventory: async () => ({
        status: 'AUTHORITATIVE_COMPLETE',
        integrity_status: 'INTEGRITY_OK',
        sequence: 1,
        manifest_sha256: 'b'.repeat(64),
        source_manifest_sha256: SOURCE_MANIFEST_SHA256,
        attestation_sha256: 'f'.repeat(64),
        lifecycle_sequence: 1,
        lifecycle_head_sha256: '1'.repeat(64),
      }),
    });

    const request = {
      user: { profile: { handle: 'bridge-e2e-user' }, directories },
      session: {
        handle: 'bridge-e2e-user',
        logicEngineSessionId: SESSION,
        logicEngineSessionHandle: 'bridge-e2e-user',
      },
      originalUrl: '/api/backends/chat-completions/generate',
      body: {
        chat_completion_source: 'custom',
        messages: [{ role: 'user', content: 'Generate a response using relevant memories.' }],
        logic_engine_conversation_uuid: CONVERSATION,
        logic_engine_request_id: randomUUID(),
        logic_engine_generation_id: randomUUID(),
        logic_engine_context_size: 4096,
        logic_engine_generation_type: 'normal',
        logic_engine_run_id: '77777777-7777-4777-8777-777777777777',
        model: 'acceptance-fake-provider',
      },
    };
    const hostPrepared = await hostAdapter.prepareGenerationContext(request, 'chat-completions');
    assert.equal(hostPrepared.status, 'READY', 'Host prepare: ' + JSON.stringify(hostPrepared));
    assert.equal(hostAdapter.resolveCoreConversationId(request), coreConversationId);
    const hostPreparationByRequest = new WeakMap();
    hostPreparationByRequest.set(request, { host: hostPrepared, coreConversationId });

    const requestMetadata = [];
    const coreMetadata = [];
    const coreRuntime = providerAdapter.npcGenerationContext;
    const bridge = createNpcGenerationContextHostBridge({
      runtime: {
        prepareForDispatch: async (metadata, options) => {
          coreMetadata.push(metadata);
          return coreRuntime.prepareForDispatch(metadata, options);
        },
        consumeDispatchHandoff: (...args) => coreRuntime.consumeDispatchHandoff(...args),
        getLaneBDispatchEvidence: (...args) => coreRuntime.getLaneBDispatchEvidence(...args),
        revalidateLaneAForDispatch: (...args) => coreRuntime.revalidateLaneAForDispatch(...args),
        revalidateLaneAForDispatchUnderCoordinatorLease: (...args) =>
          coreRuntime.revalidateLaneAForDispatchUnderCoordinatorLease(...args),
      },
      createRequestMetadata: () => {
        const metadata = createNpcGenerationRequestMetadata();
        requestMetadata.push(metadata);
        return metadata;
      },
    });

    const response = responseRecorder();
    const result = await providerAdapter.runWithAuthenticatedHostSession(
      request,
      coreConversationId,
      async () => {
        const prepared = await bridge.prepare(request, response);
        assert.equal(prepared.status, 'ready', 'Host bridge prepare: ' + JSON.stringify(prepared));
        const coreContext = providerAdapter.resolveAuthenticatedHostContext();
        const protectedMemory = buildProtectedMemory(request, {
          response,
          hostRoute: 'chat-completions',
          hostContext: {
            status: 'READY',
            host: { context: hostPrepared.context },
            coreContext,
          },
        }, bridge);
        assert.ok(protectedMemory, 'the accepted Core context must reach the production Receiver projection');
        return protectedMemory;
      },
    );

    assert.equal(requestMetadata.length, 1);
    assert.equal(coreMetadata.length, 1);
    assert.equal(Object.isFrozen(requestMetadata[0]), true);
    assert.equal(Object.keys(requestMetadata[0]).sort().join(','),
      'generation_id,generation_type,request_id,run_id');
    assert.equal(Object.keys(coreMetadata[0]).sort().join(','), 'generation_id,generation_type,request_id');
    assert.equal(Object.hasOwn(coreMetadata[0], 'run_id'), false,
      'Host run_id must not be added to the exact Core three-field contract');
    assert.equal(result.runId, requestMetadata[0].run_id);
    assert.notEqual(result.runId, request.body.logic_engine_run_id,
      'browser-supplied run identity must not select the Host one-shot run');
    assert.equal(result.requestId, requestMetadata[0].request_id);
    assert.equal(result.generationId, requestMetadata[0].generation_id);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].record_ref, record.record_ref);
    assert.equal(result.candidates[0].record_version, record.record_version);
    assert.equal(result.candidates[0].source_entity_id, sourceId);
    assert.equal(result.candidates[0].source_version, source.source_version);
    assert.equal(result.contentBlocks.length, 1);
    assert.equal(result.contentBlocks[0].content['attributes.public_note'], canary);
    assert.match(result.coreEnvelopeDigest, /^[a-f0-9]{64}$/);
    assert.match(result.contextDigest, /^[a-f0-9]{64}$/);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.contentBlocks[0].content), true);

    const replay = bridge.consume(request, response);
    assert.equal(replay.status, 'non_ready', 'a consumed Host handoff must not be accepted twice');
    assert.equal(bridge.consume(request, {} ).status, 'non_ready',
      'a different response object must not consume the original Host handoff');
    const duplicatePrepare = await bridge.prepare(request, response);
    assert.equal(duplicatePrepare.status, 'non_ready',
      'a Host request object must not be prepared twice');
    assert.equal(requestMetadata.length, 1,
      'a duplicate prepare must not mint another Host generation identity');

    // Continue this exact Host/Receiver result through the real
    // MemoryDispatchGateway and a deterministic fake model transport. Core and
    // Provider evidence readers are the production observer-only adapter;
    // Host lifecycle and Root Inventory evidence remain fixture-backed here.
    const dispatchEvidence = { core: [], provider: [], host: [] };
    gateway = new MemoryDispatchGateway({
      ledgerPath: join(directory, 'dispatch-ledger.sqlite'),
      coordinatorPath,
      authorityPort,
      readToken: ACCEPTED_READ_TOKEN,
      readCoreEvidence: input => {
        const evidence = observerAdapter.readCoreEvidenceSync(input);
        dispatchEvidence.core.push(evidence);
        return evidence;
      },
      readProviderEvidence: input => {
        const evidence = observerAdapter.readProviderEvidenceSync(input);
        assert.ok(Array.isArray(evidence.sources));
        for (const source of evidence.sources) {
          assert.deepEqual(Object.keys(source).sort(),
            ['source_entity_id', 'source_kind', 'source_version'],
            'Provider dispatch sources must use the Gateway canonical source_entity_id contract');
        }
        dispatchEvidence.provider.push(evidence);
        return evidence;
      },
      readHostEvidence: ({ hostContext: binding, worldId: evidenceWorldId, actorId: evidenceActorId }) => {
        const evidence = !binding || binding.adapter_id !== ADAPTER_ID
          || binding.world_id !== evidenceWorldId || binding.actor_id !== evidenceActorId
          || typeof binding.root_id !== 'string'
          || !Number.isSafeInteger(binding.root_inventory_sequence)
          || typeof binding.root_manifest_sha256 !== 'string'
          ? Object.freeze({ status: 'NON_READY' })
          : Object.freeze({
            status: 'READY',
            adapter_id: binding.adapter_id,
            core_conversation_id: binding.core_conversation_id,
            world_id: evidenceWorldId,
            actor_id: evidenceActorId,
            root_id: binding.root_id,
            root_inventory_sequence: binding.root_inventory_sequence,
            root_manifest_sha256: binding.root_manifest_sha256,
          });
        dispatchEvidence.host.push(evidence);
        return evidence;
      },
    });

    finalSendAdapter = createSillyTavernFinalSendAdapter({
      gateway,
      requireProtectedMemory: true,
      resolveProtectedMemory: () => result,
      chatCompletionSources: CHAT_COMPLETION_SOURCES,
      prepareHostContext: async hostRequest => {
        let preparation = hostPreparationByRequest.get(hostRequest);
        if (!preparation) {
          const host = await hostAdapter.prepareGenerationContext(hostRequest, 'chat-completions');
          if (host?.status !== 'READY') return host;
          preparation = {
            host,
            coreConversationId: hostAdapter.resolveCoreConversationId(hostRequest),
          };
          hostPreparationByRequest.set(hostRequest, preparation);
        }
        if (typeof preparation.coreConversationId !== 'string' || !preparation.coreConversationId) {
          return { status: 'NON_READY', code: 'HOST_CORE_CONVERSATION_UNAVAILABLE' };
        }
        return {
          status: 'READY',
          coreConversationId: preparation.coreConversationId,
          host: { context: preparation.host.context },
          coreContext: {
            adapter_id: result.hostContext.adapter_id,
            conversation_id: result.hostContext.core_conversation_id,
            actor_type: result.hostContext.actor_type,
          },
        };
      },
      runWithAuthenticatedHostSession: (hostRequest, conversationId, callback) =>
        providerAdapter.runWithAuthenticatedHostSession(hostRequest, conversationId, callback),
      nativeForwardFetchResponse: async () => {},
    });
    const finalResponse = responseRecorder();
    await finalSendAdapter.prepare(request, finalResponse);
    const upstreamCalls = [];
    const dispatchArgs = {
      request,
      response: finalResponse,
      senderRoute: 'custom',
      endpointUrl: 'http://127.0.0.1:1/fake-model',
      requestInit: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Final-Send accepts only the serialized role-bearing messages[]
        // contract and rejects flattened/non-message payloads.
        body: JSON.stringify({
          model: 'acceptance-fake-provider',
          messages: [{ role: 'user', content: 'Generate a response using relevant memories.' }],
        }),
      },
      stream: false,
      transport: async (url, init) => {
        upstreamCalls.push({ url, body: init.body });
        return { status: 200, body: 'fake-model-accepted' };
      },
    };
    let finalResponseValue;
    try {
      finalResponseValue = await finalSendAdapter.dispatch(dispatchArgs);
    } catch (error) {
      const causes = [];
      let current = error;
      for (let depth = 0; current && depth < 5; depth += 1, current = current.cause) {
        causes.push(current.message || String(current));
      }
      throw new Error('Integrated protected dispatch failed: ' + causes.join(' <- ')
        + ' | evidence=' + JSON.stringify(dispatchEvidence), { cause: error });
    }
    assert.equal(finalResponseValue.status, 200);
    assert.equal(upstreamCalls.length, 1, 'the real Gateway must invoke the fake model transport exactly once');
    assert.ok(upstreamCalls[0].body.includes(canary),
      'the exact Receiver-approved canary must survive serialization to the model boundary');
    assert.equal(upstreamCalls[0].body.includes(hostIdentity.host_installation_id), false,
      'Host identity locators must not be serialized to the model');

    const gatewayRow = gateway.db.prepare(
      'SELECT status,run_id,generation_id,context_digest,core_envelope_digest FROM dispatch_ledger WHERE request_id=?',
    ).get(result.requestId);
    assert.equal(gatewayRow.status, 'DISPATCH_STARTED');
    assert.equal(gatewayRow.run_id, result.runId);
    assert.equal(gatewayRow.generation_id, result.generationId);
    assert.equal(gatewayRow.context_digest, result.contextDigest);
    assert.equal(gatewayRow.core_envelope_digest, result.coreEnvelopeDigest);

    assert.equal(
      await finalSendAdapter.authorizeResponseWrite(finalResponse, () => 'released-model-response', true),
      'released-model-response',
    );
    assert.equal(
      gateway.db.prepare('SELECT status FROM dispatch_ledger WHERE request_id=?').get(result.requestId)?.status,
      'COMPLETED',
      'the same protected dispatch must reach terminal completion after response revalidation',
    );

    await assert.rejects(
      Promise.resolve().then(() => finalSendAdapter.dispatch({
        ...dispatchArgs,
        transport: async () => {
          upstreamCalls.push({ url: 'duplicate', body: '' });
          return { status: 200 };
        },
      })),
      /MEMORY_DISPATCH_DUPLICATE_HOST_SEND/,
    );
    assert.equal(upstreamCalls.length, 1,
      'a replayed Host response must not produce a second model transport call');

    // A Provider revoke after one successful dispatch must invalidate the
    // previously received candidate cursor before any subsequent model egress.
    providerAdapter.provider.revokeRecord(scope, record.record_ref, record.record_version);
    const revokedRequest = { ...request, body: structuredClone(request.body) };
    const revokedResponse = responseRecorder();
    await finalSendAdapter.prepare(revokedRequest, revokedResponse);
    const revokedTransportCalls = [];
    await assert.rejects(
      finalSendAdapter.dispatch({
        ...dispatchArgs,
        request: revokedRequest,
        response: revokedResponse,
        transport: async (url, init) => {
          revokedTransportCalls.push({ url, body: init.body });
          return { status: 200, body: 'must-not-run' };
        },
      }),
      error => {
        const causes = [];
        let current = error;
        for (let depth = 0; current && depth < 5; depth += 1, current = current.cause) {
          causes.push(current.message || String(current));
        }
        assert.ok(causes.includes('PROVIDER_DISPATCH_EVIDENCE_CHANGED'), causes.join(' <- '));
        return true;
      },
    );
    assert.equal(revokedTransportCalls.length, 0,
      'Provider revocation after retrieval must block the next model transport invocation');
  } finally {
    if (server?.listening) await new Promise(resolveClose => server.close(resolveClose));
    try { finalSendAdapter?.close?.(); } catch {}
    try { gateway?.close(); } catch {}
    try { observerAdapter?.close(); } catch {}
    try { nonceStore?.close(); } catch {}
    try { providerAdapter?.close(); } catch {}
    try { store?.close(); } catch {}
    if (authorityProcess?.child.exitCode === null && authorityProcess?.child.signalCode === null) {
      authorityProcess.child.stdin.end('stop');
      await once(authorityProcess.child, 'exit');
    }
    if (previousCoordinator === undefined) delete process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH;
    else process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH = previousCoordinator;
    if (previousDataRoot === undefined) delete globalThis.DATA_ROOT;
    else globalThis.DATA_ROOT = previousDataRoot;
    for (const key of ACCEPTED_HEAD_ENV_KEYS) {
      const value = previousAcceptedHeadEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
