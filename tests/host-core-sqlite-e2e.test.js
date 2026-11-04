import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { ActorBindingService } from '../src/application/actor-bindings.js';
import { HostConversationWorldBindingService } from '../src/application/host-conversation-world-bindings.js';
import { createMemoryNpcProviderAdapter } from '../src/application/memory-npc-provider-adapter.js';
import { HostAssertionNonceStore } from '../src/application/host-assertion-nonce-store.js';
import { createApiServer } from '../src/api/server.js';
import { createSillyTavernHostAdapter } from '../host-adapter/extension-gateway/server-plugin/host-adapter.mjs';
import { HostIdentityStore } from '../host-adapter/extension-gateway/server-plugin/st-host-identity-store.mjs';

const API_TOKEN = 'host-core-sqlite-api-token-long-enough';
const ADAPTER_TOKEN = 'host-core-sqlite-adapter-token-long-enough';
const ADAPTER_ID = 'st-host-sqlite-e2e';
const SESSION = '33333333-3333-4333-8333-333333333333';
const CONVERSATION = '44444444-4444-4444-8444-444444444444';
const REQUEST_ID = '55555555-5555-4555-8555-555555555555';
const SOURCE_MANIFEST_SHA256 = 'c'.repeat(64);

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

test('Host dispatch proxy retrieves a real SQLite Provider record through Core HTTP and MemoryNpcConsumer', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'host-core-sqlite-e2e-'));
  const corePath = join(directory, 'core.sqlite');
  const providerPath = join(directory, 'memory-provider.sqlite');
  const coordinatorPath = resolve(join(directory, 'coordinator.sqlite'));
  const previousCoordinator = process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH;
  const previousDataRoot = globalThis.DATA_ROOT;
  const dataRoot = join(directory, 'st-data');
  const identityDirectory = join(directory, 'host-identity');
  mkdirSync(dataRoot, { recursive: true });
  globalThis.DATA_ROOT = dataRoot;
  process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH = coordinatorPath;

  let store;
  let providerAdapter;
  let nonceStore;
  let server;
  try {
    const identityStore = new HostIdentityStore({ directory: identityDirectory });
    const hostIdentity = await identityStore.resolveAuthenticatedAccount('e2e-user');
    const conversationId = SESSION + ':' + hostIdentity.host_installation_id + ':' + CONVERSATION;
    const hostConversationKey = hostIdentity.host_installation_id + ':'
      + hostIdentity.authenticated_account_id + ':' + CONVERSATION;
    const directories = {
      root: join(dataRoot, 'default-user'),
      chats: join(dataRoot, 'default-user', 'chats'),
      groups: join(dataRoot, 'default-user', 'groups'),
      groupChats: join(dataRoot, 'default-user', 'groupChats'),
      extensions: join(dataRoot, 'default-user', 'extensions'),
    };
    for (const directoryPath of Object.values(directories)) mkdirSync(directoryPath, { recursive: true });
    store = new SQLiteStore(corePath);
    const engine = new LogicEngine(store);
    const worldId = 'host-core-sqlite-world';
    const actorId = 'host-core-sqlite-npc';
    const sourceId = 'host-core-sqlite-source';

    engine.createWorld({
      world_id: worldId,
      world_pack_id: 'test.host-core-sqlite-e2e',
      world_pack_version: '1',
      game_time: '2026-01-01T00:00:00Z',
    });
    engine.commitEvent(worldId, {
      idempotency_key: 'host-core-sqlite-seed',
      turn_id: 'host-core-sqlite-seed',
      event_type: 'action.completed',
      expected_revision: 0,
      effects: [
        { kind: 'entity.create', entity_id: actorId, entity_type: 'character', attributes: { name: 'NPC' } },
        { kind: 'entity.create', entity_id: sourceId, entity_type: 'character', attributes: { public_note: 'retrieved from real SQLite Provider' } },
      ],
    });
    new ActorBindingService(engine).bind(worldId, ADAPTER_ID, actorId);
    new HostConversationWorldBindingService(engine).bind({
      adapterId: ADAPTER_ID, conversationId, worldId,
    });

    providerAdapter = createMemoryNpcProviderAdapter({
      engine,
      providerPath,
      coordinatorPath,
      adapterId: ADAPTER_ID,
      trustedInitialKnowledgeSources: [],
      fieldPolicy: (_context, _entity, field) => field === 'entity_id' || field === 'attributes.public_note',
      contentFields: ['attributes.public_note'],
    });
    const source = engine.getSnapshot(worldId, {
      entityIds: [sourceId], includeSourceVersions: true,
    }).entities[0];
    const scope = { world_id: worldId, subject_id: actorId, purpose: 'npc_decision' };
    const record = {
      ...scope,
      record_ref: 'memory:host-core-sqlite-record',
      record_version: 'v1',
      source_kind: 'canonical_entity',
      source_entity_id: sourceId,
      source_version: source.source_version,
      content_kind: 'claim',
      epistemic_kind: 'acquired_report',
      producer_kind: 'host-core-sqlite-e2e',
      content_disposition: 'usable',
      evidence_assessment: 'unassessed',
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
    resolveHostLifecycleIdentity: input => ({
      authorized: true,
      adapter_id: ADAPTER_ID,
      host_installation_id: input.host_installation_id,
      authenticated_account_id: input.authenticated_account_id,
      host_session_id: input.host_session_id,
      conversation_uuid: input.conversation_uuid,
      root_id: 'a'.repeat(64),
      authority_id: 'host-core-sqlite-e2e-authority',
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
      authority_id: 'host-core-sqlite-e2e-authority',
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
    };
    const authoritativeInventory = {
      filesystem: {
        status: 'complete', entries: [], snapshot_id: 'sqlite-e2e-vss-snapshot',
      },
      mutation_coverage: { status: 'VERIFIED', source_commit: '06bde939fb1e9c4c8d8641d810f0a916b5bce127', coverage_manifest_sha256: 'c'.repeat(64), route_count: 1, source_files_sha256: 'd'.repeat(64) },
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
        snapshot_id: 'sqlite-e2e-vss-snapshot',
        snapshot_provider: 'windows-vss-client-accessible',
        snapshot_consistency: 'VSS_POINT_IN_TIME_READ_ONLY',
      },
      authority: { status: 'AUTHORITATIVE_COMPLETE', manifest_sha256: 'a'.repeat(64) },
    };
    const hostFetchRequests = [];
    const hostFetch = async (url, init) => {
      const parsed = new URL(url);
      if (parsed.pathname === '/v1/host/memory-npc/retrieve') {
        hostFetchRequests.push({ url: parsed.href, init: { ...init } });
      }
      return fetch(url, init);
    };
    const hostAdapter = createSillyTavernHostAdapter({
      env: {
        ...env,
        LOGIC_ENGINE_HOST_IDENTITY_DIR: identityDirectory,
        LOGIC_ENGINE_HOST_BUILD_SHA: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
      },
      enumerate: async () => structuredClone(authoritativeInventory),
      fetchImpl: hostFetch,
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
    const makeHostRequest = (overrides = {}) => ({
      user: {
        profile: { handle: 'e2e-user' },
        directories,
      },
      session: {
        handle: 'e2e-user',
        logicEngineSessionId: SESSION,
        logicEngineSessionHandle: 'e2e-user',
        ...(overrides.session ?? {}),
      },
      body: {
        request_id: REQUEST_ID,
        conversation_uuid: CONVERSATION,
        context_size: 4096,
        generation_type: 'normal',
        ...(overrides.body ?? {}),
      },
      ...(overrides.request ?? {}),
    });
    const invoke = async (adapter = hostAdapter, request = makeHostRequest()) => {
      const middlewareResponse = responseRecorder();
      let passed = false;
      await adapter.dispatchMiddleware(request, middlewareResponse, () => { passed = true; });
      if (!passed) return middlewareResponse;
      const response = responseRecorder();
      await adapter.dispatch(request, response);
      return response;
    };

    const retrieved = await invoke();
    assert.equal(retrieved.statusCode, 200);
    if (retrieved.payload.retrieval.status !== 'ready') throw new Error('HTTP retrieval diagnostic: ' + JSON.stringify(retrieved.payload));
    assert.equal(retrieved.payload.retrieval.candidates.length, 1);
    assert.equal(
      retrieved.payload.retrieval.candidates[0].content['attributes.public_note'],
      'retrieved from real SQLite Provider',
    );
    assert.equal(hostFetchRequests.length, 1, 'the installed Gateway adapter must perform one Core Memory HTTP request');

    // The actual ST authentication gate rejects a session/account identity mismatch
    // before any outbound Core request is made.
    const callsBeforeIdentityMismatch = hostFetchRequests.length;
    const identityMismatch = await invoke(hostAdapter, makeHostRequest({
      session: { logicEngineSessionHandle: 'different-account' },
    }));
    assert.equal(identityMismatch.statusCode, 403);
    assert.equal(hostFetchRequests.length, callsBeforeIdentityMismatch);

    // Incomplete Host inventory must fail closed before the dispatch capability
    // is minted and before Core receives any request.
    const incompleteHostAdapter = createSillyTavernHostAdapter({
      env: {
        ...env,
        LOGIC_ENGINE_HOST_IDENTITY_DIR: identityDirectory,
        LOGIC_ENGINE_HOST_BUILD_SHA: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
      },
      enumerate: async () => ({
        filesystem: { status: 'incomplete', entries: [] },
        source: { status: 'AUTHORITATIVE_COMPLETE', files: [{ logical_identity: { conversation_uuid: CONVERSATION } }] },
        authority: { status: 'AUTHORITATIVE_COMPLETE', manifest_sha256: 'c'.repeat(64) },
      }),
      fetchImpl: hostFetch,
      persistRootInventory: async () => { throw new Error('must not persist incomplete inventory'); },
    });
    const incompleteInventory = await invoke(incompleteHostAdapter);
    assert.equal(incompleteInventory.statusCode, 503);
    assert.equal(incompleteInventory.payload.code, 'HOST_INVENTORY_NOT_AUTHORITATIVE');
    assert.equal(hostFetchRequests.length, callsBeforeIdentityMismatch);

    // Core rejects both a tampered HMAC and a correctly signed but expired timestamp.
    const captured = hostFetchRequests[0];
    const capturedBody = JSON.parse(captured.init.body);
    const invalidHmac = await fetch(captured.url, {
      method: 'POST',
      headers: captured.init.headers,
      body: JSON.stringify({ ...capturedBody, signature: '0'.repeat(64) }),
    });
    assert.equal(invalidHmac.status, 401);
    assert.equal((await invalidHmac.json()).error.code, 'HOST_SESSION_ASSERTION_INVALID');
    const expiredAssertion = {
      ...capturedBody.assertion,
      issued_at: Math.floor(Date.now() / 1000) - 60,
      nonce: '77777777-7777-4777-8777-777777777777',
    };
    const expiredCanonical = JSON.stringify([
      expiredAssertion.protocol_version, expiredAssertion.host_installation_id,
      expiredAssertion.authenticated_account_id, expiredAssertion.host_session_id,
      expiredAssertion.conversation_id, expiredAssertion.world_id, expiredAssertion.actor_id,
      expiredAssertion.issued_at, expiredAssertion.nonce,
    ]);
    const expiredSignature = createHmac('sha256', ADAPTER_TOKEN)
      .update(expiredCanonical, 'utf8').digest('hex');
    const expiredTimestamp = await fetch(captured.url, {
      method: 'POST',
      headers: captured.init.headers,
      body: JSON.stringify({
        ...capturedBody, assertion: expiredAssertion, signature: expiredSignature,
      }),
    });
    assert.equal(expiredTimestamp.status, 401);
    assert.equal((await expiredTimestamp.json()).error.code, 'HOST_SESSION_ASSERTION_EXPIRED');

    // Replaying the exact accepted request is rejected by Core's durable SQLite nonce store.
    const replay = await fetch(captured.url, {
      method: 'POST',
      headers: captured.init.headers,
      body: captured.init.body,
    });
    assert.equal(replay.status, 409);
    assert.equal((await replay.json()).error.code, 'HOST_SESSION_ASSERTION_REPLAYED');

    providerAdapter.provider.revokeRecord(scope, record.record_ref, record.record_version);
    const revoked = await invoke();
    assert.equal(revoked.statusCode, 200);
    assert.ok(['ready', 'non_ready'].includes(revoked.payload.retrieval.status));
    assert.deepEqual(revoked.payload.retrieval.candidates, []);
    assert.deepEqual(revoked.payload.retrieval.admitted, []);
    assert.equal(JSON.stringify(revoked.payload).includes('retrieved from real SQLite Provider'), false);
  } finally {
    if (server?.listening) await new Promise(resolveClose => server.close(resolveClose));
    try { nonceStore?.close(); } catch {}
    try { providerAdapter?.close(); } catch {}
    try { store?.close(); } catch {}
    if (previousCoordinator === undefined) delete process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH;
    else process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH = previousCoordinator;
    if (previousDataRoot === undefined) delete globalThis.DATA_ROOT;
    else globalThis.DATA_ROOT = previousDataRoot;
    rmSync(directory, { recursive: true, force: true });
  }
});
