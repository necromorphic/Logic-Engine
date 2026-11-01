import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../host-adapter/patches/sillytavern-1.19.0-final-send.manifest.json', import.meta.url), 'utf8'));
const patch = await readFile(new URL('../host-adapter/patches/sillytavern-1.19.0-final-send.patch', import.meta.url));
const hash = createHash('sha256').update(patch).digest('hex');

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
});

test('patch manifest includes source identity checks for every separately routed generation family', () => {
  for (const path of [
    'src/endpoints/backends/text-completions.js',
    'src/endpoints/backends/kobold.js',
    'src/endpoints/novelai.js',
    'src/endpoints/horde.js',
    'src/server-main.js',
    'src/server-startup.js',
    'src/plugin-loader.js',
  ]) {
    assert.match(manifest.sourceFiles[path], /^[a-f0-9]{64}$/);
  }
});
