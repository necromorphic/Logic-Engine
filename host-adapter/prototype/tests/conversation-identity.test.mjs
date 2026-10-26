import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { hasAnyHostEnrollment, hostLocatorHasEnrollment, resolveStableHostConversationIdentity } from '../conversation-identity.mjs';

const INSTALL_A = '11111111-1111-4111-8111-111111111111';
const INSTALL_B = '22222222-2222-4222-8222-222222222222';
const CHAT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHAT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const prefix = 'logic-engine-host-lifecycle:';
const locatorKey = locator => 'logic-engine-host-lifecycle-locator:' + locator;

class Storage {
  values = new Map();
  get length() { return this.values.size; }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
  key(index) { return [...this.values.keys()][index] ?? null; }
}

const resolver = async ({ locator = 'chat-file.jsonl', metadata = {}, storage = new Storage(), saveMetadata = async () => {}, ...rest } = {}) =>
  resolveStableHostConversationIdentity({
    locator, metadata, storage, saveMetadata,
    cryptoProvider: webcrypto,
    getCurrentLocator: () => locator,
    getCurrentMetadata: () => metadata,
    ...rest,
  });

test('creates and persists an installation-scoped stable conversation identity', async () => {
  const storage = new Storage();
  storage.setItem('logic-engine-host-installation-id', INSTALL_A);
  const metadata = {};
  let saves = 0;
  const result = await resolver({ metadata, storage, saveMetadata: async () => { saves++; } });
  assert.equal(result.status, 'READY_FOR_REVIEW');
  assert.equal(result.conversationId, INSTALL_A + ':' + metadata.logic_engine_conversation_id);
  assert.match(metadata.logic_engine_conversation_id, /^[0-9a-f-]{36}$/i);
  assert.equal(saves, 1);
  const again = await resolver({ metadata, storage });
  assert.equal(again.conversationId, result.conversationId);
  assert.equal(again.created, undefined);
});

test('a locator binding prevents silent identity replacement or metadata deletion', async () => {
  const storage = new Storage();
  storage.setItem('logic-engine-host-installation-id', INSTALL_A);
  const metadata = { logic_engine_conversation_id: CHAT_A };
  storage.setItem(locatorKey('chat-file.jsonl'), INSTALL_A + ':' + CHAT_A);
  metadata.logic_engine_conversation_id = CHAT_B;
  await assert.rejects(resolver({ metadata, storage }), /locator metadata is missing or inconsistent/);
  delete metadata.logic_engine_conversation_id;
  await assert.rejects(resolver({ metadata, storage }), /locator metadata is missing or inconsistent/);
});

test('an enrolled marker without a locator binding fails closed except during the guarded rename window', async () => {
  const storage = new Storage();
  storage.setItem('logic-engine-host-installation-id', INSTALL_A);
  const metadata = { logic_engine_conversation_id: CHAT_A };
  const resolvedId = INSTALL_A + ':' + CHAT_A;
  storage.setItem(prefix + resolvedId, 'enrolled:old-name.jsonl');
  await assert.rejects(resolver({ locator: 'new-name.jsonl', metadata, storage }), /no matching locator binding/);
  const renamed = await resolver({
    locator: 'new-name.jsonl', metadata, storage, pendingRenameId: resolvedId,
  });
  assert.equal(renamed.conversationId, resolvedId);
});

test('same-install copy with reused chat metadata is rejected by locator binding', async () => {
  const storage = new Storage();
  storage.setItem('logic-engine-host-installation-id', INSTALL_A);
  const metadata = { logic_engine_conversation_id: CHAT_A };
  const resolvedId = INSTALL_A + ':' + CHAT_A;
  storage.setItem(prefix + resolvedId, 'enrolled:original.jsonl');
  storage.setItem(locatorKey('original.jsonl'), resolvedId);
  await assert.rejects(
    resolver({ locator: 'copy.jsonl', metadata, storage }),
    /no matching locator binding/,
  );
});

test('imported chat metadata on a different installation resolves to a different conversation identity', async () => {
  const storage = new Storage();
  storage.setItem('logic-engine-host-installation-id', INSTALL_B);
  const metadata = { logic_engine_conversation_id: CHAT_A };
  const result = await resolver({ locator: 'imported.jsonl', metadata, storage });
  assert.equal(result.conversationId, INSTALL_B + ':' + CHAT_A);
  assert.notEqual(result.conversationId, INSTALL_A + ':' + CHAT_A);
});

test('legacy filename-based enrollment marker cannot be silently upgraded', async () => {
  const storage = new Storage();
  storage.setItem('logic-engine-host-installation-id', INSTALL_A);
  storage.setItem(prefix + 'chat-file.jsonl', 'enrolled');
  await assert.rejects(resolver({ metadata: {}, storage }), /legacy identity migration required/);
});

test('missing identity metadata with an existing enrollment marker is non-ready', async () => {
  const storage = new Storage();
  storage.setItem('logic-engine-host-installation-id', INSTALL_A);
  storage.setItem(prefix + INSTALL_A + ':' + CHAT_A, 'enrolled:chat-file.jsonl');
  await assert.rejects(
    resolver({ locator: 'chat-file.jsonl', metadata: {}, storage }),
    /enrolled Host locator has no stable metadata identity/,
  );
});

test('failed metadata persistence does not leave an in-memory identity assigned', async () => {
  const storage = new Storage();
  storage.setItem('logic-engine-host-installation-id', INSTALL_A);
  const metadata = {};
  await assert.rejects(
    resolver({ metadata, storage, saveMetadata: async () => { throw Error('save failed'); } }),
    /durable Host conversation identity could not be saved/,
  );
  assert.equal(metadata.logic_engine_conversation_id, undefined);
});

test('locator enrollment lookup is conservative for single and bulk operations', () => {
  const storage = new Storage();
  storage.setItem('logic-engine-host-installation-id', INSTALL_A);
  const conversationId = INSTALL_A + ':' + CHAT_A;
  storage.setItem(locatorKey('enrolled-chat.jsonl'), conversationId);
  storage.setItem(prefix + conversationId, 'enrolled:enrolled-chat.jsonl');
  assert.equal(hostLocatorHasEnrollment('enrolled-chat.jsonl', storage), true);
  assert.equal(hostLocatorHasEnrollment('other-chat.jsonl', storage), false);
  assert.equal(hasAnyHostEnrollment(storage), true);
  storage.removeItem(prefix + conversationId);
  storage.removeItem(locatorKey('enrolled-chat.jsonl'));
  assert.equal(hasAnyHostEnrollment(storage), false);
});

