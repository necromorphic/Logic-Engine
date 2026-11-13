import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createHostLifecycleJournalProxy } from '../server-plugin/st-server-digest-proxy.mjs';
import { verifyHostMutationReceiptSignature } from '../server-plugin/st-host-mutation-receipt-signature.mjs';

const canonical = value => Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);
const CONFIG = {
  LOGIC_ENGINE_CORE_URL: 'http://127.0.0.1:52087',
  LOGIC_ENGINE_API_TOKEN: 'a'.repeat(32),
  LOGIC_ENGINE_ADAPTER_ID: 'sillytavern-main',
  LOGIC_ENGINE_ADAPTER_TOKEN: 'b'.repeat(32),
};
const installationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const accountId = '22222222-2222-4222-8222-222222222222';
const sessionId = '11111111-1111-4111-8111-111111111111';
const conversationUuid = '33333333-3333-4333-8333-333333333333';
const conversationId = [installationId, accountId, conversationUuid].join(':');
const coreConversationId = [sessionId, installationId, conversationUuid].join(':');
const eventId = '44444444-4444-4444-8444-444444444444';
const mutationId = '55555555-5555-4555-8555-555555555555';
const mutationDigest = 'a'.repeat(64);
const occurredAt = '2026-11-13T12:00:00.000Z';
const directories = {
  root: '/tmp/st-root',
  chats: '/tmp/st-root/chats',
  groups: '/tmp/st-root/groups',
  groupChats: '/tmp/st-root/groupChats',
  extensions: '/tmp/st-root/extensions',
};
globalThis.DATA_ROOT = '/tmp/st-global-data-root';

function requestFor(body) {
  return {
    body,
    user: { profile: { handle: 'alice' }, directories },
    session: {
      handle: 'alice',
      logicEngineSessionId: sessionId,
      logicEngineSessionHandle: 'alice',
    },
  };
}

function responseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

test('production Host lifecycle proxy issues signed communication evidence only for the prepared direct-character message send', async () => {
  const recipientBinding = {
    adapter_id: CONFIG.LOGIC_ENGINE_ADAPTER_ID,
    conversation_id: coreConversationId,
    host_character_avatar_id: 'avatar-main',
    world_id: 'world-default',
    actor_id: 'npc-main',
    actor_type: 'npc',
  };
  const delivery = {
    protocol_version: 1,
    evidence_type: 'communication_delivered',
    producer: 'logic-engine-host-delivery-receipt-v1',
    host_commit: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
    host_installation_id: installationId,
    authenticated_account_id: accountId,
    host_session_id: sessionId,
    conversation_uuid: conversationUuid,
    sender: { principal_type: 'host_authenticated_account', principal_id: accountId },
    recipient: { world_id: 'world-default', actor_id: 'npc-main', actor_type: 'npc' },
    channel: 'sillytavern.character_chat',
    source: {
      message_id: '88888888-8888-4888-8888-888888888888',
      version_id: '99999999-9999-4999-8999-999999999999',
      content_sha256: 'c'.repeat(64),
    },
    status: 'delivered',
    delivered_at: occurredAt,
    host_event_id: eventId,
    mutation_id: mutationId,
  };
  let recipientCalls = 0;
  let commitOptions = null;
  const receiptStore = {
    assertOutsideRoot: async () => {},
    prepare: async () => ({
      status: 'appended',
      prepared: {
        occurred_at: occurredAt,
        before: { target_kind: 'character-chat', target_locator: 'avatar-main/chat-1.jsonl' },
      },
    }),
    commit: async (_scope, _directories, options) => {
      commitOptions = options;
      return {
        status: 'appended',
        receipt_digest: 'f'.repeat(64),
        occurred_at: occurredAt,
        communication_delivery: delivery,
      };
    },
    abort: async () => ({ status: 'appended', occurred_at: occurredAt }),
    recover: async () => ({ status: 'RECOVERY_REQUIRED' }),
  };
  const proxy = createHostLifecycleJournalProxy({
    env: CONFIG,
    identityStore: {
      assertOutsideRoot: async () => {},
      resolveAuthenticatedAccount: async () => ({
        host_installation_id: installationId,
        authenticated_account_id: accountId,
      }),
    },
    receiptStore,
    resolveCommunicationRecipient: async input => {
      recipientCalls++;
      assert.equal(input.hostSessionId, sessionId);
      assert.equal(input.conversationUuid, conversationUuid);
      assert.equal(input.targetLocator, 'avatar-main/chat-1.jsonl');
      return recipientBinding;
    },
    fetchImpl: async () => ({ status: 201, json: async () => ({ lifecycle: { status: 'appended' } }) }),
  });

  const preparedEvent = {
    conversation_id: conversationId,
    event_id: eventId,
    event_type: 'MUTATION_PREPARED',
    mutation_id: mutationId,
    operation: 'message-send',
    mutation_digest: mutationDigest,
    occurred_at: '2000-01-01T00:00:00.000Z',
  };
  const request = requestFor(preparedEvent);
  const preparedResponse = responseRecorder();
  await proxy.append(request, preparedResponse);
  assert.equal(preparedResponse.statusCode, 201);
  assert.equal(request.session.logicEngineHostPreparedMutation.target_kind, 'character-chat');
  assert.equal(request.session.logicEngineHostPreparedMutation.target_locator, 'avatar-main/chat-1.jsonl');

  request.body = { ...preparedEvent, event_id: '66666666-6666-4666-8666-666666666666', event_type: 'MUTATION_COMMITTED' };
  const committedResponse = responseRecorder();
  await proxy.append(request, committedResponse);
  assert.equal(committedResponse.statusCode, 201);
  assert.equal(recipientCalls, 1);
  assert.deepEqual(commitOptions, { recipientBinding });
  const envelope = committedResponse.payload.communication_delivery_receipt;
  assert.equal(envelope.evidence_type, 'communication_delivered');
  assert.deepEqual(envelope.delivery, delivery);
  assert.equal(envelope.receipt_digest, createHash('sha256').update(canonical(delivery), 'utf8').digest('hex'));
  assert.equal(verifyHostMutationReceiptSignature({
    adapterId: CONFIG.LOGIC_ENGINE_ADAPTER_ID,
    adapterToken: CONFIG.LOGIC_ENGINE_ADAPTER_TOKEN,
    event: envelope.proof,
  }), true);
  assert.equal(JSON.stringify(envelope).includes('raw message text'), false);
});
