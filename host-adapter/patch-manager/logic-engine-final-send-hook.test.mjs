import test from 'node:test';
import assert from 'node:assert/strict';
import {
  registerLogicEngineFinalSendAdapter,
  unregisterLogicEngineFinalSendAdapter,
  runWithLogicEngineFinalSend,
  logicEngineFetch,
} from './logic-engine-final-send-hook.js';

test('Final-Send hook preserves native Host route for non-chat generation', async () => {
  const observed = [];
  const adapter = {
    async prepare() {},
    resolveSenderRoute(_request, hostRoute) {
      observed.push(['resolve', hostRoute]);
      return hostRoute;
    },
    dispatch(args) {
      observed.push(['dispatch', args.hostRoute, args.senderRoute]);
      return { status: 200 };
    },
    forwardResponse() {},
  };
  const owner = 'logic-engine-extension:test-route-binding';
  registerLogicEngineFinalSendAdapter(adapter, owner);
  try {
    const request = {
      originalUrl: '/api/backends/text-completions/generate?source=test',
      body: { stream: false },
    };
    const response = {};
    const result = await runWithLogicEngineFinalSend(request, response, async () =>
      logicEngineFetch('https://provider.example/generate', { method: 'POST' }));
    assert.equal(result.status, 200);
    assert.deepEqual(observed, [
      ['resolve', 'text-completions'],
      ['dispatch', 'text-completions', 'text-completions'],
    ]);
  } finally {
    unregisterLogicEngineFinalSendAdapter(adapter, owner);
  }
});


test('Final-Send hook rejects unknown Host generation routes instead of defaulting to chat-completions', async () => {
  let dispatchCalls = 0;
  const adapter = {
    async prepare() {},
    resolveSenderRoute(_request, hostRoute) { return hostRoute; },
    dispatch() { dispatchCalls += 1; return { status: 200 }; },
    forwardResponse() {},
  };
  const owner = 'logic-engine-extension:test-unknown-route';
  registerLogicEngineFinalSendAdapter(adapter, owner);
  try {
    const request = { originalUrl: '/api/plugins/other/generate', body: { stream: false } };
    await assert.rejects(
      runWithLogicEngineFinalSend(request, {}, async () =>
        logicEngineFetch('https://provider.example/generate', { method: 'POST' })),
      /LOGIC_ENGINE_FINAL_SEND_HOST_ROUTE_UNKNOWN/,
    );
    assert.equal(dispatchCalls, 0);
  } finally {
    unregisterLogicEngineFinalSendAdapter(adapter, owner);
  }
});
