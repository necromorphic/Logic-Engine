import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostRequestAuthenticationGate } from '../st-host-inventory-handler.mjs';
import { getAuthenticatedHostSessionContext, runWithAuthenticatedHostSession } from '../../../src/application/host-session-context.js';

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
const conversationUuid = '4e6b0a80-4e73-4c66-aaf3-7a6e62c7f403';
const conversationId = [sessionId, installationId, conversationUuid].join(':');

test('Host gate brands only the exact request after trusted conversation resolution', async () => {
  const resolved = new WeakMap();
  const request = {
    user: { profile: { handle: 'default-user' }, directories: { chats: '/private/chats' } },
    session: { logicEngineSessionId: sessionId, logicEngineSessionHandle: 'default-user' },
    body: { conversation_id: 'attacker-selected' },
  };
  resolved.set(request, conversationId);
  const gate = createHostRequestAuthenticationGate({
    resolveConversationId: candidate => resolved.get(candidate),
  });
  assert.equal(gate.isAuthenticatedHostRequest(request), false);
  assert.equal(gate.resolveHostConversationId(request), null);

  const response = makeResponse();
  let nextCalls = 0;
  await gate.middleware(request, response, () => { nextCalls++; });
  assert.equal(nextCalls, 1);
  assert.equal(response.statusCode, null);
  assert.equal(gate.isAuthenticatedHostRequest(request), true);
  assert.equal(gate.resolveHostConversationId(request), conversationId);
  assert.equal(response.headers['cache-control'], 'no-store, private');
  assert.equal(response.headers.vary, 'Cookie');

  // Copying the trusted request's visible fields does not copy its capability.
  const clone = { ...request };
  assert.equal(gate.isAuthenticatedHostRequest(clone), false);
  assert.equal(gate.resolveHostConversationId(clone), null);
});

test('Host gate rejects a conversation bound to a different signed session', async () => {
  const request = {
    user: { profile: { handle: 'alice' }, directories: {} },
    session: { handle: 'alice', logicEngineSessionId: sessionId, logicEngineSessionHandle: 'alice' },
  };
  const gate = createHostRequestAuthenticationGate({
    resolveConversationId: () => [installationId, sessionId, conversationUuid].join(':'),
  });
  const response = makeResponse();
  let nextCalls = 0;
  await gate.middleware(request, response, () => { nextCalls++; });
  assert.equal(response.statusCode, 403);
  assert.equal(nextCalls, 0);
  assert.equal(gate.isAuthenticatedHostRequest(request), false);
});

test('Host gate rejects mismatched account sessions and missing server user roots', async () => {
  const gate = createHostRequestAuthenticationGate({ resolveConversationId: () => conversationId });
  for (const request of [
    {
      user: { profile: { handle: 'alice' }, directories: {} },
      session: { handle: 'bob', logicEngineSessionId: sessionId, logicEngineSessionHandle: 'alice' },
    },
    {
      user: { profile: { handle: 'alice' } },
      session: { handle: 'alice', logicEngineSessionId: sessionId, logicEngineSessionHandle: 'alice' },
    },
  ]) {
    const response = makeResponse();
    let nextCalls = 0;
    await gate.middleware(request, response, () => { nextCalls++; });
    assert.equal(response.statusCode, 403);
    assert.equal(nextCalls, 0);
    assert.equal(gate.isAuthenticatedHostRequest(request), false);
  }
});

test('Host gate fails closed when trusted conversation resolution throws or returns malformed identity', async () => {
  for (const resolver of [
    () => { throw new Error('private resolver detail'); },
    () => 'caller-controlled-id',
    () => [installationId, sessionId, conversationUuid].join(':'),
  ]) {
    const gate = createHostRequestAuthenticationGate({ resolveConversationId: resolver });
    const request = {
      user: { profile: { handle: 'alice' }, directories: {} },
      session: { handle: 'alice', logicEngineSessionId: sessionId, logicEngineSessionHandle: 'alice' },
    };
    const response = makeResponse();
    let nextCalls = 0;
    await gate.middleware(request, response, () => { nextCalls++; });
    assert.equal(response.statusCode, 403);
    assert.equal(nextCalls, 0);
    assert.equal(gate.isAuthenticatedHostRequest(request), false);
  }
});


test('Host gate callbacks create the exact Core AsyncLocalStorage capability', async () => {
  const request = {
    user: { profile: { handle: 'default-user' }, directories: {} },
    session: { logicEngineSessionId: sessionId, logicEngineSessionHandle: 'default-user' },
  };
  const gate = createHostRequestAuthenticationGate({ resolveConversationId: () => conversationId });
  const response = makeResponse();
  await gate.middleware(request, response, () => {});
  const context = await runWithAuthenticatedHostSession(
    request,
    conversationId,
    () => getAuthenticatedHostSessionContext(),
    gate.isAuthenticatedHostRequest,
    gate.resolveHostConversationId,
  );
  assert.equal(context.conversation_id, conversationId);
  assert.equal(context.host_session_id, sessionId);

  await assert.rejects(
    () => runWithAuthenticatedHostSession(
      { ...request },
      conversationId,
      () => getAuthenticatedHostSessionContext(),
      gate.isAuthenticatedHostRequest,
      gate.resolveHostConversationId,
    ),
    /HOST_SESSION_AUTHENTICATION_REQUIRED/,
  );
});
