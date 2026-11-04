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
