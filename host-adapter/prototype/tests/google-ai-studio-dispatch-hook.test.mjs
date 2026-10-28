import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleAiStudioDispatchHook } from '../google-ai-studio-dispatch-hook.mjs';

function fakeResponse() {
  return {
    headersSent: false,
    destroyed: false,
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; this.headersSent = true; return this; },
    destroy() { this.destroyed = true; },
  };
}

const base = {
  request: { id: 'server-request' },
  apiUrl: 'https://generativelanguage.googleapis.com/',
  apiKey: 'server-side-secret-key',
  apiVersion: 'v1beta',
  model: 'gemini-test-model',
  stream: false,
  serializedBody: '{"contents":[{"parts":[{"text":"exact"}]}]}',
  signal: new AbortController().signal,
  forwardResponse: async () => {},
};

const trustedContext = {
  requestId: 'dispatch-1',
  worldId: 'world-1',
  actorId: 'npc-1',
  purpose: 'response-context',
  sources: [{ sourceId: 'source-1', versionId: 'version-1' }],
  candidates: [{ recordRef: 'record-1', recordVersion: 'record-version-1', sourceId: 'source-1', sourceVersion: 'version-1' }],
};

test('unprotected request is left to the existing provider path', async () => {
  let gatewayCalls = 0;
  const hook = createGoogleAiStudioDispatchHook({
    gateway: { dispatchProtectedRequest: async () => { gatewayCalls += 1; } },
    isProtectedRequest: () => false,
    getTrustedDispatchContext: () => trustedContext,
  });
  assert.equal(await hook({ ...base, response: fakeResponse() }), false);
  assert.equal(gatewayCalls, 0);
});

test('protected request passes exact serialized body and request-scoped transport to Gateway', async () => {
  let received;
  const hook = createGoogleAiStudioDispatchHook({
    gateway: { dispatchProtectedRequest: async (input) => {
      received = input;
      const prepared = input.prepareUpstream({
        route: input.route, model: input.model, stream: input.stream,
        body: input.body, signal: input.signal, forwardResponse: input.forwardResponse,
      });
      assert.equal(prepared.target, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-test-model:generateContent');
      assert.equal(typeof prepared.start, 'function');
    } },
    isProtectedRequest: () => true,
    getTrustedDispatchContext: () => trustedContext,
    fetchImpl: async () => { throw new Error('must not fetch in this test'); },
  });
  const response = fakeResponse();
  assert.equal(await hook({ ...base, response }), true);
  assert.equal(received.body, base.serializedBody);
  assert.equal(received.requestId, trustedContext.requestId);
  assert.equal(received.worldId, trustedContext.worldId);
  assert.equal(received.prepareUpstream instanceof Function, true);
  assert.equal(response.statusCode, null);
});

test('protected request fails closed when trusted context is missing', async () => {
  let gatewayCalls = 0;
  const response = fakeResponse();
  const hook = createGoogleAiStudioDispatchHook({
    gateway: { dispatchProtectedRequest: async () => { gatewayCalls += 1; } },
    isProtectedRequest: () => true,
    getTrustedDispatchContext: () => null,
  });
  assert.equal(await hook({ ...base, response }), true);
  assert.equal(gatewayCalls, 0);
  assert.equal(response.statusCode, 503);
  assert.equal(response.payload.error.code, 'MEMORY_DISPATCH_NOT_READY');
});

test('protected request rejects custom/proxy endpoint without fallback', async () => {
  let gatewayCalls = 0;
  const response = fakeResponse();
  const hook = createGoogleAiStudioDispatchHook({
    gateway: { dispatchProtectedRequest: async () => { gatewayCalls += 1; } },
    isProtectedRequest: () => true,
    getTrustedDispatchContext: () => trustedContext,
  });
  assert.equal(await hook({ ...base, apiUrl: 'https://proxy.example/api', response }), true);
  assert.equal(gatewayCalls, 0);
  assert.equal(response.statusCode, 503);
});

test('protected policy callback error fails closed instead of becoming unprotected', async () => {
  const response = fakeResponse();
  const hook = createGoogleAiStudioDispatchHook({
    gateway: { dispatchProtectedRequest: async () => { throw new Error('must not be called'); } },
    isProtectedRequest: () => { throw new Error('policy unavailable'); },
    getTrustedDispatchContext: () => trustedContext,
  });
  assert.equal(await hook({ ...base, response }), true);
  assert.equal(response.statusCode, 503);
});
