import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpcGenerationContextHostBridge } from '../src/application/npc-generation-context-host-bridge.js';
import { createNpcGenerationRequestMetadata } from '../host-adapter/npc-generation-request-metadata.mjs';

const requestMetadata = Object.freeze({
  request_id: 'request-1', generation_id: 'generation-1', generation_type: 'normal',
});

function setup({ prepareStatus = 'ready' } = {}) {
  const handoff = Object.freeze({});
  const context = Object.freeze({ request_id: 'request-1', generation_id: 'generation-1' });
  let preparedMetadata = null;
  let consumed = false;
  const coordinatorLease = Object.freeze({ held: true });
  const runtime = {
    async prepareForDispatch(metadata) {
      preparedMetadata = metadata;
      return prepareStatus === 'ready'
        ? { status: 'ready', handoff, reason: null }
        : { status: 'non_ready', handoff: null, reason: 'context_not_ready' };
    },
    consumeDispatchHandoff(token, metadata) {
      if (token !== handoff || metadata !== preparedMetadata || consumed) {
        return { status: 'non_ready', reason: 'handoff_rejected' };
      }
      consumed = true;
      return { status: 'accepted', context, reason: null };
    },
    getLaneBDispatchEvidence(value, metadata) {
      return value === context && metadata === preparedMetadata
        ? {
          status: 'ready', lane: 'B', sources: [], candidates: [],
          provider_evidence_cursor: { data_version: 12, candidate_digest: 'b'.repeat(64) },
        }
        : { status: 'non_ready', reason: 'lane_b_rejected' };
    },
    revalidateLaneAForDispatch(value, metadata) {
      return value === context && metadata === preparedMetadata
        ? { status: 'ready', reason: null }
        : { status: 'non_ready', reason: 'lane_a_rejected' };
    },
    revalidateLaneAForDispatchUnderCoordinatorLease(value, metadata, lease) {
      return value === context && metadata === preparedMetadata && lease === coordinatorLease
        ? { status: 'ready', reason: null }
        : { status: 'non_ready', reason: 'lane_a_rejected' };
    },
  };
  const bridge = createNpcGenerationContextHostBridge({
    runtime,
    createRequestMetadata: () => requestMetadata,
  });
  return { bridge, context, coordinatorLease };
}

test('Host bridge carries one prepared handoff to the exact request/response dispatch', async () => {
  const { bridge, context, coordinatorLease } = setup();
  const hostRequest = {};
  const hostResponse = {};
  assert.equal((await bridge.prepare(hostRequest, hostResponse)).status, 'ready');
  const accepted = bridge.consume(hostRequest, hostResponse);
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.context, context);
  assert.equal(accepted.laneB.lane, 'B');
  assert.deepEqual({ ...accepted.laneB.provider_evidence_cursor }, {
    data_version: 12, candidate_digest: 'b'.repeat(64),
  });
  assert.equal(accepted.revalidateLaneA().status, 'ready');
  assert.equal(accepted.revalidateLaneAUnderCoordinatorLease(coordinatorLease).status, 'ready');
  assert.equal(accepted.revalidateLaneAUnderCoordinatorLease({}).status, 'non_ready');
  assert.equal(bridge.consume(hostRequest, hostResponse).status, 'non_ready');
  assert.equal((await bridge.prepare(hostRequest, hostResponse)).status, 'non_ready');
});

test('Host bridge rejects a different response without consuming the valid request handoff', async () => {
  const { bridge } = setup();
  const hostRequest = {};
  const hostResponse = {};
  await bridge.prepare(hostRequest, hostResponse);
  assert.equal(bridge.consume(hostRequest, {}).status, 'non_ready');
  assert.equal(bridge.consume(hostRequest, hostResponse).status, 'accepted');
});

test('Host bridge does not transfer preparation to a cloned Host request object', async () => {
  const { bridge } = setup();
  const hostRequest = {};
  const hostResponse = {};
  await bridge.prepare(hostRequest, hostResponse);
  assert.equal(bridge.consume({ ...hostRequest }, hostResponse).status, 'non_ready');
  assert.equal(bridge.consume(hostRequest, hostResponse).status, 'accepted');
});

test('Host bridge rejects duplicate prepare and never creates a handoff for a non-ready context', async () => {
  const ready = setup();
  const hostRequest = {};
  const hostResponse = {};
  assert.equal((await ready.bridge.prepare(hostRequest, hostResponse)).status, 'ready');
  assert.equal((await ready.bridge.prepare(hostRequest, hostResponse)).status, 'non_ready');

  const blocked = setup({ prepareStatus: 'non_ready' });
  const blockedRequest = {};
  const blockedResponse = {};
  assert.equal((await blocked.bridge.prepare(blockedRequest, blockedResponse)).status, 'non_ready');
  assert.equal(blocked.bridge.consume(blockedRequest, blockedResponse).status, 'non_ready');
});


test('Host bridge rejects mutable request metadata before asking Core to prepare', async () => {
  let prepareCalls = 0;
  const bridge = createNpcGenerationContextHostBridge({
    runtime: {
      async prepareForDispatch() { prepareCalls += 1; return { status: 'ready', handoff: {} }; },
      consumeDispatchHandoff() { return { status: 'non_ready' }; },
      getLaneBDispatchEvidence() { return { status: 'non_ready' }; },
      revalidateLaneAForDispatch() { return { status: 'non_ready' }; },
      revalidateLaneAForDispatchUnderCoordinatorLease() { return { status: 'non_ready' }; },
    },
    createRequestMetadata: () => ({ ...requestMetadata }),
  });
  const result = await bridge.prepare({}, {});
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'request_metadata_not_immutable');
  assert.equal(prepareCalls, 0);
});


test('Host bridge blocks concurrent prepare calls for the same Host request', async () => {
  let resolvePreparation;
  const handoff = Object.freeze({});
  const bridge = createNpcGenerationContextHostBridge({
    runtime: {
      prepareForDispatch: () => new Promise(resolve => { resolvePreparation = resolve; }),
      consumeDispatchHandoff: () => ({ status: 'non_ready' }),
      getLaneBDispatchEvidence: () => ({ status: 'non_ready' }),
      revalidateLaneAForDispatch: () => ({ status: 'non_ready' }),
      revalidateLaneAForDispatchUnderCoordinatorLease: () => ({ status: 'non_ready' }),
    },
    createRequestMetadata: () => requestMetadata,
  });
  const hostRequest = {};
  const hostResponse = {};
  const first = bridge.prepare(hostRequest, hostResponse);
  const second = await bridge.prepare(hostRequest, hostResponse);
  assert.equal(second.status, 'non_ready');
  assert.equal(second.reason, 'host_request_not_preparable');
  resolvePreparation({ status: 'ready', handoff });
  assert.equal((await first).status, 'ready');
  assert.equal(bridge.consume(hostRequest, hostResponse).status, 'non_ready');
});


test('Host bridge rejects reuse of one frozen request-metadata object across Host requests', async () => {
  const handoff = Object.freeze({});
  const bridge = createNpcGenerationContextHostBridge({
    runtime: {
      async prepareForDispatch() { return { status: 'ready', handoff }; },
      consumeDispatchHandoff() { return { status: 'non_ready' }; },
      getLaneBDispatchEvidence() { return { status: 'non_ready' }; },
      revalidateLaneAForDispatch() { return { status: 'non_ready' }; },
      revalidateLaneAForDispatchUnderCoordinatorLease() { return { status: 'non_ready' }; },
    },
    createRequestMetadata: () => requestMetadata,
  });
  assert.equal((await bridge.prepare({}, {})).status, 'ready');
  const second = await bridge.prepare({}, {});
  assert.equal(second.status, 'non_ready');
  assert.equal(second.reason, 'request_metadata_reused');
});

test('Host bridge mints fresh request metadata and ignores browser-supplied correlation fields', async () => {
  const seen = [];
  const handoff = Object.freeze({});
  const bridge = createNpcGenerationContextHostBridge({
    runtime: {
      async prepareForDispatch(metadata) {
        seen.push(metadata);
        return { status: 'ready', handoff };
      },
      consumeDispatchHandoff() { return { status: 'non_ready' }; },
      getLaneBDispatchEvidence() { return { status: 'non_ready' }; },
      revalidateLaneAForDispatch() { return { status: 'non_ready' }; },
      revalidateLaneAForDispatchUnderCoordinatorLease() { return { status: 'non_ready' }; },
    },
    createRequestMetadata: () => createNpcGenerationRequestMetadata(),
  });
  const firstRequest = {
    body: {
      logic_engine_request_id: 'browser-forged-request',
      logic_engine_generation_id: 'browser-forged-generation',
      logic_engine_generation_type: 'forged',
    },
  };
  const secondRequest = { body: firstRequest.body };
  assert.equal((await bridge.prepare(firstRequest, {})).status, 'ready');
  assert.equal((await bridge.prepare(secondRequest, {})).status, 'ready');
  assert.equal(seen.length, 2);
  for (const metadata of seen) {
    assert.equal(Object.isFrozen(metadata), true);
    assert.match(metadata.request_id, /^[0-9a-f-]{36}$/i);
    assert.match(metadata.generation_id, /^[0-9a-f-]{36}$/i);
    assert.equal(metadata.generation_type, 'normal');
    assert.notEqual(metadata.request_id, 'browser-forged-request');
    assert.notEqual(metadata.generation_id, 'browser-forged-generation');
  }
  assert.notEqual(seen[0].request_id, seen[1].request_id);
  assert.notEqual(seen[0].generation_id, seen[1].generation_id);
});
