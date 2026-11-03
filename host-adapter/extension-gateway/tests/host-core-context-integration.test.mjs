import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative as pathRelative } from 'node:path';
import { createHmac } from 'node:crypto';

import { SQLiteStore } from '../../../src/storage/sqlite-store.js';
import { LogicEngine } from '../../../src/application/engine.js';
import { createApiServer } from '../../../src/api/server.js';
import { getAuthenticatedHostSessionContext } from '../../../src/application/host-session-context.js';
import { HostAssertionNonceStore } from '../../../src/application/host-assertion-nonce-store.js';
import { createSillyTavernHostAdapter } from '../server-plugin/host-adapter.mjs';
import { CORE_ATTESTED_SOURCE_BLOCKERS } from '../server-plugin/st-host-inventory-handler.mjs';
import { PINNED_PATCH_BUNDLE_SHA256, PINNED_HOST_HANDLER_GIT_BLOB_SHA } from '../server-plugin/st-source-attestation.mjs';

const API_TOKEN = 'core-api-token-long-enough-123456';
const ADMIN_TOKEN = 'core-admin-token-long-enough-123456';
const ADAPTER_TOKEN = 'host-adapter-token-long-enough-123456';
const ADAPTER_ID = 'st-host-adapter';
const PINNED_HOST_COMMIT = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';
const UUID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_HANDLE = 'default-user';
const TEST_SOURCE_MANIFEST_SHA = 'f'.repeat(64);
const TEST_SNAPSHOT_ID = '{57115DD3-F8D9-4CA2-84C2-4076FBB7D962}';

function responseRecorder() {
  return {
    statusCode: null,
    payload: null,
    headers: {},
    set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    sendStatus(code) { this.statusCode = code; return this; },
  };
}

async function post(url, headers, body) {
  return fetch(url, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('Host Adapter requires Core root proof before context resolution and binds authenticated ST identity', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'host-core-context-e2e-'));
  const globalDataRoot = join(directory, 'st-data');
  const root = join(globalDataRoot, 'default-user');
  const previousDataRoot = globalThis.DATA_ROOT;
  globalThis.DATA_ROOT = pathRelative(process.cwd(), globalDataRoot);
  const chats = join(root, 'chats');
  const groups = join(root, 'groups');
  const groupChats = join(root, 'groupChats');
  const extensions = join(root, 'extensions');
  const identityDirectory = join(directory, 'host-identity');
  await Promise.all([mkdir(chats, { recursive: true }), mkdir(groups, { recursive: true }), mkdir(groupChats, { recursive: true }), mkdir(extensions, { recursive: true })]);
  const corePath = join(directory, 'core.sqlite');
  const coordinatorPath = join(directory, 'coordinator.sqlite');
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  const nonceStore = new HostAssertionNonceStore({
    path: join(directory, 'host-assertion-nonces.sqlite'),
    coreDatabasePath: corePath,
    coordinatorPath,
  });
  const retrievalContexts = [];
  const memoryConsumer = {
    adapterId: ADAPTER_ID,
    async retrieveForNpc({ conversationId }) {
      const context = getAuthenticatedHostSessionContext();
      assert.equal(context.conversation_id, conversationId);
      assert.equal(context.world_id, 'host-e2e-world');
      assert.equal(context.actor_id, 'host-e2e-actor');
      retrievalContexts.push({ ...context });
      return {
        status: 'ready', admitted: [], candidates: [], reason: null,
        snapshot: { world_revision: 1, commit_sequence: retrievalContexts.length },
      };
    },
  };
  engine.createWorld({
    world_id: 'host-e2e-world',
    world_pack_id: 'test.host-e2e',
    world_pack_version: '1',
    game_time: '2026-01-01T00:00:00Z',
  });
  engine.commitEvent('host-e2e-world', {
    idempotency_key: 'host-e2e-seed-actor',
    turn_id: 'host-e2e-seed-actor',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [{ kind: 'entity.create', entity_id: 'host-e2e-actor', entity_type: 'character' }],
  });
  const resolveHostMemoryIdentity = input => ({
    authorized: true,
    adapter_id: ADAPTER_ID,
    host_installation_id: input.host_installation_id,
    authenticated_account_id: input.authenticated_account_id,
    host_session_id: input.host_session_id,
    conversation_uuid: input.conversation_uuid,
    root_id: 'a'.repeat(64),
    authority_id: 'host-e2e-authority',
    authority_status: 'AUTHORITATIVE_COMPLETE',
    generation: 1,
    snapshot_fingerprint: 'b'.repeat(64),
  });

  const core = createApiServer({
    engine,
    token: API_TOKEN,
    adminToken: ADMIN_TOKEN,
    adapterTokens: { [ADAPTER_ID]: ADAPTER_TOKEN },
    memoryNpcConsumers: { [ADAPTER_ID]: memoryConsumer },
    hostAssertionNonceStore: nonceStore,
    resolveHostMemoryIdentity,
  });
  core.listen(0, '127.0.0.1');
  await once(core, 'listening');
  t.after(async () => {
    await new Promise(resolve => core.close(resolve));
    nonceStore.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
    if (previousDataRoot === undefined) delete globalThis.DATA_ROOT;
    else globalThis.DATA_ROOT = previousDataRoot;
  });
  const coreUrl = 'http://127.0.0.1:' + core.address().port;
  const coreHeaders = { authorization: 'Bearer ' + API_TOKEN };
  const adminHeaders = { ...coreHeaders, 'x-admin-token': ADMIN_TOKEN };

  const actorBinding = await post(coreUrl + '/v1/worlds/host-e2e-world/actor-bindings', adminHeaders, {
    adapter_id: ADAPTER_ID,
    entity_id: 'host-e2e-actor',
  });
  assert.equal(actorBinding.status, 201);

  const coreCalls = [];
  const resolvedCoreContexts = [];
  let dispatchFaultMode = null;
  let capturedDispatchBody = null;
  let capturedSuccessfulDispatchBody = null;
  const fetchImpl = async (url, options) => {
    const parsedUrl = new URL(url);
    let outgoingOptions = options;
    if (parsedUrl.pathname === '/v1/host/memory-npc/retrieve' && options?.body) {
      const outgoingBody = JSON.parse(options.body);
      capturedDispatchBody = outgoingBody;
      if (dispatchFaultMode === null) capturedSuccessfulDispatchBody = outgoingBody;
      if (dispatchFaultMode === 'invalid-signature') {
        outgoingBody.signature = (outgoingBody.signature[0] === '0' ? '1' : '0')
          + outgoingBody.signature.slice(1);
      } else if (dispatchFaultMode === 'expired-timestamp') {
        outgoingBody.assertion.issued_at = Math.floor(Date.now() / 1000) - 3600;
        const assertion = outgoingBody.assertion;
        const canonicalAssertion = JSON.stringify([
          assertion.protocol_version, assertion.host_installation_id, assertion.authenticated_account_id,
          assertion.host_session_id, assertion.conversation_id, assertion.world_id, assertion.actor_id,
          assertion.issued_at, assertion.nonce,
        ]);
        outgoingBody.signature = createHmac('sha256', ADAPTER_TOKEN)
          .update(canonicalAssertion, 'utf8').digest('hex');
      }
      outgoingOptions = { ...options, body: JSON.stringify(outgoingBody) };
    }
    const response = await fetch(url, outgoingOptions);
    coreCalls.push(parsedUrl.pathname);
    if (parsedUrl.pathname === '/v1/host-context/resolve') {
      resolvedCoreContexts.push(await response.clone().json());
    }
    return response;
  };
  const env = {
    LOGIC_ENGINE_HOST_IDENTITY_DIR: identityDirectory,
    LOGIC_ENGINE_HOST_BUILD_SHA: PINNED_HOST_COMMIT,
    LOGIC_ENGINE_CORE_URL: coreUrl,
    LOGIC_ENGINE_API_TOKEN: API_TOKEN,
    LOGIC_ENGINE_ADAPTER_ID: ADAPTER_ID,
    LOGIC_ENGINE_ADAPTER_TOKEN: ADAPTER_TOKEN,
  };
  const rootEntries = [{
    path: 'chats/chat-one.jsonl',
    identity: { dev: '1', ino: '1', mode: 33188, size: 0, mtimeMs: 0, ctimeMs: 0 },
    sha256: 'b'.repeat(64),
  }];
  const relativeDirectories = {
    root: pathRelative(process.cwd(), root),
    chats: pathRelative(process.cwd(), chats),
    groups: pathRelative(process.cwd(), groups),
    groupChats: pathRelative(process.cwd(), groupChats),
    extensions: pathRelative(process.cwd(), extensions),
  };
  const authoritativeFixture = async ({ directories }) => {
    assert.deepEqual(directories, { root, chats, groups, groupChats, extensions });
    return {
      filesystem: {
        status: 'complete',
        entries: rootEntries,
        snapshot_sha256: 'b'.repeat(64),
        snapshot_id: TEST_SNAPSHOT_ID,
        snapshot_provider: 'windows-vss-client-accessible',
        snapshot_consistency: 'VSS_POINT_IN_TIME_READ_ONLY',
        reparse_points: 'ALL_FILE_ATTRIBUTE_REPARSE_POINT_ENTRIES_REJECTED',
      },
      source: {
        status: 'DOUBLE_SCAN_CANDIDATE',
        authority: 'NON_AUTHORITATIVE',
        host_commit: PINNED_HOST_COMMIT,
        scope: 'PINNED_SILLYTAVERN_CHAT_DATA_ROOTS',
        historical_boundary: 'CURRENT_FILE_SET_ONLY_ENROLLMENT_BASELINE_REQUIRED',
        logical_identity_status: 'CURRENT_FILE_IDENTITIES_VERIFIED',
        snapshot_id: TEST_SNAPSHOT_ID,
        snapshot_provider: 'windows-vss-client-accessible',
        snapshot_consistency: 'VSS_POINT_IN_TIME_READ_ONLY',
        blockers: [...CORE_ATTESTED_SOURCE_BLOCKERS],
        files: [{ logical_identity: {
          conversation_uuid: UUID,
          identity_status: 'CURRENT_IDENTITIES_VERIFIED',
        } }],
      },
      mutation_coverage: {
        status: 'VERIFIED',
        source_commit: PINNED_HOST_COMMIT,
        coverage_manifest_sha256: 'a'.repeat(64),
        route_count: 47,
        source_files_sha256: 'b'.repeat(64),
      },
      snapshot_alignment: 'SHARED_VSS_SNAPSHOT',
    };
  };
  const testSourceIdentity = async () => ({
    status: 'CURRENT_IDENTITIES_VERIFIED',
    manifest_sha256: TEST_SOURCE_MANIFEST_SHA,
    patch_blob_sha: PINNED_PATCH_BUNDLE_SHA256,
    host_handler_blob_sha: PINNED_HOST_HANDLER_GIT_BLOB_SHA,
  });
  // This proof stub is test-only. Production uses the signed Core root-inventory
  // response; a local candidate scan without that proof must remain NON_READY.
  let includeLifecycleProof = true;
  const testOnlyAuthoritativeRootProof = async ({
    userHandle, rootPath, entries, snapshotAlignment, snapshotSha256, sourceIdentity,
  }) => {
    assert.equal(typeof userHandle, 'string');
    assert.equal(rootPath, root);
    assert.deepEqual(entries, rootEntries);
    assert.equal(snapshotAlignment, 'SHARED_VSS_SNAPSHOT');
    assert.equal(snapshotSha256, 'b'.repeat(64));
    assert.equal(sourceIdentity.status, 'CURRENT_IDENTITIES_VERIFIED');
    assert.equal(sourceIdentity.manifest_sha256, TEST_SOURCE_MANIFEST_SHA);
    return {
      status: 'AUTHORITATIVE_COMPLETE',
      integrity_status: 'INTEGRITY_OK',
      sequence: 1,
      manifest_sha256: 'c'.repeat(64),
      source_manifest_sha256: TEST_SOURCE_MANIFEST_SHA,
      attestation_sha256: 'd'.repeat(64),
      ...(includeLifecycleProof ? {
        lifecycle_sequence: 1,
        lifecycle_head_sha256: 'e'.repeat(64),
      } : {}),
    };
  };
  const adapter = createSillyTavernHostAdapter({
    env,
    enumerate: authoritativeFixture,
    fetchImpl,
    persistRootInventory: testOnlyAuthoritativeRootProof,
    verifySourceIdentity: testSourceIdentity,
  });

  const request = {
    user: {
      profile: { handle: ACCOUNT_HANDLE },
      directories: relativeDirectories,
    },
    // ST default-user mode: session.handle is intentionally absent.
    session: {},
    body: {
      conversation_uuid: UUID,
      request_id: '44444444-4444-4444-8444-444444444444',
      context_size: 4096,
      generation_type: 'normal',
    },
  };
  const productionCoreCalls = [];
  const productionAdapter = createSillyTavernHostAdapter({
    env,
    enumerate: authoritativeFixture,
    // This negative case deliberately supplies an unverified installed manifest.
    verifySourceIdentity: async () => ({ status: 'SOURCE_IDENTITY_UNVERIFIED' }),
    fetchImpl: async (url, options) => {
      const response = await fetch(url, options);
      productionCoreCalls.push(new URL(url).pathname);
      return response;
    },
  });
  const productionRequest = {
    user: request.user,
    session: {},
    body: { ...request.body, request_id: '77777777-7777-4777-8777-777777777777' },
  };
  const productionSessionResponse = responseRecorder();
  productionAdapter.session(productionRequest, productionSessionResponse);
  assert.equal(productionSessionResponse.statusCode, 200);
  const productionIdentityResponse = responseRecorder();
  await productionAdapter.identity(productionRequest, productionIdentityResponse);
  assert.equal(productionIdentityResponse.statusCode, 200);
  const productionGateResponse = responseRecorder();
  let productionPassedGate = false;
  await productionAdapter.dispatchMiddleware(productionRequest, productionGateResponse, () => { productionPassedGate = true; });
  assert.equal(productionPassedGate, false);
  assert.equal(productionGateResponse.statusCode, 503);
  assert.equal(productionGateResponse.payload.code, 'HOST_CONTEXT_UNAVAILABLE');
  assert.equal(productionCoreCalls.includes('/v1/host-root-inventory/attest'), false,
    'an unverified installed source manifest must never create a Core completeness attestation');
  assert.equal(productionCoreCalls.includes('/v1/host-context/resolve'), false);

  const sessionResponse = responseRecorder();
  adapter.session(request, sessionResponse);
  assert.equal(sessionResponse.statusCode, 200);
  assert.equal(sessionResponse.payload.host_session_identity, 'SIGNED_AUTHENTICATED_ST_SESSION');
  const identityResponse = responseRecorder();
  await adapter.identity(request, identityResponse);
  assert.equal(identityResponse.statusCode, 200);
  assert.equal(identityResponse.payload.identity_source, 'SERVER_PERSISTED_OPAQUE_IDENTITY');

  const conversationId = sessionResponse.payload.host_session_id + ':'
    + identityResponse.payload.host_installation_id + ':' + UUID;
  const worldBinding = await post(coreUrl + '/v1/host-conversation-bindings', adminHeaders, {
    adapter_id: ADAPTER_ID,
    conversation_id: conversationId,
    world_id: 'host-e2e-world',
  });
  assert.equal(worldBinding.status, 201);

  includeLifecycleProof = false;
  const incompleteLifecycleGate = responseRecorder();
  let incompleteLifecyclePassed = false;
  await adapter.dispatchMiddleware(request, incompleteLifecycleGate, () => { incompleteLifecyclePassed = true; });
  assert.equal(incompleteLifecyclePassed, false);
  assert.equal(incompleteLifecycleGate.statusCode, 503);
  assert.equal(incompleteLifecycleGate.payload.code, 'HOST_INVENTORY_NOT_AUTHORITATIVE');
  assert.equal(coreCalls.includes('/v1/host-context/resolve'), false);
  includeLifecycleProof = true;

  const gateResponse = responseRecorder();
  let passedGate = false;
  await adapter.dispatchMiddleware(request, gateResponse, () => { passedGate = true; });
  assert.equal(passedGate, true, JSON.stringify(gateResponse.payload));
  const dispatchResponse = responseRecorder();
  await adapter.dispatch(request, dispatchResponse);
  assert.equal(coreCalls[0], '/v1/host-context/resolve');
  assert.equal(resolvedCoreContexts[0].context.adapter_id, ADAPTER_ID);
  assert.equal(resolvedCoreContexts[0].context.world_id, 'host-e2e-world');
  assert.equal(resolvedCoreContexts[0].context.actor_id, 'host-e2e-actor');
  const stableConversationId = sessionResponse.payload.host_session_id
    + ':' + identityResponse.payload.host_installation_id + ':' + UUID;
  assert.equal(resolvedCoreContexts[0].context.conversation_id, stableConversationId);
  assert.equal(dispatchResponse.statusCode, 200);
  assert.equal(dispatchResponse.payload.retrieval.status, 'ready');
  assert.equal(coreCalls[1], '/v1/host/memory-npc/retrieve');
  assert.equal(retrievalContexts[0].conversation_id, stableConversationId);
  assert.equal(retrievalContexts[0].host_installation_id, identityResponse.payload.host_installation_id);
  assert.equal(retrievalContexts[0].authenticated_account_id, identityResponse.payload.authenticated_account_id);
  // Negative assertions travel through the same Host Adapter → Core HTTP path.
  dispatchFaultMode = 'invalid-signature';
  const invalidSignatureResponse = responseRecorder();
  await adapter.dispatch(request, invalidSignatureResponse);
  assert.equal(invalidSignatureResponse.statusCode, 502);
  assert.equal(invalidSignatureResponse.payload.code, 'CORE_HOST_DISPATCH_REJECTED');
  dispatchFaultMode = null;

  dispatchFaultMode = 'expired-timestamp';
  const expiredTimestampResponse = responseRecorder();
  await adapter.dispatch(request, expiredTimestampResponse);
  assert.equal(expiredTimestampResponse.statusCode, 502);
  assert.equal(expiredTimestampResponse.payload.code, 'CORE_HOST_DISPATCH_REJECTED');
  dispatchFaultMode = null;

  // Re-submit the exact assertion accepted by the successful Host dispatch.
  // Core's durable nonce ledger must reject it before invoking the Consumer.
  assert.ok(capturedSuccessfulDispatchBody);
  const replayResponse = await post(
    coreUrl + '/v1/host/memory-npc/retrieve',
    { ...coreHeaders, 'x-adapter-id': ADAPTER_ID, 'x-adapter-token': ADAPTER_TOKEN },
    capturedSuccessfulDispatchBody,
  );
  assert.equal(replayResponse.status, 409);
  assert.equal((await replayResponse.json()).error.code, 'HOST_SESSION_ASSERTION_REPLAYED');
  assert.equal(retrievalContexts.length, 1);


  // Accounts-enabled mode: ST supplies session.handle and it must bind to the
  // middleware-authenticated profile handle, while the account ID remains
  // distinct from default-user and installation identity remains shared.
  const accountsEnabledRequest = {
    user: {
      profile: { handle: 'alice' },
      directories: request.user.directories,
    },
    session: { handle: 'alice' },
    body: {
      conversation_uuid: UUID,
      request_id: '66666666-6666-4666-8666-666666666666',
      context_size: 4096,
      generation_type: 'normal',
    },
  };
  const accountsSessionResponse = responseRecorder();
  adapter.session(accountsEnabledRequest, accountsSessionResponse);
  assert.equal(accountsSessionResponse.statusCode, 200);
  const accountsIdentityResponse = responseRecorder();
  await adapter.identity(accountsEnabledRequest, accountsIdentityResponse);
  assert.equal(accountsIdentityResponse.statusCode, 200);
  assert.equal(accountsIdentityResponse.payload.host_installation_id, identityResponse.payload.host_installation_id);
  assert.notEqual(accountsIdentityResponse.payload.authenticated_account_id, identityResponse.payload.authenticated_account_id);
  const accountsConversationId = accountsSessionResponse.payload.host_session_id + ':'
    + accountsIdentityResponse.payload.host_installation_id + ':' + UUID;
  const accountsWorldBinding = await post(coreUrl + '/v1/host-conversation-bindings', adminHeaders, {
    adapter_id: ADAPTER_ID,
    conversation_id: accountsConversationId,
    world_id: 'host-e2e-world',
  });
  assert.equal(accountsWorldBinding.status, 201);
  const accountsGateResponse = responseRecorder();
  let accountsPassedGate = false;
  await adapter.dispatchMiddleware(accountsEnabledRequest, accountsGateResponse, () => { accountsPassedGate = true; });
  assert.equal(accountsPassedGate, true);
  const accountsDispatchResponse = responseRecorder();
  await adapter.dispatch(accountsEnabledRequest, accountsDispatchResponse);
  assert.equal(accountsDispatchResponse.statusCode, 200);
  assert.equal(accountsDispatchResponse.payload.retrieval.status, 'ready');
  assert.equal(retrievalContexts[1].conversation_id, accountsConversationId);
  assert.equal(retrievalContexts[1].authenticated_account_id, accountsIdentityResponse.payload.authenticated_account_id);
  assert.equal(coreCalls[6], '/v1/host-context/resolve');
  assert.equal(coreCalls[7], '/v1/host/memory-npc/retrieve');
  assert.equal(resolvedCoreContexts[3].context.conversation_id, accountsConversationId);
  assert.equal(resolvedCoreContexts[3].context.world_id, 'host-e2e-world');
  assert.equal(resolvedCoreContexts[3].context.actor_id, 'host-e2e-actor');

  // Recreate the Host Adapter against the same server-owned identity directory.
  // Installation/account identity must survive; the transient ST session rotates.
  const restartedAdapter = createSillyTavernHostAdapter({
    env,
    enumerate: authoritativeFixture,
    fetchImpl,
    persistRootInventory: testOnlyAuthoritativeRootProof,
    verifySourceIdentity: testSourceIdentity,
  });
  const restartedRequest = {
    user: request.user,
    session: {},
    body: {
      conversation_uuid: UUID,
      request_id: '55555555-5555-4555-8555-555555555555',
      context_size: 4096,
      generation_type: 'normal',
    },
  };
  const restartedSessionResponse = responseRecorder();
  restartedAdapter.session(restartedRequest, restartedSessionResponse);
  assert.equal(restartedSessionResponse.statusCode, 200);
  assert.notEqual(restartedSessionResponse.payload.host_session_id, sessionResponse.payload.host_session_id);
  const restartedIdentityResponse = responseRecorder();
  await restartedAdapter.identity(restartedRequest, restartedIdentityResponse);
  assert.equal(restartedIdentityResponse.payload.host_installation_id, identityResponse.payload.host_installation_id);
  assert.equal(restartedIdentityResponse.payload.authenticated_account_id, identityResponse.payload.authenticated_account_id);
  const restartedConversationId = restartedSessionResponse.payload.host_session_id + ':'
    + restartedIdentityResponse.payload.host_installation_id + ':' + UUID;
  const restartedWorldBinding = await post(coreUrl + '/v1/host-conversation-bindings', adminHeaders, {
    adapter_id: ADAPTER_ID,
    conversation_id: restartedConversationId,
    world_id: 'host-e2e-world',
  });
  assert.equal(restartedWorldBinding.status, 201);
  const restartedGateResponse = responseRecorder();
  let restartedPassedGate = false;
  await restartedAdapter.dispatchMiddleware(restartedRequest, restartedGateResponse, () => { restartedPassedGate = true; });
  assert.equal(restartedPassedGate, true);
  const restartedDispatchResponse = responseRecorder();
  await restartedAdapter.dispatch(restartedRequest, restartedDispatchResponse);
  assert.equal(restartedDispatchResponse.statusCode, 200);
  assert.equal(restartedDispatchResponse.payload.retrieval.status, 'ready');
  assert.equal(retrievalContexts[2].conversation_id, restartedConversationId);
  assert.equal(retrievalContexts[2].host_installation_id, restartedIdentityResponse.payload.host_installation_id);
  assert.equal(retrievalContexts[2].authenticated_account_id, restartedIdentityResponse.payload.authenticated_account_id);
  assert.notEqual(retrievalContexts[2].host_session_id, retrievalContexts[0].host_session_id);
  assert.equal(coreCalls[8], '/v1/host-context/resolve');
  assert.equal(coreCalls[9], '/v1/host/memory-npc/retrieve');
  assert.equal(resolvedCoreContexts.length, 5);
  assert.equal(resolvedCoreContexts[4].context.conversation_id, restartedConversationId);
  assert.equal(resolvedCoreContexts[4].context.world_id, 'host-e2e-world');
  assert.equal(resolvedCoreContexts[4].context.actor_id, 'host-e2e-actor');
  // The integrated Final-Send path authenticates the actual native Express
  // generation request and retrieves the Core envelope without a browser
  // /dispatch request or a second request identity.
  const nativeGenerationRequest = {
    user: request.user,
    session: request.session,
    body: {
      logic_engine_conversation_uuid: UUID,
      logic_engine_request_id: '88888888-8888-4888-8888-888888888888',
      logic_engine_context_size: 4096,
      logic_engine_generation_type: 'normal',
    },
  };
  const preparedGeneration = await adapter.prepareGenerationContext(nativeGenerationRequest, 'chat-completions');
  assert.equal(preparedGeneration.status, 'READY');
  assert.equal(preparedGeneration.context.conversation_uuid, UUID);
  assert.equal(preparedGeneration.context.root_inventory_sequence, 1);
  assert.equal(preparedGeneration.coreContext.world_id, 'host-e2e-world');
  assert.equal(preparedGeneration.coreContext.actor_id, 'host-e2e-actor');
  assert.equal(preparedGeneration.retrieval.status, 'ready');
  assert.equal(preparedGeneration.requestId, '88888888-8888-4888-8888-888888888888');
  assert.equal(resolvedCoreContexts[5].context.conversation_id, stableConversationId);


  // The production scanner currently emits DOUBLE_SCAN_CANDIDATE. Prove that
  // such a candidate cannot reach Core, even when the same server credentials exist.
  let deniedCoreCalls = 0;
  const nonAuthoritativeAdapter = createSillyTavernHostAdapter({
    env,
    enumerate: async () => ({
      filesystem: { status: 'complete' },
      source: { status: 'DOUBLE_SCAN_CANDIDATE', files: [{ logical_identity: { conversation_uuid: UUID } }] },
      authority: { status: 'NON_AUTHORITATIVE', manifest_sha256: 'b'.repeat(64) },
    }),
    fetchImpl: async (...args) => { deniedCoreCalls++; return fetch(...args); },
  });
  const deniedRequest = {
    ...request,
    session: { ...request.session },
    body: { ...request.body },
  };
  const deniedSessionResponse = responseRecorder();
  nonAuthoritativeAdapter.session(deniedRequest, deniedSessionResponse);
  const deniedGateResponse = responseRecorder();
  let deniedPassed = false;
  await nonAuthoritativeAdapter.dispatchMiddleware(deniedRequest, deniedGateResponse, () => { deniedPassed = true; });
  assert.equal(deniedPassed, false);
  assert.equal(deniedGateResponse.statusCode, 503);
  assert.equal(deniedGateResponse.payload.code, 'HOST_INVENTORY_NOT_AUTHORITATIVE');
  assert.equal(deniedCoreCalls, 0);

  // Exercise the actual adapter session-rotation path against Core. The old
  // assertion is captured before rotation and must be rejected afterwards.
  const rotationGateResponse = responseRecorder();
  let rotationPassedGate = false;
  await adapter.dispatchMiddleware(request, rotationGateResponse, () => { rotationPassedGate = true; });
  assert.equal(rotationPassedGate, true);
  const rotationDispatchResponse = responseRecorder();
  await adapter.dispatch(request, rotationDispatchResponse);
  assert.equal(rotationDispatchResponse.statusCode, 200);
  const assertionFromOldSession = structuredClone(capturedSuccessfulDispatchBody);
  assertionFromOldSession.assertion.nonce = '88888888-8888-4888-8888-888888888888';
  assertionFromOldSession.request_id = '99999999-9999-4999-8999-999999999999';
  const oldAssertion = assertionFromOldSession.assertion;
  const oldCanonical = JSON.stringify([
    oldAssertion.protocol_version, oldAssertion.host_installation_id,
    oldAssertion.authenticated_account_id, oldAssertion.host_session_id,
    oldAssertion.conversation_id, oldAssertion.world_id, oldAssertion.actor_id,
    oldAssertion.issued_at, oldAssertion.nonce,
  ]);
  assertionFromOldSession.signature = createHmac('sha256', ADAPTER_TOKEN)
    .update(oldCanonical, 'utf8').digest('hex');
  const oldSessionId = request.session.logicEngineSessionId;
  const oldAccountHandle = request.session.logicEngineSessionHandle;
  request.user.profile.handle = 'rotated-account';
  const rotationSessionResponse = responseRecorder();
  await adapter.session(request, rotationSessionResponse);
  assert.equal(rotationSessionResponse.statusCode, 200);
  assert.notEqual(rotationSessionResponse.payload.host_session_id, oldSessionId);
  assert.equal(request.session.logicEngineSessionHandle, 'rotated-account');
  assert.ok(coreCalls.includes('/v1/host/session/revoke'));
  assert.equal(oldAccountHandle, ACCOUNT_HANDLE);

  const oldSessionRead = await post(
    coreUrl + '/v1/host/memory-npc/retrieve',
    { ...coreHeaders, 'x-adapter-id': ADAPTER_ID, 'x-adapter-token': ADAPTER_TOKEN },
    assertionFromOldSession,
  );
  assert.equal(oldSessionRead.status, 401);
  assert.equal((await oldSessionRead.json()).error.code, 'HOST_SESSION_REVOKED');
  // Three lifecycle reads plus the native Final-Send preparation and the
  // subsequent rotation check; the revoked old assertion adds no retrieval.
  assert.equal(retrievalContexts.length, 5);

});
