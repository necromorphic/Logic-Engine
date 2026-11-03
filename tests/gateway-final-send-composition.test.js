import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Memory-enabled native Final-Send composes the embedded Gateway and one-shot NPC bridge', async () => {
  const source = await readFile(new URL('../index.mjs', import.meta.url), 'utf8');
  assert.match(source, /createEmbeddedGatewayRuntime/);
  assert.match(source, /createNpcGenerationContextHostBridge/);
  assert.match(source, /npcBridge\.prepare\(request, response\)/);
  assert.match(source, /npcBridge\.consume\(request, prepared\.response\)/);
  assert.match(source, /gateway: memoryEnabled \? registeredRuntime\.gateway : unavailableGateway/);
  assert.match(source, /runWithAuthenticatedHostSession: memoryEnabled/);
});

test('non-empty Lane A is terminal until its model projection is explicitly approved', async () => {
  const source = await readFile(new URL('../index.mjs', import.meta.url), 'utf8');
  assert.match(source, /if \(laneA\.items\.length !== 0\) return undefined/);
  assert.match(source, /complete, revalidated empty Lane A \+ Lane B is explicitly unprotected/);
  assert.doesNotMatch(source, /return received;/);
});

test('native fallback is limited to a complete-empty two-lane context', async () => {
  const source = await readFile(new URL('../index.mjs', import.meta.url), 'utf8');
  assert.match(source, /accepted\.laneB\.sources\.length === 0/);
  assert.match(source, /accepted\.laneB\.candidates\.length === 0/);
  assert.match(source, /if \(contentBlocks\.length === 0[\s\S]*?return null/);
  assert.match(source, /if \(!laneA[\s\S]*?return undefined/);
});

test('Final-Send keeps the authenticated Host capability alive through Gateway response release', async () => {
  const source = await readFile(new URL('../host-adapter/sillytavern-final-send-adapter.mjs', import.meta.url), 'utf8');
  assert.match(source, /preparedContextByRequest\.set\(request, Object\.freeze\(\{ request, response,/);
  assert.match(source, /runWithAuthenticatedHostSession\(args\.request, coreConversationId, execute\)/);
  assert.match(source, /authorizeResponseWrite\(response, write, final = false\)/);
});

test('unavailable Gateway remains terminal when Memory integration is disabled', async () => {
  const source = await readFile(new URL('../index.mjs', import.meta.url), 'utf8');
  const gatewayStart = source.indexOf('const unavailableGateway = Object.freeze({');
  const gatewayEnd = source.indexOf('\n});', gatewayStart);
  assert.ok(gatewayStart >= 0 && gatewayEnd > gatewayStart);
  const gateway = source.slice(gatewayStart, gatewayEnd);
  assert.match(gateway, /dispatchProtectedRequest\(\)[\s\S]*throw new Error\('MEMORY_DISPATCH_NOT_READY'\)/);
  assert.match(gateway, /authorizeResponseWrite\(\)[\s\S]*throw new Error\('MEMORY_DISPATCH_NOT_READY'\)/);
});
