import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpcGenerationContextHostBridge } from '../src/application/npc-generation-context-host-bridge.js';

const requestMetadata = Object.freeze({
  request_id: 'request-1', generation_id: 'generation-1', generation_type: 'normal',
});

function setup({ prepareStatus = 'ready' } = {}) {
  const handoff = Object.freeze({});
  const context = Object.freeze({ request_id: 'request-1', generation_id: 'generation-1' });
  let preparedMetadata = null;
  let consumed = false;
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
        ? { status: 'ready', lane: 'B', sources: [], candidates: [] }
        : { status: 'non_ready', reason: 'lane_b_rejected' };
    },
    revalidateLaneAForDispatch(value, metadata) {
      return value === context && metadata === preparedMetadata
        ? { status: 'ready', reason: null }
        : { status: 'non_ready', reason: 'lane_a_rejected' };
    },
  };
  const bridge = createNpcGenerationContextHostBridge({
    runtime,
    createRequestMetadata: () => requestMetadata,
  });
  return { bridge, context };
}

test('Host bridge carries one prepared handoff to the exact request/response dispatch', async () => {
  const { bridge, context } = setup();
  const hostRequest = {};
  const hostResponse = {};
  assert.equal((await bridge.prepare(hostRequest, hostResponse)).status, 'ready');
  const accepted = bridge.consume(hostRequest, hostResponse);
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.context, context);
  assert.equal(accepted.laneB.lane, 'B');
  assert.equal(accepted.revalidateLaneA().status, 'ready');
  assert.equal(bridge.consume(hostRequest, hostResponse).status, 'non_ready');
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
