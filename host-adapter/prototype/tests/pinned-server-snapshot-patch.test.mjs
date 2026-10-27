import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const patchPath = fileURLToPath(new URL('../patches/sillytavern-1.19.0-lifecycle-hooks.patch', import.meta.url));

test('pinned ST patch binds authenticated user before lifecycle mutation middleware', async () => {
  const patch = await readFile(patchPath, 'utf8');
  const start = patch.indexOf('diff --git a/src/server-startup.js');
  const end = patch.indexOf('\ndiff --git ', start + 1);
  assert.ok(start >= 0 && end > start, 'server-startup patch section exists');
  const section = patch.slice(start, end);
  const userBinding = section.indexOf(" app.use('/', userDataRouter);");
  const lifecycleGuard = section.indexOf('+    app.use(createHostLifecycleMutationMiddleware({ requirePersistedInventory: true }));');
  assert.ok(userBinding >= 0, 'authenticated user-data middleware is mounted');
  assert.ok(lifecycleGuard > userBinding, 'lifecycle guard runs after request.user binding');
});

test('pinned ST patch exposes server-derived persisted inventory, not caller-supplied inventory', async () => {
  const patch = await readFile(patchPath, 'utf8');
  assert.match(patch, /router\.post\('\/host-conversation-inventory\/scan',[\s\S]*?getHostConversationInventory\(request\)/);
  assert.match(patch, /export async function getHostConversationInventory\(request\)[\s\S]*?readRegistry\(paths\.registryPath\)[\s\S]*?scanPersistedConversationInventories\(/);
  assert.match(patch, /CURRENT_PERSISTED_SNAPSHOT_NON_AUTHORITATIVE/);
  assert.match(patch, /historicalCompleteness: 'UNKNOWN'/);
});


test('server mutation journal covers character routes that can alter chat identity bindings', async () => {
  const journalPath = fileURLToPath(new URL('../server-lifecycle-mutation-journal.mjs', import.meta.url));
  const journal = await readFile(journalPath, 'utf8');
  for (const route of [
    'POST /api/characters/rename',
    'POST /api/characters/edit',
    'POST /api/characters/edit-attribute',
    'POST /api/characters/merge-attributes',
    'POST /api/characters/delete',
  ]) {
    assert.ok(journal.includes("['" + route + "'"), 'mutation route is journaled: ' + route);
  }
});


test('pinned ST enrollment binds the exact persisted source path before registering it', async () => {
  const patch = await readFile(patchPath, 'utf8');
  assert.match(patch, /const sourcePath = selected_group[\s\S]*?sourceLocator \+ '\.jsonl'/);
  assert.match(patch, /conversationId,\n\+                        sourceLocator,\n\+                        sourcePath,/);
  assert.match(patch, /HOST_ENROLLMENT_SOURCE_PATH_REQUIRED/);
  assert.match(patch, /validateEnrolledSourcePath\(paths, \{ conversationId, sourceLocator, domain, sourcePath \}\)/);
});


test('production middleware requires persisted version inventory and journals version-level deltas', async () => {
  const patch = await readFile(patchPath, 'utf8');
  assert.match(patch, /createHostLifecycleMutationMiddleware\(\{ requirePersistedInventory: true \}\)/);
  assert.match(patch, /beforeConversationInventories/);
  assert.match(patch, /afterConversationInventories/);
  assert.match(patch, /versionChanges: diffConversationInventories\(before, after\)/);
});


test('production inventory scan compares against the last committed local mutation checkpoint', async () => {
  const patch = await readFile(patchPath, 'utf8');
  assert.match(patch, /readAndValidateJournal\(paths\.journalPath\)/);
  assert.match(patch, /MATCHES_LAST_COMMITTED_LOCAL_CHECKPOINT/);
  assert.match(patch, /DIVERGES_FROM_LAST_LOCAL_CHECKPOINT/);
  assert.match(patch, /CURRENT_SNAPSHOT_DIVERGES_FROM_LAST_COMMITTED_JOURNAL_SNAPSHOT/);
});
