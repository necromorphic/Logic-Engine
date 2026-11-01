import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('repository root is a valid SillyTavern third-party client extension package', async () => {
    const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    const entrypoint = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const stylesheet = await readFile(new URL('../style.css', import.meta.url), 'utf8');

    assert.equal(manifest.js, 'index.js');
    assert.equal(manifest.css, 'style.css');
    assert.equal(manifest.hooks?.activate, 'init');
    assert.match(entrypoint, /from ['"]\.\.\/\.\.\/\.\.\/\.\.\/script\.js['"]/);
    assert.match(entrypoint, /from ['"]\.\.\/\.\.\/\.\.\/extensions\.js['"]/);
    assert.match(entrypoint, /requestPlugin\(['"]\/session['"]\)/);
    assert.match(entrypoint, /requestPlugin\(['"]\/health['"]\)/);
    assert.match(stylesheet, /logic-engine-extension/);
    assert.equal(packageJson.main, 'server-plugin/index.mjs');
});

test('client extension does not contain Core or adapter credentials or model-provider configuration', async () => {
    const entrypoint = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.doesNotMatch(entrypoint, /ENGINE_API_TOKEN|ENGINE_ADAPTER_TOKENS|x-adapter-token|Bearer\s/);
    assert.doesNotMatch(entrypoint, /\/api\/backends\/chat-completions\/generate/);
    assert.doesNotMatch(entrypoint, /apiKey|api_key|providerUrl|provider_url/);
});
