import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, link, symlink, rm } from 'node:fs/promises';
import {
  enumeratePinnedSillyTavernChatFiles,
  HostSourceInventoryError,
  readBoundedFileHandle,
} from '../host-adapter/prototype/st-source-inventory.mjs';

const PINNED = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'le-host-inventory-'));
  const directories = {
    chats: path.join(root, 'chats'),
    groups: path.join(root, 'groups'),
    groupChats: path.join(root, 'group chats'),
  };
  await Promise.all(Object.values(directories).map(directory => mkdir(directory, { recursive: true })));
  await mkdir(path.join(directories.chats, 'character-a'));
  await writeFile(path.join(directories.chats, 'root-chat.jsonl'), '[{"mes":"root"}]\n');
  await writeFile(path.join(directories.chats, 'character-a', 'chat-a.jsonl'), '[{"mes":"character"}]\n');
  await writeFile(path.join(directories.groups, 'group-a.json'), JSON.stringify({
    id: 'group-a',
    chats: ['group-chat-a'],
  }));
  await writeFile(path.join(directories.groupChats, 'group-chat-a.jsonl'), '[{"mes":"group"}]\n');
  return { root, directories, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function scan(directories, hostCommit = PINNED) {
  return enumeratePinnedSillyTavernChatFiles({ directories, hostCommit });
}

test('enumerates root, character and group chat files as a non-authoritative stable candidate', async t => {
  const value = await fixture();
  t.after(value.cleanup);
  const result = await scan(value.directories);
  assert.equal(result.status, 'DOUBLE_SCAN_CANDIDATE');
  assert.equal(result.authority, 'NON_AUTHORITATIVE');
  assert.equal(result.completeness, 'DOUBLE_SCANNED_PATH_VIEW_ONLY');
  assert.ok(result.blockers.includes('NO_ATOMIC_DIRECTORY_SNAPSHOT'));
  assert.ok(result.blockers.includes('PATH_BASED_DIRECTORY_REPLACEMENT_RACE_REMAINS'));
  assert.equal(result.file_count, 4);
  assert.deepEqual(result.files.map(file => file.kind).sort(), [
    'character-chat', 'group-chat', 'group-metadata', 'root-chat',
  ]);
  assert.match(result.inventory_sha256, /^[a-f0-9]{64}$/);
  assert.ok(result.blockers.includes('NO_PRE_ENROLLMENT_DELETED_HISTORY'));
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

test('bounded file-handle reader rejects an append during read without consuming beyond maxBytes + 1', async () => {
  const original = Buffer.from('1234');
  let current = original;
  let position = 0;
  let totalRead = 0;
  let appended = false;
  const fakeHandle = {
    async read(buffer, offset, length, requestedPosition) {
      assert.equal(requestedPosition, position);
      if (!appended) {
        current = Buffer.concat([current, Buffer.from('56789')]);
        appended = true;
      }
      const available = Math.max(0, current.length - position);
      const bytesRead = Math.min(length, available);
      if (bytesRead > 0) current.copy(buffer, offset, position, position + bytesRead);
      position += bytesRead;
      totalRead += bytesRead;
      return { bytesRead, buffer };
    },
  };

  await assert.rejects(
    readBoundedFileHandle(fakeHandle, 4),
    error => error instanceof HostSourceInventoryError && error.code === 'SOURCE_FILE_SIZE_LIMIT',
  );
  assert.equal(totalRead, 5);
  assert.equal(position, 5);
});
