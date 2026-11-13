import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HostLifecycleReceiptStore,
  createCommunicationDeliveryReceipt,
} from '../server-plugin/st-host-lifecycle-receipt-store.mjs';
import { createHostLifecycleJournalProxy } from '../server-plugin/st-server-digest-proxy.mjs';
import { verifyHostMutationReceiptSignature } from '../server-plugin/st-host-mutation-receipt-signature.mjs';

const INSTALLATION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const SESSION = '11111111-1111-4111-8111-111111111111';
const CONVERSATION = '33333333-3333-4333-8333-333333333333';
const PREPARED_EVENT = '44444444-4444-4444-8444-444444444444';
const TERMINAL_EVENT = '55555555-5555-4555-8555-555555555555';
const MUTATION = '66666666-6666-4666-8666-666666666666';
const MESSAGE_OLD = '77777777-7777-4777-8777-777777777777';
const VERSION_OLD = '88888888-8888-4888-8888-888888888888';
const MESSAGE_NEW = '99999999-9999-4999-8999-999999999999';
const VERSION_NEW = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const HOST_COMMIT = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';
const occurredAt = '2026-11-13T12:00:00.000Z';
const digest = value => createHash('sha256').update(String(value)).digest('hex');
const canonical = value => Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);

const version = (id, content, index = 0, parent = null, active = true) => ({
  version_id: id,
  version_index: index,
  parent_version_id: parent,
  content_sha256: digest(content),
  active,
});
const message = (id, role, content, versionId) => ({
  message_id: id,
  role,
  active_version_index: 0,
  versions: [version(versionId, content)],
});
const logical = messages => ({
  conversation_uuid: CONVERSATION,
  identity_status: 'CURRENT_IDENTITIES_VERIFIED',
  missing_message_identity_count: 0,
  messages,
});
const recipientBinding = {
  adapter_id: 'sillytavern-main',
  conversation_id: [SESSION, INSTALLATION, CONVERSATION].join(':'),
  host_character_avatar_id: 'avatar-main',
  world_id: 'world-default',
  actor_id: 'npc-main',
  actor_type: 'npc',
};
const scope = overrides => ({
  host_installation_id: INSTALLATION,
  authenticated_account_id: ACCOUNT,
  host_session_id: SESSION,
  conversation_uuid: CONVERSATION,
  mutation_id: MUTATION,
  event_id: PREPARED_EVENT,
  operation: 'message-send',
  mutation_digest: digest('message-send-operation'),
  occurred_at: occurredAt,
  ...overrides,
});
const directories = {
  root: '/tmp/logic-engine-st-delivery-fixture',
  chats: '/tmp/logic-engine-st-delivery-fixture/chats',
  groups: '/tmp/logic-engine-st-delivery-fixture/groups',
  groupChats: '/tmp/logic-engine-st-delivery-fixture/groupChats',
};

function snapshotProof(snapshotId, content) {
  return {
    host_commit: HOST_COMMIT,
    snapshot_id: snapshotId,
    source_snapshot_id: snapshotId,
    snapshot_sha256: digest('filesystem:' + content),
    source_inventory_sha256: digest(content + ':inventory'),
    source_manifest_sha256: digest('pinned-source-manifest'),
    mutation_coverage_manifest_sha256: digest('mutation-coverage-manifest'),
    mutation_coverage_source_files_sha256: digest('mutation-coverage-source-files'),
    snapshot_alignment: 'SHARED_VSS_SNAPSHOT',
  };
}

function inventory(state) {
  const target = {
    kind: state.kind ?? 'character-chat',
    locator: state.locator ?? 'avatar-main/chat-1.jsonl',
    file_identity: '1:' + state.fileIdentity,
    content_sha256: digest(state.content),
    logical_identity: logical(state.messages),
  };
  const targetPath = 'chats/' + target.locator;
  return {
    filesystem: {
      status: 'complete',
      snapshot_id: state.snapshotId,
      snapshot_sha256: digest('filesystem:' + state.content),
      entries: [{
        path: targetPath,
        identity: {
          dev: '1',
          ino: state.fileIdentity,
          mode: 33188,
          size: state.content.length,
          mtimeMs: state.fileIdentity === '101' ? 1 : 2,
          ctimeMs: 1,
        },
        sha256: target.content_sha256,
      }],
    },
    source: {
      status: 'DOUBLE_SCAN_CANDIDATE',
      host_commit: HOST_COMMIT,
      files: [target],
      inventory_sha256: digest(state.content + ':inventory'),
      snapshot_id: state.snapshotId,
    },
    snapshot_alignment: 'SHARED_VSS_SNAPSHOT',
  };
}

test('delivery receipt is created only for one persisted appended user message in its bound direct character chat', async t => {
  const root = mkdtempSync(join(tmpdir(), 'st-communication-delivery-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const beforeMessages = [message(MESSAGE_OLD, 'assistant', 'previous NPC reply', VERSION_OLD)];
  const afterMessages = [
    ...beforeMessages,
    message(MESSAGE_NEW, 'user', 'new user communication', VERSION_NEW),
  ];
  let scan = 0;
  const states = [
    { fileIdentity: '101', content: 'persisted-before', snapshotId: 'snapshot-before', messages: beforeMessages },
    { fileIdentity: '101', content: 'persisted-after', snapshotId: 'snapshot-after', messages: afterMessages },
  ];
  const store = new HostLifecycleReceiptStore({
    directory: join(root, 'receipts'),
    hostCommit: HOST_COMMIT,
    enumerate: async () => inventory(states[Math.min(scan++, states.length - 1)]),
    sourceEvidenceProvider: async () => ({
      status: 'VERIFIED',
      source_manifest_sha256: digest('pinned-source-manifest'),
      mutation_coverage_manifest_sha256: digest('mutation-coverage-manifest'),
      mutation_coverage_source_files_sha256: digest('mutation-coverage-source-files'),
    }),
  });

  await store.prepare(scope(), directories);
  const committed = await store.commit(scope({
    event_id: TERMINAL_EVENT,
    prepared_event_id: PREPARED_EVENT,
  }), directories, { recipientBinding });

  assert.equal(committed.status, 'appended');
  assert.equal(scan, 2, 'receipt uses fresh before/after server inventories');
  assert.equal(committed.communication_delivery.evidence_type, 'communication_delivered');
  assert.equal(committed.communication_delivery.producer, 'logic-engine-host-delivery-receipt-v1');
  assert.equal(committed.communication_delivery.sender.principal_id, ACCOUNT);
  assert.equal(committed.communication_delivery.recipient.actor_id, 'npc-main');
  assert.equal(committed.communication_delivery.source.message_id, MESSAGE_NEW);
  assert.equal(committed.communication_delivery.source.version_id, VERSION_NEW);
  assert.equal(committed.communication_delivery.source.content_sha256, digest('new user communication'));
  assert.equal(committed.communication_delivery.status, 'delivered');
  assert.equal(JSON.stringify(committed.communication_delivery).includes('new user communication'), false);
});

test('delivery evidence rejects group chats, assistant output, historical insertion, and recipient mismatch', () => {
  const beforeMessages = [message(MESSAGE_OLD, 'assistant', 'previous NPC reply', VERSION_OLD)];
  const appendedUser = message(MESSAGE_NEW, 'user', 'new user communication', VERSION_NEW);
  const scopeValue = scope();
  const base = {
    scope: scopeValue,
    before: {
      target_kind: 'character-chat',
      target_locator: 'avatar-main/chat-1.jsonl',
      logical_identity: logical(beforeMessages),
      snapshot_proof: snapshotProof('snapshot-before', 'persisted-before'),
    },
    after: {
      target_locator: 'avatar-main/chat-1.jsonl',
      target_kind: 'character-chat',
      logical_identity: logical([...beforeMessages, appendedUser]),
      snapshot_proof: snapshotProof('snapshot-after', 'persisted-after'),
    },
    recipientBinding,
    hostCommit: HOST_COMMIT,
  };

  assert.ok(createCommunicationDeliveryReceipt(base));
  assert.equal(createCommunicationDeliveryReceipt({
    ...base,
    before: { ...base.before, target_kind: 'group-chat' },
    after: { ...base.after, target_kind: 'group-chat' },
  }), null);
  assert.equal(createCommunicationDeliveryReceipt({
    ...base,
    after: { ...base.after, logical_identity: logical([...beforeMessages, message(MESSAGE_NEW, 'assistant', 'generated output', VERSION_NEW)]) },
  }), null);
  assert.equal(createCommunicationDeliveryReceipt({
    ...base,
    after: { ...base.after, logical_identity: logical([appendedUser, ...beforeMessages]) },
  }), null);
  assert.equal(createCommunicationDeliveryReceipt({
    ...base,
    recipientBinding: { ...recipientBinding, host_character_avatar_id: 'another-avatar' },
  }), null);
});

test('delivery evidence rejects a message with multiple or non-root versions', () => {
  const beforeMessages = [message(MESSAGE_OLD, 'assistant', 'previous NPC reply', VERSION_OLD)];
  const twoVersionMessage = {
    message_id: MESSAGE_NEW,
    role: 'user',
    active_version_index: 1,
    versions: [
      version(VERSION_NEW, 'first version', 0, null, false),
      version('bbbbbbbb-cccc-4ddd-8eee-ffffffffffff', 'second version', 1, VERSION_NEW, true),
    ],
  };
  const base = {
    scope: scope(),
    before: {
      target_kind: 'character-chat',
      target_locator: 'avatar-main/chat-1.jsonl',
      logical_identity: logical(beforeMessages),
      snapshot_proof: snapshotProof('snapshot-before', 'before'),
    },
    after: {
      target_kind: 'character-chat',
      target_locator: 'avatar-main/chat-1.jsonl',
      logical_identity: logical([...beforeMessages, twoVersionMessage]),
      snapshot_proof: snapshotProof('snapshot-after', 'after'),
    },
    recipientBinding,
    hostCommit: HOST_COMMIT,
  };
  assert.equal(createCommunicationDeliveryReceipt(base), null);
});


test('delivery evidence remains unavailable for non-VSS scans or changed pinned-source attestations', () => {
  const beforeMessages = [message(MESSAGE_OLD, 'assistant', 'previous NPC reply', VERSION_OLD)];
  const afterMessages = [...beforeMessages, message(MESSAGE_NEW, 'user', 'new user communication', VERSION_NEW)];
  const base = {
    scope: scope(),
    before: {
      target_kind: 'character-chat',
      target_locator: 'avatar-main/chat-1.jsonl',
      logical_identity: logical(beforeMessages),
      snapshot_proof: snapshotProof('snapshot-before', 'before'),
    },
    after: {
      target_kind: 'character-chat',
      target_locator: 'avatar-main/chat-1.jsonl',
      logical_identity: logical(afterMessages),
      snapshot_proof: snapshotProof('snapshot-after', 'after'),
    },
    recipientBinding,
    hostCommit: HOST_COMMIT,
  };
  assert.ok(createCommunicationDeliveryReceipt(base));
  assert.equal(createCommunicationDeliveryReceipt({
    ...base,
    after: { ...base.after, snapshot_proof: { ...base.after.snapshot_proof, snapshot_alignment: 'INDEPENDENT_DOUBLE_SCAN' } },
  }), null);
  assert.equal(createCommunicationDeliveryReceipt({
    ...base,
    after: { ...base.after, snapshot_proof: { ...base.after.snapshot_proof, source_manifest_sha256: digest('changed-source') } },
  }), null);
  assert.equal(createCommunicationDeliveryReceipt({
    ...base,
    after: { ...base.after, snapshot_proof: { ...base.after.snapshot_proof, snapshot_id: 'snapshot-before', source_snapshot_id: 'snapshot-before' } },
  }), null);
});


test('authenticated Host lifecycle proxy returns the signed receipt from the real VSS-gated receipt store', async t => {
  const root = mkdtempSync(join(tmpdir(), 'st-host-delivery-proxy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dataRoot = join(root, 'data');
  const directoriesForTest = {
    root: dataRoot,
    chats: join(dataRoot, 'chats'),
    groups: join(dataRoot, 'groups'),
    groupChats: join(dataRoot, 'groupChats'),
    extensions: join(dataRoot, 'extensions'),
  };
  const { mkdirSync } = await import('node:fs');
  for (const directory of Object.values(directoriesForTest)) mkdirSync(directory, { recursive: true });
  const previousDataRoot = globalThis.DATA_ROOT;
  globalThis.DATA_ROOT = dataRoot;
  t.after(() => {
    if (previousDataRoot === undefined) delete globalThis.DATA_ROOT;
    else globalThis.DATA_ROOT = previousDataRoot;
  });

  const beforeMessages = [message(MESSAGE_OLD, 'assistant', 'previous NPC reply', VERSION_OLD)];
  const afterMessages = [...beforeMessages, message(MESSAGE_NEW, 'user', 'new user communication', VERSION_NEW)];
  let scan = 0;
  const states = [
    { fileIdentity: '201', content: 'proxy-before', snapshotId: 'proxy-snapshot-before', messages: beforeMessages },
    { fileIdentity: '201', content: 'proxy-after', snapshotId: 'proxy-snapshot-after', messages: afterMessages },
  ];
  const receiptStore = new HostLifecycleReceiptStore({
    directory: join(root, 'receipts'),
    hostCommit: HOST_COMMIT,
    enumerate: async () => inventory(states[Math.min(scan++, states.length - 1)]),
    sourceEvidenceProvider: async () => ({
      status: 'VERIFIED',
      source_manifest_sha256: digest('pinned-source-manifest'),
      mutation_coverage_manifest_sha256: digest('mutation-coverage-manifest'),
      mutation_coverage_source_files_sha256: digest('mutation-coverage-source-files'),
    }),
  });
  const config = {
    LOGIC_ENGINE_CORE_URL: 'http://127.0.0.1:52087',
    LOGIC_ENGINE_API_TOKEN: 'a'.repeat(32),
    LOGIC_ENGINE_ADAPTER_ID: recipientBinding.adapter_id,
    LOGIC_ENGINE_ADAPTER_TOKEN: 'b'.repeat(32),
  };
  const proxy = createHostLifecycleJournalProxy({
    env: config,
    identityStore: {
      assertOutsideRoot: async () => {},
      resolveAuthenticatedAccount: async () => ({
        host_installation_id: INSTALLATION,
        authenticated_account_id: ACCOUNT,
      }),
    },
    receiptStore,
    resolveCommunicationRecipient: async ({ targetLocator }) => {
      assert.equal(targetLocator, 'avatar-main/chat-1.jsonl');
      return recipientBinding;
    },
    fetchImpl: async () => ({
      status: 201,
      json: async () => ({ lifecycle: { status: 'appended' } }),
    }),
  });
  const request = {
    user: { profile: { handle: 'alice' }, directories: directoriesForTest },
    session: { logicEngineSessionId: SESSION, logicEngineSessionHandle: 'alice', handle: 'alice' },
    body: {
      conversation_id: [INSTALLATION, ACCOUNT, CONVERSATION].join(':'),
      event_id: PREPARED_EVENT,
      event_type: 'MUTATION_PREPARED',
      mutation_id: MUTATION,
      operation: 'message-send',
      mutation_digest: digest('message-send-operation'),
      occurred_at: occurredAt,
    },
  };
  const response = () => ({
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  });

  const preparedResponse = response();
  await proxy.append(request, preparedResponse);
  assert.equal(preparedResponse.statusCode, 201);
  assert.equal(request.session.logicEngineHostPreparedMutation.target_kind, 'character-chat');

  request.body = { ...request.body, event_id: TERMINAL_EVENT, event_type: 'MUTATION_COMMITTED' };
  const committedResponse = response();
  await proxy.append(request, committedResponse);

  const envelope = committedResponse.payload.communication_delivery_receipt;
  assert.equal(committedResponse.statusCode, 201);
  assert.equal(scan, 2);
  assert.equal(envelope.evidence_type, 'communication_delivered');
  assert.equal(envelope.delivery.source.message_id, MESSAGE_NEW);
  assert.equal(envelope.delivery.recipient.actor_id, 'npc-main');
  assert.equal(verifyHostMutationReceiptSignature({
    adapterId: recipientBinding.adapter_id,
    adapterToken: config.LOGIC_ENGINE_ADAPTER_TOKEN,
    event: envelope.proof,
  }), true);
  assert.equal(JSON.stringify(envelope).includes('new user communication'), false);
});
