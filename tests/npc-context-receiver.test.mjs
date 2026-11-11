import test from 'node:test';
import assert from 'node:assert/strict';
import { receiveNpcContext } from '../host-adapter/npc-context-receiver.mjs';

const hostContext = Object.freeze({
  adapter_id: 'st-gateway',
  conversation_id: '55555555-5555-4555-8555-555555555555:11111111-1111-4111-8111-111111111111:33333333-3333-4333-8333-333333333333',
  world_id: 'world-main',
  actor_id: 'actor-npc',
  actor_type: 'npc',
});
const hostBinding = Object.freeze({
  host_installation_id: '11111111-1111-4111-8111-111111111111',
  authenticated_account_id: '22222222-2222-4222-8222-222222222222',
  host_session_id: '55555555-5555-4555-8555-555555555555',
  conversation_id: '11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:33333333-3333-4333-8333-333333333333',
  conversation_uuid: '33333333-3333-4333-8333-333333333333',
  root_id: 'a'.repeat(64),
  root_inventory_sequence: 1,
  root_manifest_sha256: 'b'.repeat(64),
  adapter_id: 'st-gateway',
  world_id: 'world-main',
  actor_id: 'actor-npc',
  actor_type: 'npc',
});
const requestId = '44444444-4444-4444-8444-444444444444';
const runId = '77777777-7777-4777-8777-777777777777';
const generationId = '66666666-6666-4666-8666-666666666666';
const candidate = (overrides = {}) => ({
  record_ref: 'memory:record-1',
  record_version: 'v3',
  authorization_generation: 4,
  source_entity_id: 'entity-1',
  epistemic_kind: 'acquired_report',
  evidence_assessment: 'supported',
  content: { 'attributes.public_note': 'A trusted source statement.' },
  ...overrides,
});
const sourceLineageFor = result => result.candidates.flatMap(item => {
  const admitted = result.admitted.some(entry => entry.record_ref === item.record_ref
    && entry.record_version === item.record_version);
  return admitted ? [{
    record_ref: item.record_ref,
    record_version: item.record_version,
    authorization_generation: item.authorization_generation,
    source_kind: 'canonical_entity',
    source_entity_id: item.source_entity_id,
    source_version: 'core-entity-v1:7',
  }] : [];
});
const receive = input => receiveNpcContext({
  sourceLineage: sourceLineageFor(input.retrieval),
  ...input,
});

const retrieval = (overrides = {}) => ({
  status: 'ready',
  admitted: [{
    record_ref: 'memory:record-1',
    record_version: 'v3',
    epistemic_kind: 'acquired_report',
    evidence_assessment: 'supported',
  }],
  candidates: [candidate()],
  reason: null,
  snapshot: { world_revision: 12, commit_sequence: 19 },
  ...overrides,
});

test('receiver digest is stable for the same accepted context and changes when admitted content changes', () => {
  const original = retrieval();
  const first = receive({
    retrieval: original, hostContext, hostBinding, requestId, generationId, runId,
    model: 'google/gemini-test',
  });
  const repeated = receive({
    retrieval: retrieval(), hostContext, hostBinding, requestId, generationId, runId,
    model: 'google/gemini-test',
  });
  const changed = receive({
    retrieval: retrieval({ candidates: [candidate({ content: { 'attributes.public_note': 'Changed content' } })] }),
    hostContext, hostBinding, requestId, generationId, runId,
    model: 'google/gemini-test',
  });
  assert.equal(first.contextDigest, repeated.contextDigest);
  const otherRun = receive({ retrieval: retrieval(), hostContext, hostBinding, requestId, generationId,
    runId: '88888888-8888-4888-8888-888888888888', model: 'google/gemini-test' });
  assert.notEqual(first.contextDigest, otherRun.contextDigest);
  assert.notEqual(first.contextDigest, changed.contextDigest);
  assert.match(first.coreEnvelopeDigest, /^[a-f0-9]{64}$/);
  assert.notEqual(first.coreEnvelopeDigest, changed.coreEnvelopeDigest);
});

test('receiver rejects missing or malformed generation identity and run identity', () => {
  assert.throws(() => receive({
    retrieval: retrieval(), hostContext, hostBinding, requestId,
    model: 'google/gemini-test',
  }), /NPC_CONTEXT_SCOPE_INVALID/);
  assert.throws(() => receive({
    retrieval: retrieval(), hostContext, hostBinding, requestId, generationId: 'not-a-uuid', runId,
    model: 'google/gemini-test',
  }), /NPC_CONTEXT_SCOPE_INVALID/);
  assert.throws(() => receive({
    retrieval: retrieval(), hostContext, hostBinding, requestId, generationId, runId: 'not-a-uuid',
    model: 'google/gemini-test',
  }), /NPC_CONTEXT_SCOPE_INVALID/);
});

test('receiver converts only matching Core-admitted candidates into Gateway metadata and content blocks', () => {
  const result = receive({
    retrieval: retrieval(),
    hostContext,
    hostBinding,
    requestId,
    generationId,
    runId,
    model: 'google/gemini-test',
  });
  assert.equal(result.runId, runId);
  assert.equal(result.generationId, generationId);
  assert.match(result.contextDigest, /^[a-f0-9]{64}$/);
  assert.match(result.coreEnvelopeDigest, /^[a-f0-9]{64}$/);
  assert.equal(result.worldId, 'world-main');
  assert.equal(result.actorId, 'actor-npc');
  assert.equal(result.purpose, 'npc_decision');
  assert.deepEqual(result.sources, [{
    source_kind: 'canonical_entity',
    source_entity_id: 'entity-1',
    source_version: 'core-entity-v1:7',
  }]);
  assert.deepEqual(result.candidates, [{
    record_ref: 'memory:record-1',
    record_version: 'v3',
    authorization_generation: 4,
    source_kind: 'canonical_entity',
    source_entity_id: 'entity-1',
    source_version: 'core-entity-v1:7',
  }]);
  assert.deepEqual(result.contentBlocks, [{
    epistemic_kind: 'acquired_report',
    evidence_assessment: 'supported',
    content: { 'attributes.public_note': 'A trusted source statement.' },
  }]);
  assert.equal(result.hostContext.core_conversation_id, hostContext.conversation_id);
  assert.equal(result.hostContext.host_session_id, hostBinding.host_session_id);
  assert.equal(result.hostContext.root_id, hostBinding.root_id);
  assert.equal(result.hostContext.root_inventory_sequence, 1);
});

test('authorized complete-empty result is preserved as an empty ready context', () => {
  const result = receive({
    retrieval: retrieval({ admitted: [], candidates: [] }),
    hostContext,
    hostBinding,
    requestId,
    generationId,
    runId,
    model: 'google/gemini-test',
  });
  assert.deepEqual(result.sources, []);
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.contentBlocks, []);
});

test('receiver accepts the public five-field envelope and rejects the private Provider cursor', () => {
  const publicResult = receive({
    retrieval: retrieval(),
    hostContext,
    hostBinding,
    requestId,
    generationId,
    runId,
    model: 'google/gemini-test',
  });
  assert.match(publicResult.coreEnvelopeDigest, /^[a-f0-9]{64}$/);
  assert.throws(() => receive({
    retrieval: retrieval({
      provider_evidence_cursor: { data_version: 23, candidate_digest: 'c'.repeat(64) },
    }),
    hostContext,
    hostBinding,
    requestId,
    generationId,
    runId,
    model: 'google/gemini-test',
  }), /NPC_CONTEXT_NON_READY/);
});

test('NON_READY and malformed result envelopes are rejected', () => {
  assert.throws(() => receive({
    retrieval: { status: 'non_ready', admitted: [], candidates: [], reason: 'provider_unavailable' },
    hostContext, hostBinding, requestId,
    generationId, runId, model: 'google/gemini-test',
  }), /NPC_CONTEXT_NON_READY/);
  assert.throws(() => receive({
    retrieval: retrieval({ candidates: [] }),
    hostContext, hostBinding, requestId,
    generationId, runId, model: 'google/gemini-test',
  }), /NPC_CONTEXT_NON_READY/);
});

test('receiver rejects unassessed, disputed and insufficient evidence before projection', () => {
  for (const evidence_assessment of ['unassessed', 'disputed', 'insufficient', 'unknown']) {
    assert.throws(() => receive({
      retrieval: retrieval({
        admitted: [{
          record_ref: 'memory:record-1',
          record_version: 'v3',
          epistemic_kind: 'acquired_report',
          evidence_assessment,
        }],
        candidates: [candidate({ evidence_assessment })],
      }),
      hostContext, hostBinding, requestId,
    generationId, runId, model: 'google/gemini-test',
    }), /NPC_CONTEXT_CANDIDATE_SCOPE_MISMATCH/);
  }
});

test('receiver does not project preserved but unadmitted evidence', () => {
  const result = receive({
    retrieval: retrieval({
      admitted: [],
      candidates: [candidate({ evidence_assessment: 'disputed' })],
    }),
    hostContext, hostBinding, requestId,
    generationId, runId, model: 'google/gemini-test',
  });
  assert.deepEqual(result.sources, []);
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.contentBlocks, []);
});

test('receiver rejects source-version, admission and scope mismatches', () => {
  assert.throws(() => receive({
    retrieval: retrieval(),
    sourceLineage: [{
      record_ref: 'memory:record-1', record_version: 'v3', authorization_generation: 4,
      source_kind: 'canonical_entity', source_entity_id: 'entity-1', source_version: '',
    }],
    hostContext, hostBinding, requestId,
    generationId, runId, model: 'google/gemini-test',
  }), /NPC_CONTEXT_SOURCE_LINEAGE_INVALID/);
  assert.throws(() => receive({
    retrieval: retrieval(), sourceLineage: [],
    hostContext, hostBinding, requestId,
    generationId, runId, model: 'google/gemini-test',
  }), /NPC_CONTEXT_SOURCE_LINEAGE_MISMATCH/);
  assert.throws(() => receive({
    retrieval: retrieval({ admitted: [] }),
    hostContext, hostBinding, requestId,
    generationId, runId, model: 'google/gemini-test',
  }), /NPC_CONTEXT_NON_READY/);
  assert.throws(() => receive({
    retrieval: retrieval(),
    hostContext: { ...hostContext, actor_id: 'attacker-actor' },
    hostBinding,
    requestId,
    generationId,
    runId, model: 'google/gemini-test',
  }), /NPC_CONTEXT_SCOPE_INVALID/);
});

test('receiver rejects accessor, Proxy, excessive nesting and oversized content values', () => {
  const accessor = {
    record_ref: 'memory:record-1', record_version: 'v3', authorization_generation: 4,
    source_kind: 'canonical_entity', source_entity_id: 'entity-1', source_version: 'core-entity-v1:7',
  };
  Object.defineProperty(accessor, 'source_version', { enumerable: true, get() { throw new Error('getter executed'); } });
  assert.throws(() => receive({
    retrieval: retrieval(),
    sourceLineage: [accessor],
    hostContext, hostBinding, requestId,
    generationId, runId, model: 'google/gemini-test',
  }), /NPC_CONTEXT_SOURCE_LINEAGE_INVALID/);
  assert.throws(() => receive({
    retrieval: new Proxy(retrieval(), {}),
    hostContext, hostBinding, requestId,
    generationId, runId, model: 'google/gemini-test',
  }), /NPC_CONTEXT_NON_READY/);
  assert.throws(() => receive({
    retrieval: retrieval({ candidates: [candidate({ content: { nested: { level2: { level3: { level4: { level5: { secret: true } } } } } } })] }),
    hostContext, hostBinding, requestId,
    generationId, runId, model: 'google/gemini-test',
  }), /NPC_CONTEXT_CONTENT_INVALID/);
  assert.throws(() => receive({
    retrieval: retrieval({ candidates: [candidate({ content: { note: 'x'.repeat(32769) } })] }),
    hostContext, hostBinding, requestId,
    generationId, runId, model: 'google/gemini-test',
  }), /NPC_CONTEXT_CONTENT_INVALID/);
});

test('receiver preserves bounded JSON-safe nested NPC content', () => {
  const nested = candidate({
    content: {
      'attributes.public_note': 'A report with structured evidence.',
      'attributes.tags': ['bridge', 'closed'],
      'attributes.source_summary': { confidence: 0.8, corroborated: true },
    },
  });
  const result = receive({
    retrieval: retrieval({ candidates: [nested] }),
    hostContext,
    hostBinding,
    requestId,
    generationId,
    runId,
    model: 'google/gemini-test',
  });
  assert.deepEqual(result.contentBlocks[0].content, nested.content);
});

