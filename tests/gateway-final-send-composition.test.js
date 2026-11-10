import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildProtectedMemory } from '../index.mjs';
import { createNpcGenerationContextHostBridge } from '../src/application/npc-generation-context-host-bridge.js';

const readText = async url => (await readFile(url, 'utf8')).replace(/\r\n/g, '\n');

test('production NPC Host bridge consumes a handoff once and rejects duplicate dispatch', async () => {
  let prepareCalls = 0;
  let consumeCalls = 0;
  const metadata = () => Object.freeze({
    run_id: '77777777-7777-4777-8777-777777777777',
    request_id: '44444444-4444-4444-8444-444444444444',
    generation_id: '66666666-6666-4666-8666-666666666666',
    generation_type: 'normal',
  });
  const bridge = createNpcGenerationContextHostBridge({
    createRequestMetadata: metadata,
    runtime: {
      async prepareForDispatch(requestMetadata) {
        prepareCalls += 1;
        assert.equal(requestMetadata.generation_id, '66666666-6666-4666-8666-666666666666');
        return { status: 'ready', handoff: Object.freeze({ token: 'one-shot' }) };
      },
      consumeDispatchHandoff(handoff, requestMetadata) {
        consumeCalls += 1;
        assert.equal(handoff.token, 'one-shot');
        assert.equal(requestMetadata.request_id, '44444444-4444-4444-8444-444444444444');
        return { status: 'accepted', context: Object.freeze({ request_id: requestMetadata.request_id }) };
      },
      getLaneBDispatchEvidence() { return { status: 'ready', candidates: [], sources: [] }; },
      revalidateLaneAForDispatch() { return { status: 'ready' }; },
      revalidateLaneAForDispatchUnderCoordinatorLease() { return { status: 'ready' }; },
    },
  });
  const request = {};
  const response = {};
  assert.equal((await bridge.prepare(request, response)).status, 'ready');
  const consumed = bridge.consume(request, response);
  assert.equal(consumed.status, 'accepted');
  assert.equal(consumed.runId, '77777777-7777-4777-8777-777777777777');
  assert.equal(bridge.consume(request, response).status, 'non_ready');
  assert.equal(prepareCalls, 1);
  assert.equal(consumeCalls, 1);
});

test('Memory-enabled native Final-Send composes the embedded Gateway and one-shot NPC bridge', async () => {
  const source = await readText(new URL('../index.mjs', import.meta.url));
  assert.match(source, /createEmbeddedGatewayRuntime/);
  assert.match(source, /createNpcGenerationContextHostBridge/);
  assert.match(source, /npcBridge\.prepare\(request, response, signal\)/);
  assert.match(source, /npcBridge\.consume\(request, prepared\.response\)/);
  assert.match(source, /gateway: memoryEnabled \? registeredRuntime\.gateway : unavailableGateway/);
  assert.match(source, /runWithAuthenticatedHostSession: memoryEnabled/);
});

test('production NPC correlation IDs are Host-generated and never read from browser JSON', async () => {
  const source = await readText(new URL('../index.mjs', import.meta.url));
  const metadata = await readText(new URL('../host-adapter/npc-generation-request-metadata.mjs', import.meta.url));
  assert.match(source, /createRequestMetadata: \(\) => createNpcGenerationRequestMetadata\(\)/);
  assert.match(source, /import \{ createNpcGenerationRequestMetadata \}/);
  assert.doesNotMatch(source, /function generationBody\(request\)/);
  assert.match(metadata, /run_id: randomUUID\(\)/);
  assert.match(metadata, /request_id: randomUUID\(\)/);
  assert.match(metadata, /generation_id: randomUUID\(\)/);
  assert.match(metadata, /generation_type: 'normal'/);
});

test('Lane A and Lane B remain distinct in the provider projection', async () => {
  const source = await readText(new URL('../index.mjs', import.meta.url));
  const finalSend = await readText(new URL('../host-adapter/protected-memory-final-send.mjs', import.meta.url));
  assert.match(source, /laneA,/);
  assert.match(source, /revalidateLaneAUnderCoordinatorLease/);
  assert.match(finalSend, /Logic Engine Core Knowledge — Lane A/);
  assert.match(finalSend, /Logic Engine NPC Memory Context — Lane B/);
  assert.doesNotMatch(source, /laneA\.items\.length !== 0\) return undefined/);
});

test('native fallback is limited to a complete-empty two-lane context', async () => {
  const source = await readText(new URL('../index.mjs', import.meta.url));
  assert.match(source, /laneA\.items\.length === 0/);
  assert.match(source, /received\.sources\.length === 0/);
  assert.match(source, /received\.candidates\.length === 0/);
  assert.match(source, /if \(laneA\.items\.length === 0 && received\.contentBlocks\.length === 0[\s\S]*?return null/);
  assert.match(source, /if \(!laneA[\s\S]*?return undefined/);
});

test('Final-Send keeps the authenticated Host capability alive through Gateway response release', async () => {
  const source = await readText(new URL('../host-adapter/sillytavern-final-send-adapter.mjs', import.meta.url));
  assert.match(source, /preparedContextByRequest\.set\(request, Object\.freeze\(\{ request, response,/);
  assert.match(source, /runWithAuthenticatedHostSession\(args\.request, coreConversationId, execute\)/);
  assert.match(source, /authorizeResponseWrite\(response, write, final = false\)/);
});

test('unavailable Gateway remains terminal when Memory integration is disabled', async () => {
  const source = await readText(new URL('../index.mjs', import.meta.url));
  const gatewayStart = source.indexOf('const unavailableGateway = Object.freeze({');
  const gatewayEnd = source.indexOf('\n});', gatewayStart);
  assert.ok(gatewayStart >= 0 && gatewayEnd > gatewayStart);
  const gateway = source.slice(gatewayStart, gatewayEnd);
  assert.match(gateway, /dispatchProtectedRequest\(\)[\s\S]*throw new Error\('MEMORY_DISPATCH_NOT_READY'\)/);
  assert.match(gateway, /authorizeResponseWrite\(\)[\s\S]*throw new Error\('MEMORY_DISPATCH_NOT_READY'\)/);
});

test('Host session revocation is read by Gateway and serialized with the shared Coordinator', async () => {
  const runtime = await readText(new URL('../host-adapter/embedded-gateway-runtime.mjs', import.meta.url));
  const store = await readText(new URL('../src/application/host-assertion-nonce-store.js', import.meta.url));
  const api = await readText(new URL('../src/api/server.js', import.meta.url));
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
  const runtime = await readText(new URL('../host-adapter/embedded-gateway-runtime.mjs', import.meta.url));
  const provider = await readText(new URL('../src/application/memory-npc-provider-adapter.js', import.meta.url));
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
  const gateway = await readText(new URL('../src/security/memory-dispatch-gateway.js', import.meta.url));
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
  const source = await readText(new URL('../index.mjs', import.meta.url));
  const start = source.indexOf('function resolveRequestModel(request, prepared) {');
  const end = source.indexOf('\n}\n', start);
  assert.ok(start >= 0 && end > start);
  const resolver = source.slice(start, end);
  assert.match(resolver, /const body = request\?\.body;/);
  assert.doesNotMatch(resolver, /request\?\.body\?\.params/);
});

test('protected Memory projection reads Core context from the prepared Host envelope', async () => {
  const source = await readText(new URL('../index.mjs', import.meta.url));
  assert.match(source, /host: Object\.freeze\(\{ context: host\.context \}\),\s*coreContext: prepared\.coreContext/);
  assert.match(source, /const preparedHostContext = prepared\?\.hostContext;[\s\S]*?preparedHostContext\?\.status !== 'READY'/);
  assert.match(source, /const hostBinding = host\.context;\s*\/\/ prepareHostContext stores coreContext beside host[\s\S]*?const coreContext = prepared\.hostContext\.coreContext;/);
  assert.doesNotMatch(source, /const coreContext = host\.coreContext;/);
});

test('production protected-memory projection accepts the actual prepared Host/Core envelope', () => {
  const candidate = {
    record_ref: 'record-1',
    record_version: 'version-1',
    authorization_generation: 3,
    source_kind: 'canonical_entity',
    source_entity_id: 'entity-1',
    source_version: 'core-entity-v1:2',
    epistemic_kind: 'acquired_report',
    evidence_assessment: 'supported',
    content: { 'attributes.public_note': 'A verified memory candidate' },
  };
  const hostBinding = {
    host_installation_id: '11111111-1111-4111-8111-111111111111',
    authenticated_account_id: '22222222-2222-4222-8222-222222222222',
    host_session_id: '55555555-5555-4555-8555-555555555555',
    conversation_id: '11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:33333333-3333-4333-8333-333333333333',
    conversation_uuid: '33333333-3333-4333-8333-333333333333',
    root_id: 'a'.repeat(64),
    root_inventory_sequence: 7,
    root_manifest_sha256: 'a'.repeat(64),
  };
  const coreContext = {
    adapter_id: 'st-host-adapter',
    conversation_id: '55555555-5555-4555-8555-555555555555:11111111-1111-4111-8111-111111111111:33333333-3333-4333-8333-333333333333',
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
    request_id: '44444444-4444-4444-8444-444444444444',
    generation_id: '66666666-6666-4666-8666-666666666666',
    world_id: 'world',
    actor_id: 'actor',
    snapshot: { world_revision: 3, commit_sequence: 9 },
    lanes: {
      lane_a: { items: [] },
      lane_b: {
        status: 'ready',
        candidates: [candidate],
        result: {
          status: 'ready',
          admitted: [{
            record_ref: candidate.record_ref,
            record_version: candidate.record_version,
            epistemic_kind: candidate.epistemic_kind,
            evidence_assessment: candidate.evidence_assessment,
          }],
          candidates: [{
            record_ref: candidate.record_ref,
            record_version: candidate.record_version,
            authorization_generation: candidate.authorization_generation,
            source_entity_id: candidate.source_entity_id,
            source_version: candidate.source_version,
            epistemic_kind: candidate.epistemic_kind,
            evidence_assessment: candidate.evidence_assessment,
            content: candidate.content,
          }],
          reason: null,
          snapshot: { world_revision: 3, commit_sequence: 9 },
          provider_evidence_cursor: { data_version: 4, candidate_digest: 'b'.repeat(64) },
        },
      },
    },
  };
  const npcBridge = {
    consume: () => ({
      status: 'accepted',
      context: acceptedContext,
      laneB: {
        status: 'ready',
        sources: [{ source_kind: 'canonical_entity', source_entity_id: 'entity-1', source_version: 'core-entity-v1:2' }],
        candidates: [{ record_ref: 'record-1', record_version: 'version-1', authorization_generation: 3, source_kind: 'canonical_entity', source_entity_id: 'entity-1', source_version: 'core-entity-v1:2', epistemic_kind: 'acquired_report', evidence_assessment: 'supported' }],
        provider_evidence_cursor: { data_version: 4, candidate_digest: 'b'.repeat(64) },
      },
      revalidateLaneAUnderCoordinatorLease: () => ({ status: 'ready' }),
    }),
  };

  const result = buildProtectedMemory({ body: { model: 'horde-model' } }, prepared, npcBridge);
  assert.equal(result.model, 'horde-model');
  assert.equal(result.runId, '77777777-7777-4777-8777-777777777777');
  assert.equal(result.generationId, '66666666-6666-4666-8666-666666666666');
  assert.match(result.contextDigest, /^[a-f0-9]{64}$/);
  assert.match(result.coreEnvelopeDigest, /^[a-f0-9]{64}$/);
  assert.equal(result.hostContext.adapter_id, coreContext.adapter_id);
  assert.equal(result.hostContext.core_conversation_id, coreContext.conversation_id);
  assert.equal(result.hostContext.host_session_id, hostBinding.host_session_id);
  assert.equal(result.candidates.length, 1);
  assert.notStrictEqual(result.contentBlocks[0].content, candidate.content);
  assert.equal(Object.getPrototypeOf(result.contentBlocks[0].content), null);
  assert.equal(result.contentBlocks[0].content['attributes.public_note'], candidate.content['attributes.public_note']);
  assert.equal(result.providerEvidenceCursor.data_version, 4);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.hostContext));
  assert.ok(Object.isFrozen(result.sources));
  assert.ok(Object.isFrozen(result.candidates));
  assert.ok(Object.isFrozen(result.contentBlocks));
  assert.ok(Object.isFrozen(result.contentBlocks[0]));
  assert.ok(Object.isFrozen(result.contentBlocks[0].content));
  assert.ok(Object.isFrozen(result.snapshot));
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

test('production protected-memory projection rejects Lane B content without a matching admitted candidate', () => {
  const candidate = {
    record_ref: 'record-2',
    record_version: 'version-2',
    authorization_generation: 4,
    source_kind: 'canonical_entity',
    source_entity_id: 'entity-2',
    source_version: 'core-entity-v1:3',
    epistemic_kind: 'acquired_report',
    evidence_assessment: 'supported',
    content: 'Content without an admitted candidate',
  };
  const result = buildProtectedMemory({ body: { model: 'horde-model' } }, {
    response: {},
    hostRoute: 'horde-text',
    hostContext: {
      status: 'READY',
      host: { context: {
        host_installation_id: '11111111-1111-4111-8111-111111111111',
        authenticated_account_id: '22222222-2222-4222-8222-222222222222',
        host_session_id: '55555555-5555-4555-8555-555555555555',
        conversation_id: '11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:33333333-3333-4333-8333-333333333333',
        conversation_uuid: '11111111-1111-4111-8111-111111111111',
        root_id: 'a'.repeat(64),
        root_inventory_sequence: 7,
        root_manifest_sha256: 'a'.repeat(64),
      } },
      coreContext: { adapter_id: 'adapter', conversation_id: '55555555-5555-4555-8555-555555555555:11111111-1111-4111-8111-111111111111:33333333-3333-4333-8333-333333333333', actor_type: 'character' },
    },
  }, {
    consume: () => ({
      status: 'accepted',
      context: {
        request_id: '44444444-4444-4444-8444-444444444444',
        generation_id: 'generation-id',
        world_id: 'world',
        actor_id: 'actor',
        snapshot: { world_revision: 3, commit_sequence: 9 },
        lanes: {
          lane_a: { items: [] },
          lane_b: { status: 'ready', candidates: [candidate] },
        },
      },
      laneB: {
        status: 'ready',
        sources: [{ source_kind: 'canonical_entity', source_entity_id: 'entity-2', source_version: 'core-entity-v1:3' }],
        candidates: [{ record_ref: 'different-record', record_version: 'version-2', authorization_generation: 4, source_kind: 'canonical_entity', source_entity_id: 'entity-2', source_version: 'core-entity-v1:3', epistemic_kind: 'acquired_report', evidence_assessment: 'supported' }],
        provider_evidence_cursor: { data_version: 4, candidate_digest: 'b'.repeat(64) },
      },
    }),
  });
  assert.equal(result, undefined);
});

test('production protected-memory projection rejects same-count Lane B candidate substitution', () => {
  const contextCandidate = {
    record_ref: 'record-context',
    record_version: 'version-1',
    authorization_generation: 5,
    source_kind: 'canonical_entity',
    source_entity_id: 'entity-1',
    source_version: 'core-entity-v1:1',
    epistemic_kind: 'acquired_report',
    evidence_assessment: 'supported',
    content: 'Substituted prompt content',
  };
  const result = buildProtectedMemory({ body: { model: 'horde-model' } }, {
    response: {}, hostRoute: 'horde-text',
    hostContext: { status: 'READY', host: { context: {
      host_installation_id: '11111111-1111-4111-8111-111111111111', authenticated_account_id: '22222222-2222-4222-8222-222222222222',
      host_session_id: '55555555-5555-4555-8555-555555555555', conversation_id: '11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:33333333-3333-4333-8333-333333333333',
      conversation_uuid: '11111111-1111-4111-8111-111111111111',
      root_id: 'a'.repeat(64), root_inventory_sequence: 7, root_manifest_sha256: 'a'.repeat(64),
    } }, coreContext: { adapter_id: 'adapter', conversation_id: '55555555-5555-4555-8555-555555555555:11111111-1111-4111-8111-111111111111:33333333-3333-4333-8333-333333333333', actor_type: 'character' } },
  }, { consume: () => ({
    status: 'accepted',
    context: { request_id: '44444444-4444-4444-8444-444444444444', generation_id: 'generation-id', world_id: 'world', actor_id: 'actor',
      snapshot: { world_revision: 3, commit_sequence: 9 },
      lanes: { lane_a: { items: [] }, lane_b: { status: 'ready', candidates: [contextCandidate] } } },
    laneB: { status: 'ready',
      sources: [{ source_kind: 'canonical_entity', source_entity_id: 'entity-1', source_version: 'core-entity-v1:1' }],
      candidates: [{ record_ref: 'different-record', record_version: 'version-1', authorization_generation: 5,
        source_kind: 'canonical_entity', source_entity_id: 'entity-1', source_version: 'core-entity-v1:1',
        epistemic_kind: 'acquired_report', evidence_assessment: 'supported' }],
    },
  }) });
  assert.equal(result, undefined);
});


test('production Host revocation evidence requires the active shared Coordinator lease', async () => {
  const runtime = await readText(new URL('../host-adapter/embedded-gateway-runtime.mjs', import.meta.url));
  const start = runtime.indexOf('readHostEvidence: ({ hostContext, coordinatorLease }) => {');
  const end = runtime.indexOf('\n      },\n    });', start);
  assert.ok(start >= 0 && end > start);
  const reader = runtime.slice(start, end);
  const leaseGuard = reader.indexOf('isCoordinatorLease(coordinatorLease, engine.store.coordinatorDb)');
  const revocationRead = reader.indexOf('hostSessionRevocationReader.isSessionRevoked');
  const lifecycleRead = reader.indexOf('hostJournal.readAuthoritySnapshotUnderLease');
  assert.ok(leaseGuard >= 0 && revocationRead > leaseGuard && lifecycleRead > revocationRead);
  assert.match(reader, /HOST_SESSION_REVOCATION_COORDINATOR_LEASE_REQUIRED/);
});


test('Gateway replay digest remains stable across Host session rotation', async () => {
  const gateway = await readText(new URL('../src/security/memory-dispatch-gateway.js', import.meta.url));
  const start = gateway.indexOf('const requestDigest = createHash');
  const end = gateway.indexOf("), 'utf8').digest('hex');", start);
  assert.ok(start >= 0 && end > start);
  const digestInput = gateway.slice(start, end);
  assert.doesNotMatch(digestInput, /host_session_id/);
  assert.match(digestInput, /host_installation_id: hostContextSnapshot\.host_installation_id/);
  assert.match(digestInput, /authenticated_account_id: hostContextSnapshot\.authenticated_account_id/);
  assert.match(digestInput, /host_conversation_id: hostContextSnapshot\.host_conversation_id/);
});
