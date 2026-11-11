import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { registerHostGenerationIdentity } from '../host-adapter/extension-gateway/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('root manifest exposes the browser entrypoint required by SillyTavern Extension Manager', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.js, 'host-adapter/extension-gateway/index.js');
  assert.equal(manifest.display_name, 'Logic Engine');
  assert.equal(manifest.logic_engine_patch_manager.id, 'logic-engine-sillytavern-final-send');
  await assert.doesNotReject(readFile(path.join(root, manifest.js), 'utf8'));
  await assert.doesNotReject(readFile(path.join(root, 'host-adapter/extension-gateway/host-context.mjs'), 'utf8'));
  await assert.doesNotReject(readFile(path.join(root, 'host-adapter/extension-gateway/conversation-identity.mjs'), 'utf8'));
});

test('browser entrypoint resolves ST context through the stable public script URL', async () => {
  const entrypoint = await readFile(path.join(root, 'host-adapter/extension-gateway/index.js'), 'utf8');
  const hostContext = await readFile(path.join(root, 'host-adapter/extension-gateway/host-context.mjs'), 'utf8');
  assert.equal((entrypoint.match(/new URL\('\/scripts\/st-context\.js', import\.meta\.url\)/g) ?? []).length, 1);
  assert.equal((hostContext.match(/new URL\('\/scripts\/st-context\.js', import\.meta\.url\)/g) ?? []).length, 1);
  assert.doesNotMatch(entrypoint + hostContext, /\.\.\/\.\.\/\.\.\/st-context\.js/);
});

test('Extension Manager entrypoint registers and removes only its two Host identity listeners', async () => {
  const listeners = new Map();
  const eventSource = {
    on(name, callback) { listeners.set(name, callback); },
    removeListener(name, callback) {
      if (listeners.get(name) === callback) listeners.delete(name);
    },
  };
  const context = {
    eventSource,
    eventTypes: {
      CHAT_COMPLETION_SETTINGS_READY: 'CHAT_COMPLETION_SETTINGS_READY',
      GENERATE_AFTER_DATA: 'GENERATE_AFTER_DATA',
    },
  };
  const unregister = await registerHostGenerationIdentity(context, {
    resolveHostContext: async () => ({ conversationUuid: '11111111-1111-4111-8111-111111111111' }),
  });
  assert.deepEqual([...listeners.keys()].sort(), [
    'CHAT_COMPLETION_SETTINGS_READY',
    'GENERATE_AFTER_DATA',
  ]);
  unregister();
  assert.equal(listeners.size, 0);
});
