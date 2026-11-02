import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../index.mjs', import.meta.url), 'utf8');

test('server plugin bootstraps the shared multi-route Patch Manager as sole owner', () => {
  assert.match(source, /import \{ SillyTavernPatchManager \} from '\.\/scripts\/sillytavern-patch-manager\.mjs'/);
  assert.match(source, /manager\.execute\('update'\)/);
  assert.match(source, /manager\.execute\('uninstall'\)/);
  assert.doesNotMatch(source, /host-adapter\/patch-manager\/manager\.mjs/);
  assert.match(source, /\.logic-engine-patch-manager/);
  assert.match(source, /registerLogicEngineFinalSendAdapter/);
});

test('server plugin refuses legacy parallel-manager state before touching the shared patch', () => {
  assert.match(source, /data', 'final-send-patch/);
  assert.match(source, /LOGIC_ENGINE_LEGACY_PATCH_MANAGER_STATE_PRESENT/);
});

test('fail-closed adapter resolves every route in the five-handler Hook contract', () => {
  for (const route of ['text-completions', 'kobold', 'novelai-text', 'horde-text']) {
    assert.match(source, new RegExp("'" + route + "'\\s*:\\s*'" + route + "'"));
  }
  assert.match(source, /async prepare\(request\)/);
  assert.match(source, /LOGIC_ENGINE_UNTRUSTED_MEMORY_MARKER/);
});
