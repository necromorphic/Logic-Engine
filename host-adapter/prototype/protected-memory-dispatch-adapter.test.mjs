import test from 'node:test';
import assert from 'node:assert/strict';
import { createProtectedMemoryDispatchAdapter } from './protected-memory-dispatch-adapter.mjs';

const trustedContext = () => ({
  requestId: 'request-1',
  adapterId: 'adapter-1',
  conversationId: 'conversation-1',
  worldId: 'world-1',
  actorId: 'actor-1',
  purpose: 'npc-generation',
  sources: [{ source_kind: 'canonical_entity', source_entity_id: 'entity-1', source_version: 'core-entity-v1:7' }],
  candidates: [{ record_ref: 'record-1', record_version: 'provider-v1:3', source_kind: 'canonical_entity', source_entity_id: 'entity-1', source_version: 'core-entity-v1:7' }],
});

function harness({ context = trustedContext(), gatewayImpl, transportFactory } = {}) {
  const calls = [];
  const prepared = [];
  const gateway = {
    async dispatchProtectedRequest(args) {
      calls.push(args);
      if (gatewayImpl) return gatewayImpl(args);
      return { ok: true };
    },
  };
  const dispatch = createProtectedMemoryDispatchAdapter({
    gateway,
    readTrustedContext: async () => context,
    createServerTransport: transportFactory ?? ((args) => {
      prepared.push(args);
      return () => ({ started: true, response: Promise.resolve({ status: 200 }) });
    }),
    forwardResponse: async () => {},
  });
  return { dispatch, calls, prepared };
}

test('passes exact serialized body and dormant server transport capability to Gateway', async () => {
  const body = '{ "model":"opaque-model", "messages":[{"role":"user","content":"x"}] }';
  const { dispatch, calls, prepared } = harness();
  await dispatch({ serializedBody: body, model: 'opaque-model', stream: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body, body);
  assert.equal(calls[0].route, 'host-managed-chat-completions');
  assert.equal(calls[0].purpose, 'npc-generation');
  assert.deepEqual(calls[0].candidates, trustedContext().candidates);
  assert.equal(typeof calls[0].transport, 'function');
  assert.notEqual(calls[0].transport.constructor?.name, 'AsyncFunction');
  assert.deepEqual(prepared, [{ serializedBody: body, model: 'opaque-model', stream: false, signal: undefined }]);
});

test('rejects malformed input before reading context, preparing transport, or calling Gateway', async () => {
  const { dispatch, calls, prepared } = harness();
  await assert.rejects(dispatch({ serializedBody: '', model: 'model', stream: false }), /MEMORY_DISPATCH_NOT_READY/);
  await assert.rejects(dispatch({ serializedBody: '{}', model: 'bad model', stream: false }), /MEMORY_DISPATCH_NOT_READY/);
  assert.equal(calls.length, 0);
  assert.equal(prepared.length, 0);
});

test('rejects incomplete trusted context before preparing transport or calling Gateway', async () => {
  const incomplete = trustedContext();
  delete incomplete.candidates;
  const { dispatch, calls, prepared } = harness({ context: incomplete });
  await assert.rejects(dispatch({ serializedBody: '{}', model: 'model', stream: false }), /MEMORY_DISPATCH_NOT_READY/);
  assert.equal(calls.length, 0);
  assert.equal(prepared.length, 0);
});

test('rejects an async transport factory before invoking it or entering Gateway', async () => {
  let factoryStarted = 0;
  const { dispatch, calls } = harness({
    transportFactory: async () => {
      factoryStarted += 1;
      return () => ({ started: true, response: Promise.resolve({ status: 200 }) });
    },
  });
  await assert.rejects(dispatch({ serializedBody: '{}', model: 'model', stream: false }), /MEMORY_DISPATCH_NOT_READY/);
  assert.equal(factoryStarted, 0);
  assert.equal(calls.length, 0);
});

test('rejects a synchronous factory that does not return a callable capability', async () => {
  const { dispatch, calls } = harness({ transportFactory: () => ({ started: true }) });
  await assert.rejects(dispatch({ serializedBody: '{}', model: 'model', stream: false }), /MEMORY_DISPATCH_NOT_READY/);
  assert.equal(calls.length, 0);
});

test('propagates Gateway denial without retry or alternate transport', async () => {
  let gatewayCalls = 0;
  let transportInvocations = 0;
  const { dispatch } = harness({
    transportFactory: () => () => {
      transportInvocations += 1;
      return { started: true, response: Promise.resolve({ status: 200 }) };
    },
    gatewayImpl: async () => {
      gatewayCalls += 1;
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    },
  });
  await assert.rejects(dispatch({ serializedBody: '{}', model: 'model', stream: false }), /MEMORY_DISPATCH_NOT_READY/);
  assert.equal(gatewayCalls, 1);
  assert.equal(transportInvocations, 0);
});
