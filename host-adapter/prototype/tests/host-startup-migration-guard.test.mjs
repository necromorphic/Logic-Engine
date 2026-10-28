import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertHostStartupMigrationSafe, assertHostUserDataMigrationSafe } from './host-startup-migration-guard.mjs';

async function fixture({ enrolled = true, legacy = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'host-startup-migration-'));
  const chats = path.join(root, 'chats');
  const groups = path.join(root, 'groups');
  const state = path.join(root, '.logic-engine-host');
  await Promise.all([mkdir(chats), mkdir(groups), mkdir(state)]);
  await writeFile(path.join(state, 'enrollments.json'), JSON.stringify({
    version: 1,
    conversations: enrolled ? [{ conversationId: randomUUID() }] : [],
  }));
  await writeFile(path.join(groups, 'group.json'), JSON.stringify(legacy
    ? { id: 'group-a', chat_metadata: { old: true }, chats: [] }
    : { id: 'group-a', chats: [] }));
  return { root, directories: { chats, groups } };
}

test('allows startup migration when no Host enrollment exists', async () => {
  const f = await fixture({ enrolled: false, legacy: true });
  try { assert.equal((await assertHostStartupMigrationSafe([f.directories])).status, 'SAFE_TO_RUN_NO_ENROLLED_GROUP_MIGRATION'); }
  finally { await rm(f.root, { recursive: true, force: true }); }
});

test('blocks group metadata migration when enrolled history needs rewriting', async () => {
  const f = await fixture({ enrolled: true, legacy: true });
  try {
    await assert.rejects(assertHostStartupMigrationSafe([f.directories]), /HOST_STARTUP_GROUP_MIGRATION_BLOCKED_ENROLLED_HISTORY/);
    const group = JSON.parse(await readFile(path.join(f.directories.groups, 'group.json'), 'utf8'));
    assert.ok(Object.hasOwn(group, 'chat_metadata'), 'guard must not mutate source');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('fails closed if Host state exists but enrollment registry is missing', async () => {
  const f = await fixture();
  try {
    await rm(path.join(f.root, '.logic-engine-host', 'enrollments.json'));
    await assert.rejects(assertHostStartupMigrationSafe([f.directories]), /HOST_STARTUP_MIGRATION_REGISTRY_MISSING/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('blocks legacy public-data migration before it can overwrite enrolled Host data', async () => {
  const f = await fixture();
  const publicCharacters = path.join(f.root, 'public', 'characters');
  await mkdir(publicCharacters, { recursive: true });
  try {
    await assert.rejects(assertHostUserDataMigrationSafe([f.directories], publicCharacters), /HOST_STARTUP_PUBLIC_DATA_MIGRATION_BLOCKED_ENROLLED_HISTORY/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('allows legacy public-data migration when Host has never been enrolled', async () => {
  const f = await fixture({ enrolled: false });
  const publicCharacters = path.join(f.root, 'public', 'characters');
  await mkdir(publicCharacters, { recursive: true });
  try {
    assert.equal((await assertHostUserDataMigrationSafe([f.directories], publicCharacters)).status, 'SAFE_NO_ENROLLED_HOST_HISTORY');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
