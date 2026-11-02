import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../host-adapter/patches/sillytavern-1.19.0-final-send.manifest.json', import.meta.url), 'utf8'));
const patch = await readFile(new URL('../host-adapter/patches/sillytavern-1.19.0-final-send.patch', import.meta.url));
const hash = createHash('sha256').update(patch).digest('hex');


test('managed unified-diff patch hunk counts are internally consistent', () => {
  const lines = patch.toString('utf8').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/);
    if (!match) continue;
    let oldLines = 0;
    let newLines = 0;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (line.startsWith('@@ ')
        || line.startsWith('--- a/')
        || line === '--- /dev/null') break;
      if (line.startsWith(' ')) { oldLines += 1; newLines += 1; }
      else if (line.startsWith('-')) oldLines += 1;
      else if (line.startsWith('+')) newLines += 1;
      else if (line.startsWith('\\ No newline')) continue;
      else if (line === '') continue;
    }
    assert.equal(oldLines, Number(match[1] ?? 1), 'old hunk line count at patch line ' + (index + 1));
    assert.equal(newLines, Number(match[2] ?? 1), 'new hunk line count at patch line ' + (index + 1));
  }
});
test('Final-Send patch is pinned to the exact audited SillyTavern 1.19.0 source', () => {
  assert.equal(manifest.host.version, '1.19.0');
  assert.equal(manifest.host.commit, '06bde939fb1e9c4c8d8641d810f0a916b5bce127');
  assert.equal(hash, manifest.patch.sha256);
  assert.equal(manifest.sourceFiles['src/endpoints/backends/chat-completions.js'].before,
    '53f429859efcfb29dd8becfebf7ff0ae49256ea795a0c81c320930fab5a407e7');
});

test('Final-Send patch routes every Chat Completions fetch and stream release through the hook seam', () => {
  const source = patch.toString('utf8');
  assert.match(source, /logicEngineFetch as fetch/);
  assert.match(source, /runWithLogicEngineFinalSend/);
  assert.match(source, /logicEngineForwardFetchResponse/);
  assert.match(source, /forwardFetchResponse as nativeForwardFetchResponse/);
  assert.match(source, /src\/logic-engine-final-send-hook\.js/);
  assert.equal(source.includes('text-completions.js'), false);
  assert.equal(source.includes('kobold.js'), false);
  assert.equal(source.includes('novelai.js'), false);
  assert.equal(source.includes('horde.js'), false);
  assert.match(source, /response\.write = function/);
  assert.match(source, /response\.end = function/);
  assert.match(source, /hostTransformsStream/);
  assert.ok(source.includes("from '../logic-engine-final-send-hook.js'"),
    'endpoint modules must resolve the Hook from src/endpoints to src/');
  assert.equal(source.includes("from './logic-engine-final-send-hook.js'"), false,
    'endpoint-relative imports must not point to a nonexistent endpoints-local Hook');
});

test('patch manifest pins Chat Completions plus required Host lifecycle source files only', () => {
  for (const path of [
    'src/endpoints/backends/chat-completions.js',
    'src/server-main.js',
    'src/server-startup.js',
    'src/plugin-loader.js',
    'src/endpoints/extensions.js',
    'src/constants.js',
    'src/util.js',
  ]) {
    const pin = manifest.sourceFiles[path];
    const before = typeof pin === 'string' ? pin : pin?.before;
    assert.match(before, /^[a-f0-9]{64}$/);
    if (typeof pin === 'object') assert.match(pin.after, /^[a-f0-9]{64}$/);
  }
});

test('Logic-Engine Extension manifest opts into the server-side Patch Manager lifecycle', async () => {
  const extensionManifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.equal(extensionManifest.logic_engine_patch_manager.id, manifest.id);
  assert.equal(extensionManifest.logic_engine_patch_manager.manifestVersion, 1);
});

test('patch manifest pins both server-side lifecycle Hook modules', () => {
  assert.match(manifest.createdFiles['src/logic-engine-final-send-hook.js'], /^[a-f0-9]{64}$/);
  assert.match(manifest.createdFiles['src/logic-engine-extension-install-hook.js'], /^[a-f0-9]{64}$/);
});

test('Patch Manager update runs after the native Extension git update has completed', () => {
  const source = patch.toString('utf8');
  const fileStart = source.indexOf('--- a/src/endpoints/extensions.js');
  const fileEnd = source.indexOf('\n--- a/', fileStart + 1);
  assert.ok(fileStart >= 0 && fileEnd > fileStart);
  const extensionPatch = source.slice(fileStart, fileEnd);
  const managerCall = "await runLogicEngineExtensionLifecycle({ action: 'update', extensionPath });";
  assert.ok(extensionPatch.indexOf("await git.fetch('origin');") < extensionPatch.indexOf(managerCall));
  assert.ok(extensionPatch.indexOf("const shortCommitHash = fullCommitHash.slice(0, 7);") < extensionPatch.indexOf(managerCall));
});

test('native ST Extension install/update/delete lifecycle invokes only the pinned Logic-Engine manager', () => {
  const source = patch.toString('utf8');
  assert.match(source, /runLogicEngineExtensionLifecycle/);
  assert.match(source, /action: 'install'/);
  assert.match(source, /action: 'update'/);
  assert.match(source, /action: 'delete'/);
  assert.ok(source.includes("TRUSTED_REPOSITORY_PATH = '/necromorphic/Logic-Engine'"));
  assert.ok(source.includes("hostname.toLowerCase() !== 'github.com'"));
  assert.ok(source.includes("basename(extensionPath).toLowerCase() !== 'logic-engine'"));
  assert.match(source, /LOGIC_ENGINE_EXTENSION_ORIGIN_DENIED/);
});
