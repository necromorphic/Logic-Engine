import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { constants as fsConstants } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  applyFinalSendPatch,
  getFinalSendPatchStatus,
  patchChatCompletionsSource,
  restoreFinalSendPatch,
  repairFinalSendPatch,
  updateFinalSendPatch,
  uninstallFinalSendPatch,
} from './manager.mjs';
import { SILLYTAVERN_TARGET } from './target.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = resolve('.');
const hookSourcePath = resolve('host-adapter/patch-manager/logic-engine-final-send-hook.js');
const sourceRoot = process.env.SILLYTAVERN_DIR ? resolve(process.env.SILLYTAVERN_DIR) : null;
const sourcePaths = [
  'src/plugin-loader.js',
  'src/server-main.js',
  'src/server-startup.js',
  'src/endpoints/backends/chat-completions.js',
];

async function createPinnedFixture(t) {
  if (!sourceRoot) {
    t.skip('SILLYTAVERN_DIR must point to the exact pinned SillyTavern checkout');
    return null;
  }
  const root = await mkdtemp(join(tmpdir(), 'logic-engine-st-patch-'));
  const state = join(root, 'logic-engine-state');
  const host = join(root, 'sillytavern');
  await mkdir(host, { recursive: true });
  await copyFile(join(sourceRoot, 'package.json'), join(host, 'package.json'));
  for (const relativePath of sourcePaths) {
    const target = join(host, relativePath);
    await mkdir(join(target, '..'), { recursive: true });
    await copyFile(join(sourceRoot, relativePath), target);
  }
  t.after(() => rm(root, { recursive: true, force: true }));
  return { host, state };
}

test('pinned patch transforms exactly the native chat-completion final-send route', async t => {
  const fixture = await createPinnedFixture(t);
  if (!fixture) return;
  const original = await readFile(join(sourceRoot, SILLYTAVERN_TARGET.endpointRelativePath), 'utf8');
  const patched = patchChatCompletionsSource(original);
  assert.notEqual(patched, original);
  assert.equal((patched.match(/runWithLogicEngineFinalSend\(/g) || []).length, 1);
  assert.equal((patched.match(/logicEngineFetch as fetch/g) || []).length, 1);
  assert.equal((patched.match(/nativeForwardFetchResponse/g) || []).length, 2);
  assert.match(patched, /forwardFetchResponse = \(upstream, response\) => logicEngineForwardFetchResponse/);
  assert.match(patched, /router\.post\('\/generate',[\s\S]*?return runWithLogicEngineFinalSend/);
  assert.match(patched, /const multimodalModels = express\.Router\(\);/);

  const target = join(fixture.host, SILLYTAVERN_TARGET.endpointRelativePath);
  await writeFile(target, patched, 'utf8');
  await writeFile(join(fixture.host, SILLYTAVERN_TARGET.hookRelativePath), await readFile(hookSourcePath));
  await execFileAsync(process.execPath, ['--check', target]);
  await execFileAsync(process.execPath, ['--check', join(fixture.host, SILLYTAVERN_TARGET.hookRelativePath)]);
});

test('Patch Manager installs idempotently, verifies the installed bytes, and restores exact upstream source', async t => {
  const fixture = await createPinnedFixture(t);
  if (!fixture) return;
  const original = await readFile(join(sourceRoot, SILLYTAVERN_TARGET.endpointRelativePath));
  const result = await applyFinalSendPatch({
    hostRoot: fixture.host,
    stateRoot: fixture.state,
    hookSourcePath,
  });
  assert.equal(result.status, 'installed');
  assert.equal((await getFinalSendPatchStatus({ hostRoot: fixture.host, stateRoot: fixture.state })).status, 'installed');

  const second = await applyFinalSendPatch({
    hostRoot: fixture.host,
    stateRoot: fixture.state,
    hookSourcePath,
  });
  assert.equal(second.status, 'installed');
  const patched = await readFile(join(fixture.host, SILLYTAVERN_TARGET.endpointRelativePath));
  assert.notDeepEqual(patched, original);

  const restored = await restoreFinalSendPatch({ hostRoot: fixture.host, stateRoot: fixture.state });
  assert.equal(restored.status, 'restored');
  assert.deepEqual(await readFile(join(fixture.host, SILLYTAVERN_TARGET.endpointRelativePath)), original);
  await assert.rejects(readFile(join(fixture.host, SILLYTAVERN_TARGET.hookRelativePath)), { code: 'ENOENT' });
  assert.equal((await getFinalSendPatchStatus({ hostRoot: fixture.host, stateRoot: fixture.state })).status, 'not_installed');

  for (const relativePath of sourcePaths.slice(0, 3)) {
    assert.deepEqual(
      await readFile(join(fixture.host, relativePath)),
      await readFile(join(sourceRoot, relativePath)),
      relativePath + ' must never be modified',
    );
  }
});

test('Patch Manager refuses an unknown or drifted Host build without modifying it', async t => {
  const fixture = await createPinnedFixture(t);
  if (!fixture) return;
  const endpoint = join(fixture.host, SILLYTAVERN_TARGET.endpointRelativePath);
  await writeFile(endpoint, (await readFile(endpoint)).subarray(0, -1));
  const before = await readFile(endpoint);
  await assert.rejects(
    applyFinalSendPatch({ hostRoot: fixture.host, stateRoot: fixture.state, hookSourcePath }),
    /LOGIC_ENGINE_PATCH_HOST_SOURCE_HASH_MISMATCH/,
  );
  assert.deepEqual(await readFile(endpoint), before);
  await assert.rejects(readFile(join(fixture.host, SILLYTAVERN_TARGET.hookRelativePath)), { code: 'ENOENT' });
});

test('Patch Manager refuses to overwrite local edits made after installation', async t => {
  const fixture = await createPinnedFixture(t);
  if (!fixture) return;
  await applyFinalSendPatch({ hostRoot: fixture.host, stateRoot: fixture.state, hookSourcePath });
  const endpoint = join(fixture.host, SILLYTAVERN_TARGET.endpointRelativePath);
  const edited = Buffer.concat([await readFile(endpoint), Buffer.from('\n// local drift\n')]);
  await writeFile(endpoint, edited);
  assert.equal((await getFinalSendPatchStatus({ hostRoot: fixture.host, stateRoot: fixture.state })).status, 'drifted');
  await assert.rejects(
    restoreFinalSendPatch({ hostRoot: fixture.host, stateRoot: fixture.state }),
    /LOGIC_ENGINE_PATCH_RESTORE_DRIFT/,
  );
  assert.deepEqual(await readFile(endpoint), edited);
});


test('repair verifies an intact installation without replacing it', async t => {
  const fixture = await createPinnedFixture(t);
  if (!fixture) return;
  const installed = await applyFinalSendPatch({
    hostRoot: fixture.host, stateRoot: fixture.state, hookSourcePath,
  });
  assert.equal(installed.status, 'installed');
  const repaired = await repairFinalSendPatch({
    hostRoot: fixture.host, stateRoot: fixture.state, hookSourcePath,
  });
  assert.equal(repaired.operation, 'repair');
  assert.equal(repaired.status, 'installed');
});

test('repair refuses drift and preserves user edits', async t => {
  const fixture = await createPinnedFixture(t);
  if (!fixture) return;
  await applyFinalSendPatch({ hostRoot: fixture.host, stateRoot: fixture.state, hookSourcePath });
  const endpoint = join(fixture.host, SILLYTAVERN_TARGET.endpointRelativePath);
  const edited = Buffer.concat([await readFile(endpoint), Buffer.from('\n// user change\n')]);
  await writeFile(endpoint, edited);
  await assert.rejects(
    repairFinalSendPatch({ hostRoot: fixture.host, stateRoot: fixture.state, hookSourcePath }),
    /LOGIC_ENGINE_PATCH_REPAIR_DRIFT/,
  );
  assert.deepEqual(await readFile(endpoint), edited);
});

test('update is idempotent for the same managed patch and uninstall restores exact upstream bytes', async t => {
  const fixture = await createPinnedFixture(t);
  if (!fixture) return;
  const original = await readFile(join(sourceRoot, SILLYTAVERN_TARGET.endpointRelativePath));
  const first = await updateFinalSendPatch({
    hostRoot: fixture.host, stateRoot: fixture.state, hookSourcePath,
  });
  assert.equal(first.status, 'installed');
  const second = await updateFinalSendPatch({
    hostRoot: fixture.host, stateRoot: fixture.state, hookSourcePath,
  });
  assert.equal(second.operation, 'update');
  assert.equal(second.status, 'installed');
  const removed = await uninstallFinalSendPatch({
    hostRoot: fixture.host, stateRoot: fixture.state,
  });
  assert.equal(removed.operation, 'uninstall');
  assert.deepEqual(await readFile(join(fixture.host, SILLYTAVERN_TARGET.endpointRelativePath)), original);
  await assert.rejects(readFile(join(fixture.host, SILLYTAVERN_TARGET.hookRelativePath)), { code: 'ENOENT' });
});


test('pinned non-target source hash verification tolerates Windows CRLF checkout normalization', async t => {
  const fixture = await createPinnedFixture(t);
  if (!fixture) return;
  const loader = join(fixture.host, 'src/plugin-loader.js');
  const lf = (await readFile(loader, 'utf8')).replace(/\r?\n/g, '\n');
  await writeFile(loader, lf.replace(/\n/g, '\r\n'), 'utf8');
  const first = await applyFinalSendPatch({
    hostRoot: fixture.host, stateRoot: fixture.state, hookSourcePath,
  });
  assert.equal(first.status, 'installed');
  const second = await applyFinalSendPatch({
    hostRoot: fixture.host, stateRoot: fixture.state, hookSourcePath,
  });
  assert.equal(second.status, 'installed');
});


test('repair safely migrates an intact managed patch to an updated hook payload', async t => {
  const fixture = await createPinnedFixture(t);
  if (!fixture) return;
  await applyFinalSendPatch({ hostRoot: fixture.host, stateRoot: fixture.state, hookSourcePath });
  const updatedHook = join(fixture.state, 'updated-hook.js');
  const updatedBytes = Buffer.concat([await readFile(hookSourcePath), Buffer.from('\\n// updated hook payload\\n')]);
  await writeFile(updatedHook, updatedBytes);
  const repaired = await repairFinalSendPatch({
    hostRoot: fixture.host, stateRoot: fixture.state, hookSourcePath: updatedHook,
  });
  assert.equal(repaired.operation, 'repair');
  assert.equal(repaired.status, 'installed');
  assert.deepEqual(await readFile(join(fixture.host, SILLYTAVERN_TARGET.hookRelativePath)), updatedBytes);
});


test('restart recovery rolls back an interrupted apply before refusing changed pinned source', async t => {
  const fixture = await createPinnedFixture(t);
  if (!fixture) return;
  const endpointRelativePath = SILLYTAVERN_TARGET.endpointRelativePath;
  const hookRelativePath = SILLYTAVERN_TARGET.hookRelativePath;
  const endpoint = join(fixture.host, endpointRelativePath);
  const hook = join(fixture.host, hookRelativePath);
  const original = await readFile(endpoint);
  const patched = Buffer.from(patchChatCompletionsSource(original.toString('utf8')), 'utf8');
  const hookBytes = await readFile(hookSourcePath);
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const backupRelativePath = 'backups/recovery/chat-completions.js';
  const backup = join(fixture.state, backupRelativePath);
  await mkdir(join(fixture.state, 'backups/recovery'), { recursive: true });
  await writeFile(backup, original);
  await writeFile(hook, hookBytes);
  await writeFile(endpoint, patched);
  await writeFile(join(fixture.state, 'pending.json'), JSON.stringify({
    patchId: 'sillytavern-1.19.0-final-send-v1',
    hostCommit: SILLYTAVERN_TARGET.commit,
    endpointRelativePath,
    hookRelativePath,
    backupRelativePath,
    originalHash: hash(original),
    patchedHash: hash(patched),
    hookHash: hash(hookBytes),
  }));
  const loader = join(fixture.host, 'src/plugin-loader.js');
  await writeFile(loader, Buffer.concat([await readFile(loader), Buffer.from('\\n// source drift\\n')]));
  await assert.rejects(
    applyFinalSendPatch({ hostRoot: fixture.host, stateRoot: fixture.state, hookSourcePath }),
    /LOGIC_ENGINE_PATCH_HOST_SOURCE_HASH_MISMATCH/,
  );
  assert.deepEqual(await readFile(endpoint), original);
  await assert.rejects(readFile(hook), { code: 'ENOENT' });
  await assert.rejects(readFile(join(fixture.state, 'pending.json')), { code: 'ENOENT' });
});


test('restore recovery completes after each destructive uninstall boundary', async t => {
  for (const phase of ['before-endpoint-restore', 'after-endpoint-restore', 'after-hook-removal']) {
    await t.test(phase, async t2 => {
      const fixture = await createPinnedFixture(t2);
      if (!fixture) return;
      const installed = await applyFinalSendPatch({
        hostRoot: fixture.host, stateRoot: fixture.state, hookSourcePath,
      });
      assert.equal(installed.status, 'installed');
      const manifestPath = join(fixture.state, 'manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      const endpoint = join(fixture.host, manifest.endpointRelativePath);
      const hook = join(fixture.host, manifest.hookRelativePath);
      const original = await readFile(join(fixture.state, manifest.backupRelativePath));
      const pending = {
        patchId: manifest.patchId,
        endpointRelativePath: manifest.endpointRelativePath,
        hookRelativePath: manifest.hookRelativePath,
        backupRelativePath: manifest.backupRelativePath,
        originalHash: manifest.originalHash,
        patchedHash: manifest.patchedHash,
        hookHash: manifest.hookHash,
      };
      await writeFile(join(fixture.state, 'restore-pending.json'), JSON.stringify(pending));
      if (phase !== 'before-endpoint-restore') await writeFile(endpoint, original);
      if (phase === 'after-hook-removal') await rm(hook);
      const result = await restoreFinalSendPatch({ hostRoot: fixture.host, stateRoot: fixture.state });
      assert.equal(result.status, 'restored');
      assert.deepEqual(await readFile(endpoint), original);
      await assert.rejects(readFile(hook), { code: 'ENOENT' });
      await assert.rejects(readFile(manifestPath), { code: 'ENOENT' });
      await assert.rejects(readFile(join(fixture.state, 'restore-pending.json')), { code: 'ENOENT' });
    });
  }
});

test('Extension startup update recovers a partially restored patch before status validation', async t => {
  const fixture = await createPinnedFixture(t);
  if (!fixture) return;
  await applyFinalSendPatch({ hostRoot: fixture.host, stateRoot: fixture.state, hookSourcePath });
  const manifestPath = join(fixture.state, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const endpoint = join(fixture.host, manifest.endpointRelativePath);
  const hook = join(fixture.host, manifest.hookRelativePath);
  const original = await readFile(join(fixture.state, manifest.backupRelativePath));
  await writeFile(join(fixture.state, 'restore-pending.json'), JSON.stringify({
    patchId: manifest.patchId,
    endpointRelativePath: manifest.endpointRelativePath,
    hookRelativePath: manifest.hookRelativePath,
    backupRelativePath: manifest.backupRelativePath,
    originalHash: manifest.originalHash,
    patchedHash: manifest.patchedHash,
    hookHash: manifest.hookHash,
  }));
  // Simulate process death after endpoint restoration but before hook removal.
  await writeFile(endpoint, original);
  const result = await updateFinalSendPatch({
    hostRoot: fixture.host, stateRoot: fixture.state, hookSourcePath,
  });
  assert.equal(result.status, 'installed');
  assert.notDeepEqual(await readFile(endpoint), original);
  await assert.rejects(readFile(join(fixture.state, 'restore-pending.json')), { code: 'ENOENT' });
  assert.equal((await getFinalSendPatchStatus({ hostRoot: fixture.host, stateRoot: fixture.state })).status, 'installed');
  assert.equal((await readFile(hook)).length > 0, true);
});

test('Patch Manager refuses a symlinked durable state root', async t => {
  const fixture = await createPinnedFixture(t);
  if (!fixture) return;
  const externalState = fixture.state + '-external';
  await mkdir(externalState, { recursive: true });
  try {
    await symlink(externalState, fixture.state, 'junction');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error?.code)) {
      t.skip('Directory symlink creation is not permitted in this environment');
      return;
    }
    throw error;
  }
  const endpoint = join(fixture.host, SILLYTAVERN_TARGET.endpointRelativePath);
  const original = await readFile(endpoint);
  await assert.rejects(
    applyFinalSendPatch({ hostRoot: fixture.host, stateRoot: fixture.state, hookSourcePath }),
    /LOGIC_ENGINE_PATCH_STATE_PATH_UNSAFE/,
  );
  assert.deepEqual(await readFile(endpoint), original);
});

test('restore refuses a symlinked backup instead of reading outside the durable state root', async t => {
  const fixture = await createPinnedFixture(t);
  if (!fixture) return;
  await applyFinalSendPatch({ hostRoot: fixture.host, stateRoot: fixture.state, hookSourcePath });
  const manifestPath = join(fixture.state, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const backupPath = join(fixture.state, manifest.backupRelativePath);
  const outsideBackup = join(fixture.host, 'outside-backup.bin');
  await copyFile(backupPath, outsideBackup);
  await rm(backupPath);
  try {
    await symlink(outsideBackup, backupPath);
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error?.code)) {
      t.skip('Symlink creation is not permitted in this environment');
      return;
    }
    throw error;
  }
  await assert.rejects(
    restoreFinalSendPatch({ hostRoot: fixture.host, stateRoot: fixture.state }),
    /LOGIC_ENGINE_PATCH_HOST_PATH_MISSING_OR_REPARSE/,
  );
  assert.equal((await readFile(join(fixture.host, SILLYTAVERN_TARGET.endpointRelativePath))).length > 0, true);
});

test('Patch Manager recovery state survives removal of the Extension directory', async t => {
  const fixture = await createPinnedFixture(t);
  if (!fixture) return;
  const extensionDir = join(fixture.host, 'plugins', 'logic-engine');
  await mkdir(extensionDir, { recursive: true });
  await applyFinalSendPatch({ hostRoot: fixture.host, stateRoot: fixture.state, hookSourcePath });
  const manifest = JSON.parse(await readFile(join(fixture.state, 'manifest.json'), 'utf8'));
  const backup = join(fixture.state, manifest.backupRelativePath);
  const original = await readFile(backup);
  await rm(extensionDir, { recursive: true, force: true });
  assert.deepEqual(await readFile(backup), original);
  const result = await restoreFinalSendPatch({ hostRoot: fixture.host, stateRoot: fixture.state });
  assert.equal(result.status, 'restored');
  assert.deepEqual(await readFile(join(fixture.host, SILLYTAVERN_TARGET.endpointRelativePath)), original);
});

test('restore refuses a symlinked durable state root before reading external backup or journal', async t => {
  const fixture = await createPinnedFixture(t);
  if (!fixture) return;
  await applyFinalSendPatch({ hostRoot: fixture.host, stateRoot: fixture.state, hookSourcePath });
  const externalState = fixture.state + '-external';
  await mkdir(externalState, { recursive: true });
  await copyFile(join(fixture.state, 'manifest.json'), join(externalState, 'manifest.json'));
  await copyFile(
    join(fixture.state, JSON.parse(await readFile(join(fixture.state, 'manifest.json'), 'utf8')).backupRelativePath),
    join(externalState, 'backup.bin'),
  );
  const linkedState = fixture.state + '-link';
  try {
    await symlink(externalState, linkedState, 'junction');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error?.code)) {
      t.skip('Directory symlink creation is not permitted in this environment');
      return;
    }
    throw error;
  }
  const endpoint = join(fixture.host, SILLYTAVERN_TARGET.endpointRelativePath);
  const patched = await readFile(endpoint);
  await assert.rejects(
    restoreFinalSendPatch({ hostRoot: fixture.host, stateRoot: linkedState }),
    /LOGIC_ENGINE_PATCH_STATE_PATH_UNSAFE/,
  );
  assert.deepEqual(await readFile(endpoint), patched);
});
