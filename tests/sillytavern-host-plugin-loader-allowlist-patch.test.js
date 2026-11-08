import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const patch = await readFile(
  new URL('../host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-hooks.patch', import.meta.url),
  'utf8',
);

test('Host lifecycle patch does not alter SillyTavern native plugin discovery', () => {
  assert.equal(patch.includes('diff --git a/src/plugin-loader.js'), false);
  assert.equal(patch.includes('HOST_UNREVIEWED_SERVER_PLUGIN_BLOCKED'), false);
});
