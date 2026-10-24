import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryNpcContextBridge } from '../src/application/memory-npc-context-bridge.js';

const request = Object.freeze({
  world_id: 'world-a',
  subject_id: 'actor-7',
  purpose: 'npc_decision',
  snapshot: { world_revision: 12, commit_sequence: 40 },
});

function candidate(overrides = {}) {
  return {
    record: { ref: 'memory:claim-1', version: 'v3' },
    world_id: request.world_id,
    subject_id: request.subject_id,
    purpose: request.purpose,
    access: { outcome: 'allow', subject_id: request.subject_id, purpose: request.purpose },
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer: { kind: 'fixture' },
    lifecycle: {
      content_disposition: 'usable',
      source_reconciliation: 'current',
      evidence_assessment: 'unassessed',
      access_outcome: 'allow',
      index_health: 'ready',
    },
    freshness: { status: 'current' },
    snapshot: { ...request.snapshot },
    content: 'private payload must not be returned',
    ...overrides,
  };
}

function result(candidates = [candidate()], overrides = {}) {
  return {
    completeness: 'complete',
    access: { outcome: 'allow', subject_id: request.subject_id, purpose: request.purpose },
    scope: { world_id: request.world_id, subject_id: request.subject_id, purpose: request.purpose },
    candidates,
    ...overrides,
  };
}

const allowAll = {
  retrieve: () => result(),
  verifyResult: () => true,
  verifyCandidate: () => true,
};

test('requires all trusted host dependencies; no default allow path exists', () => {
  assert.throws(() => new MemoryNpcContextBridge({}), /retrieve function/);
  assert.throws(() => new MemoryNpcContextBridge({ retrieve: () => result() }), /result verifier/);
  assert.throws(() => new MemoryNpcContextBridge({ retrieve: () => result(), verifyResult: () => true }), /candidate verifier/);
});

test('trusted source verification is required even when caller labels say allow/current/ready', () => {
  const bridge = new MemoryNpcContextBridge({
    ...allowAll,
    verifyResult: () => false,
  });
  const output = bridge.read(request);
  assert.deepEqual(output, {
    status: 'non_ready',
    admitted: [],
    reason: 'authoritative_result_unconfirmed',
  });
});

test('an unverifiable candidate makes the whole result non-ready, not complete-empty', () => {
  const bridge = new MemoryNpcContextBridge({
    ...allowAll,
    retrieve: () => result([candidate(), candidate({ record: { ref: 'memory:unverified', version: 'v1' } })]),
    verifyCandidate: (_request, item) => item.record.ref !== 'memory:unverified',
  });
  const output = bridge.read(request);
  assert.equal(output.status, 'non_ready');
  assert.equal(output.reason, 'authoritative_candidate_unconfirmed');
  assert.deepEqual(output.admitted, []);
  assert.notDeepEqual(output, new MemoryNpcContextBridge(allowAll).read({ ...request, snapshot: undefined }));
});

test('positive verified path emits reference metadata only and never returns memory content', () => {
  const bridge = new MemoryNpcContextBridge(allowAll);
  const output = bridge.read(request);
  assert.equal(output.status, 'ready');
  assert.deepEqual(output.admitted, [{
    record_ref: 'memory:claim-1',
    record_version: 'v3',
    epistemic_kind: 'acquired_report',
    evidence_assessment: 'unassessed',
  }]);
  assert.equal(JSON.stringify(output).includes('private payload'), false);
});

test('retrieval and verifier failures fail closed without exposing details', () => {
  const cases = [
    [new MemoryNpcContextBridge({ ...allowAll, retrieve: () => { throw new Error('private backend detail'); } }), 'retrieval_unavailable'],
    [new MemoryNpcContextBridge({ ...allowAll, verifyResult: () => { throw new Error('private policy detail'); } }), 'authoritative_verification_unavailable'],
    [new MemoryNpcContextBridge({ ...allowAll, verifyCandidate: () => { throw new Error('private source detail'); } }), 'authoritative_verification_unavailable'],
  ];
  for (const [bridge, reason] of cases) {
    const output = bridge.read(request);
    assert.equal(output.status, 'non_ready');
    assert.equal(output.reason, reason);
    assert.equal(JSON.stringify(output).includes('private'), false);
  }
});

test('invalid trusted scope fails before retrieval', () => {
  let called = false;
  const bridge = new MemoryNpcContextBridge({ ...allowAll, retrieve: () => { called = true; return result(); } });
  const output = bridge.read({ ...request, subject_id: ' ' });
  assert.equal(output.status, 'non_ready');
  assert.equal(output.reason, 'trusted_scope_incomplete');
  assert.equal(called, false);
});

test('partial retrieval is rejected by the existing NPC oracle even if host verifies transport', () => {
  const bridge = new MemoryNpcContextBridge({
    ...allowAll,
    retrieve: () => result([candidate()], { completeness: 'partial' }),
  });
  const output = bridge.read(request);
  assert.equal(output.status, 'non_ready');
  assert.equal(output.reason, 'result_incomplete_or_unavailable');
  assert.deepEqual(output.admitted, []);
});
