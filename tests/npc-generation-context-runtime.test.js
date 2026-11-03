import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoreNpcGenerationContextRuntime } from '../src/application/npc-generation-context-runtime.js';

const scope = Object.freeze({
  world_id: 'world-1', actor_id: 'npc-1', conversation_id: 'conversation-1',
  adapter_id: 'adapter-1', recipient: 'model', purpose: 'npc_turn_context',
  snapshot: Object.freeze({ world_revision: 3, commit_sequence: 8 }),
});
const request = Object.freeze({
  request_id: 'request-1', generation_id: 'generation-1', generation_type: 'normal',
});
const acquisition = Object.freeze({
  acquisition_id: 'acq-1', fact_id: 'fact-1', subject_ref: 'entity:npc-1',
  predicate: 'knows', value: Object.freeze({ fact: 'private-to-npc-1' }),
  acquisition_kind: 'author_initial', provenance_ref: 'world-pack@1',
  provenance_digest: 'a'.repeat(64), acquisition_authorization_ref: 'assignment-1',
  source_event_ids: Object.freeze(['event-1']),
});
const memoryResult = () => ({
  status: 'ready',
  admitted: [{ record_ref: 'memory:1', record_version: 'v1' }],
  candidates: [{
    record_ref: 'memory:1', record_version: 'v1', authorization_generation: 2,
    source_entity_id: 'source-1', source_version: 'source-v1', epistemic_kind: 'acquired_report',
    evidence_assessment: 'disputed', content: { note: 'report' },
  }],
  reason: null, snapshot: { ...scope.snapshot },
});

function setup() {
  let currentScope = scope;
  let visible = true;
  let visibilityCalls = 0;
  let denyOnVisibilityCall = Number.POSITIVE_INFINITY;
  let memoryCurrent = true;
  let revokeAtFinalFence = false;
  let readAuthorizationRef = 'core-read-1';
  let readActorId = scope.actor_id;
  let memoryResultFactory = memoryResult;
  let afterMemoryRevalidation = null;
  const engine = {
    getSnapshot: () => scope.snapshot,
    readNpcKnowledge(input) {
      assert.equal(input.actor_id, scope.actor_id);
      assert.equal(input.purpose, 'npc_turn_context');
      return {
        status: 'ready', world_id: scope.world_id, actor_id: readActorId,
        conversation_id: scope.conversation_id, adapter_id: scope.adapter_id,
        recipient: 'model', purpose: 'npc_turn_context',
        snapshot: { ...scope.snapshot }, authorization_ref: readAuthorizationRef,
        truncated: false, items: [acquisition],
      };
    },
    npcKnowledgeVisibilityAuthorizer(input) {
      visibilityCalls += 1;
      const allowed = visible && visibilityCalls < denyOnVisibilityCall;
      return {
        status: allowed ? 'allowed' : 'denied',
        world_id: input.world_id, conversation_id: input.conversation_id,
        adapter_id: input.adapter_id, actor_id: input.actor_id,
        recipient: input.recipient, purpose: input.purpose,
        world_revision: input.world_revision, commit_sequence: input.commit_sequence,
        acquisition_id: input.acquisition_id,
        authorization_ref: allowed ? 'visibility-1' : 'visibility-denied-1',
      };
    },
  };
  const consumer = {
    async retrieveForNpc() { return memoryCurrent ? memoryResultFactory() : { status: 'non_ready' }; },
    async revalidateForFinalDispatch(_request, prepared) {
      const result = memoryCurrent && !revokeAtFinalFence && JSON.stringify(prepared) === JSON.stringify(memoryResultFactory())
        ? memoryResultFactory() : { status: 'non_ready' };
      const callback = afterMemoryRevalidation;
      afterMemoryRevalidation = null;
      if (callback) callback();
      return result;
    },
  };
  const runtime = createCoreNpcGenerationContextRuntime({
    engine, consumer, adapterId: 'adapter-1',
    resolveAuthenticatedScope: () => currentScope,
  });
  return {
    runtime,
    setScope: value => { currentScope = value; },
    setVisible: value => { visible = value; },
    setDenyOnVisibilityCall: value => { denyOnVisibilityCall = value; },
    setMemoryCurrent: value => { memoryCurrent = value; },
    setRevokeAtFinalFence: value => { revokeAtFinalFence = value; },
    setReadAuthorizationRef: value => { readAuthorizationRef = value; },
    setReadActorId: value => { readActorId = value; },
    setMemoryResultFactory: value => { memoryResultFactory = value; },
    setAfterMemoryRevalidation: callback => { afterMemoryRevalidation = callback; },
  };
}

test('composes the live Core acquisition visibility fence and Memory consumer into separate lanes', async () => {
  const { runtime } = setup();
  const built = await runtime.build(request);
  assert.equal(built.status, 'ready', built.reason);
  assert.equal(built.context.lanes.lane_a.items.length, 1);
  assert.equal(built.context.lanes.lane_a.items[0].visibility_authorization_ref, 'visibility-1');
  assert.equal(built.context.lanes.lane_b.candidates[0].evidence_assessment, 'disputed');
  assert.equal(built.context.lanes.lane_b.provider_purpose, 'npc_decision');
  assert.equal((await runtime.receive(built.context, request)).status, 'accepted');
});

test('omits per-acquisition denied Lane A records without leaking their values', async () => {
  const { runtime, setVisible } = setup();
  setVisible(false);
  const built = await runtime.build(request);
  assert.equal(built.status, 'ready');
  assert.deepEqual(built.context.lanes.lane_a.items, []);
  assert.doesNotMatch(JSON.stringify(built.context), /private-to-npc-1/);
});

test('fails closed when Lane A visibility is revoked at the final build fence', async () => {
  const { runtime, setDenyOnVisibilityCall } = setup();
  setDenyOnVisibilityCall(2);
  const built = await runtime.build(request);
  assert.equal(built.status, 'non_ready');
  assert.equal(built.context, null);
});

test('receiver rejects an issued context after a Lane A acquisition is revoked', async () => {
  const { runtime, setDenyOnVisibilityCall } = setup();
  const built = await runtime.build(request);
  assert.equal(built.status, 'ready');
  setDenyOnVisibilityCall(3);
  const received = await runtime.receive(built.context, request);
  assert.equal(received.status, 'non_ready');
  assert.equal(received.reason, 'context_evidence_changed');
});

test('fails closed when Memory authorization is revoked at the final evidence fence', async () => {
  const { runtime, setRevokeAtFinalFence } = setup();
  setRevokeAtFinalFence(true);
  const built = await runtime.build(request);
  assert.equal(built.status, 'non_ready');
  assert.equal(built.context, null);
});

test('rejects Lane A results bound to another NPC before any record enters context', async () => {
  const { runtime, setReadActorId } = setup();
  setReadActorId('npc-2');
  const built = await runtime.build(request);
  assert.equal(built.status, 'non_ready');
  assert.equal(built.context, null);
  assert.doesNotMatch(JSON.stringify(built), /private-to-npc-1/);
});

test('receiver rejects a context after Core scope changes', async () => {
  const { runtime, setScope } = setup();
  const built = await runtime.build(request);
  setScope({ ...scope, actor_id: 'npc-2', snapshot: scope.snapshot });
  const received = await runtime.receive(built.context, request);
  assert.equal(received.status, 'non_ready');
});

test('receiver rejects changed Lane A authorization even when visible items are unchanged', async () => {
  const { runtime, setReadAuthorizationRef } = setup();
  const built = await runtime.build(request);
  setReadAuthorizationRef('core-read-rotated');
  const received = await runtime.receive(built.context, request);
  assert.equal(received.status, 'non_ready');
});

test('receiver rejects changed Lane B admission metadata even when candidates are unchanged', async () => {
  const { runtime, setMemoryResultFactory } = setup();
  const built = await runtime.build(request);
  setMemoryResultFactory(() => {
    const current = memoryResult();
    current.admitted = [{ record_ref: 'memory:other', record_version: 'v1' }];
    return current;
  });
  const received = await runtime.receive(built.context, request);
  assert.equal(received.status, 'non_ready');
});

test('Core runtime remains usable when Array.prototype iteration is polluted', async () => {
  const { runtime } = setup();
  const originalIterator = Array.prototype[Symbol.iterator];
  try {
    Array.prototype[Symbol.iterator] = function () { throw new Error('polluted array iterator'); };
    const built = await runtime.build(request);
    assert.equal(built.status, 'ready', built.reason);
    const received = await runtime.receive(built.context, request);
    assert.equal(received.status, 'accepted');
  } finally {
    Array.prototype[Symbol.iterator] = originalIterator;
  }
});

test('build rejects Lane A revocation that occurs during asynchronous Lane B revalidation', async () => {
  const { runtime, setDenyOnVisibilityCall, setAfterMemoryRevalidation } = setup();
  setAfterMemoryRevalidation(() => setDenyOnVisibilityCall(3));
  const built = await runtime.build(request);
  assert.equal(built.status, 'non_ready');
  assert.equal(built.context, null);
});

test('receiver rejects Lane A revocation that occurs during asynchronous Lane B revalidation', async () => {
  const { runtime, setDenyOnVisibilityCall, setAfterMemoryRevalidation } = setup();
  const built = await runtime.build(request);
  assert.equal(built.status, 'ready');
  setAfterMemoryRevalidation(() => setDenyOnVisibilityCall(4));
  const received = await runtime.receive(built.context, request);
  assert.equal(received.status, 'non_ready');
  assert.equal(received.reason, 'context_evidence_changed');
});


test('Core runtime exposes an opaque one-shot handoff only after receiver acceptance', async () => {
  const { runtime } = setup();
  const built = await runtime.build(request);
  assert.equal(built.status, 'ready');
  const accepted = await runtime.receive(built.context, request);
  assert.equal(accepted.status, 'accepted');

  const issued = runtime.issueDispatchHandoff(accepted, request);
  assert.equal(issued.status, 'ready');
  const consumed = runtime.consumeDispatchHandoff(issued.handoff, request);
  assert.equal(consumed.status, 'accepted');
  assert.equal(consumed.context, built.context);
  assert.equal(runtime.consumeDispatchHandoff(issued.handoff, request).status, 'non_ready');
});


test('synchronous dispatch fence revalidates Lane A visibility and exact Core scope after handoff', async () => {
  const { runtime, setVisible, setScope } = setup();
  const built = await runtime.build(request);
  assert.equal(built.status, 'ready');
  const accepted = await runtime.receive(built.context, request);
  assert.equal(accepted.status, 'accepted');
  const issued = runtime.issueDispatchHandoff(accepted, request);
  assert.equal(issued.status, 'ready');
  const consumed = runtime.consumeDispatchHandoff(issued.handoff, request);
  assert.equal(consumed.status, 'accepted');

  assert.equal(runtime.revalidateLaneAForDispatch(consumed.context, request).status, 'ready');
  setVisible(false);
  assert.equal(runtime.revalidateLaneAForDispatch(consumed.context, request).status, 'non_ready');

  setVisible(true);
  setScope({ ...scope, actor_id: 'npc-2', snapshot: scope.snapshot });
  assert.equal(runtime.revalidateLaneAForDispatch(consumed.context, request).status, 'non_ready');
});

test('synchronous dispatch fence rejects copied contexts and unconsumed handoff contexts', async () => {
  const { runtime } = setup();
  const built = await runtime.build(request);
  assert.equal(runtime.revalidateLaneAForDispatch(built.context, request).status, 'non_ready');
  const copied = { ...built.context };
  assert.equal(runtime.revalidateLaneAForDispatch(copied, request).status, 'non_ready');
});


test('prepareForDispatch completes async build and receiver checks but exposes only an opaque handoff', async () => {
  const { runtime } = setup();
  const prepared = await runtime.prepareForDispatch(request);
  assert.equal(prepared.status, 'ready');
  assert.equal(prepared.reason, null);
  assert.equal(Object.hasOwn(prepared, 'context'), false);
  assert.equal(Object.keys(prepared.handoff).length, 0);
  assert.equal(Object.isFrozen(prepared.handoff), true);

  const consumed = runtime.consumeDispatchHandoff(prepared.handoff, request);
  assert.equal(consumed.status, 'accepted');
  assert.equal(consumed.context.lanes.lane_a.items.length, 1);
  assert.equal(runtime.revalidateLaneAForDispatch(consumed.context, request).status, 'ready');
});

test('dispatch projection preserves both lanes and does not consume the opaque handoff', async () => {
  const { runtime } = setup();
  const prepared = await runtime.prepareForDispatch(request);
  assert.equal(prepared.status, 'ready');
  const projected = runtime.projectDispatchHandoff(prepared.handoff, request);
  assert.equal(projected.status, 'ready');
  assert.equal(projected.projection.contentBlocks.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(projected.projection.contentBlocks[0])), {
    epistemic_kind: 'author_initial',
    evidence_assessment: 'unassessed',
    content: {
      subject_ref: 'entity:npc-1',
      predicate: 'knows',
      value: { fact: 'private-to-npc-1' },
    },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(projected.projection.contentBlocks[1])), {
    epistemic_kind: 'acquired_report',
    evidence_assessment: 'disputed',
    content: { note: 'report' },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(projected.projection.sources)), [{
    source_kind: 'canonical_entity',
    source_entity_id: 'source-1',
    source_version: 'source-v1',
  }]);
  assert.deepEqual(JSON.parse(JSON.stringify(projected.projection.candidates)), [{
    record_ref: 'memory:1',
    record_version: 'v1',
    authorization_generation: 2,
    source_kind: 'canonical_entity',
    source_entity_id: 'source-1',
    source_version: 'source-v1',
  }]);
  assert.equal(runtime.projectDispatchHandoff(prepared.handoff, { ...request, request_id: 'other' }).status, 'non_ready');
  assert.equal(runtime.consumeDispatchHandoff(prepared.handoff, request).status, 'accepted');
  assert.equal(runtime.projectDispatchHandoff(prepared.handoff, request).status, 'non_ready');
});

test('prepareForDispatch returns no handoff when either lane is not ready', async () => {
  const { runtime, setMemoryCurrent } = setup();
  setMemoryCurrent(false);
  const prepared = await runtime.prepareForDispatch(request);
  assert.equal(prepared.status, 'non_ready');
  assert.equal(prepared.handoff, null);
  assert.equal(Object.hasOwn(prepared, 'context'), false);
});
