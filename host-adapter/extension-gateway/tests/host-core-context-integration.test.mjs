import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SQLiteStore } from '../../../src/storage/sqlite-store.js';
import { LogicEngine } from '../../../src/application/engine.js';
import { createApiServer } from '../../../src/api/server.js';
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

test('Host Adapter makes a real authenticated Core context-resolution call; incomplete inventory blocks before Core', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'host-core-context-e2e-'));
  const root = join(directory, 'st-user');
  const chats = join(root, 'chats');
  const groups = join(root, 'groups');
  const groupChats = join(root, 'groupChats');
  const identityDirectory = join(directory, 'host-identity');
  await Promise.all([mkdir(chats, { recursive: true }), mkdir(groups), mkdir(groupChats)]);
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
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
  });
  core.listen(0, '127.0.0.1');
  await once(core, 'listening');
  const coreUrl = 'http://127.0.0.1:' + core.address().port;
  const coreHeaders = { authorization: 'Bearer ' + API_TOKEN };
  const adminHeaders = { ...coreHeaders, 'x-admin-token': ADMIN_TOKEN };
  const adapterHeaders = {
    ...coreHeaders,
    'x-adapter-id': ADAPTER_ID,
    'x-adapter-token': ADAPTER_TOKEN,
  };

  const actorBinding = await post(coreUrl + '/v1/worlds/host-e2e-world/actor-bindings', adminHeaders, {
    adapter_id: ADAPTER_ID,
    entity_id: 'host-e2e-actor',
  });
  assert.equal(actorBinding.status, 201);

  const coreCalls = [];
  let resolvedCoreContext = null;
  const fetchImpl = async (url, options) => {
    const response = await fetch(url, options);
    const parsedUrl = new URL(url);
    coreCalls.push(parsedUrl.pathname);
    if (parsedUrl.pathname === '/v1/host-context/resolve') {
      resolvedCoreContext = await response.clone().json();
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
  const authoritativeFixture = async () => ({
    filesystem: { status: 'complete' },
    source: {
      status: 'AUTHORITATIVE_COMPLETE',
      files: [{ logical_identity: { conversation_uuid: UUID } }],
    },
    authority: {
      status: 'AUTHORITATIVE_COMPLETE',
      manifest_sha256: 'a'.repeat(64),
    },
  });
  const adapter = createSillyTavernHostAdapter({
    env,
    enumerate: authoritativeFixture,
    fetchImpl,
  });

  const request = {
    user: {
      profile: { handle: ACCOUNT_HANDLE },
      directories: { root, chats, groups, groupChats },
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
  const sessionResponse = responseRecorder();
  adapter.session(request, sessionResponse);
  assert.equal(sessionResponse.statusCode, 200);
  assert.equal(sessionResponse.payload.host_session_identity, 'SIGNED_AUTHENTICATED_ST_SESSION');
  const identityResponse = responseRecorder();
  await adapter.identity(request, identityResponse);
  assert.equal(identityResponse.statusCode, 200);
  assert.equal(identityResponse.payload.identity_source, 'SERVER_PERSISTED_OPAQUE_IDENTITY');

  const conversationId = identityResponse.payload.host_installation_id + ':'
    + identityResponse.payload.authenticated_account_id + ':' + UUID;
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
  assert.equal(resolvedCoreContext.context.adapter_id, ADAPTER_ID);
  assert.equal(resolvedCoreContext.context.world_id, 'host-e2e-world');
  assert.equal(resolvedCoreContext.context.actor_id, 'host-e2e-actor');
  assert.equal(resolvedCoreContext.context.conversation_id, identityResponse.payload.host_installation_id
    + ':' + identityResponse.payload.authenticated_account_id + ':' + UUID);
  assert.equal(dispatchResponse.statusCode, 503);
  assert.equal(dispatchResponse.payload.code, 'CORE_HOST_DISPATCH_ROUTE_UNAVAILABLE');
  assert.equal(coreCalls[1], '/v1/host/memory-npc/retrieve');

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
  assert.equal(deniedGateResponse.payload.code, 'HOST_CONTEXT_UNAVAILABLE');
  assert.equal(deniedCoreCalls, 0);

  t.after(async () => {
    await new Promise(resolve => core.close(resolve));
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
});
