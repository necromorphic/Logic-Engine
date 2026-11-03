import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpcGenerationContextHostBridge } from '../src/application/npc-generation-context-host-bridge.js';

const requestMetadata = Object.freeze({
  request_id: 'request-1', generation_id: 'generation-1', generation_type: 'normal',
});

function setup({ prepareStatus = 'ready', metadata = requestMetadata } = {}) {
  const handoff = Object.freeze({});
  const projection = Object.freeze({
    world_id: 'world-1', actor_id: 'npc-1', conversation_id: 'conversation-1',
    adapter_id: 'adapter-1', purpose: 'npc_turn_context',
    snapshot: Object.freeze({ world_revision: 1, commit_sequence: 1 }),
    contentBlocks: Object.freeze([Object.freeze({
      epistemic_kind: 'direct_observation', evidence_assessment: 'unassessed',
      content: Object.freeze({ fact: 'x' }),
    })]),
    sources: Object.freeze([]), candidates: Object.freeze([]),
  });
  let preparedMetadata = null;
  let consumed = false;
  const runtime = {
    async prepareForDispatch(value) {
      preparedMetadata = value;
      return prepareStatus === 'ready'
        ? { status: 'ready', handoff, reason: null }
        : { status: 'non_ready', handoff: null, reason: 'context_not_ready' };
    },
    projectDispatchHandoff(token, value) {
      return token === handoff && value === preparedMetadata
        ? { status: 'ready', projection, reason: null }
        : { status: 'non_ready', projection: null, reason: 'projection_rejected' };
    },
    consumeDispatchHandoff(token, value) {
      if (token !== handoff || value !== preparedMetadata || consumed) {
        return { status: 'non_ready', reason: 'handoff_rejected' };
      }
      consumed = true;
      return { status: 'accepted', context: Object.freeze({}), reason: null };
    },
    revalidateLaneAForDispatch() { return { status: 'ready', reason: null }; },
  };
  const bridge = createNpcGenerationContextHostBridge({
    runtime,
    createRequestMetadata: () => metadata,
  });
  return { bridge, handoff, projection, runtime, wasConsumed: () => consumed };
}

test('Host bridge transfers exact handoff and dual-lane projection without consuming Gateway capability', async () => {
  const { bridge, handoff, projection, wasConsumed } = setup();
  const hostRequest = {};
  const hostResponse = {};
  assert.equal((await bridge.prepare(hostRequest, hostResponse)).status, 'ready');
  assert.equal(wasConsumed(), false);
  const transfer = bridge.takeForDispatch(hostRequest, hostResponse);
  assert.equal(transfer.status, 'ready');
  assert.equal(transfer.handoff, handoff);
  assert.equal(transfer.requestMetadata, requestMetadata);
  assert.equal(transfer.projection, projection);
  assert.equal(wasConsumed(), false);
  assert.equal(bridge.takeForDispatch(hostRequest, hostResponse).status, 'non_ready');
});

test('Host bridge rejects a different response without consuming the valid request handoff', async () => {
  const { bridge, handoff } = setup();
  const hostRequest = {};
  const hostResponse = {};
  await bridge.prepare(hostRequest, hostResponse);
  assert.equal(bridge.takeForDispatch(hostRequest, {}).status, 'non_ready');
  const transfer = bridge.takeForDispatch(hostRequest, hostResponse);
  assert.equal(transfer.status, 'ready');
  assert.equal(transfer.handoff, handoff);
});

test('Host bridge does not transfer preparation to a cloned Host request object', async () => {
  const { bridge } = setup();
  const hostRequest = {};
  const hostResponse = {};
  await bridge.prepare(hostRequest, hostResponse);
  assert.equal(bridge.takeForDispatch({ ...hostRequest }, hostResponse).status, 'non_ready');
  assert.equal(bridge.takeForDispatch(hostRequest, hostResponse).status, 'ready');
});

test('Host bridge rejects duplicate prepare and non-ready context without issuing a handoff', async () => {
  const ready = setup();
  const hostRequest = {};
  const hostResponse = {};
  assert.equal((await ready.bridge.prepare(hostRequest, hostResponse)).status, 'ready');
  assert.equal((await ready.bridge.prepare(hostRequest, hostResponse)).status, 'non_ready');

  const blocked = setup({ prepareStatus: 'non_ready' });
  const blockedRequest = {};
  const blockedResponse = {};
  assert.equal((await blocked.bridge.prepare(blockedRequest, blockedResponse)).status, 'non_ready');
  assert.equal(blocked.bridge.takeForDispatch(blockedRequest, blockedResponse).status, 'non_ready');
});

test('Host bridge rejects mutable request metadata before asking Core to prepare', async () => {
  let prepareCalls = 0;
  const bridge = createNpcGenerationContextHostBridge({
    runtime: {
      async prepareForDispatch() { prepareCalls += 1; return { status: 'ready', handoff: {} }; },
      projectDispatchHandoff() { return { status: 'ready', projection: {} }; },
      consumeDispatchHandoff() { return { status: 'non_ready' }; },
      revalidateLaneAForDispatch() { return { status: 'non_ready' }; },
    },
    createRequestMetadata: () => ({ ...requestMetadata }),
  });
  const result = await bridge.prepare({}, {});
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'request_metadata_not_immutable');
  assert.equal(prepareCalls, 0);
});

test('Host bridge rejects reuse of one frozen request-metadata object across Host requests', async () => {
  const bridge = setup().bridge;
  assert.equal((await bridge.prepare({}, {})).status, 'ready');
  const second = await bridge.prepare({}, {});
  assert.equal(second.status, 'non_ready');
  assert.equal(second.reason, 'request_metadata_reused');
});
