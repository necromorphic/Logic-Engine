import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../index.mjs', import.meta.url), 'utf8');
const managerSource = await readFile(new URL('../scripts/sillytavern-patch-manager.mjs', import.meta.url), 'utf8');

test('server plugin bootstraps the shared multi-route Patch Manager as sole owner', () => {
  assert.match(source, /import \{ SillyTavernPatchManager \} from '\.\/scripts\/sillytavern-patch-manager\.mjs'/);
  assert.match(source, /manager\.inspectInstalledReadOnly\(\)/);
  assert.doesNotMatch(source, /manager\.execute\('(update|uninstall)'\)/);
  assert.doesNotMatch(source, /host-adapter\/patch-manager\/manager\.mjs/);
  assert.match(managerSource, /data', 'logic-engine', 'final-send-patch/);
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


test('server plugin refuses late patch application and leaves patch installed on shutdown', () => {
  assert.match(source, /LOGIC_ENGINE_FINAL_SEND_PATCH_NOT_INSTALLED_OR_VERIFIED_RESTART_REQUIRED/);
  assert.match(source, /Native generation modules are imported before server plugins initialize/);
  assert.match(source, /Extension deletion owns explicit uninstall/);
  assert.doesNotMatch(source, /await manager\.execute\('uninstall'\)/);
});
