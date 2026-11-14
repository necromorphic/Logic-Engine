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
  assert.equal(manifest.sourceFiles['src/endpoints/backends/text-completions.js'].before,
    '877b2b6279091c70495e561c00ce021592205e1d42ea4fe5f20f23dd67071971');
  assert.equal(manifest.sourceFiles['src/endpoints/backends/kobold.js'].before,
    'ce23d72599580d5822d17fda14c8413882237c1ab984b1be63ee063256286801');
  assert.equal(manifest.sourceFiles['src/endpoints/novelai.js'].before,
    '0b6b41052ae0311ae6e716955b0805a44b1b63e3a58bf403b81becf0ff1b04ce');
  assert.equal(manifest.sourceFiles['src/endpoints/horde.js'].before,
    '9a0280cfa2c5498f540b8593b100e80cbacdefa563038a6cc6c60c9c9923f3f4');
});

test('Final-Send patch routes every Chat Completions fetch and stream release through the hook seam', () => {
  const source = patch.toString('utf8');
  assert.match(source, /logicEngineFetch as fetch/);
  assert.match(source, /runWithLogicEngineFinalSend/);
  assert.match(source, /logicEngineForwardFetchResponse/);
  assert.ok(source.includes("const method = typeof outboundInit.method === 'string' ? outboundInit.method.toUpperCase() : 'GET';"));
  assert.ok(source.includes("if (method !== 'POST') return nativeFetch(endpointUrl, outboundInit);"));
  assert.match(source, /forwardFetchResponse as nativeForwardFetchResponse/);
  assert.match(source, /src\/logic-engine-final-send-hook\.js/);
  for (const routeFile of [
    'src/endpoints/backends/text-completions.js',
    'src/endpoints/backends/kobold.js',
    'src/endpoints/novelai.js',
    'src/endpoints/horde.js',
  ]) {
    assert.ok(source.includes('--- a/' + routeFile), 'missing protected generation route patch: ' + routeFile);
  }
  assert.match(source, /hostRoute: active\.route/);
  assert.match(source, /logicEngineFinalSendTerminal/);
  assert.match(source, /response\.destroy\(\)/);
  assert.match(source, /if \(error\?\.logicEngineFinalSendTerminal === true\) throw error;/);
  for (const routeId of ['text-completions', 'kobold', 'novelai-text', 'horde-text']) {
    assert.ok(source.includes(`}, '${routeId}');`), 'missing explicit Final-Send route binding: ' + routeId);
  }
  assert.match(source, /response\.write = function/);
  assert.match(source, /response\.end = function/);
  assert.match(source, /const responseAdapter = adapter/);
  assert.match(source, /hostTransformsStream/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /request\.once\?\.\('aborted'/);
  assert.match(source, /request\.once\?\.\('aborted', cleanup\)/);
  assert.match(source, /response\.once\?\.\('close', cleanup\)/);
  assert.match(source, /request\.off\?\.\('aborted', cleanup\)/);
  assert.match(source, /response\.off\?\.\('close', cleanup\)/);
  assert.match(source, /abortController\.signal\.aborted \|\| response\.destroyed === true/);
  assert.match(source, /await responseAdapter\.prepare\(request, response, abortController\.signal\)/);
  assert.match(source, /if \(abortController\.signal\.aborted\) return/);
  assert.match(source, /if \(abortController\.signal\.aborted \|\| response\.destroyed === true\) return/);
  assert.match(source, /composeAbortSignals\(\[requestInit\.signal, active\.abortController\.signal\]/);
  assert.equal(source.includes('AbortSignal.any'), false, 'the Hook must support the full SillyTavern Node >=20 engine range');
  assert.ok(source.includes("from '../logic-engine-final-send-hook.js'"),
    'endpoint modules must resolve the Hook from src/endpoints to src/');
  assert.equal(source.includes("from './logic-engine-final-send-hook.js'"), false,
    'endpoint-relative imports must not point to a nonexistent endpoints-local Hook');
});

test('patch manifest pins every protected generation route plus required Host lifecycle source files', () => {
  for (const path of [
    'src/endpoints/backends/chat-completions.js',
    'src/endpoints/backends/text-completions.js',
    'src/endpoints/backends/kobold.js',
    'src/endpoints/novelai.js',
    'src/endpoints/horde.js',
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
