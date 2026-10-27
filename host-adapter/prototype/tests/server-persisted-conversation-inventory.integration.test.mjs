import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { getHostConversationInventory, registerHostConversation } from '../server-lifecycle-mutation-journal.mjs';

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
    await registerHostConversation(request, {
      conversationId: 'install:' + uuid,
      sourceLocator: 'chat-a',
      domain: 'chats',
    });
    const result = await getHostConversationInventory(request);
    assert.equal(result.status, 'CURRENT_PERSISTED_SNAPSHOT_NON_AUTHORITATIVE');
    assert.equal(result.complete, true);
    assert.equal(result.conversationCount, 1);
    assert.equal(result.messageCount, 1);
    assert.equal(result.versionCount, 2);
    assert.deepEqual(result.inventories[0].versions.map(v => v.active), [false, true]);
    assert.doesNotMatch(JSON.stringify(result), /active secret|old secret/);
  } finally {
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
    await registerHostConversation(request, {
      conversationId: 'install:' + uuid,
      sourceLocator: 'missing',
      domain: 'chats',
    });
    const result = await getHostConversationInventory(request);
    assert.equal(result.status, 'INVENTORY_INCOMPLETE');
    assert.equal(result.complete, false);
    assert.ok(result.errors.includes('ENROLLED_CONVERSATION_FILE_MISSING'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
