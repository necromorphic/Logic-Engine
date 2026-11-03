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

test('Lane A and Lane B remain distinct in the provider projection', async () => {
  const source = await readFile(new URL('../index.mjs', import.meta.url), 'utf8');
  const finalSend = await readFile(new URL('../host-adapter/protected-memory-final-send.mjs', import.meta.url), 'utf8');
  assert.match(source, /laneA,/);
  assert.match(source, /revalidateLaneAUnderCoordinatorLease/);
  assert.match(finalSend, /Logic Engine Core Knowledge — Lane A/);
  assert.match(finalSend, /Logic Engine NPC Memory Context — Lane B/);
  assert.doesNotMatch(source, /laneA\.items\.length !== 0\) return undefined/);
});

test('native fallback is limited to a complete-empty two-lane context', async () => {
  const source = await readFile(new URL('../index.mjs', import.meta.url), 'utf8');
  assert.match(source, /laneA\.items\.length === 0/);
  assert.match(source, /accepted\.laneB\.sources\.length === 0/);
  assert.match(source, /accepted\.laneB\.candidates\.length === 0/);
  assert.match(source, /if \(laneA\.items\.length === 0 && contentBlocks\.length === 0[\s\S]*?return null/);
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

test('Host session revocation is read by Gateway and serialized with the shared Coordinator', async () => {
  const runtime = await readFile(new URL('../host-adapter/embedded-gateway-runtime.mjs', import.meta.url), 'utf8');
  const store = await readFile(new URL('../src/application/host-assertion-nonce-store.js', import.meta.url), 'utf8');
  const api = await readFile(new URL('../src/api/server.js', import.meta.url), 'utf8');
  assert.match(runtime, /hostSessionRevocationReader\.isSessionRevoked/);
  assert.match(runtime, /HOST_SESSION_REVOKED/);
  assert.match(store, /async revokeSession\(/);
  assert.match(store, /await acquireCoordinatorLeaseWithoutBlocking\(this\.\#coordinatorDb\)/);
  assert.match(api, /await hostAssertionNonceStore\.revokeSession\(/);
});


test('production embedded runtime wires separate synchronous Core, Provider and Host evidence readers', async () => {
  const runtime = await readFile(new URL('../host-adapter/embedded-gateway-runtime.mjs', import.meta.url), 'utf8');
  const provider = await readFile(new URL('../src/application/memory-npc-provider-adapter.js', import.meta.url), 'utf8');
  assert.match(runtime, /new SQLiteStore\(corePath, \{ readOnly: true \}\)/);
  assert.match(runtime, /observerOnly: true/);
  assert.match(runtime, /new MemoryDispatchGateway\(/);
  assert.match(runtime, /readCoreEvidence: input => providerAdapter\.consumer\.readDispatchEvidenceSync\(input\)/);
  assert.match(runtime, /readProviderEvidence: input => providerAdapter\.readDispatchEvidenceSync\(input\)/);
  assert.match(runtime, /readHostEvidence: \(\{ hostContext, coordinatorLease \}\)/);
  assert.match(runtime, /readAuthoritySnapshotUnderLease\([\s\S]*?coordinatorLease/);
  assert.match(provider, /readCoreEvidenceSync: input => consumer\.readDispatchEvidenceSync\(input\)/);
  assert.match(provider, /readProviderEvidenceSync: input => provider\.readDispatchEvidenceSync\(input\)/);
});

test('final response revalidation re-reads Host root authority before every protected write', async () => {
  const gateway = await readFile(new URL('../src/security/memory-dispatch-gateway.js', import.meta.url), 'utf8');
  const start = gateway.indexOf('  #revalidateReleaseContext(context, coordinatorLease)');
  const end = gateway.indexOf('  /** Revalidate and perform one synchronous Host write', start);
  assert.ok(start >= 0 && end > start);
  const release = gateway.slice(start, end);
  assert.match(release, /this\.readHostEvidence\(/);
  assert.match(release, /currentHost\.status !== 'READY'/);
  assert.match(release, /currentHost\.root_inventory_sequence !== context\.hostContext\.root_inventory_sequence/);
  assert.match(release, /currentHost\.root_manifest_sha256 !== context\.hostContext\.root_manifest_sha256/);
  assert.match(gateway, /this\.#revalidateReleaseContext\(context, release\)/);
});
