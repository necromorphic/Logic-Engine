import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHmac } from 'node:crypto';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { createApiServer } from '../src/api/server.js';
import { getAuthenticatedHostSessionContext } from '../src/application/host-session-context.js';
import { HostAssertionNonceStore } from '../src/application/host-assertion-nonce-store.js';

const API_TOKEN = 'host-memory-api-token-long-enough';
const ADMIN_TOKEN = 'host-memory-admin-token-long-enough';
const ADAPTER_TOKEN = 'host-memory-adapter-token-long-enough';
const ADAPTER_ID = 'st-host-adapter';
const INSTALLATION = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const CONVERSATION = '44444444-4444-4444-8444-444444444444';
const NONCE = '55555555-5555-4555-8555-555555555555';
const conversationId = SESSION + ':' + INSTALLATION + ':' + CONVERSATION;

function sign(assertion) {
  const canonical = JSON.stringify([
    assertion.protocol_version, assertion.host_installation_id,
    assertion.authenticated_account_id, assertion.host_session_id,
    assertion.conversation_id, assertion.world_id, assertion.actor_id,
    assertion.issued_at, assertion.nonce,
  ]);
  return createHmac('sha256', ADAPTER_TOKEN).update(canonical, 'utf8').digest('hex');
}
function signRevocation(event) {
  const canonical = JSON.stringify([
    event.protocol_version, ADAPTER_ID, event.host_installation_id,
    event.authenticated_account_id, event.host_session_id, event.issued_at,
    event.nonce, event.reason,
  ]);
  return createHmac('sha256', ADAPTER_TOKEN).update(canonical, 'utf8').digest('hex');
}
function post(base, pathname, headers, body) {
  return fetch(base + pathname, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('Core Host context and Memory retrieval routes enforce PC-NEXT-11 and signed adapter assertions', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'host-memory-http-'));
  const corePath = join(directory, 'core.sqlite');
  const coordinatorPath = resolve(join(directory, 'coordinator.sqlite'));
  const store = new SQLiteStore(corePath);
  const engine = new LogicEngine(store);
  let nonceStore = new HostAssertionNonceStore({
    path: join(directory, 'host-assertion-nonces.sqlite'),
    coreDatabasePath: corePath,
    coordinatorPath,
  });
  engine.createWorld({
    world_id: 'host-memory-world', world_pack_id: 'test.host-memory',
    world_pack_version: '1', game_time: '2026-01-01T00:00:00Z',
  });
  engine.commitEvent('host-memory-world', {
    idempotency_key: 'host-memory-seed-actor', turn_id: 'host-memory-seed-actor',
    event_type: 'action.completed', expected_revision: 0,
    effects: [{ kind: 'entity.create', entity_id: 'host-memory-actor', entity_type: 'character' }],
  });
  let hostIdentityAllowed = true;
  const resolveHostLifecycleIdentity = input => hostIdentityAllowed
    && input.adapterId === ADAPTER_ID
    && input.host_installation_id === INSTALLATION
    && input.authenticated_account_id === ACCOUNT
    && input.host_session_id === SESSION
    && input.conversation_uuid === CONVERSATION ? ({
    authorized: true, adapter_id: ADAPTER_ID,
    host_installation_id: input.host_installation_id,
    authenticated_account_id: input.authenticated_account_id,
    host_session_id: input.host_session_id,
    conversation_uuid: input.conversation_uuid,
    root_id: 'a'.repeat(64), authority_id: 'test-host-authority',
    generation: 1, snapshot_fingerprint: 'b'.repeat(64),
  }) : ({ authorized: false });
  let calls = 0;
  let failConsumer = false;
  let consumerResultOverride = null;
  let pauseConsumer = false;
  let consumerStartedResolve = null;
  let releaseConsumerResolve = null;
  const consumer = {
    adapterId: ADAPTER_ID,
    async retrieveForNpc({ conversationId: requested }) {
      calls += 1;
      const context = getAuthenticatedHostSessionContext();
      assert.equal(context.conversation_id, requested);
      assert.equal(context.host_session_id, SESSION);
      assert.equal(context.host_installation_id, INSTALLATION);
      assert.equal(context.authenticated_account_id, ACCOUNT);
      assert.equal(context.world_id, 'host-memory-world');
      assert.equal(context.actor_id, 'host-memory-actor');
      if (failConsumer) throw new Error('sensitive consumer implementation detail');
      if (pauseConsumer) {
        consumerStartedResolve?.();
        await new Promise(resolve => { releaseConsumerResolve = resolve; });
      }
      return consumerResultOverride ?? { status: 'ready', admitted: [], candidates: [], reason: null, snapshot: { world_revision: 0, commit_sequence: 0 } };
    },
  };
  let server = createApiServer({
    engine, token: API_TOKEN, adminToken: ADMIN_TOKEN,
    adapterTokens: { [ADAPTER_ID]: ADAPTER_TOKEN },
    memoryNpcConsumers: { [ADAPTER_ID]: consumer },
    hostAssertionNonceStore: nonceStore,
    resolveHostLifecycleIdentity,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    nonceStore.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const headers = { authorization: 'Bearer ' + API_TOKEN };
  const adapterHeaders = { ...headers, 'x-adapter-id': ADAPTER_ID, 'x-adapter-token': ADAPTER_TOKEN };
  const adminHeaders = { ...headers, 'x-admin-token': ADMIN_TOKEN };

  const actorBinding = await post(base, '/v1/worlds/host-memory-world/actor-bindings', adminHeaders, {
    adapter_id: ADAPTER_ID, entity_id: 'host-memory-actor',
  });
  assert.equal(actorBinding.status, 201);
  const worldBinding = await post(base, '/v1/host-conversation-bindings', adminHeaders, {
    adapter_id: ADAPTER_ID, conversation_id: conversationId, world_id: 'host-memory-world',
  });
  assert.equal(worldBinding.status, 201);

  for (const malformedConversationId of [
    SESSION + ':' + INSTALLATION,
    SESSION + ':' + INSTALLATION + ':' + CONVERSATION + ':extra',
    '------------------------------------:' + INSTALLATION + ':' + CONVERSATION,
    ' ' + conversationId,
    INSTALLATION + ':' + SESSION + ':' + CONVERSATION,
  ]) {
    const invalidContext = await post(base, '/v1/host-context/resolve', adapterHeaders, {
      conversation_id: malformedConversationId,
      host_session_id: SESSION,
      host_installation_id: INSTALLATION,
      conversation_uuid: CONVERSATION,
    });
    assert.equal(invalidContext.status, 400);
    assert.equal((await invalidContext.json()).error.code, 'INVALID_HOST_CONTEXT_RESOLUTION');
  }
  const contextResponse = await post(base, '/v1/host-context/resolve', adapterHeaders, {
    conversation_id: conversationId,
    host_session_id: SESSION,
    host_installation_id: INSTALLATION,
    conversation_uuid: CONVERSATION,
  });
  assert.equal(contextResponse.status, 200);
  assert.deepEqual((await contextResponse.json()).context, {
    adapter_id: ADAPTER_ID, conversation_id: conversationId,
    world_id: 'host-memory-world', actor_id: 'host-memory-actor', actor_type: 'character',
  });

  const assertion = {
    protocol_version: 1, host_installation_id: INSTALLATION,
    authenticated_account_id: ACCOUNT, host_session_id: SESSION,
    conversation_id: conversationId, world_id: 'host-memory-world',
    actor_id: 'host-memory-actor', issued_at: Math.floor(Date.now() / 1000), nonce: NONCE,
  };
  const body = {
    assertion, signature: sign(assertion),
    request_id: '66666666-6666-4666-8666-666666666666',
    context_size: 4096, generation_type: 'normal',
  };
  const malformedRequestId = await post(base, '/v1/host/memory-npc/retrieve', adapterHeaders, {
    ...body, request_id: '------------------------------------',
  });
  assert.equal(malformedRequestId.status, 400);
  const uppercaseGeneration = await post(base, '/v1/host/memory-npc/retrieve', adapterHeaders, {
    ...body, request_id: '99999999-9999-4999-8999-999999999999', generation_type: 'NORMAL',
  });
  assert.equal(uppercaseGeneration.status, 400);

  const retrieved = await post(base, '/v1/host/memory-npc/retrieve', adapterHeaders, body);
  assert.equal(retrieved.status, 200);
  assert.deepEqual((await retrieved.json()).retrieval.status, 'ready');
  assert.equal(calls, 1);

  // A correctly HMAC-signed assertion is still rejected unless its exact
  // installation/account/session/conversation tuple is enrolled by Root
  // Inventory Authority.
  hostIdentityAllowed = false;
  const unregisteredAssertion = {
    ...assertion, nonce: '12121212-1212-4212-8212-121212121211',
    issued_at: Math.floor(Date.now() / 1000),
  };
  const unregisteredRead = await post(base, '/v1/host/memory-npc/retrieve', adapterHeaders, {
    ...body, assertion: unregisteredAssertion, signature: sign(unregisteredAssertion),
    request_id: '12121212-1212-4212-8212-121212121212',
  });
  assert.equal(unregisteredRead.status, 401);
  assert.equal((await unregisteredRead.json()).error.code, 'HOST_ROOT_IDENTITY_UNAUTHORIZED');
  assert.equal(calls, 1);
  hostIdentityAllowed = true;

  const wrongAccountAssertion = {
    ...assertion, authenticated_account_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    nonce: '14141414-1414-4414-8414-141414141414',
    issued_at: Math.floor(Date.now() / 1000),
  };
  const wrongAccountRead = await post(base, '/v1/host/memory-npc/retrieve', adapterHeaders, {
    ...body, assertion: wrongAccountAssertion, signature: sign(wrongAccountAssertion),
    request_id: '15151515-1515-4515-8515-151515151515',
  });
  assert.equal(wrongAccountRead.status, 401);
  assert.equal((await wrongAccountRead.json()).error.code, 'HOST_ROOT_IDENTITY_UNAUTHORIZED');
  assert.equal(calls, 1);

  const invalidResults = [
    { status: 'ready', admitted: [], candidates: [], reason: null, snapshot: { world_revision: 0, commit_sequence: 0 }, provider_diagnostics: { secret: true } },
    { status: 'ready', admitted: [], candidates: [], snapshot: { world_revision: 0, commit_sequence: 0 } },
    { status: 'ready', admitted: [], candidates: [], reason: null, snapshot: { world_revision: -1, commit_sequence: 0 } },
    { status: 'non_ready', admitted: [], candidates: [], reason: 'query_access_unconfirmed', snapshot: {} },
  ];
  for (let index = 0; index < invalidResults.length; index += 1) {
    const invalidAssertion = {
      ...assertion,
      nonce: [
        '99999999-9999-4999-8999-999999999991',
        '99999999-9999-4999-8999-999999999992',
        '99999999-9999-4999-8999-999999999993',
        '99999999-9999-4999-8999-999999999994',
      ][index],
      issued_at: Math.floor(Date.now() / 1000),
    };
    consumerResultOverride = invalidResults[index];
    const invalidEnvelope = await post(base, '/v1/host/memory-npc/retrieve', adapterHeaders, {
      ...body,
      assertion: invalidAssertion,
      signature: sign(invalidAssertion),
      request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa' + (index + 1),
    });
    assert.equal(invalidEnvelope.status, 503);
    assert.equal((await invalidEnvelope.json()).error.code, 'MEMORY_NPC_RESULT_INVALID');
  }
  consumerResultOverride = null;

  const replay = await post(base, '/v1/host/memory-npc/retrieve', adapterHeaders, body);
  assert.equal(replay.status, 409);
  assert.equal((await replay.json()).error.code, 'HOST_SESSION_ASSERTION_REPLAYED');
  assert.equal(calls, 5);

  const tamperedAssertion = { ...assertion, actor_id: 'attacker-selected-actor' };
  const tampered = await post(base, '/v1/host/memory-npc/retrieve', adapterHeaders, {
    ...body, assertion: tamperedAssertion,
  });
  assert.equal(tampered.status, 401);
  assert.equal(calls, 5);

  // A verified assertion followed by an unexpected Consumer failure is an
  // internal error, never an authentication failure or a detail disclosure.
  failConsumer = true;
  const failingAssertion = {
    ...assertion, nonce: '77777777-7777-4777-8777-777777777777',
    issued_at: Math.floor(Date.now() / 1000),
  };
  const failingBody = {
    ...body, assertion: failingAssertion, signature: sign(failingAssertion),
    request_id: '88888888-8888-4888-8888-888888888888',
  };
  const consumerFailure = await post(base, '/v1/host/memory-npc/retrieve', adapterHeaders, failingBody);
  assert.equal(consumerFailure.status, 500);
  assert.deepEqual(await consumerFailure.json(), {
    error: { code: 'INTERNAL_ERROR', message: 'Internal error.' },
  });
  assert.equal(calls, 6);
  const consumerFailureReplay = await post(base, '/v1/host/memory-npc/retrieve', adapterHeaders, failingBody);
  assert.equal(consumerFailureReplay.status, 409);
  assert.equal((await consumerFailureReplay.json()).error.code, 'HOST_SESSION_ASSERTION_REPLAYED');
  assert.equal(calls, 6);
  failConsumer = false;

  // The nonce ledger is durable in the Core SQLite store, not a process-local Map.
  await new Promise(resolve => server.close(resolve));
  server = createApiServer({
    engine, token: API_TOKEN, adminToken: ADMIN_TOKEN,
    adapterTokens: { [ADAPTER_ID]: ADAPTER_TOKEN },
    memoryNpcConsumers: { [ADAPTER_ID]: consumer },
    hostAssertionNonceStore: nonceStore,
    resolveHostLifecycleIdentity,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const restartedBase = 'http://127.0.0.1:' + server.address().port;
  const replayAfterRestart = await post(restartedBase, '/v1/host/memory-npc/retrieve', adapterHeaders, body);
  assert.equal(replayAfterRestart.status, 409);
  assert.equal((await replayAfterRestart.json()).error.code, 'HOST_SESSION_ASSERTION_REPLAYED');
  assert.equal(calls, 6);

  const callerSelectedWorld = await post(restartedBase, '/v1/host-context/resolve', adapterHeaders, {
    conversation_id: conversationId, world_id: 'attacker-world',
  });
  assert.equal(callerSelectedWorld.status, 400);

  // Two simultaneous requests carrying the same signed nonce must have exactly
  // one winner. The durable SQLite primary key is the cross-request arbiter.
  const parallelAssertion = {
    ...assertion, nonce: '99999999-9999-4999-8999-999999999999',
    issued_at: Math.floor(Date.now() / 1000),
  };
  const parallelBody = {
    ...body, assertion: parallelAssertion, signature: sign(parallelAssertion),
    request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  };
  const parallelResponses = await Promise.all([
    post(restartedBase, '/v1/host/memory-npc/retrieve', adapterHeaders, parallelBody),
    post(restartedBase, '/v1/host/memory-npc/retrieve', adapterHeaders, parallelBody),
  ]);
  assert.deepEqual(parallelResponses.map(response => response.status).sort(), [200, 409]);
  const parallelPayloads = await Promise.all(parallelResponses.map(response => response.json()));
  assert.equal(parallelPayloads.filter(payload => payload.retrieval?.status === 'ready').length, 1);
  assert.equal(parallelPayloads.filter(payload => payload.error?.code === 'HOST_SESSION_ASSERTION_REPLAYED').length, 1);
  assert.equal(calls, 7);


  // A signed logout revocation is durable, scoped to the exact installation /
  // account / session tuple, and invalidates assertions already in flight.
  const revocation = {
    protocol_version: 1, host_installation_id: INSTALLATION,
    authenticated_account_id: ACCOUNT, host_session_id: SESSION,
    issued_at: Math.floor(Date.now() / 1000),
    nonce: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', reason: 'logout',
  };
  const unsignedRevocation = await post(base, '/v1/host/session/revoke', adapterHeaders, {
    ...revocation, signature: '0'.repeat(64),
  });
  assert.equal(unsignedRevocation.status, 401);

  // Start a Provider-backed retrieval and revoke the exact session while its
  // Consumer is suspended. The already-started operation must not disclose.
  let consumerStarted;
  const started = new Promise(resolve => { consumerStarted = resolve; });
  pauseConsumer = true;
  consumerStartedResolve = consumerStarted;
  const inFlightAssertion = {
    ...assertion, nonce: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    issued_at: Math.floor(Date.now() / 1000),
  };
  const inFlightRead = post(base, '/v1/host/memory-npc/retrieve', adapterHeaders, {
    ...body, assertion: inFlightAssertion, signature: sign(inFlightAssertion),
    request_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  });
  await started;
  const revokedResponse = await post(base, '/v1/host/session/revoke', adapterHeaders, {
    ...revocation, signature: signRevocation(revocation),
  });
  assert.equal(revokedResponse.status, 204);
  releaseConsumerResolve?.();
  pauseConsumer = false;
  const inFlightResponse = await inFlightRead;
  assert.equal(inFlightResponse.status, 401);
  assert.equal((await inFlightResponse.json()).error.code, 'HOST_SESSION_REVOKED');
  consumerStartedResolve = null;

  const revocationReplay = await post(base, '/v1/host/session/revoke', adapterHeaders, {
    ...revocation, signature: signRevocation(revocation),
  });
  assert.equal(revocationReplay.status, 409);

  const rotatedSession = '12121212-1212-4212-8212-121212121212';
  const rotationEvent = {
    protocol_version: 1, host_installation_id: INSTALLATION,
    authenticated_account_id: ACCOUNT, host_session_id: rotatedSession,
    issued_at: Math.floor(Date.now() / 1000),
    nonce: '13131313-1313-4313-8313-131313131313', reason: 'session_rotation',
  };
  const rotationResponse = await post(base, '/v1/host/session/revoke', adapterHeaders, {
    ...rotationEvent, signature: signRevocation(rotationEvent),
  });
  assert.equal(rotationResponse.status, 204);
  assert.equal(nonceStore.isSessionRevoked(ADAPTER_ID, {
    host_installation_id: INSTALLATION,
    authenticated_account_id: ACCOUNT,
    host_session_id: rotatedSession,
  }), true);
  assert.equal(calls, 8);

  // Reopen the SQLite file to prove revocation survives a Core process restart.
  await new Promise(resolve => server.close(resolve));
  nonceStore.close();
  nonceStore = new HostAssertionNonceStore({
    path: join(directory, 'host-assertion-nonces.sqlite'),
    coreDatabasePath: corePath,
    coordinatorPath,
  });
  server = createApiServer({
    engine, token: API_TOKEN, adminToken: ADMIN_TOKEN,
    adapterTokens: { [ADAPTER_ID]: ADAPTER_TOKEN },
    memoryNpcConsumers: { [ADAPTER_ID]: consumer },
    hostAssertionNonceStore: nonceStore,
    resolveHostLifecycleIdentity,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const afterRevocationRestart = 'http://127.0.0.1:' + server.address().port;
  const afterRestartAssertion = {
    ...assertion, nonce: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    issued_at: Math.floor(Date.now() / 1000),
  };
  const afterRestartRead = await post(afterRevocationRestart, '/v1/host/memory-npc/retrieve', adapterHeaders, {
    ...body, assertion: afterRestartAssertion, signature: sign(afterRestartAssertion),
    request_id: 'abababab-abab-4bab-8bab-abababababab',
  });
  assert.equal(afterRestartRead.status, 401);
  assert.equal((await afterRestartRead.json()).error.code, 'HOST_SESSION_REVOKED');
  assert.equal(calls, 7);

  // A durable-store I/O failure is a distinct fail-closed 503, not a generic
  // 500 and never an authentication success.
  await new Promise(resolve => server.close(resolve));
  server = createApiServer({
    engine, token: API_TOKEN, adminToken: ADMIN_TOKEN,
    adapterTokens: { [ADAPTER_ID]: ADAPTER_TOKEN },
    memoryNpcConsumers: { [ADAPTER_ID]: consumer },
    hostAssertionNonceStore: { consume() { throw new Error('simulated SQLite I/O failure'); }, revokeSession() { throw new Error('simulated SQLite I/O failure'); }, isSessionRevoked() { throw new Error('simulated SQLite I/O failure'); } },
    resolveHostLifecycleIdentity,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const unavailableBase = 'http://127.0.0.1:' + server.address().port;
  const unavailableAssertion = {
    ...assertion, nonce: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    issued_at: Math.floor(Date.now() / 1000),
  };
  const unavailableResponse = await post(unavailableBase, '/v1/host/memory-npc/retrieve', adapterHeaders, {
    ...body, assertion: unavailableAssertion, signature: sign(unavailableAssertion),
  });
  assert.equal(unavailableResponse.status, 503);
  assert.equal((await unavailableResponse.json()).error.code, 'HOST_ASSERTION_REPLAY_GUARD_UNAVAILABLE');
  assert.equal(calls, 8);
});
