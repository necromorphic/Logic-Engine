import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { enumerateHostDataInventory } from '../host-data-inventory.mjs';
import { isVerifiedFileInventory } from '../fs-inventory.js';

const test = nodeTest;

const PINNED = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';

function chatJsonl(id, label) {
  const suffix = String(id).padStart(12, '0');
  return [
    JSON.stringify({
      chat_metadata: {
        logic_engine_conversation_id: '00000000-0000-4000-8000-' + suffix,
      },
    }),
    JSON.stringify({
      mes: 'message ' + label,
      logic_engine_message_id: '10000000-0000-4000-8000-' + suffix,
      swipes: ['message ' + label],
      swipe_info: [{ logic_engine_version_id: '20000000-0000-4000-8000-' + suffix }],
    }),
  ].join('\n') + '\n';
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'le-host-data-inventory-'));
  const directories = {
    root,
    chats: path.join(root, 'chats'),
    groups: path.join(root, 'groups'),
    groupChats: path.join(root, 'group chats'),
  };
  await Promise.all(Object.values(directories).map(directory => mkdir(directory, { recursive: true })));
  await mkdir(path.join(directories.chats, 'character-a'));
  await writeFile(path.join(directories.chats, 'root-chat.jsonl'), chatJsonl(1, 'root'));
  await writeFile(path.join(directories.chats, 'character-a', 'chat-a.jsonl'), chatJsonl(2, 'character'));
  await writeFile(path.join(directories.groups, 'group-a.json'), JSON.stringify({
    id: 'group-a',
    chats: ['group-chat-a'],
  }));
  await writeFile(path.join(directories.groupChats, 'group-chat-a.jsonl'), chatJsonl(3, 'group'));
  await mkdir(path.join(root, 'characters'));
  await writeFile(path.join(root, 'characters', 'hero.json'), JSON.stringify({ name: 'hero' }));
  await mkdir(path.join(root, 'User Avatars'));
  await writeFile(path.join(root, 'User Avatars', 'persona.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await writeFile(path.join(root, 'settings.json'), JSON.stringify({ theme: 'dark' }));
  return { directories, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('full host data inventory covers character, avatar and settings files outside chat roots', async t => {
  const value = await fixture();
  t.after(value.cleanup);
  const result = await enumerateHostDataInventory({
    directories: value.directories,
    hostCommit: PINNED,
  });
  if (process.platform === 'win32') {
    assert.equal(result.snapshot_alignment, 'SHARED_VSS_SNAPSHOT');
    assert.equal(result.filesystem.snapshot_id, result.source.snapshot_id);
    assert.equal(result.filesystem.snapshot_provider, 'windows-vss-client-accessible');
    assert.ok(result.source.blockers.includes('NO_APPLICATION_LEVEL_ATOMIC_SNAPSHOT'));
  } else {
    assert.equal(result.snapshot_alignment, 'INDEPENDENT_DOUBLE_SCAN');
  }
  assert.equal(result.filesystem.status, 'complete');
  assert.equal(isVerifiedFileInventory(result.filesystem), true);
  assert.equal(result.filesystem.file_count, 7);
  assert.ok(result.filesystem.total_bytes > 0);
  assert.equal(result.filesystem.scope, 'single-root-regular-files-only');
  assert.ok(result.filesystem.entries.some(entry => entry.path === 'characters/hero.json'));
  assert.ok(result.filesystem.entries.some(entry => entry.path === 'User Avatars/persona.png'));
  assert.ok(result.filesystem.entries.some(entry => entry.path === 'settings.json'));
  assert.equal(result.source.status, 'DOUBLE_SCAN_CANDIDATE');
  assert.equal(result.source.file_count, 4);
  assert.equal(result.source.authority, 'NON_AUTHORITATIVE');
});

test('Windows full host inventory shares one VSS snapshot across generic and semantic scans', {
  skip: process.platform !== 'win32',
  timeout: 240_000,
}, async t => {
  const value = await fixture();
  t.after(value.cleanup);
  const result = await enumerateHostDataInventory({
    directories: value.directories,
    hostCommit: PINNED,
  });
  assert.equal(result.snapshot_alignment, 'SHARED_VSS_SNAPSHOT');
  assert.equal(result.filesystem.status, 'complete');
  assert.equal(isVerifiedFileInventory(result.filesystem), true);
  assert.equal(result.filesystem.snapshot_id, result.source.snapshot_id);
  assert.equal(result.filesystem.snapshot_provider, 'windows-vss-client-accessible');
  assert.equal(result.source.snapshot_provider, 'windows-vss-client-accessible');
  assert.equal(result.filesystem.file_count, 7);
  assert.equal(result.source.file_count, 4);
  assert.ok(result.source.blockers.includes('NO_APPLICATION_LEVEL_ATOMIC_SNAPSHOT'));
});
