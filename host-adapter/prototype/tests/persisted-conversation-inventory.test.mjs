import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { scanPersistedConversationInventories } from '../persisted-conversation-inventory.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(String(value))).digest('hex');
const makeMessage = (text, swipes = [text], swipeId = 0) => {
  const messageId = randomUUID();
  const versions = swipes.map(value => ({ versionId: randomUUID(), payloadDigest: digest(value), parentVersionId: null }));
  return { mes: text, swipes, swipe_id: swipeId, _logicEngineLifecycle: { messageId, versions, activeVersionIndex: swipeId } };
};
const writeChat = async (root, locator, conversationUuid, messages) => {
  const file = path.join(root, locator + '.jsonl');
  await writeFile(file, [
    JSON.stringify({ chat_metadata: { logic_engine_conversation_id: conversationUuid } }),
    ...messages.map(JSON.stringify),
  ].join('\n') + '\n');
  return file;
};
const fixture = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'persisted-host-inventory-'));
  const chats = path.join(root, 'chats');
  const groups = path.join(root, 'group_chats');
  await mkdir(chats); await mkdir(groups);
  return { root, chats, groups, roots: [{ domain: 'chats', path: chats }, { domain: 'group_chats', path: groups }] };
};

test('persisted snapshot inventories every current swipe by stable identity and digest without exposing text', async () => {
  const f = await fixture();
  try {
    const uuid = randomUUID();
    const m1 = makeMessage('active answer', ['old answer', 'active answer'], 1);
    await writeChat(f.chats, 'chat-a', uuid, [m1]);
    const result = await scanPersistedConversationInventories(f.roots, [{ conversationId: randomUUID() + ':' + uuid, sourceLocator: 'chat-a', domain: 'chats' }]);
    assert.equal(result.status, 'CURRENT_PERSISTED_SNAPSHOT_NON_AUTHORITATIVE');
    assert.equal(result.complete, true);
    assert.equal(result.historicalCompleteness, 'UNKNOWN');
    assert.equal(result.messageCount, 1);
    assert.equal(result.versionCount, 2);
    assert.equal(result.inventories[0].versions.filter(v => v.active).length, 1);
    assert.equal(result.inventories[0].versions.find(v => v.active).payload_sha256, digest('active answer'));
    assert.doesNotMatch(JSON.stringify(result), /active answer|old answer/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('persisted snapshot rejects missing per-message identity instead of guessing from array index', async () => {
  const f = await fixture();
  try {
    const uuid = randomUUID();
    await writeChat(f.chats, 'chat-a', uuid, [{ mes: 'message without identity' }]);
    const result = await scanPersistedConversationInventories(f.roots, [{ conversationId: randomUUID() + ':' + uuid, sourceLocator: 'chat-a', domain: 'chats' }]);
    assert.equal(result.status, 'INVENTORY_INCOMPLETE');
    assert.deepEqual(result.inventories, []);
    assert.ok(result.errors.includes('MESSAGE_IDENTITY_OR_ACTIVE_POINTER_INVALID'));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('persisted snapshot rejects copied/branched artifacts that reuse an enrolled identity', async () => {
  const f = await fixture();
  try {
    const uuid = randomUUID();
    const m = makeMessage('hello');
    const file = await writeChat(f.chats, 'chat-a', uuid, [m]);
    await copyFile(file, path.join(f.chats, 'other-name.jsonl'));
    const result = await scanPersistedConversationInventories(f.roots, [{ conversationId: randomUUID() + ':' + uuid, sourceLocator: 'chat-a', domain: 'chats' }]);
    assert.equal(result.status, 'INVENTORY_INCOMPLETE');
    assert.ok(result.errors.includes('ENROLLED_CONVERSATION_LOCATOR_OR_DOMAIN_MISMATCH'));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('persisted snapshot rejects digest mismatch and malformed active selection', async () => {
  const f = await fixture();
  try {
    const uuid = randomUUID();
    const m = makeMessage('hello');
    m._logicEngineLifecycle.versions[0].payloadDigest = digest('tampered');
    await writeChat(f.chats, 'chat-a', uuid, [m]);
    const result = await scanPersistedConversationInventories(f.roots, [{ conversationId: randomUUID() + ':' + uuid, sourceLocator: 'chat-a', domain: 'chats' }]);
    assert.equal(result.status, 'INVENTORY_INCOMPLETE');
    assert.ok(result.errors.includes('VERSION_IDENTITY_OR_DIGEST_INVALID'));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('persisted snapshot rejects a missing enrolled file and invalid root coverage', async () => {
  const f = await fixture();
  try {
    const uuid = randomUUID();
    const missing = await scanPersistedConversationInventories(f.roots, [{ conversationId: randomUUID() + ':' + uuid, sourceLocator: 'missing', domain: 'chats' }]);
    assert.equal(missing.status, 'INVENTORY_INCOMPLETE');
    assert.ok(missing.errors.includes('ENROLLED_CONVERSATION_FILE_MISSING'));
    const noGroups = await scanPersistedConversationInventories([{ domain: 'chats', path: f.chats }], [{ conversationId: randomUUID() + ':' + uuid, sourceLocator: 'missing', domain: 'chats' }]);
    assert.ok(noGroups.errors.includes('BOTH_CHAT_DOMAINS_REQUIRED'));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
