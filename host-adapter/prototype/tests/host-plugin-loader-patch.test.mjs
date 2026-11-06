import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const patchPath = path.resolve('host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-hooks.patch');

test('Host plugin loader skips the Logic Engine core package but loads only the reviewed Gateway', () => {
    const patch = fs.readFileSync(patchPath, 'utf8');
    const skipCore = "+            if (hostAuthorityConfigured && file === 'logic-engine') continue;";
    const rejectUnreviewed = "+            if (hostAuthorityConfigured && file !== 'logic-engine-extension-gateway') {";
    const requireGateway = "+        if (hostAuthorityConfigured && !loadedPlugins.has('logic-engine-extension-gateway')) {";

    assert.ok(patch.includes(skipCore), 'Logic Engine core package must be skipped by the ST server-plugin loader');
    assert.ok(patch.includes(rejectUnreviewed), 'all other server plugins must remain blocked');
    assert.ok(patch.includes(requireGateway), 'the reviewed Gateway must still be required');
    assert.ok(patch.indexOf(skipCore) < patch.indexOf(rejectUnreviewed),
        'the core package must be skipped before the unreviewed-plugin rejection');
});
