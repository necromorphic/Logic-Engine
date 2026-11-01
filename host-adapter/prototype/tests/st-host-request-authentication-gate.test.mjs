import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostRequestAuthenticationGate } from '../st-host-inventory-handler.mjs';

function makeResponse() {
  return {
    statusCode: null,
    headers: {},
    set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    sendStatus(code) { this.statusCode = code; return this; },
  };
}

const sessionId = '2e6b0a80-4e73-4c66-aaf3-7a6e62c7f401';
const installationId = '3e6b0a80-4e73-4c66-aaf3-7a6e62c7f402';
const accountId = '5e6b0a80-4e73-4c66-aaf3-7a6e62c7f404';
const conversationUuid = '4e6b0a80-4e73-4c66-aaf3-7a6e62c7f403';
const conversationId = [installationId, accountId, conversationUuid].join(':');

function identityStore() {
  const calls = [];
  return {
    calls,
    async resolveAuthenticatedAccount(handle) {
      calls.push(handle);
      return {
        host_installation_id: installationId,
        authenticated_account_id: accountId,
      };
    },
  };
}

function authenticatedRequest(handle = 'default-user') {
  return {
    user: { profile: { handle }, directories: { chats: '/private/chats' } },
    session: {
      logicEngineSessionId: sessionId,
      logicEngineSessionHandle: handle,
    },
    body: { conversation_id: 'attacker-selected', world_id: 'attacker-world', actor_id: 'attacker-actor' },
    headers: { 'x-conversation-id': 'attacker-header-id' },
  };
}

test('Host gate brands exact request with canonical installation:account:conversation identity', async () => {
  const store = identityStore();
  let resolverContext;
  const request = authenticatedRequest();
  const gate = createHostRequestAuthenticationGate({
    identityStore: store,
    resolveConversationUuid: async (candidate, context) => {
      assert.equal(candidate, request);
      resolverContext = context;
      return conversationUuid;
    },
  });
  assert.equal(gate.isAuthenticatedHostRequest(request), false);
  assert.equal(gate.resolveHostConversationId(request), null);

  const response = makeResponse();
  let nextCalls = 0;
  await gate.middleware(request, response, () => { nextCalls++; });
  assert.equal(response.statusCode, null);
  assert.equal(nextCalls, 1);
  assert.deepEqual(store.calls, ['default-user']);
  assert.deepEqual(resolverContext, {
    host_installation_id: installationId,
    authenticated_account_id: accountId,
    host_session_id: sessionId,
    host_user_handle: 'default-user',
  });
  assert.equal(gate.isAuthenticatedHostRequest(request), true);
  assert.equal(gate.resolveHostConversationId(request), conversationId);
  assert.equal(gate.resolveHostConversationId(request).split(':')[0], installationId);
  assert.equal(gate.resolveHostConversationId(request).split(':')[1], accountId);
  assert.equal(gate.resolveHostConversationId(request).split(':')[2], conversationUuid);
  assert.equal(gate.resolveHostConversationId(request).includes(sessionId), false);
  assert.equal(response.headers['cache-control'], 'no-store, private');
  assert.equal(response.headers.vary, 'Cookie');

  const clone = { ...request };
  assert.equal(gate.isAuthenticatedHostRequest(clone), false);
  assert.equal(gate.resolveHostConversationId(clone), null);
});

test('Host gate keeps the transient signed session separate from durable conversation identity', async () => {
  const store = identityStore();
  const gate = createHostRequestAuthenticationGate({
    identityStore: store,
    resolveConversationUuid: () => conversationUuid,
  });
  const first = authenticatedRequest();
  const firstResponse = makeResponse();
  await gate.middleware(first, firstResponse, () => {});
  assert.equal(gate.resolveHostConversationId(first), conversationId);

  const second = authenticatedRequest();
  second.session.logicEngineSessionId = '6e6b0a80-4e73-4c66-aaf3-7a6e62c7f406';
  const secondResponse = makeResponse();
  await gate.middleware(second, secondResponse, () => {});
  assert.equal(gate.resolveHostConversationId(second), conversationId);
  assert.notEqual(first.session.logicEngineSessionId, second.session.logicEngineSessionId);
});

test('Host gate rejects mismatched account sessions and missing authenticated user roots', async () => {
  const store = identityStore();
  const gate = createHostRequestAuthenticationGate({
    identityStore: store,
    resolveConversationUuid: () => conversationUuid,
  });
  for (const request of [
    {
      user: { profile: { handle: 'alice' }, directories: {} },
      session: { handle: 'bob', logicEngineSessionId: sessionId, logicEngineSessionHandle: 'alice' },
    },
    {
      user: { profile: { handle: 'alice' } },
      session: { handle: 'alice', logicEngineSessionId: sessionId, logicEngineSessionHandle: 'alice' },
    },
    {
      user: { profile: { handle: 'alice' }, directories: {} },
      session: { handle: 'alice', logicEngineSessionId: sessionId, logicEngineSessionHandle: 'bob' },
    },
  ]) {
    const response = makeResponse();
    let nextCalls = 0;
    await gate.middleware(request, response, () => { nextCalls++; });
    assert.equal(response.statusCode, 403);
    assert.equal(nextCalls, 0);
  }
  assert.deepEqual(store.calls, []);
});

test('Host gate rejects malformed server identities and conversation UUIDs', async () => {
  const badStores = [
    { resolveAuthenticatedAccount: async () => ({ host_installation_id: 'bad', authenticated_account_id: accountId }) },
    { resolveAuthenticatedAccount: async () => ({ host_installation_id: installationId, authenticated_account_id: 'bad' }) },
  ];
  for (const store of badStores) {
    const gate = createHostRequestAuthenticationGate({
      identityStore: store,
      resolveConversationUuid: () => conversationUuid,
    });
    const response = makeResponse();
    await gate.middleware(authenticatedRequest(), response, () => assert.fail('must deny'));
    assert.equal(response.statusCode, 403);
  }

  for (const resolver of [
    () => { throw new Error('private resolver detail'); },
    () => 'caller-controlled-id',
    () => null,
  ]) {
    const gate = createHostRequestAuthenticationGate({
      identityStore: identityStore(),
      resolveConversationUuid: resolver,
    });
    const request = authenticatedRequest();
    const response = makeResponse();
    await gate.middleware(request, response, () => assert.fail('must deny'));
    assert.equal(response.statusCode, 403);
    assert.equal(gate.isAuthenticatedHostRequest(request), false);
  }
});

test('Host gate requires the server-owned identity store and resolver at construction', () => {
  assert.throws(() => createHostRequestAuthenticationGate({ resolveConversationUuid: () => conversationUuid }),
    /identity store/i);
  assert.throws(() => createHostRequestAuthenticationGate({ identityStore: identityStore() }),
    /conversation resolver/i);
});
