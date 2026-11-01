import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative as pathRelative } from 'node:path';

import { SQLiteStore } from '../../../src/storage/sqlite-store.js';
import { LogicEngine } from '../../../src/application/engine.js';
import { createApiServer } from '../../../src/api/server.js';
import { getAuthenticatedHostSessionContext } from '../../../src/application/host-session-context.js';
import { HostAssertionNonceStore } from '../../../src/application/host-assertion-nonce-store.js';
import { createSillyTavernHostAdapter } from '../server-plugin/host-adapter.mjs';

const API_TOKEN = 'core-api-token-long-enough-123456';
const ADMIN_TOKEN = 'core-admin-token-long-enough-123456';
const ADAPTER_TOKEN = 'host-adapter-token-long-enough-123456';
const ADAPTER_ID = 'st-host-adapter';
const PINNED_HOST_COMMIT = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';
const UUID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_HANDLE = 'default-user';

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
  const identityDirectory = join(directory, 'host-identity');
  await Promise.all([mkdir(chats, { recursive: true }), mkdir(groups, { recursive: true }), mkdir(groupChats, { recursive: true })]);
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
  const core = createApiServer({
    engine,
    token: API_TOKEN,
    adminToken: ADMIN_TOKEN,
    adapterTokens: { [ADAPTER_ID]: ADAPTER_TOKEN },
    memoryNpcConsumers: { [ADAPTER_ID]: memoryConsumer },
    hostAssertionNonceStore: nonceStore,
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
  const fetchImpl = async (url, options) => {
    const response = await fetch(url, options);
    const parsedUrl = new URL(url);
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
  };
  const authoritativeFixture = async ({ directories }) => {
    assert.deepEqual(directories, { root, chats, groups, groupChats });
    return {
    filesystem: { status: 'complete', entries: rootEntries },
    source: {
      status: 'AUTHORITATIVE_COMPLETE',
      files: [{ logical_identity: { conversation_uuid: UUID } }],
    },
    authority: {
      status: 'AUTHORITATIVE_COMPLETE',
      manifest_sha256: 'a'.repeat(64),
    },
  };
  };
  // This proof stub is test-only. Production uses the Core root-inventory
  // response and must reject its current REVIEW_ONLY result.
  const testOnlyAuthoritativeRootProof = async ({ userHandle, rootPath, entries }) => {
    assert.equal(typeof userHandle, 'string');
    assert.equal(rootPath, root);
    assert.deepEqual(entries, rootEntries);
    return {
      status: 'AUTHORITATIVE_COMPLETE',
      integrity_status: 'INTEGRITY_OK',
      sequence: 1,
      manifest_sha256: 'c'.repeat(64),
    };
  };
  const adapter = createSillyTavernHostAdapter({
    env,
    enumerate: authoritativeFixture,
    fetchImpl,
    persistRootInventory: testOnlyAuthoritativeRootProof,
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
  assert.equal(productionGateResponse.payload.code, 'HOST_INVENTORY_NOT_AUTHORITATIVE');
  assert.ok(productionCoreCalls.some(path => path.startsWith('/v1/host-root-inventory/')));
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

  const gateResponse = responseRecorder();
  let passedGate = false;
  await adapter.dispatchMiddleware(request, gateResponse, () => { passedGate = true; });
  assert.equal(passedGate, true);
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
  assert.equal(coreCalls[2], '/v1/host-context/resolve');
  assert.equal(coreCalls[3], '/v1/host/memory-npc/retrieve');
  assert.equal(resolvedCoreContexts[1].context.conversation_id, accountsConversationId);
  assert.equal(resolvedCoreContexts[1].context.world_id, 'host-e2e-world');
  assert.equal(resolvedCoreContexts[1].context.actor_id, 'host-e2e-actor');

  // Recreate the Host Adapter against the same server-owned identity directory.
  // Installation/account identity must survive; the transient ST session rotates.
  const restartedAdapter = createSillyTavernHostAdapter({
    env,
    enumerate: authoritativeFixture,
    fetchImpl,
    persistRootInventory: testOnlyAuthoritativeRootProof,
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
  assert.equal(coreCalls[4], '/v1/host-context/resolve');
  assert.equal(coreCalls[5], '/v1/host/memory-npc/retrieve');
  assert.equal(resolvedCoreContexts.length, 3);
  assert.equal(resolvedCoreContexts[2].context.conversation_id, restartedConversationId);
  assert.equal(resolvedCoreContexts[2].context.world_id, 'host-e2e-world');
  assert.equal(resolvedCoreContexts[2].context.actor_id, 'host-e2e-actor');

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

});
