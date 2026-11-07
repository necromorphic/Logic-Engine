import nodeTest from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, link, symlink, rm } from 'node:fs/promises';
import {
  enumeratePinnedSillyTavernChatFiles,
  HostSourceInventoryError,
  readBoundedFileHandle,
} from '../host-adapter/prototype/st-source-inventory.mjs';


// Windows source inventory uses the VSS-backed path. The symlink-specific
// assertion remains covered by the dedicated VSS reparse/junction integration test.
const test = (name, optionsOrFn, maybeFn) => {
  const options = typeof optionsOrFn === 'function' ? {} : optionsOrFn;
  const fn = typeof optionsOrFn === 'function' ? optionsOrFn : maybeFn;
  const windowsSymlinkTest = name === 'rejects symbolic links in enumerated roots';
  const skip = process.platform === 'win32' && windowsSymlinkTest
    ? 'VSS integration test separately verifies rejection of Windows reparse points.'
    : options?.skip;
  return nodeTest(name, { ...options, ...(skip ? { skip } : {}) }, fn);
};

const PINNED = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';

const uuid = value => '00000000-0000-4000-8000-' + String(value).padStart(12, '0');
const sha256 = value => createHash('sha256').update(value, 'utf8').digest('hex');
function chatJsonl(seed, text) {
  const versionId = uuid(seed + 2);
  return [
    { chat_metadata: { logic_engine_conversation_id: uuid(seed) } },
    {
      is_user: false,
      mes: text,
      swipes: [text],
      swipe_id: 0,
      _logicEngineLifecycle: {
        messageId: uuid(seed + 1),
        activeVersionIndex: 0,
        versions: [{ versionId, versionIndex: 0, parentVersionId: null, payloadDigest: sha256(text) }],
      },
    },
  ].map(value => JSON.stringify(value)).join('\n') + '\n';
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'le-host-inventory-'));
  const directories = {
    chats: path.join(root, 'chats'),
    groups: path.join(root, 'groups'),
    groupChats: path.join(root, 'group chats'),
  };
  await Promise.all(Object.values(directories).map(directory => mkdir(directory, { recursive: true })));
  await mkdir(path.join(directories.chats, 'character-a'));
  await writeFile(path.join(directories.chats, 'root-chat.jsonl'), chatJsonl(1, 'root'));
  await writeFile(path.join(directories.chats, 'character-a', 'chat-a.jsonl'), chatJsonl(4, 'character'));
  await writeFile(path.join(directories.groups, 'group-a.json'), JSON.stringify({
    id: 'group-a',
    chats: ['group-chat-a'],
  }));
  await writeFile(path.join(directories.groupChats, 'group-chat-a.jsonl'), chatJsonl(7, 'group'));
  return { root, directories, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function scan(directories, hostCommit = PINNED) {
  return enumeratePinnedSillyTavernChatFiles({ directories, hostCommit });
}

test('enumerates root, character and group chat files as a non-authoritative double-scan candidate', async t => {
  const value = await fixture();
  t.after(value.cleanup);
  const result = await scan(value.directories);
  assert.equal(result.status, 'DOUBLE_SCAN_CANDIDATE');
  assert.equal(result.authority, 'NON_AUTHORITATIVE');
  assert.equal(result.completeness, 'DOUBLE_SCANNED_PATH_VIEW_ONLY');
  if (process.platform === 'win32') {
    assert.ok(result.blockers.includes('NO_APPLICATION_LEVEL_ATOMIC_SNAPSHOT'));
    assert.ok(!result.blockers.includes('NO_ATOMIC_DIRECTORY_SNAPSHOT'));
    assert.ok(!result.blockers.includes('PATH_BASED_DIRECTORY_REPLACEMENT_RACE_REMAINS'));
  } else {
    assert.ok(result.blockers.includes('NO_ATOMIC_DIRECTORY_SNAPSHOT'));
    assert.ok(result.blockers.includes('PATH_BASED_DIRECTORY_REPLACEMENT_RACE_REMAINS'));
  }
  assert.equal(result.file_count, 4);
  assert.deepEqual(result.files.map(file => file.kind).sort(), [
    'character-chat', 'group-chat', 'group-metadata', 'root-chat',
  ]);
  assert.match(result.inventory_sha256, /^[a-f0-9]{64}$/);
  assert.ok(result.blockers.includes('NO_PRE_ENROLLMENT_DELETED_HISTORY'));
});


test('extracts current conversation, message and swipe IDs with digests but never raw message text', async t => {
  const value = await fixture();
  t.after(value.cleanup);
  const result = await scan(value.directories);
  assert.equal(result.logical_identity_status, 'CURRENT_FILE_IDENTITIES_VERIFIED');
  assert.equal(result.conversation_identity_count, 3);
  assert.equal(result.message_identity_count, 3);
  assert.equal(result.version_identity_count, 3);
  const chatFiles = result.files.filter(file => file.logical_identity);
  assert.equal(chatFiles.length, 3);
  assert.ok(chatFiles.every(file => file.logical_identity.identity_status === 'CURRENT_IDENTITIES_VERIFIED'));
  assert.ok(chatFiles.every(file => file.logical_identity.messages.length === 1
    && file.logical_identity.messages[0].versions.length === 1
    && /^[a-f0-9]{64}$/.test(file.logical_identity.messages[0].versions[0].content_sha256)));
  assert.equal(JSON.stringify(result).includes('"root"'), false);
  assert.equal(JSON.stringify(result).includes('"character"'), false);
  assert.equal(JSON.stringify(result).includes('"group"'), false);
  assert.ok(result.blockers.includes('NO_HOST_INSTALLATION_BINDING'));
  assert.ok(result.blockers.includes('NO_COMPLETE_MESSAGE_OR_SWIPE_REVISION_HISTORY'));
});

test('legacy chat records without lifecycle IDs remain incomplete and receive no synthesized identity', async t => {
  const value = await fixture();
  t.after(value.cleanup);
  await writeFile(path.join(value.directories.chats, 'root-chat.jsonl'), [
    { chat_metadata: { logic_engine_conversation_id: uuid(1) } },
    { is_user: true, mes: 'legacy message' },
  ].map(record => JSON.stringify(record)).join('\n') + '\n');
  const result = await scan(value.directories);
  const root = result.files.find(file => file.locator === 'root-chat.jsonl');
  assert.equal(root.logical_identity.identity_status, 'INCOMPLETE');
  assert.equal(root.logical_identity.missing_message_identity_count, 1);
  assert.equal(root.logical_identity.messages.length, 0);
  assert.equal(result.logical_identity_status, 'INCOMPLETE');
  assert.ok(result.blockers.includes('CURRENT_CHAT_LOGICAL_IDENTITY_INCOMPLETE'));
});

test('rejects a persisted swipe digest that does not match the exact JSONL payload', async t => {
  const value = await fixture();
  t.after(value.cleanup);
  const file = path.join(value.directories.chats, 'root-chat.jsonl');
  const records = [JSON.parse(chatJsonl(1, 'root').split('\n')[0]), JSON.parse(chatJsonl(1, 'root').split('\n')[1])];
  records[1]._logicEngineLifecycle.versions[0].payloadDigest = '0'.repeat(64);
  await writeFile(file, records.map(record => JSON.stringify(record)).join('\n') + '\n');
  await assert.rejects(scan(value.directories), error =>
    error instanceof HostSourceInventoryError && error.code === 'SOURCE_CHAT_VERSION_DIGEST_MISMATCH');
});

test('accepts lifecycle edit revisions that are not represented as native swipe alternatives', async t => {
  const value = await fixture();
  t.after(value.cleanup);
  const previous = 'previous logical edit';
  const active = 'current persisted edit';
  const records = [
    { chat_metadata: { logic_engine_conversation_id: uuid(20) } },
    {
      is_user: true,
      mes: active,
      _logicEngineLifecycle: {
        messageId: uuid(21),
        activeVersionIndex: 1,
        versions: [
          { versionId: uuid(22), versionIndex: 0, parentVersionId: null, payloadDigest: sha256(previous) },
          { versionId: uuid(23), versionIndex: 1, parentVersionId: uuid(22), payloadDigest: sha256(active) },
        ],
      },
    },
  ];
  await writeFile(path.join(value.directories.chats, 'root-chat.jsonl'),
    JSON.stringify(records[0]) + String.fromCharCode(10) + JSON.stringify(records[1]) + String.fromCharCode(10));
  const result = await scan(value.directories);
  const root = result.files.find(file => file.locator === 'root-chat.jsonl');
  assert.equal(root.logical_identity.messages[0].active_version_index, 1);
  assert.deepEqual(root.logical_identity.messages[0].versions.map(version => version.active), [false, true]);
  assert.equal(root.logical_identity.messages[0].versions[1].content_sha256, sha256(active));
});

test('rejects an edit revision whose active digest differs from the persisted message body', async t => {
  const value = await fixture();
  t.after(value.cleanup);
  const active = 'current persisted edit';
  const records = [
    { chat_metadata: { logic_engine_conversation_id: uuid(30) } },
    {
      is_user: true,
      mes: active,
      _logicEngineLifecycle: {
        messageId: uuid(31),
        activeVersionIndex: 1,
        versions: [
          { versionId: uuid(32), versionIndex: 0, parentVersionId: null, payloadDigest: sha256('previous edit') },
          { versionId: uuid(33), versionIndex: 1, parentVersionId: uuid(32), payloadDigest: sha256('tampered active edit') },
        ],
      },
    },
  ];
  await writeFile(path.join(value.directories.chats, 'root-chat.jsonl'),
    JSON.stringify(records[0]) + String.fromCharCode(10) + JSON.stringify(records[1]) + String.fromCharCode(10));
  await assert.rejects(scan(value.directories), error =>
    error instanceof HostSourceInventoryError && error.code === 'SOURCE_CHAT_VERSION_DIGEST_MISMATCH');
});

test('rejects duplicate stable conversation UUIDs across different chat files', async t => {
  const value = await fixture();
  t.after(value.cleanup);
  await writeFile(path.join(value.directories.chats, 'character-a', 'chat-a.jsonl'), chatJsonl(1, 'different message'));
  await assert.rejects(scan(value.directories), error =>
    error instanceof HostSourceInventoryError && error.code === 'SOURCE_CHAT_CONVERSATION_ID_DUPLICATE');
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

test('preserves all current swipe identities and verifies the active swipe selection', async t => {
  const value = await fixture();
  t.after(value.cleanup);
  const prior = 'previous swipe';
  const active = 'active swipe';
  const records = [
    { chat_metadata: { logic_engine_conversation_id: uuid(10) } },
    {
      is_user: false,
      mes: active,
      swipes: [prior, active],
      swipe_id: 1,
      _logicEngineLifecycle: {
        messageId: uuid(11),
        activeVersionIndex: 1,
        versions: [
          { versionId: uuid(12), versionIndex: 0, parentVersionId: null, payloadDigest: sha256(prior) },
          { versionId: uuid(13), versionIndex: 1, parentVersionId: uuid(12), payloadDigest: sha256(active) },
        ],
      },
    },
  ];
  await writeFile(path.join(value.directories.chats, 'root-chat.jsonl'),
    records.map(record => JSON.stringify(record)).join('\n') + '\n');
  const result = await scan(value.directories);
  const root = result.files.find(file => file.locator === 'root-chat.jsonl');
  const message = root.logical_identity.messages[0];
  assert.equal(message.active_version_index, 1);
  assert.deepEqual(message.versions.map(version => version.active), [false, true]);
  assert.equal(message.versions.length, 2);
  assert.equal(message.versions[1].parent_version_id, uuid(12));
});

test('rejects a message body that disagrees with the persisted active swipe index', async t => {
  const value = await fixture();
  t.after(value.cleanup);
  const records = [JSON.parse(chatJsonl(1, 'root').split('\n')[0]), JSON.parse(chatJsonl(1, 'root').split('\n')[1])];
  records[1].swipes = ['other swipe'];
  records[1].swipe_id = 0;
  await writeFile(path.join(value.directories.chats, 'root-chat.jsonl'),
    records.map(record => JSON.stringify(record)).join('\n') + '\n');
  await assert.rejects(scan(value.directories), error =>
    error instanceof HostSourceInventoryError && error.code === 'SOURCE_CHAT_ACTIVE_MESSAGE_MISMATCH');
});



test('Windows pinned-source inventory uses an audited VSS point-in-time snapshot', {
  skip: process.platform !== 'win32',
  timeout: 240_000,
}, async t => {
  const value = await fixture();
  t.after(value.cleanup);
  const result = await scan(value.directories);
  assert.equal(result.status, 'DOUBLE_SCAN_CANDIDATE', JSON.stringify(result));
  assert.equal(result.authority, 'NON_AUTHORITATIVE');
  assert.equal(result.snapshot_provider, 'windows-vss-client-accessible');
  assert.equal(result.snapshot_consistency, 'VSS_POINT_IN_TIME_READ_ONLY');
  assert.equal(result.reparse_points, 'ALL_FILE_ATTRIBUTE_REPARSE_POINT_ENTRIES_REJECTED');
  assert.equal(result.file_count, 4);
  assert.ok(result.blockers.includes('NO_APPLICATION_LEVEL_ATOMIC_SNAPSHOT'));
  assert.ok(!result.blockers.includes('NO_ATOMIC_DIRECTORY_SNAPSHOT'));
  assert.ok(!result.blockers.includes('PATH_BASED_DIRECTORY_REPLACEMENT_RACE_REMAINS'));
});
