import test from 'node:test';
import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { ActorBindingService } from '../src/application/actor-bindings.js';
import { HostConversationWorldBindingService } from '../src/application/host-conversation-world-bindings.js';
import { createMemoryNpcProviderAdapter } from '../src/application/memory-npc-provider-adapter.js';
import { createHostSessionAssertionRunner, getAuthenticatedHostSessionContext, runWithAuthenticatedHostSession } from '../src/application/host-session-context.js';


test('real adapter composes file-backed SQLite Provider with Core query and canonical-source authorization', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-memory-real-adapter-'));
  const corePath = join(directory, 'core.sqlite');
  const providerPath = join(directory, 'provider.sqlite');
  const coordinatorPath = resolve(join(directory, 'coordinator.sqlite'));
  const previousCoordinator = process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH;
  process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH = coordinatorPath;

  let store;
  let adapter;
  try {
    store = new SQLiteStore(corePath);
    const engine = new LogicEngine(store);
    const worldId = 'real-adapter-world';
    const actorId = 'real-adapter-npc';
    const sourceId = 'real-adapter-source';
    const adapterId = 'real-adapter-host';
    const hostSessionId = '11111111-1111-4111-8111-111111111111';
    const conversationId = hostSessionId + ':22222222-2222-4222-8222-222222222222:33333333-3333-4333-8333-333333333333';
    const hostRequest = {
      user: { profile: { handle: 'adapter-test-user' } },
      session: { handle: 'adapter-test-user', logicEngineSessionId: hostSessionId, logicEngineSessionHandle: 'adapter-test-user' },
    };
    const authenticatedHostRequests = new WeakSet([hostRequest]);
    const trustedConversationIds = new WeakMap([[hostRequest, conversationId]]);
    const resolveHostConversationId = request => trustedConversationIds.get(request) ?? null;

    engine.createWorld({
      world_id: worldId,
      world_pack_id: 'test.memory-real-adapter',
      world_pack_version: '1',
      game_time: '2026-01-01T00:00:00Z',
    });
    engine.commitEvent(worldId, {
      event_id: 'real-adapter-seed',
      idempotency_key: 'real-adapter-seed',
      turn_id: 'real-adapter-seed',
      event_type: 'action.completed',
      expected_revision: 0,
      effects: [
        { kind: 'entity.create', entity_id: actorId, entity_type: 'character', attributes: { name: 'NPC' } },
        { kind: 'entity.create', entity_id: sourceId, entity_type: 'character', attributes: { public_note: 'real Core source value' } },
      ],
    });
    new ActorBindingService(engine).bind(worldId, adapterId, actorId);
    new HostConversationWorldBindingService(engine).bind({
      adapterId, conversationId, worldId,
    });

    assert.throws(() => createMemoryNpcProviderAdapter({
      engine,
      providerPath: corePath,
      coordinatorPath,
      adapterId,
      trustedInitialKnowledgeSources: [],
      fieldPolicy: () => true,
      contentFields: ['attributes.public_note'],
    }), /separate file from Core/);

    assert.throws(() => createMemoryNpcProviderAdapter({
      engine,
      providerPath,
      coordinatorPath,
      adapterId,
      trustedInitialKnowledgeSources: [],
      fieldPolicy: () => true,
      contentFields: ['attributes.public_note'],
    }), /trusted Host authentication middleware verifier/);

    assert.throws(() => createMemoryNpcProviderAdapter({
      engine,
      providerPath,
      coordinatorPath,
      adapterId,
      trustedInitialKnowledgeSources: [],
      fieldPolicy: () => true,
      contentFields: ['attributes.public_note'],
      isAuthenticatedHostRequest: request => authenticatedHostRequests.has(request),
    }), /trusted Host conversation identity resolver/);

    adapter = createMemoryNpcProviderAdapter({
      engine,
      providerPath,
      coordinatorPath,
      adapterId,
      trustedInitialKnowledgeSources: [],
      fieldPolicy: (_context, _entity, field) => field === 'entity_id' || field === 'attributes.public_note',
      contentFields: ['attributes.public_note'],
      isAuthenticatedHostRequest: request => authenticatedHostRequests.has(request),
      resolveHostConversationId,
    });

    const scope = { world_id: worldId, subject_id: actorId, purpose: 'npc_decision' };
    const source = engine.getSnapshot(worldId, { entityIds: [sourceId], includeSourceVersions: true }).entities[0];
    const record = {
      ...scope,
      record_ref: 'memory:real-adapter-record',
      record_version: 'v1',
      source_kind: 'canonical_entity',
      source_entity_id: sourceId,
      source_version: source.source_version,
      content_kind: 'claim',
      epistemic_kind: 'acquired_report',
      producer_kind: 'real-provider-adapter-test',
      content_disposition: 'usable',
      evidence_assessment: 'unassessed',
      lineage: [{
        source_kind: 'canonical_entity',
        entity_id: sourceId,
        source_version: source.source_version,
      }],
    };
    adapter.provider.putRecord(record);
    adapter.provider.grantQuery(scope, true);
    adapter.provider.grantRecord(scope, record.record_ref, record.record_version, true);

    assert.equal((await adapter.prepareWorld(worldId)).status, 'current');
    assert.equal(adapter.provider.retrieveCandidates, undefined);
    assert.equal(adapter.provider.authorizeCandidate, undefined);
    assert.equal(adapter.provider.authorizeQuery, undefined);
    assert.equal(adapter.consumer.memoryProvider, undefined);
    assert.equal(adapter.consumer.authorizedReadService, undefined);
    assert.equal(adapter.consumer.actorBindingService, undefined);
    assert.equal(adapter.consumer.hostConversationWorldBindingService, undefined);
    assert.equal(adapter.consumer.coreQueryAuthorizer, undefined);
    assert.equal(typeof adapter.consumer.retrieveForNpc, 'function');
    assert.equal(typeof adapter.consumer.revalidateForFinalDispatch, 'function');
    const withoutHostContext = await adapter.consumer.retrieveForNpc({ worldId, actorEntityId: actorId, conversationId });
    assert.equal(withoutHostContext.status, 'non_ready');
    assert.equal(withoutHostContext.reason, 'query_access_unconfirmed');
    assert.deepEqual(withoutHostContext.candidates, []);

    const result = await adapter.runWithAuthenticatedHostSession(hostRequest, conversationId, () => adapter.consumer.retrieveForNpc({
      worldId, actorEntityId: actorId, conversationId,
      adapterId: 'caller-selected-spoofed-adapter',
    }));
    assert.equal(result.status, 'ready');
    assert.equal(result.candidates.length, 1);
    assert.deepEqual(result.candidates[0].content, {
      'attributes.public_note': 'real Core source value',
    });
    assert.throws(() => adapter.runWithAuthenticatedHostSession(
      hostRequest, 'caller-selected-conversation', () => adapter.consumer.retrieveForNpc({
        worldId, actorEntityId: actorId, conversationId: 'caller-selected-conversation',
      }),
    ), /HOST_SESSION_AUTHENTICATION_REQUIRED/);

    const unboundConversationId = hostSessionId + ':44444444-4444-4444-8444-444444444444:55555555-5555-4555-8555-555555555555';
    const unboundHostRequest = {
      user: hostRequest.user,
      session: hostRequest.session,
    };
    authenticatedHostRequests.add(unboundHostRequest);
    trustedConversationIds.set(unboundHostRequest, unboundConversationId);
    const unboundConversation = await adapter.runWithAuthenticatedHostSession(
      unboundHostRequest, unboundConversationId, () => adapter.consumer.retrieveForNpc({
        worldId, actorEntityId: actorId, conversationId: unboundConversationId,
      }),
    );
    assert.throws(() => adapter.runWithAuthenticatedHostSession({ ...hostRequest }, conversationId, () => adapter.consumer.retrieveForNpc({
      worldId, actorEntityId: actorId, conversationId,
    })), /HOST_SESSION_AUTHENTICATION_REQUIRED/);
    assert.equal(unboundConversation.status, 'non_ready');
    assert.equal(unboundConversation.reason, 'query_access_unconfirmed');
    assert.deepEqual(unboundConversation.candidates, []);
  } finally {
    try { adapter?.close(); } catch {}
    try { store?.close(); } catch {}
    if (previousCoordinator === undefined) delete process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH;
    else process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH = previousCoordinator;
    rmSync(directory, { recursive: true, force: true });
  }
});


test('Provider Host capability is invalidated by session rotation, logout, account switch, unbinding, and request replay', async () => {
  const hostSessionId = '11111111-1111-4111-8111-111111111111';
  const conversationId = hostSessionId + ':22222222-2222-4222-8222-222222222222:33333333-3333-4333-8333-333333333333';
  const request = {
    user: { profile: { handle: 'alice' } },
    session: {
      handle: 'alice',
      logicEngineSessionId: hostSessionId,
      logicEngineSessionHandle: 'alice',
    },
  };
  const authenticatedRequests = new WeakSet([request]);
  let activeConversationId = conversationId;
  const verifyMiddlewareSession = candidate => authenticatedRequests.has(candidate);
  const resolveActiveConversation = candidate => candidate === request ? activeConversationId : null;

  await runWithAuthenticatedHostSession(
    request, conversationId, async () => {
      assert.ok(getAuthenticatedHostSessionContext());

      request.session.logicEngineSessionId = '44444444-4444-4444-8444-444444444444';
      assert.equal(getAuthenticatedHostSessionContext(), null);
      request.session.logicEngineSessionId = hostSessionId;
      assert.ok(getAuthenticatedHostSessionContext());

      request.user.profile.handle = 'bob';
      request.session.handle = 'bob';
      request.session.logicEngineSessionHandle = 'bob';
      assert.equal(getAuthenticatedHostSessionContext(), null);
      request.user.profile.handle = 'alice';
      request.session.handle = 'alice';
      request.session.logicEngineSessionHandle = 'alice';
      assert.ok(getAuthenticatedHostSessionContext());

      authenticatedRequests.delete(request);
      assert.equal(getAuthenticatedHostSessionContext(), null);
      authenticatedRequests.add(request);
      assert.ok(getAuthenticatedHostSessionContext());

      activeConversationId = null;
      assert.equal(getAuthenticatedHostSessionContext(), null);
      activeConversationId = conversationId;
      assert.ok(getAuthenticatedHostSessionContext());

      assert.throws(() => runWithAuthenticatedHostSession(
        request, conversationId, () => true, verifyMiddlewareSession, resolveActiveConversation,
      ), /HOST_SESSION_AUTHENTICATION_REQUIRED/);
    },
    verifyMiddlewareSession,
    resolveActiveConversation,
  );

  assert.equal(getAuthenticatedHostSessionContext(), null);
  assert.throws(() => runWithAuthenticatedHostSession(
    request, conversationId, () => true, verifyMiddlewareSession, resolveActiveConversation,
  ), /HOST_SESSION_AUTHENTICATION_REQUIRED/);
});

test('cross-process Host session assertion creates a Core capability only for a valid, fresh, non-replayed signature', async () => {
  const secret = 'adapter-secret-for-host-assertion-test';
  const nowSeconds = 1_800_000_000;
  const assertion = {
    protocol_version: 1,
    host_installation_id: '22222222-2222-4222-8222-222222222222',
    authenticated_account_id: '33333333-3333-4333-8333-333333333333',
    host_session_id: '11111111-1111-4111-8111-111111111111',
    conversation_id: '11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:44444444-4444-4444-8444-444444444444',
    issued_at: nowSeconds,
    nonce: '55555555-5555-4555-8555-555555555555',
  };
  const signature = createHmac('sha256', secret)
    .update(JSON.stringify([
      assertion.protocol_version,
      assertion.host_installation_id,
      assertion.authenticated_account_id,
      assertion.host_session_id,
      assertion.conversation_id,
      assertion.issued_at,
      assertion.nonce,
    ]), 'utf8').digest('hex');
  const runner = createHostSessionAssertionRunner({
    secret,
    now: () => nowSeconds * 1000,
  });
  const context = await runner.run(assertion, signature, async () => getAuthenticatedHostSessionContext());
  assert.equal(context.identity, 'SIGNED_HOST_SESSION_ASSERTION');
  assert.equal(context.host_installation_id, assertion.host_installation_id);
  assert.equal(context.authenticated_account_id, assertion.authenticated_account_id);
  assert.equal(context.host_session_id, assertion.host_session_id);
  assert.equal(context.conversation_id, assertion.conversation_id);
  assert.throws(() => runner.run(assertion, signature, () => true), /HOST_SESSION_ASSERTION_REPLAYED/);
});

test('cross-process Host session assertion rejects malformed scope, tampering, expiry and future timestamps', () => {
  const secret = 'adapter-secret-for-host-assertion-test';
  const nowSeconds = 1_800_000_000;
  const base = {
    protocol_version: 1,
    host_installation_id: '22222222-2222-4222-8222-222222222222',
    authenticated_account_id: '33333333-3333-4333-8333-333333333333',
    host_session_id: '11111111-1111-4111-8111-111111111111',
    conversation_id: '11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:44444444-4444-4444-8444-444444444444',
    issued_at: nowSeconds,
    nonce: '55555555-5555-4555-8555-555555555555',
  };
  const sign = value => createHmac('sha256', secret).update(JSON.stringify([
    value.protocol_version, value.host_installation_id, value.authenticated_account_id,
    value.host_session_id, value.conversation_id, value.issued_at, value.nonce,
  ]), 'utf8').digest('hex');
  const runner = createHostSessionAssertionRunner({ secret, now: () => nowSeconds * 1000 });
  assert.throws(() => runner.run({ ...base, conversation_id: 'forged' }, sign(base), () => true),
    /HOST_SESSION_ASSERTION_INVALID/);
  assert.throws(() => runner.run(base, '0'.repeat(64), () => true),
    /HOST_SESSION_ASSERTION_INVALID/);
  assert.throws(() => runner.run({ ...base, issued_at: nowSeconds - 31 }, sign({ ...base, issued_at: nowSeconds - 31 }), () => true),
    /HOST_SESSION_ASSERTION_EXPIRED/);
  assert.throws(() => runner.run({ ...base, issued_at: nowSeconds + 6 }, sign({ ...base, issued_at: nowSeconds + 6 }), () => true),
    /HOST_SESSION_ASSERTION_EXPIRED/);
  assert.throws(() => runner.run({ ...base, extra: true }, sign(base), () => true),
    /HOST_SESSION_ASSERTION_INVALID/);
});
