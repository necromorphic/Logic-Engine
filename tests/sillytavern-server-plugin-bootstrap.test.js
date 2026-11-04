import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../index.mjs', import.meta.url), 'utf8');
const managerSource = await readFile(new URL('../scripts/sillytavern-patch-manager.mjs', import.meta.url), 'utf8');

test('server plugin bootstraps the shared multi-route Patch Manager as sole owner', () => {
  assert.match(source, /import \{ SillyTavernPatchManager \} from '\.\/scripts\/sillytavern-patch-manager\.mjs'/);
  assert.match(source, /manager\.inspectInstalledReadOnly\(\)/);
  assert.doesNotMatch(source, /manager\.execute\('(update|uninstall|install)'\)/);
  assert.doesNotMatch(source, /host-adapter\/patch-manager\/manager\.mjs/);
  assert.match(managerSource, /data', 'logic-engine', 'final-send-patch/);
  assert.match(source, /registerLogicEngineFinalSendAdapter/);
});

test('server plugin refuses legacy parallel-manager state before touching the shared patch', () => {
  assert.match(source, /data', 'final-send-patch/);
  assert.match(source, /LOGIC_ENGINE_LEGACY_PATCH_MANAGER_STATE_PRESENT/);
});

test('server plugin composes authenticated Host, embedded Gateway and one-shot NPC handoff', () => {
  assert.match(source, /createSillyTavernHostAdapter/);
  assert.match(source, /hostAdapter\.prepareGenerationContext\(request, hostRoute, signal\)/);
  assert.match(source, /createEmbeddedGatewayRuntime/);
  assert.match(source, /createNpcGenerationContextHostBridge/);
  assert.match(source, /npcBridge\.prepare\(request, response\)/);
  assert.match(source, /npcBridge\.consume\(request, prepared\.response\)/);
  assert.match(source, /createSillyTavernFinalSendAdapter/);
  assert.match(source, /LOGIC_ENGINE_MEMORY_NPC_ENABLED/);
  assert.match(source, /gateway: memoryEnabled \? registeredRuntime\.gateway : unavailableGateway/);
  assert.match(source, /dispatchProtectedRequest\(\)[\s\S]*MEMORY_DISPATCH_NOT_READY/);
  assert.match(source, /authorizeResponseWrite\(\)[\s\S]*MEMORY_DISPATCH_NOT_READY/);
  assert.doesNotMatch(source, /receiveNpcContext|createFailClosedAdapter|NOT_WIRED_FAIL_CLOSED/);
  assert.doesNotMatch(source, /return received\.candidates\.length === 0 \? null : received/);
});

test('server plugin verifies the preinstalled patch read-only and never uninstalls it on shutdown', () => {
  assert.match(source, /LOGIC_ENGINE_FINAL_SEND_PATCH_NOT_INSTALLED_OR_VERIFIED_RESTART_REQUIRED/);
  assert.match(source, /manager\.inspectInstalledReadOnly\(\)/);
  assert.doesNotMatch(source, /await manager\.execute\('(install|update|uninstall)'\)/);
  const exitStart = source.indexOf('export async function exit()');
  assert.ok(exitStart >= 0);
  const exitSource = source.slice(exitStart);
  assert.match(exitSource, /unregisterLogicEngineFinalSendAdapter/);
  assert.match(exitSource, /registeredRuntime\?\.close/);
  assert.doesNotMatch(exitSource, /execute\(['"]uninstall['"]\)/);
});
