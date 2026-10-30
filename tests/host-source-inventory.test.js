import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, link, symlink, rm } from 'node:fs/promises';
import {
  enumeratePinnedSillyTavernChatFiles,
  HostSourceInventoryError,
} from '../host-adapter/prototype/st-source-inventory.mjs';

const PINNED = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';
const UUIDS = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
];
const chatFile = (id, message) => [
  JSON.stringify({ user_name: 'User', character_name: 'Character', chat_metadata: id ? { logic_engine_conversation_id: id } : {} }),
  JSON.stringify({ mes: message }),
  '',
].join('\\n');

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'le-host-inventory-'));
  const directories = {
    chats: path.join(root, 'chats'),
    groups: path.join(root, 'groups'),
    groupChats: path.join(root, 'group chats'),
  };
  await Promise.all(Object.values(directories).map(directory => mkdir(directory, { recursive: true })));
  await mkdir(path.join(directories.chats, 'character-a'));
  await writeFile(path.join(directories.chats, 'root-chat.jsonl'), chatFile(UUIDS[0], 'root'));
  await writeFile(path.join(directories.chats, 'character-a', 'chat-a.jsonl'), chatFile(UUIDS[1], 'character'));
  await writeFile(path.join(directories.groups, 'group-a.json'), JSON.stringify({
    id: 'group-a',
    chats: ['group-chat-a'],
  }));
  await writeFile(path.join(directories.groupChats, 'group-chat-a.jsonl'), chatFile(UUIDS[2], 'group'));
  return { root, directories, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function scan(directories, hostCommit = PINNED) {
  return enumeratePinnedSillyTavernChatFiles({ directories, hostCommit });
}

test('enumerates root, character and group chat files as a non-authoritative stable candidate', async t => {
  const value = await fixture();
  t.after(value.cleanup);
  const result = await scan(value.directories);
  assert.equal(result.status, 'STABLE_SCAN_CANDIDATE');
  assert.equal(result.authority, 'NON_AUTHORITATIVE');
  assert.equal(result.completeness, 'STABLE_CURRENT_FILE_SET_ONLY');
  assert.equal(result.file_count, 4);
  assert.equal(result.chat_file_count, 3);
  assert.equal(result.chat_files_with_stable_identity, 3);
  assert.equal(result.conversation_identity_completeness, 'COMPLETE_CURRENT_FILE_SET');
  assert.deepEqual(result.files.filter(file => file.stable_conversation_uuid).map(file => file.stable_conversation_uuid).sort(), [...UUIDS].sort());
  assert.deepEqual(result.files.map(file => file.kind).sort(), [
    'character-chat', 'group-chat', 'group-metadata', 'root-chat',
  ]);
  assert.match(result.inventory_sha256, /^[a-f0-9]{64}$/);
  assert.ok(result.blockers.includes('NO_PRE_ENROLLMENT_DELETED_HISTORY'));
});


test('reports missing persisted conversation identity as incomplete without inventing one', async t => {
  const value = await fixture();
  t.after(value.cleanup);
  await writeFile(path.join(value.directories.chats, 'root-chat.jsonl'), chatFile(null, 'root'));
  const result = await scan(value.directories);
  assert.equal(result.status, 'STABLE_SCAN_CANDIDATE');
  assert.equal(result.conversation_identity_completeness, 'INCOMPLETE_CURRENT_FILE_SET');
  assert.equal(result.chat_files_with_stable_identity, 2);
  assert.ok(result.blockers.includes('CHAT_CONVERSATION_IDENTITY_MISSING_OR_NO_CHAT_FILES'));
  const root = result.files.find(file => file.locator === 'root-chat.jsonl');
  assert.equal(root.stable_conversation_uuid, null);
  assert.equal(root.conversation_identity_status, 'MISSING');
});

test('rejects duplicate persisted conversation UUIDs across different chat files', async t => {
  const value = await fixture();
  t.after(value.cleanup);
  await writeFile(path.join(value.directories.groupChats, 'group-chat-a.jsonl'), chatFile(UUIDS[0], 'duplicate'));
  await assert.rejects(scan(value.directories), error =>
    error instanceof HostSourceInventoryError && error.code === 'SOURCE_CONVERSATION_IDENTITY_DUPLICATE');
});

test('rejects malformed persisted conversation UUIDs', async t => {
  const value = await fixture();
  t.after(value.cleanup);
  await writeFile(path.join(value.directories.chats, 'root-chat.jsonl'), chatFile('not-a-uuid', 'bad'));
  await assert.rejects(scan(value.directories), error =>
    error instanceof HostSourceInventoryError && error.code === 'SOURCE_CONVERSATION_IDENTITY_INVALID');
});

test('rejects malformed chat header JSON instead of silently losing its identity', async t => {
  const value = await fixture();
  t.after(value.cleanup);
  await writeFile(path.join(value.directories.chats, 'root-chat.jsonl'), 'not-json\n[]\n');
  await assert.rejects(scan(value.directories), error =>
    error instanceof HostSourceInventoryError && error.code === 'SOURCE_CHAT_HEADER_INVALID');
});

test('rejects a host build other than the pinned SillyTavern commit', async t => {
  const value = await fixture();
  t.after(value.cleanup);
  await assert.rejects(scan(value.directories, 'deadbeef'), error =>
    error instanceof HostSourceInventoryError && error.code === 'SOURCE_LAYOUT_OR_HOST_BUILD_UNSUPPORTED');
});

test('rejects orphaned group chat files rather than silently omitting them', async t => {
  const value = await fixture();
  t.after(value.cleanup);
  await writeFile(path.join(value.directories.groupChats, 'orphan.jsonl'), '[]\n');
  await assert.rejects(scan(value.directories), error =>
    error instanceof HostSourceInventoryError && error.code === 'SOURCE_ORPHAN_GROUP_CHAT');
});

test('rejects a group metadata reference whose chat file is missing', async t => {
  const value = await fixture();
  t.after(value.cleanup);
  await rm(path.join(value.directories.groupChats, 'group-chat-a.jsonl'));
  await assert.rejects(scan(value.directories), error =>
    error instanceof HostSourceInventoryError && error.code === 'SOURCE_GROUP_CHAT_MISSING');
});

test('rejects hard-linked aliases in different SillyTavern chat roots', async t => {
  const value = await fixture();
  t.after(value.cleanup);
  await writeFile(path.join(value.directories.groups, 'group-a.json'), JSON.stringify({
    id: 'group-a',
    chats: ['group-chat-a', 'linked-chat'],
  }));
  await link(
    path.join(value.directories.chats, 'root-chat.jsonl'),
    path.join(value.directories.groupChats, 'linked-chat.jsonl'),
  );
  await assert.rejects(scan(value.directories), error =>
    error instanceof HostSourceInventoryError && error.code === 'SOURCE_FILE_IDENTITY_DUPLICATE');
});

test('rejects unknown entries instead of returning a partial inventory', async t => {
  const value = await fixture();
  t.after(value.cleanup);
  await writeFile(path.join(value.directories.chats, 'ignored.tmp'), 'not a chat');
  await assert.rejects(scan(value.directories), error =>
    error instanceof HostSourceInventoryError && error.code === 'SOURCE_UNKNOWN_CHAT_LAYOUT');
});

test('rejects symbolic links in enumerated roots', async t => {
  const value = await fixture();
  t.after(value.cleanup);
  const outside = path.join(value.root, 'outside.jsonl');
  await writeFile(outside, '[]\n');
  try {
    await symlink(outside, path.join(value.directories.chats, 'linked.jsonl'));
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
      t.skip('The current platform does not permit creating a symlink in this test environment.');
      return;
    }
    throw error;
  }
  await assert.rejects(scan(value.directories), error =>
    error instanceof HostSourceInventoryError && error.code === 'SOURCE_REPARSE_ENTRY');
});

test('rejects aliased inventory roots', async t => {
  const value = await fixture();
  t.after(value.cleanup);
  const directories = { ...value.directories, groups: value.directories.chats };
  await assert.rejects(scan(directories), error =>
    error instanceof HostSourceInventoryError && error.code === 'SOURCE_ROOT_ALIAS');
});
