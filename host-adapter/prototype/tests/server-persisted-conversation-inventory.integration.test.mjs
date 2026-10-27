import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { getHostConversationInventory, recordHostCaptureAcknowledgement, registerHostConversation } from '../server-lifecycle-mutation-journal.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(String(value))).digest('hex');

test('server inventory reads registered persisted chat and returns only version identities/digests', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'host-persisted-inventory-integration-'));
  const directories = {
    chats: path.join(root, 'chats'),
    groups: path.join(root, 'groups'),
    groupChats: path.join(root, 'group_chats'),
    backups: path.join(root, 'backups'),
  };
  await Promise.all(Object.values(directories).map(dir => mkdir(dir, { recursive: true })));
  const request = { user: { profile: { handle: 'test-user' }, directories } };
  const envKeys = ['LOGIC_ENGINE_CORE_URL', 'LOGIC_ENGINE_API_TOKEN', 'LOGIC_ENGINE_ADAPTER_ID', 'LOGIC_ENGINE_ADAPTER_TOKEN'];
  const priorEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const uuid = randomUUID();
  const messageId = randomUUID();
  const oldVersionId = randomUUID();
  const activeVersionId = randomUUID();
  await writeFile(path.join(directories.chats, 'chat-a.jsonl'), [
    JSON.stringify({ chat_metadata: { logic_engine_conversation_id: uuid } }),
    JSON.stringify({
      mes: 'active secret',
      swipes: ['old secret', 'active secret'],
      swipe_id: 1,
      _logicEngineLifecycle: {
        messageId,
        activeVersionIndex: 1,
        versions: [
          { versionId: oldVersionId, payloadDigest: digest('old secret'), parentVersionId: null },
          { versionId: activeVersionId, payloadDigest: digest('active secret'), parentVersionId: oldVersionId },
        ],
      },
    }),
  ].join('\n') + '\n');
  try {
    const conversationId = randomUUID() + ':' + uuid;
    await registerHostConversation(request, {
      conversationId,
      sourceLocator: 'chat-a',
      sourcePath: 'chat-a.jsonl',
      domain: 'chats',
    });
    await recordHostCaptureAcknowledgement(request, { conversation_id: conversationId, message_id: messageId, version_id: oldVersionId, content_sha256: digest('old secret'), active: false, deleted: false });
    await recordHostCaptureAcknowledgement(request, { conversation_id: conversationId, message_id: messageId, version_id: activeVersionId, content_sha256: digest('active secret'), active: true, deleted: false });
    process.env.LOGIC_ENGINE_CORE_URL = 'http://127.0.0.1:8787';
    process.env.LOGIC_ENGINE_API_TOKEN = 'test-core-api-token-long-enough';
    process.env.LOGIC_ENGINE_ADAPTER_ID = 'adapter-test';
    process.env.LOGIC_ENGINE_ADAPTER_TOKEN = 'test-adapter-token-long-enough';
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ inventory: {
      authority: 'CORE_HOST_VERSION_LEDGER',
      conversation_id: conversationId,
      inventory_status: 'READY',
      versions: [
        { message_id: messageId, version_id: oldVersionId, content_sha256: digest('old secret'), active: false, deleted: false },
        { message_id: messageId, version_id: activeVersionId, content_sha256: digest('active secret'), active: true, deleted: false },
      ],
    } }) });
    const result = await getHostConversationInventory(request, { requireCoreInventory: true });
    assert.equal(result.status, 'ENROLLMENT_FORWARD_ONLY_OBSERVED_INVENTORY_NON_AUTHORITATIVE');
    assert.equal(result.complete, true);
    assert.equal(result.conversationCount, 1);
    assert.equal(result.messageCount, 1);
    assert.equal(result.versionCount, 2);
    assert.equal(result.inventories[0].versions.filter(v => v.active).length, 1);
    assert.equal(result.inventories[0].versions.find(v => v.active).version_id, activeVersionId);
    assert.doesNotMatch(JSON.stringify(result), /active secret|old secret/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of envKeys) {
      if (priorEnv[key] === undefined) delete process.env[key];
      else process.env[key] = priorEnv[key];
    }
    await rm(root, { recursive: true, force: true });
  }
});

test('server inventory fails closed when enrolled persisted identity is absent', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'host-persisted-inventory-missing-'));
  const directories = {
    chats: path.join(root, 'chats'),
    groups: path.join(root, 'groups'),
    groupChats: path.join(root, 'group_chats'),
    backups: path.join(root, 'backups'),
  };
  await Promise.all(Object.values(directories).map(dir => mkdir(dir, { recursive: true })));
  const request = { user: { profile: { handle: 'test-user' }, directories } };
  try {
    const uuid = randomUUID();
    await writeFile(path.join(directories.chats, 'missing.jsonl'), JSON.stringify({
      chat_metadata: { logic_engine_conversation_id: uuid },
    }) + '\n');
    await registerHostConversation(request, {
      conversationId: randomUUID() + ':' + uuid,
      sourceLocator: 'missing',
      sourcePath: 'missing.jsonl',
      domain: 'chats',
    });
    await rm(path.join(directories.chats, 'missing.jsonl'));
    const result = await getHostConversationInventory(request);
    assert.equal(result.status, 'INVENTORY_INCOMPLETE');
    assert.equal(result.complete, false);
    assert.ok(result.errors.includes('ENROLLED_CONVERSATION_FILE_MISSING'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
