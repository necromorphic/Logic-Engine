import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRequestScopedTransportCapability,
  dispatchThroughRequestScopedCapability,
} from '../request-scoped-transport-capability.mjs';

const makeCapability = (overrides = {}, calls = []) => createRequestScopedTransportCapability({
  fetchImpl: (url, init) => {
    calls.push({ url, init });
    return Promise.resolve({ status: 200, ok: true });
  },
  endpoint: 'https://provider.example/v1/chat/completions',
  method: 'POST',
  headers: { authorization: 'Bearer test-secret', 'content-type': 'application/json' },
  serializedBody: '{"model":"test","messages":[{"role":"user","content":"exact bytes"}]}',
  streaming: false,
  ...overrides,
});

test('capability sends the exact serialized body once without parsing or reserialization', async () => {
  const calls = [];
  const serializedBody = '{"z":1, "a":2}';
  const capability = makeCapability({ serializedBody }, calls);
  const result = await dispatchThroughRequestScopedCapability({
    capability,
    authorizeAndPersistStart: async evidence => ({
      status: 'STARTED',
      dispatchId: 'dispatch-1',
      requestDigest: evidence.requestDigest,
    }),
  });
  assert.equal(result.status, 'RESPONSE_RECEIVED');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.body, serializedBody);
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.method, 'POST');
});

test('durable authorization/start is awaited before the only outbound call', async () => {
  const order = [];
  const capability = makeCapability({
    fetchImpl: () => {
      order.push('transport');
      return Promise.resolve({ status: 200 });
    },
  });
  const result = await dispatchThroughRequestScopedCapability({
    capability,
    authorizeAndPersistStart: async evidence => {
      order.push('authorize-and-persist-start');
      assert.equal(evidence.requestDigest, capability.requestDigest);
      await Promise.resolve();
      order.push('durable-start-confirmed');
      return { status: 'STARTED', dispatchId: 'dispatch-2', requestDigest: evidence.requestDigest };
    },
  });
  assert.equal(result.status, 'RESPONSE_RECEIVED');
  assert.deepEqual(order, ['authorize-and-persist-start', 'durable-start-confirmed', 'transport']);
});

test('deny, missing atomic boundary, and callback failure make zero outbound calls', async () => {
  for (const mode of ['deny', 'missing', 'throw']) {
    const calls = [];
    const capability = makeCapability({ fetchImpl: (...args) => { calls.push(args); return Promise.resolve({}); } });
    const options = { capability };
    if (mode === 'deny') {
      options.authorizeAndPersistStart = async evidence => ({
        status: 'DENIED', dispatchId: 'not-started', requestDigest: evidence.requestDigest,
      });
    } else if (mode === 'throw') {
      options.authorizeAndPersistStart = async () => { throw new Error('authority unavailable'); };
    }
    const result = await dispatchThroughRequestScopedCapability(options);
    assert.equal(result.status, 'DENIED', mode);
    assert.equal(calls.length, 0, mode);
  }
});

test('a decision for a different request digest is rejected before transport', async () => {
  const calls = [];
  const capability = makeCapability({ fetchImpl: (...args) => { calls.push(args); return Promise.resolve({}); } });
  const result = await dispatchThroughRequestScopedCapability({
    capability,
    authorizeAndPersistStart: async () => ({
      status: 'STARTED', dispatchId: 'dispatch-wrong', requestDigest: '0'.repeat(64),
    }),
  });
  assert.equal(result.status, 'DENIED');
  assert.equal(result.reason, 'DISPATCH_START_NOT_DURABLY_AUTHORIZED');
  assert.equal(calls.length, 0);
});

test('capability is one-shot even after a response promise rejects; outcome is UNKNOWN and not retried', async () => {
  let calls = 0;
  const capability = makeCapability({
    fetchImpl: () => { calls += 1; return Promise.reject(new Error('connection reset')); },
  });
  const result = await dispatchThroughRequestScopedCapability({
    capability,
    authorizeAndPersistStart: async evidence => ({
      status: 'STARTED', dispatchId: 'dispatch-unknown', requestDigest: evidence.requestDigest,
    }),
  });
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.dispatchId, 'dispatch-unknown');
  assert.equal(calls, 1);
  assert.throws(() => capability.start(), /TRANSPORT_CAPABILITY_ALREADY_USED/);
  assert.equal(calls, 1);
});

test('invalid endpoint, non-string body, and URL credentials are rejected', () => {
  assert.throws(() => makeCapability({ endpoint: 'file:///tmp/provider' }), /resolved HTTP\(S\) endpoint/);
  assert.throws(() => makeCapability({ endpoint: 'https://user:pass@provider.example/v1' }), /resolved HTTP\(S\) endpoint/);
  assert.throws(() => makeCapability({ serializedBody: { model: 'test' } }), /exact serialized request body/);
  assert.throws(() => makeCapability({ headers: { Authorization: 'Bearer one', authorization: 'Bearer two' } }), /unique normalized string pairs/);
  assert.throws(() => makeCapability({ headers: { 'x-provider': 'value\\r\\nInjected: yes' } }), /unique normalized string pairs/);
});

test('request digest binds endpoint, headers, streaming mode, and exact body bytes without exposing secrets', () => {
  const base = makeCapability();
  assert.equal(JSON.stringify(base.requestMetadata).includes('provider.example'), false);
  assert.equal(JSON.stringify(base.requestMetadata).includes('test-secret'), false);
  assert.notEqual(base.requestDigest, makeCapability({ serializedBody: '{"model":"different"}' }).requestDigest);
  assert.notEqual(base.requestDigest, makeCapability({ endpoint: 'https://provider.example/v2/chat/completions' }).requestDigest);
  assert.notEqual(base.requestDigest, makeCapability({ streaming: true }).requestDigest);
  assert.notEqual(base.requestDigest, makeCapability({ headers: { authorization: 'Bearer other', 'content-type': 'application/json' } }).requestDigest);
});
