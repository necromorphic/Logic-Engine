import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { enumeratePinnedSillyTavernChatFiles } from '../server-plugin/st-source-inventory.mjs';

const HOST_COMMIT = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';

test('legacy group metadata migration is visible as a Host inventory blocker', {
  skip: process.platform === 'win32',
}, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'logic-engine-legacy-group-metadata-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directories = {
    chats: path.join(root, 'chats'),
    groups: path.join(root, 'groups'),
    groupChats: path.join(root, 'group chats'),
  };
  await Promise.all(Object.values(directories).map(directory => mkdir(directory, { recursive: true })));
  await writeFile(path.join(directories.groups, 'group-one.json'), JSON.stringify({
    id: 'group-one',
    chats: ['group-chat-one'],
    chat_metadata: { legacy: true },
  }));
  await writeFile(path.join(directories.groupChats, 'group-chat-one.jsonl'), [
    JSON.stringify({ chat_metadata: { logic_engine_conversation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } }),
    JSON.stringify({ name: 'User', is_user: true, mes: 'hello' }),
  ].join('\n') + '\n');

  const inventory = await enumeratePinnedSillyTavernChatFiles({ directories, hostCommit: HOST_COMMIT });
  assert.equal(inventory.status, 'DOUBLE_SCAN_CANDIDATE');
  assert.equal(inventory.legacy_group_metadata_count, 1);
  assert.ok(inventory.blockers.includes('LEGACY_GROUP_METADATA_MIGRATION_PENDING'));
});
