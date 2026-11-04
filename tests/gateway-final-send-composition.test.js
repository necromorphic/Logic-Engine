import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildProtectedMemory } from '../index.mjs';

test('Memory-enabled native Final-Send composes the embedded Gateway and one-shot NPC bridge', async () => {
  const source = await readFile(new URL('../index.mjs', import.meta.url), 'utf8');
  assert.match(source, /createEmbeddedGatewayRuntime/);
  assert.match(source, /createNpcGenerationContextHostBridge/);
  assert.match(source, /npcBridge\.prepare\(request, response, signal\)/);
  assert.match(source, /npcBridge\.consume\(request, prepared\.response\)/);
  assert.match(source, /gateway: memoryEnabled \? registeredRuntime\.gateway : unavailableGateway/);
  assert.match(source, /runWithAuthenticatedHostSession: memoryEnabled/);
});

test('production NPC correlation IDs are Host-generated and never read from browser JSON', async () => {
  const source = await readFile(new URL('../index.mjs', import.meta.url), 'utf8');
  const metadata = await readFile(new URL('../host-adapter/npc-generation-request-metadata.mjs', import.meta.url), 'utf8');
  assert.match(source, /createRequestMetadata: \(\) => createNpcGenerationRequestMetadata\(\)/);
  assert.match(source, /import \{ createNpcGenerationRequestMetadata \}/);
  assert.doesNotMatch(source, /function generationBody\(request\)/);
  assert.match(metadata, /request_id: randomUUID\(\)/);
  assert.match(metadata, /generation_id: randomUUID\(\)/);
  assert.match(metadata, /generation_type: 'normal'/);
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
  assert.match(runtime, /readHostEvidence: \(\{ hostContext, coordinatorLease \}\) => \{/);
  const hostReaderStart = runtime.indexOf('readHostEvidence: ({ hostContext, coordinatorLease }) => {');
  const hostReaderEnd = runtime.indexOf('\n      },\n    });', hostReaderStart);
  assert.ok(hostReaderStart >= 0 && hostReaderEnd > hostReaderStart);
  const hostReader = runtime.slice(hostReaderStart, hostReaderEnd);
  assert.ok(hostReader.indexOf('hostSessionRevocationReader.isSessionRevoked') >= 0);
  assert.ok(hostReader.indexOf('hostJournal.readAuthoritySnapshotUnderLease') > hostReader.indexOf('hostSessionRevocationReader.isSessionRevoked'));
  assert.match(hostReader, /HOST_SESSION_REVOKED/);
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

test('Horde model identity is resolved from the native request body, not a nonexistent params envelope', async () => {
  const source = await readFile(new URL('../index.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('function resolveRequestModel(request, prepared) {');
  const end = source.indexOf('\n}\n', start);
  assert.ok(start >= 0 && end > start);
  const resolver = source.slice(start, end);
  assert.match(resolver, /const body = request\?\.body;/);
  assert.doesNotMatch(resolver, /request\?\.body\?\.params/);
});

test('protected Memory projection reads Core context from the prepared Host envelope', async () => {
  const source = await readFile(new URL('../index.mjs', import.meta.url), 'utf8');
  assert.match(source, /host: Object\.freeze\(\{ context: host\.context \}\),\s*coreContext: prepared\.coreContext/);
  assert.match(source, /const preparedHostContext = prepared\?\.hostContext;[\s\S]*?preparedHostContext\?\.status !== 'READY'/);
  assert.match(source, /const hostBinding = host\.context;\s*\/\/ prepareHostContext stores coreContext beside host[\s\S]*?const coreContext = prepared\.hostContext\.coreContext;/);
  assert.doesNotMatch(source, /const coreContext = host\.coreContext;/);
});

test('production protected-memory projection accepts the actual prepared Host/Core envelope', () => {
  const candidate = {
    epistemic_kind: 'acquired_report',
    evidence_assessment: 'supported',
    content: 'A verified memory candidate',
  };
  const hostBinding = {
    host_installation_id: 'host-installation',
    authenticated_account_id: 'account',
    host_session_id: 'session',
    conversation_id: 'conversation',
    conversation_uuid: '11111111-1111-4111-8111-111111111111',
    root_id: 'root',
    root_inventory_sequence: 7,
    root_manifest_sha256: 'a'.repeat(64),
  };
  const coreContext = {
    adapter_id: 'st-host-adapter',
    conversation_id: 'core-conversation',
    actor_type: 'character',
  };
  const prepared = {
    response: {},
    hostRoute: 'horde-text',
    hostContext: {
      status: 'READY',
      host: { context: hostBinding },
      coreContext,
    },
  };
  const acceptedContext = {
    request_id: 'request-id',
    generation_id: 'generation-id',
    world_id: 'world',
    actor_id: 'actor',
    snapshot: { world_revision: 3, commit_sequence: 9 },
    lanes: {
      lane_a: { items: [] },
      lane_b: { status: 'ready', candidates: [candidate] },
    },
  };
  const npcBridge = {
    consume: () => ({
      status: 'accepted',
      context: acceptedContext,
      laneB: {
        status: 'ready',
        sources: [{ source_id: 'source' }],
        candidates: [candidate],
        provider_evidence_cursor: { data_version: 4, candidate_digest: 'b'.repeat(64) },
      },
      revalidateLaneAUnderCoordinatorLease: () => ({ status: 'ready' }),
    }),
  };

  const result = buildProtectedMemory({ body: { model: 'horde-model' } }, prepared, npcBridge);
  assert.equal(result.model, 'horde-model');
  assert.equal(result.hostContext.adapter_id, coreContext.adapter_id);
  assert.equal(result.hostContext.core_conversation_id, coreContext.conversation_id);
  assert.equal(result.hostContext.host_session_id, hostBinding.host_session_id);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.contentBlocks[0].content, candidate.content);
  assert.equal(result.providerEvidenceCursor.data_version, 4);
});

test('production protected-memory projection fails closed when the prepared Host envelope is not READY', () => {
  const result = buildProtectedMemory({}, {
    response: {},
    hostContext: {
      status: 'NON_READY',
      host: { context: {} },
      coreContext: {},
    },
  }, { consume: () => { throw new Error('must not consume'); } });
  assert.equal(result, undefined);
});
