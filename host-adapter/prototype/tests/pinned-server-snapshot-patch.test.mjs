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
  const lifecycleGuard = section.indexOf('+    app.use(createHostLifecycleMutationMiddleware());');
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
