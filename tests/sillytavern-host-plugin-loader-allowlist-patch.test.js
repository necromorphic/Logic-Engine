import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const patch = await readFile(
  new URL('../host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-hooks.patch', import.meta.url),
  'utf8',
);
const loaderHunk = patch.slice(patch.indexOf('diff --git a/src/plugin-loader.js'));

test('Host plugin allowlist filters executable plugin candidates, not root metadata', () => {
  assert.match(loaderHunk, /fs\.lstatSync\(pluginFilePath\)/);
  assert.match(loaderHunk, /pluginStat\.isDirectory\(\)/);
  assert.match(loaderHunk, /pluginStat\.isFile\(\) && \(isCommonJS\(file\) \|\| isESModule\(file\)\)/);
  assert.match(loaderHunk, /if \(!pluginCandidate\) continue;/);
  assert.doesNotMatch(loaderHunk, /HOST_UNREVIEWED_SERVER_PLUGIN_BLOCKED:[\s\S]{0,100}package\.json/);
});

test('Host plugin allowlist still blocks unknown executable plugins and all symlinks', () => {
  assert.match(loaderHunk, /hostAuthorityConfigured && pluginStat\.isSymbolicLink\(\)/);
  assert.match(loaderHunk, /hostAuthorityConfigured && pluginCandidate[\s\S]*file !== 'logic-engine'[\s\S]*file !== 'logic-engine-extension-gateway'[\s\S]*HOST_UNREVIEWED_SERVER_PLUGIN_BLOCKED/);
});
