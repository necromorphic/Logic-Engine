import test from 'node:test';
import assert from 'node:assert/strict';
import { createSillyTavernGenerationBridge } from '../host-adapter/sillytavern-generation-bridge.mjs';

test('SillyTavern generation bridge intercepts all sender fetches only inside /generate context', async () => {
  const calls = [];
  const bridge = createSillyTavernGenerationBridge({
    finalSend: (args) => {
      calls.push(args);
      return args.requestInit.body;
    },
    nativeFetch: async (url) => ({ source: 'native', url }),
    nativeForwardFetchResponse: async () => {},
    resolveSenderRoute: (source) => source === 'google' ? 'google-ai-studio' : 'openai',
  });
  const outside = await bridge.fetch('https://models.example/list', { method: 'GET' });
  assert.equal(outside.source, 'native');
  assert.equal(calls.length, 0);

  const request = { body: { chat_completion_source: 'google', stream: false } };
  const response = {};
  const inside = await bridge.run(request, response, async () => (
    bridge.fetch('https://provider.example/generate', {
      method: 'POST', body: '{"final":"provider body"}',
    })
  ));
  assert.equal(inside, '{"final":"provider body"}');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].senderRoute, 'google-ai-studio');
  assert.equal(calls[0].hostRequestContext, request);
});

test('SillyTavern protected streaming is forwarded once inside Gateway transport', async () => {
  let fetchCalls = 0;
  let forwardCalls = 0;
  const bridge = createSillyTavernGenerationBridge({
    finalSend: async ({ forwardResponse, stream }) => {
      assert.equal(stream, true);
      const upstream = await Promise.resolve({ status: 200 });
      await forwardResponse(upstream);
      return { status: upstream.status };
    },
    nativeFetch: async () => { fetchCalls += 1; return { status: 200 }; },
    nativeForwardFetchResponse: async () => { forwardCalls += 1; },
    resolveSenderRoute: () => 'google-ai-studio',
  });
  const request = { body: { chat_completion_source: 'google', stream: true } };
  const response = {};
  await bridge.run(request, response, async () => {
    const upstream = await bridge.fetch('https://provider.example/stream', {
      method: 'POST', body: '{}',
    });
    await bridge.forwardFetchResponse(upstream, response);
  });
  assert.equal(fetchCalls, 0);
  assert.equal(forwardCalls, 1);
});
