import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { constants as fsConstants } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  applyFinalSendPatch,
  getFinalSendPatchStatus,
  patchChatCompletionsSource,
  restoreFinalSendPatch,
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
