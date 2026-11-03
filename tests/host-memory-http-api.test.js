import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
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
const ROTATED_SESSION = '12121212-1212-4212-8212-121212121212';
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
  const providerDatabasePath = join(directory, 'provider.sqlite');
  assert.throws(() => new HostAssertionNonceStore({
    path: providerDatabasePath,
    coreDatabasePath: corePath,
    coordinatorPath,
    providerDatabasePath,
  }), /must be separate from Core, Coordinator, and Provider databases/);
  const danglingProviderAlias = join(directory, 'nonce-provider-dangling-alias.sqlite');
  try {
    symlinkSync(providerDatabasePath, danglingProviderAlias);
    assert.throws(() => new HostAssertionNonceStore({
      path: danglingProviderAlias,
      coreDatabasePath: corePath,
      coordinatorPath,
      providerDatabasePath,
    }), /must be separate from Core, Coordinator, and Provider databases/);
  } catch (error) {
    if (!['EPERM', 'EACCES'].includes(error?.code)) throw error;
    t.diagnostic('Skipped dangling-symlink alias probe because this runner cannot create file symlinks.');
  }
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
  let hostIdentitySnapshot = {
    root_id: 'a'.repeat(64), authority_id: 'test-host-authority',
    authority_status: 'AUTHORITATIVE_COMPLETE',
    generation: 1, snapshot_fingerprint: 'b'.repeat(64),
  };
  const resolveIdentity = (input, authorityStatus) => hostIdentityAllowed
    && input.adapterId === ADAPTER_ID
    && input.host_installation_id === INSTALLATION
    && input.authenticated_account_id === ACCOUNT
    && [SESSION, ROTATED_SESSION].includes(input.host_session_id)
    && input.conversation_uuid === CONVERSATION ? ({
    authorized: true, adapter_id: ADAPTER_ID,
    host_installation_id: input.host_installation_id,
    authenticated_account_id: input.authenticated_account_id,
    host_session_id: input.host_session_id,
    conversation_uuid: input.conversation_uuid,
    ...hostIdentitySnapshot,
    authority_status: authorityStatus,
  }) : ({ authorized: false });
  const resolveHostLifecycleIdentity = input => resolveIdentity(input, 'REVIEW_ONLY');
  const resolveHostMemoryIdentity = input => resolveIdentity(input, hostIdentitySnapshot.authority_status);
  const hostLifecycleJournal = {
    append: event => ({ status: 'appended', event_id: event.event_id }),
    getConversationStatus: () => ({ status: 'review_only_lifecycle_read_allowed' }),
  };
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
      assert.equal(context.host_session_id, requested.split(':')[0]);
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

  assert.throws(() => createApiServer({
    engine, token: API_TOKEN,
    adapterTokens: { [ADAPTER_ID]: ADAPTER_TOKEN },
    memoryNpcConsumers: { [ADAPTER_ID]: consumer },
    hostAssertionNonceStore: { consume() { return true; } },
    resolveHostLifecycleIdentity,
    resolveHostMemoryIdentity,
  }), /must expose atomic consume\(\), revokeSession\(\), and isSessionRevoked\(\)/);
  assert.throws(() => createApiServer({
    engine, token: API_TOKEN,
    adapterTokens: { [ADAPTER_ID]: ADAPTER_TOKEN },
    memoryNpcConsumers: { [ADAPTER_ID]: consumer },
    resolveHostLifecycleIdentity,
    resolveHostMemoryIdentity,
  }), /requires a durable Host assertion nonce and revocation store/);

  assert.throws(() => createApiServer({
    engine, token: API_TOKEN,
    adapterTokens: { [ADAPTER_ID]: ADAPTER_TOKEN },
    memoryNpcConsumers: { [ADAPTER_ID]: consumer },
    hostAssertionNonceStore: nonceStore,
    resolveHostLifecycleIdentity,
  }), /requires a separate Root Inventory completeness resolver/);

  let server = createApiServer({
    engine, token: API_TOKEN, adminToken: ADMIN_TOKEN,
    adapterTokens: { [ADAPTER_ID]: ADAPTER_TOKEN },
    memoryNpcConsumers: { [ADAPTER_ID]: consumer },
    hostAssertionNonceStore: nonceStore,
    hostLifecycleJournal,
    resolveHostLifecycleIdentity,
    resolveHostMemoryIdentity,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    nonceStore.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  let base = 'http://127.0.0.1:' + server.address().port;
  const headers = { authorization: 'Bearer ' + API_TOKEN };
  const adapterHeaders = { ...headers, 'x-adapter-id': ADAPTER_ID, 'x-adapter-token': ADAPTER_TOKEN };
  const adminHeaders = { ...headers, 'x-admin-token': ADMIN_TOKEN };

  const lifecycleStatus = await fetch(base + '/v1/host-lifecycle/status?'
    + new URLSearchParams({
      host_installation_id: INSTALLATION,
      authenticated_account_id: ACCOUNT,
      host_session_id: SESSION,
      conversation_uuid: CONVERSATION,
    }), { headers: adapterHeaders });
  assert.equal(lifecycleStatus.status, 200);
  assert.equal((await lifecycleStatus.json()).lifecycle.status, 'review_only_lifecycle_read_allowed');

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

  // A valid hash chain is not sufficient: review-only inventory must not
  // authorize a Memory read until Host supplies a completeness attestation.
  hostIdentitySnapshot = { ...hostIdentitySnapshot, authority_status: 'BASELINED_REVIEW_ONLY' };
  const reviewOnlyAssertion = {
    ...assertion, nonce: '15151515-1515-4515-8515-151515151515',
    issued_at: Math.floor(Date.now() / 1000),
  };
  const reviewOnlyRead = await post(base, '/v1/host/memory-npc/retrieve', adapterHeaders, {
    ...body, assertion: reviewOnlyAssertion, signature: sign(reviewOnlyAssertion),
    request_id: '16161616-1616-4616-8616-161616161616',
  });
  assert.equal(reviewOnlyRead.status, 401);
  assert.equal((await reviewOnlyRead.json()).error.code, 'HOST_ROOT_IDENTITY_UNAUTHORIZED');
  assert.equal(calls, 1);
  hostIdentitySnapshot = { ...hostIdentitySnapshot, authority_status: 'AUTHORITATIVE_COMPLETE' };

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

  const forgedIdentityAssertions = [
    {
      ...assertion,
      host_installation_id: '17171717-1717-4717-8717-171717171717',
      conversation_id: SESSION + ':17171717-1717-4717-8717-171717171717:' + CONVERSATION,
      nonce: '18181818-1818-4818-8818-181818181818',
    },
    {
      ...assertion,
      host_session_id: '19191919-1919-4919-8919-191919191919',
      conversation_id: '19191919-1919-4919-8919-191919191919:' + INSTALLATION + ':' + CONVERSATION,
      nonce: '20202020-2020-4020-8020-202020202020',
    },
    {
      ...assertion,
      conversation_id: SESSION + ':' + INSTALLATION + ':21212121-2121-4121-8121-212121212121',
      nonce: '22222222-2222-4222-8222-222222222222',
    },
  ];
  for (let index = 0; index < forgedIdentityAssertions.length; index += 1) {
    const forged = { ...forgedIdentityAssertions[index], issued_at: Math.floor(Date.now() / 1000) };
    const response = await post(base, '/v1/host/memory-npc/retrieve', adapterHeaders, {
      ...body, assertion: forged, signature: sign(forged),
      request_id: [
        '23232323-2323-4323-8323-232323232323',
        '24242424-2424-4424-8424-242424242424',
        '25252525-2525-4525-8525-252525252525',
      ][index],
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'HOST_ROOT_IDENTITY_UNAUTHORIZED');
  }
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
    resolveHostMemoryIdentity,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const restartedBase = 'http://127.0.0.1:' + server.address().port;
  base = restartedBase;
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


  // Root Inventory authority can also be revoked while a Provider read is
  // suspended. Core must re-resolve the exact root binding after the read.
  let rootConsumerStarted;
  const rootStarted = new Promise(resolve => { rootConsumerStarted = resolve; });
  pauseConsumer = true;
  consumerStartedResolve = rootConsumerStarted;
  const rootRaceAssertion = {
    ...assertion, nonce: '27272727-2727-4727-8727-272727272727',
    issued_at: Math.floor(Date.now() / 1000),
  };
  const rootRaceRead = post(base, '/v1/host/memory-npc/retrieve', adapterHeaders, {
    ...body, assertion: rootRaceAssertion, signature: sign(rootRaceAssertion),
    request_id: '28282828-2828-4828-8828-282828282828',
  });
  await rootStarted;
  hostIdentityAllowed = false;
  releaseConsumerResolve?.();
  pauseConsumer = false;
  const rootRaceResponse = await rootRaceRead;
  assert.equal(rootRaceResponse.status, 401);
  assert.equal((await rootRaceResponse.json()).error.code, 'HOST_ROOT_IDENTITY_UNAUTHORIZED');
  hostIdentityAllowed = true;
  consumerStartedResolve = null;
  assert.equal(calls, 8);

  // An authorized but newer Root Inventory generation is a different
  // authority snapshot. It must not authorize completion of the old read.
  let snapshotConsumerStarted;
  const snapshotStarted = new Promise(resolve => { snapshotConsumerStarted = resolve; });
  pauseConsumer = true;
  consumerStartedResolve = snapshotConsumerStarted;
  const snapshotRaceAssertion = {
    ...assertion, nonce: '29292929-2929-4929-8929-292929292929',
    issued_at: Math.floor(Date.now() / 1000),
  };
  const snapshotRaceRead = post(base, '/v1/host/memory-npc/retrieve', adapterHeaders, {
    ...body, assertion: snapshotRaceAssertion, signature: sign(snapshotRaceAssertion),
    request_id: '30303030-3030-4030-8030-303030303030',
  });
  await snapshotStarted;
  hostIdentitySnapshot = {
    ...hostIdentitySnapshot, generation: 2, snapshot_fingerprint: 'c'.repeat(64),
  };
  releaseConsumerResolve?.();
  pauseConsumer = false;
  const snapshotRaceResponse = await snapshotRaceRead;
  assert.equal(snapshotRaceResponse.status, 409);
  assert.equal((await snapshotRaceResponse.json()).error.code, 'HOST_ROOT_IDENTITY_BINDING_CHANGED');
  hostIdentitySnapshot = {
    root_id: 'a'.repeat(64), authority_id: 'test-host-authority',
    authority_status: 'AUTHORITATIVE_COMPLETE',
    generation: 1, snapshot_fingerprint: 'b'.repeat(64),
  };
  consumerStartedResolve = null;
  assert.equal(calls, 9);

  // Completeness can be withdrawn while the Consumer is suspended. An
  // integrity-valid REVIEW_ONLY snapshot must not authorize disclosure.
  let completenessConsumerStarted;
  const completenessStarted = new Promise(resolve => { completenessConsumerStarted = resolve; });
  pauseConsumer = true;
  consumerStartedResolve = completenessConsumerStarted;
  const completenessRaceAssertion = {
    ...assertion, nonce: '31313131-3131-4131-8131-313131313131',
    issued_at: Math.floor(Date.now() / 1000),
  };
  const completenessRaceRead = post(base, '/v1/host/memory-npc/retrieve', adapterHeaders, {
    ...body, assertion: completenessRaceAssertion, signature: sign(completenessRaceAssertion),
    request_id: '32323232-3232-4232-8232-323232323232',
  });
  await completenessStarted;
  hostIdentitySnapshot = { ...hostIdentitySnapshot, authority_status: 'REVIEW_ONLY' };
  releaseConsumerResolve?.();
  pauseConsumer = false;
  const completenessRaceResponse = await completenessRaceRead;
  assert.equal(completenessRaceResponse.status, 401);
  assert.equal((await completenessRaceResponse.json()).error.code, 'HOST_ROOT_IDENTITY_UNAUTHORIZED');
  hostIdentitySnapshot = { ...hostIdentitySnapshot, authority_status: 'AUTHORITATIVE_COMPLETE' };
  consumerStartedResolve = null;
  assert.equal(calls, 10);

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

  const rotationConversationId = ROTATED_SESSION + ':' + INSTALLATION + ':' + CONVERSATION;
  let rotationConsumerStarted;
  const rotationStarted = new Promise(resolve => { rotationConsumerStarted = resolve; });
  pauseConsumer = true;
  consumerStartedResolve = rotationConsumerStarted;
  const rotationAssertion = {
    ...assertion,
    host_session_id: ROTATED_SESSION,
    conversation_id: rotationConversationId,
    nonce: '13131313-1313-4313-8313-131313131313',
    issued_at: Math.floor(Date.now() / 1000),
  };
  const rotationRead = post(base, '/v1/host/memory-npc/retrieve', adapterHeaders, {
    ...body, assertion: rotationAssertion, signature: sign(rotationAssertion),
    request_id: '14141414-1414-4414-8414-141414141414',
  });
  await rotationStarted;
  const rotationEvent = {
    protocol_version: 1, host_installation_id: INSTALLATION,
    authenticated_account_id: ACCOUNT, host_session_id: ROTATED_SESSION,
    issued_at: Math.floor(Date.now() / 1000),
    nonce: '15151515-1515-4515-8515-151515151515', reason: 'session_rotation',
  };
  const rotationResponse = await post(base, '/v1/host/session/revoke', adapterHeaders, {
    ...rotationEvent, signature: signRevocation(rotationEvent),
  });
  assert.equal(rotationResponse.status, 204);
  releaseConsumerResolve?.();
  pauseConsumer = false;
  const rotatedInFlightResponse = await rotationRead;
  assert.equal(rotatedInFlightResponse.status, 401);
  assert.equal((await rotatedInFlightResponse.json()).error.code, 'HOST_SESSION_REVOKED');
  consumerStartedResolve = null;
  assert.equal(nonceStore.isSessionRevoked(ADAPTER_ID, {
    host_installation_id: INSTALLATION,
    authenticated_account_id: ACCOUNT,
    host_session_id: ROTATED_SESSION,
  }), true);
  assert.equal(calls, 12);

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
    resolveHostMemoryIdentity,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const afterRevocationRestart = 'http://127.0.0.1:' + server.address().port;
  base = afterRevocationRestart;
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
  assert.equal(calls, 12);

  // A durable-store I/O failure is a distinct fail-closed 503, not a generic
  // 500 and never an authentication success.
  await new Promise(resolve => server.close(resolve));
  server = createApiServer({
    engine, token: API_TOKEN, adminToken: ADMIN_TOKEN,
    adapterTokens: { [ADAPTER_ID]: ADAPTER_TOKEN },
    memoryNpcConsumers: { [ADAPTER_ID]: consumer },
    hostAssertionNonceStore: { consume() { throw new Error('simulated SQLite I/O failure'); }, revokeSession() { throw new Error('simulated SQLite I/O failure'); }, isSessionRevoked() { throw new Error('simulated SQLite I/O failure'); } },
    resolveHostLifecycleIdentity,
    resolveHostMemoryIdentity,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const unavailableBase = 'http://127.0.0.1:' + server.address().port;
  base = unavailableBase;
  const unavailableRevocation = {
    protocol_version: 1, host_installation_id: INSTALLATION,
    authenticated_account_id: ACCOUNT, host_session_id: SESSION,
    issued_at: Math.floor(Date.now() / 1000),
    nonce: '26262626-2626-4626-8626-262626262626', reason: 'logout',
  };
  const unavailableRevokeResponse = await post(unavailableBase, '/v1/host/session/revoke', adapterHeaders, {
    ...unavailableRevocation, signature: signRevocation(unavailableRevocation),
  });
  assert.equal(unavailableRevokeResponse.status, 503);
  assert.equal((await unavailableRevokeResponse.json()).error.code, 'HOST_SESSION_REVOCATION_UNAVAILABLE');
  const unavailableAssertion = {
    ...assertion, nonce: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    issued_at: Math.floor(Date.now() / 1000),
  };
  const unavailableResponse = await post(unavailableBase, '/v1/host/memory-npc/retrieve', adapterHeaders, {
    ...body, assertion: unavailableAssertion, signature: sign(unavailableAssertion),
  });
  assert.equal(unavailableResponse.status, 503);
  assert.equal((await unavailableResponse.json()).error.code, 'HOST_ASSERTION_REPLAY_GUARD_UNAVAILABLE');
  assert.equal(calls, 12);
});
