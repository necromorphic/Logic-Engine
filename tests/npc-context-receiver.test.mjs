import test from 'node:test';
import assert from 'node:assert/strict';
import { receiveNpcContext } from '../host-adapter/npc-context-receiver.mjs';

const hostContext = Object.freeze({
  adapter_id: 'st-gateway',
  conversation_id: '11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:33333333-3333-4333-8333-333333333333',
  world_id: 'world-main',
  actor_id: 'actor-npc',
  actor_type: 'npc',
});
const requestId = '44444444-4444-4444-8444-444444444444';
const candidate = (overrides = {}) => ({
  record_ref: 'memory:record-1',
  record_version: 'v3',
  authorization_generation: 4,
  source_entity_id: 'entity-1',
  source_version: 'core-entity-v1:7',
  epistemic_kind: 'acquired_report',
  evidence_assessment: 'supported',
  content: { 'attributes.public_note': 'A trusted source statement.' },
  ...overrides,
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

test('receiver converts only matching Core-admitted candidates into Gateway metadata and content blocks', () => {
  const result = receiveNpcContext({
    retrieval: retrieval(),
    hostContext,
    requestId,
    model: 'google/gemini-test',
  });
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
});

test('authorized complete-empty result is preserved as an empty ready context', () => {
  const result = receiveNpcContext({
    retrieval: retrieval({ admitted: [], candidates: [] }),
    hostContext,
    requestId,
    model: 'google/gemini-test',
  });
  assert.deepEqual(result.sources, []);
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.contentBlocks, []);
});

test('NON_READY and malformed result envelopes are rejected', () => {
  assert.throws(() => receiveNpcContext({
    retrieval: { status: 'non_ready', admitted: [], candidates: [], reason: 'provider_unavailable' },
    hostContext, requestId, model: 'google/gemini-test',
  }), /NPC_CONTEXT_NON_READY/);
  assert.throws(() => receiveNpcContext({
    retrieval: retrieval({ candidates: [] }),
    hostContext, requestId, model: 'google/gemini-test',
  }), /NPC_CONTEXT_NON_READY/);
});

test('receiver rejects source-version, admission and scope mismatches', () => {
  assert.throws(() => receiveNpcContext({
    retrieval: retrieval({ candidates: [candidate({ source_version: '' })] }),
    hostContext, requestId, model: 'google/gemini-test',
  }), /NPC_CONTEXT_CANDIDATE_SCOPE_MISMATCH/);
  assert.throws(() => receiveNpcContext({
    retrieval: retrieval({ admitted: [] }),
    hostContext, requestId, model: 'google/gemini-test',
  }), /NPC_CONTEXT_NON_READY/);
  assert.throws(() => receiveNpcContext({
    retrieval: retrieval(),
    hostContext: { ...hostContext, actor_id: 'attacker-actor' },
    requestId, model: 'google/gemini-test',
  }), /NPC_CONTEXT_SCOPE_INVALID/);
});

test('receiver rejects accessor, Proxy, nested object and oversized content values', () => {
  const accessor = candidate();
  Object.defineProperty(accessor, 'source_version', { enumerable: true, get() { throw new Error('getter executed'); } });
  assert.throws(() => receiveNpcContext({
    retrieval: retrieval({ candidates: [accessor] }),
    hostContext, requestId, model: 'google/gemini-test',
  }), /NPC_CONTEXT_CANDIDATE_INVALID/);
  assert.throws(() => receiveNpcContext({
    retrieval: new Proxy(retrieval(), {}),
    hostContext, requestId, model: 'google/gemini-test',
  }), /NPC_CONTEXT_NON_READY/);
  assert.throws(() => receiveNpcContext({
    retrieval: retrieval({ candidates: [candidate({ content: { nested: { secret: true } } })] }),
    hostContext, requestId, model: 'google/gemini-test',
  }), /NPC_CONTEXT_CONTENT_INVALID/);
  assert.throws(() => receiveNpcContext({
    retrieval: retrieval({ candidates: [candidate({ content: { note: 'x'.repeat(32769) } })] }),
    hostContext, requestId, model: 'google/gemini-test',
  }), /NPC_CONTEXT_CONTENT_INVALID/);
});
