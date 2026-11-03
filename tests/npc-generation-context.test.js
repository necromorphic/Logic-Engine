import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpcGenerationContextBuilder } from '../src/application/npc-generation-context.js';

const scope = Object.freeze({
  world_id: 'world-1', actor_id: 'npc-1', conversation_id: 'conversation-1',
  adapter_id: 'adapter-1', recipient: 'model', purpose: 'npc_turn_context',
  snapshot: Object.freeze({ world_revision: 4, commit_sequence: 19 }),
});
const request = Object.freeze({ request_id: 'request-1', generation_id: 'generation-1', generation_type: 'normal' });
const laneA = () => ({
  status: 'ready', lane: 'A', world_id: scope.world_id, actor_id: scope.actor_id,
  conversation_id: scope.conversation_id, adapter_id: scope.adapter_id,
  recipient: 'model', purpose: 'npc_turn_context', snapshot: { ...scope.snapshot },
  completeness: 'complete', read_authorization_ref: 'core-read-1',
  visibility_authorization_ref: 'core-visibility-1',
  items: [{
    acquisition_id: 'acq-1', fact_id: 'fact-1', subject_ref: 'entity:npc-1',
    predicate: 'knows', value: { text: 'Lane A source' }, acquisition_kind: 'author_initial',
    provenance_ref: 'world-pack@1', provenance_digest: 'a'.repeat(64),
    acquisition_authorization_ref: 'assignment-1', source_event_ids: ['event-1'],
    visibility_authorization_ref: 'visibility-1',
  }],
});
const laneB = () => ({
  status: 'ready', lane: 'B', world_id: scope.world_id, actor_id: scope.actor_id,
  conversation_id: scope.conversation_id, adapter_id: scope.adapter_id,
  recipient: 'model', core_purpose: 'npc_turn_context', provider_purpose: 'npc_decision',
  snapshot: { ...scope.snapshot },
  result: {
    status: 'ready', admitted: [{ record_ref: 'memory:1', record_version: 'v1' }],
    candidates: [{
      record_ref: 'memory:1', record_version: 'v1', authorization_generation: 2,
      source_kind: 'canonical_entity', source_entity_id: 'source-1',
      source_version: 'core-entity-v1:1', epistemic_kind: 'acquired_report',
      evidence_assessment: 'disputed', content: { note: 'Lane B report' },
    }],
    reason: null, snapshot: { ...scope.snapshot },
  },
});
function setup(overrides = {}) {
  let currentScope = scope;
  const calls = [];
  const builder = createNpcGenerationContextBuilder({
    resolveScope: async () => currentScope,
    readLaneA: async input => { calls.push(['A', input]); return overrides.laneA ? overrides.laneA(laneA()) : laneA(); },
    readLaneB: async input => { calls.push(['B', input]); return overrides.laneB ? overrides.laneB(laneB()) : laneB(); },
    revalidateEvidence: async () => overrides.revalidateEvidence ? overrides.revalidateEvidence() : true,
    revalidateScope: async () => currentScope,
  });
  const receiver = builder.createReceiver({
    resolveScope: async () => currentScope,
    revalidateEvidence: async () => overrides.revalidateEvidence ? overrides.revalidateEvidence() : true,
    revalidateScope: async () => currentScope,
  });
  return { builder, receiver, calls, setScope: value => { currentScope = value; } };
}

test('builds immutable generation context with isolated Lane A and Lane B envelopes', async () => {
  const { builder, calls } = setup();
  const result = await builder.build(request);
  assert.equal(result.status, 'ready');
  assert.equal(calls.length, 2);
  assert.equal(result.context.lanes.lane_a.items[0].value.text, 'Lane A source');
  assert.equal(result.context.lanes.lane_b.candidates[0].evidence_assessment, 'disputed');
  assert.equal(result.context.lanes.lane_b.provider_purpose, 'npc_decision');
  assert.equal(Object.isFrozen(result.context), true);
  assert.equal(Object.isFrozen(result.context.lanes.lane_a.items[0].value), true);
  assert.throws(() => { result.context.actor_id = 'npc-2'; }, TypeError);
  assert.throws(() => { result.context.lanes.lane_b.candidates[0].content.note = 'changed'; }, TypeError);
});

test('identity is resolved by Core; request-supplied actor/world fields are rejected', async () => {
  const { builder } = setup();
  assert.equal((await builder.build({ ...request, actor_id: 'npc-2' })).status, 'non_ready');
  assert.equal((await builder.build({ ...request, world_id: 'world-2' })).status, 'non_ready');
});

test('wrong NPC, conversation, world, adapter or purpose in either lane is rejected', async t => {
  for (const [field, value] of [
    ['actor_id', 'npc-2'], ['conversation_id', 'conversation-2'], ['world_id', 'world-2'],
    ['adapter_id', 'adapter-2'], ['purpose', 'npc_action_evaluation'],
  ]) {
    await t.test(field, async () => {
      // Corrupt the lane envelope itself; it must not be rebound to the resolved scope.
      const bad = laneA(); bad[field] = value;
      const configured = createNpcGenerationContextBuilder({
        resolveScope: async () => scope,
        readLaneA: async () => bad,
        readLaneB: async () => laneB(),
        revalidateEvidence: async () => true,
        revalidateScope: async () => scope,
      });
      assert.equal((await configured.build(request)).status, 'non_ready');
    });
  }
});

test('withheld or incomplete Lane A evidence fails closed without exposing records', async () => {
  const bad = laneA(); bad.completeness = 'partial';
  const { builder } = setup({ laneA: () => bad });
  const result = await builder.build(request);
  assert.equal(result.status, 'non_ready');
  assert.equal(result.context, null);
  assert.doesNotMatch(JSON.stringify(result), /Lane A source|world-pack@1/);
});

test('revoked, stale, partial and unavailable Lane B evidence fails closed', async t => {
  const cases = [
    ['revoked', () => ({ ...laneB(), status: 'non_ready' })],
    ['stale snapshot', () => ({ ...laneB(), snapshot: { world_revision: 3, commit_sequence: 19 } })],
    ['stale source', () => ({ ...laneB(), status: 'non_ready' })],
    ['partial retrieval', () => ({ ...laneB(), result: { ...laneB().result, status: 'non_ready' } })],
    ['unknown assessment', () => { const x = laneB(); x.result.candidates[0].evidence_assessment = 'confirmed'; return x; }],
  ];
  for (const [name, make] of cases) await t.test(name, async () => {
    const { builder } = setup({ laneB: make });
    const result = await builder.build(request);
    assert.equal(result.status, 'non_ready');
    assert.equal(result.context, null);
    assert.doesNotMatch(JSON.stringify(result), /Lane B report/);
  });
});

test('conflicting and insufficient assessments remain evidence labels, never belief assertions', async () => {
  const b = laneB();
  b.result.candidates[0].evidence_assessment = 'insufficient';
  const { builder } = setup({ laneB: () => b });
  const result = await builder.build(request);
  assert.equal(result.status, 'ready');
  assert.equal(result.context.lanes.lane_b.candidates[0].evidence_assessment, 'insufficient');
  assert.equal(Object.hasOwn(result.context.lanes.lane_b.candidates[0], 'belief'), false);
});

test('context is rejected when Core snapshot or scope changes during construction', async () => {
  const changed = { ...scope, snapshot: { world_revision: 4, commit_sequence: 20 } };
  const builder = createNpcGenerationContextBuilder({
    resolveScope: async () => scope,
    readLaneA: async () => laneA(),
    readLaneB: async () => laneB(),
    revalidateEvidence: async () => true,
    revalidateScope: async () => changed,
  });
  const result = await builder.build(request);
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'generation_scope_changed');
});

test('receiver accepts only the exact context for the same request and current scope', async () => {
  const { builder, receiver } = setup();
  const built = await builder.build(request);
  assert.equal((await receiver.receive(built.context, request)).status, 'accepted');
  assert.equal((await receiver.receive(built.context, { ...request, request_id: 'request-2' })).status, 'non_ready');
  assert.equal((await receiver.receive({ ...built.context }, request)).status, 'non_ready');
});

test('a receiver from another builder instance cannot accept an issued context', async () => {
  const first = setup();
  const second = setup();
  const built = await first.builder.build(request);
  assert.equal(built.status, 'ready');
  assert.equal((await first.receiver.receive(built.context, request)).status, 'accepted');
  assert.equal((await second.receiver.receive(built.context, request)).status, 'non_ready');
});

test('receiver rejects context after actor binding or source snapshot changes', async () => {
  const { builder, receiver, setScope } = setup();
  const built = await builder.build(request);
  setScope({ ...scope, actor_id: 'npc-2', snapshot: scope.snapshot });
  assert.equal((await receiver.receive(built.context, request)).status, 'non_ready');
});

test('revocation detected by the final evidence fence prevents context creation', async () => {
  const { builder } = setup({ revalidateEvidence: async () => false });
  const result = await builder.build(request);
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'generation_evidence_changed');
  assert.equal(result.context, null);
});

test('receiver repeats evidence revalidation and rejects a revoked generation', async () => {
  const { builder } = setup();
  const built = await builder.build(request);
  const receiver = builder.createReceiver({
    resolveScope: async () => scope,
    revalidateEvidence: async () => false,
    revalidateScope: async () => scope,
  });
  const result = await receiver.receive(built.context, request);
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'context_evidence_changed');
});

test('receiver rejects a context when its first scope resolution has a different snapshot', async () => {
  const { builder } = setup();
  const built = await builder.build(request);
  const changed = { ...scope, snapshot: { world_revision: 4, commit_sequence: 20 } };
  const receiver = builder.createReceiver({
    resolveScope: async () => changed,
    revalidateEvidence: async () => true,
    revalidateScope: async () => scope,
  });
  const result = await receiver.receive(built.context, request);
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'context_scope_changed');
});

test('Lane B envelope rejects another NPC and mismatched request scope or authorization purpose', async t => {
  const cases = [
    ['actor_id', 'npc-2'],
    ['conversation_id', 'conversation-2'],
    ['world_id', 'world-2'],
    ['adapter_id', 'adapter-2'],
    ['recipient', 'browser'],
    ['core_purpose', 'npc_action_evaluation'],
    ['provider_purpose', 'npc_turn_context'],
    ['lane', 'A'],
  ];
  for (const [field, value] of cases) await t.test(field, async () => {
    const bad = laneB();
    bad[field] = value;
    const configured = createNpcGenerationContextBuilder({
      resolveScope: async () => scope,
      readLaneA: async () => laneA(),
      readLaneB: async () => bad,
      revalidateEvidence: async () => true,
      revalidateScope: async () => scope,
    });
    const result = await configured.build(request);
    assert.equal(result.status, 'non_ready');
    assert.equal(result.context, null);
    assert.doesNotMatch(JSON.stringify(result), /Lane B report/);
  });
});

test('receiver rejects reuse of the same issued context for a second dispatch', async () => {
  const { builder, receiver } = setup();
  const built = await builder.build(request);
  assert.equal(built.status, 'ready');
  assert.equal((await receiver.receive(built.context, request)).status, 'accepted');
  const replayed = await receiver.receive(built.context, request);
  assert.equal(replayed.status, 'non_ready');
  assert.equal(replayed.reason, 'context_replay_rejected');
});

test('receivers created by the same builder share replay protection', async () => {
  const { builder, receiver } = setup();
  const secondReceiver = builder.createReceiver({
    resolveScope: async () => scope,
    revalidateEvidence: async () => true,
    revalidateScope: async () => scope,
  });
  const built = await builder.build(request);
  assert.equal((await receiver.receive(built.context, request)).status, 'accepted');
  const replayed = await secondReceiver.receive(built.context, request);
  assert.equal(replayed.status, 'non_ready');
  assert.equal(replayed.reason, 'context_replay_rejected');
});


test('opaque dispatch handoff is minted only from a successful receiver receipt and is one-shot', async () => {
  const { builder, receiver } = setup();
  const built = await builder.build(request);
  const accepted = await receiver.receive(built.context, request);
  assert.equal(accepted.status, 'accepted');

  const minted = receiver.issueDispatchHandoff(accepted, request);
  assert.equal(minted.status, 'ready');
  assert.equal(Object.keys(minted.handoff).length, 0);
  assert.equal(Object.isFrozen(minted.handoff), true);
  assert.equal(JSON.stringify(minted.handoff), '{}');

  const consumed = receiver.consumeDispatchHandoff(minted.handoff, request);
  assert.equal(consumed.status, 'accepted');
  assert.equal(consumed.context, built.context);
  assert.equal(receiver.consumeDispatchHandoff(minted.handoff, request).status, 'non_ready');
  assert.equal(receiver.consumeDispatchHandoff({ ...minted.handoff }, request).status, 'non_ready');
});

test('opaque dispatch handoff cannot be issued or consumed for another request or generation', async () => {
  const { builder, receiver } = setup();
  const built = await builder.build(request);
  const accepted = await receiver.receive(built.context, request);
  assert.equal(accepted.status, 'accepted');

  assert.equal(receiver.issueDispatchHandoff(accepted, {
    ...request, request_id: 'request-2',
  }).status, 'non_ready');

  const minted = receiver.issueDispatchHandoff(accepted, request);
  assert.equal(minted.status, 'ready');
  assert.equal(receiver.consumeDispatchHandoff(minted.handoff, {
    ...request, generation_id: 'generation-2',
  }).status, 'non_ready');
  // A failed cross-request attempt does not make the capability transferable.
  assert.equal(receiver.consumeDispatchHandoff(minted.handoff, request).status, 'accepted');
});

test('opaque dispatch handoff cannot be minted from a forged acceptance object', async () => {
  const { receiver } = setup();
  const forged = Object.freeze({ status: 'accepted', context: Object.freeze({ ...scope }) , reason: null });
  assert.equal(receiver.issueDispatchHandoff(forged, request).status, 'non_ready');
});
