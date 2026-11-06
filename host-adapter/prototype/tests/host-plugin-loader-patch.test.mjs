import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const patchPath = path.resolve('host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-hooks.patch');

test('Host plugin loader requires both first-party Logic Engine runtime and Gateway under Host authority', () => {
    const patch = fs.readFileSync(patchPath, 'utf8');
    const allowFirstParty = [
        "+            if (hostAuthorityConfigured",
        "+                && pluginCandidate",
        "+                && file !== 'logic-engine'",
        "+                && file !== 'logic-engine-extension-gateway') {",
    ].join('\n');
    const rejectUnreviewed = "+                throw new Error('HOST_UNREVIEWED_SERVER_PLUGIN_BLOCKED:' + file);";
    const requireCore = "+        if (hostAuthorityConfigured && !loadedPlugins.has('logic-engine')) {";
    const requireGateway = "+        if (hostAuthorityConfigured && !loadedPlugins.has('logic-engine-extension-gateway')) {";
    const skippedCore = "+            if (hostAuthorityConfigured && file === 'logic-engine') continue;";

    assert.ok(patch.includes(allowFirstParty), 'only the two reviewed first-party plugins may load');
    assert.ok(patch.includes(rejectUnreviewed), 'all other server plugins remain blocked');
    assert.ok(patch.includes(requireCore), 'the root Logic Engine runtime must load and register Final-Send');
    assert.ok(patch.includes(requireGateway), 'the Host Gateway must load');
    assert.ok(!patch.includes(skippedCore), 'the root runtime must not be skipped while Host authority is active');
    assert.ok(patch.indexOf(requireCore) < patch.indexOf(requireGateway),
        'the Final-Send runtime is required before the Host Gateway readiness check');
});
