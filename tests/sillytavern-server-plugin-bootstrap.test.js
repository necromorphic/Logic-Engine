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

test('server plugin connects Host preparation and NPC Context Receiver but keeps Gateway fail-closed', () => {
  assert.match(source, /createSillyTavernHostAdapter/);
  assert.match(source, /prepareGenerationContext\(request, hostRoute\)/);
  assert.match(source, /receiveNpcContext/);
  assert.match(source, /createSillyTavernFinalSendAdapter/);
  assert.match(source, /LOGIC_ENGINE_MEMORY_NPC_ENABLED/);
  assert.match(source, /NOT_WIRED_FAIL_CLOSED/);
  assert.match(source, /MEMORY_DISPATCH_NOT_READY/);
  assert.doesNotMatch(source, /createFailClosedAdapter/);
  assert.match(source, /return received\.candidates\.length === 0 \? null : received/);
});


test('server plugin refuses late patch application and leaves patch installed on shutdown', () => {
  assert.match(source, /LOGIC_ENGINE_FINAL_SEND_PATCH_NOT_INSTALLED_OR_VERIFIED_RESTART_REQUIRED/);
  assert.match(source, /Native generation modules are imported before server plugins initialize/);
  assert.match(source, /normal shutdown never removes it/);
  assert.doesNotMatch(source, /await manager\.execute\('uninstall'\)/);
});
