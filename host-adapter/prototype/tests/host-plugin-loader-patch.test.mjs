import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const patchPath = path.resolve('host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-hooks.patch');

test('Host lifecycle patch leaves native SillyTavern plugin loading untouched', () => {
    const patch = fs.readFileSync(patchPath, 'utf8');
    assert.equal(patch.includes('diff --git a/src/plugin-loader.js'), false,
        'Host lifecycle integration must not replace SillyTavern plugin discovery');
    assert.equal(patch.includes('HOST_UNREVIEWED_SERVER_PLUGIN_BLOCKED'), false,
        'Host must not block native third-party plugin loading');
});
