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

test('Host disconnect during preparation prevents provider dispatch', async () => {
  const { EventEmitter } = await import('node:events');
  let finishPreparation;
  let dispatchCalls = 0;
  const adapter = {
    prepare: () => new Promise((resolve) => { finishPreparation = resolve; }),
    resolveSenderRoute: () => 'text-completions',
    dispatch() { dispatchCalls += 1; return 'unexpected'; },
    forwardResponse() {},
  };
  const owner = 'logic-engine-extension:test-cancel-during-prepare';
  registerLogicEngineFinalSendAdapter(adapter, owner);
  const request = new EventEmitter();
  request.originalUrl = '/api/backends/text-completions/generate';
  request.body = { stream: false };
  const response = new EventEmitter();
  response.writableEnded = false;
  try {
    const pending = runWithLogicEngineFinalSend(request, response, () => {
      throw new Error('native sender must not run after disconnect');
    });
    await new Promise((resolve) => setImmediate(resolve));
    response.emit('close');
    finishPreparation();
    assert.equal(await pending, undefined);
    assert.equal(dispatchCalls, 0);
  } finally {
    unregisterLogicEngineFinalSendAdapter(adapter, owner);
  }
});

test('Host disconnect after dispatch begins aborts the exact provider request signal', async () => {
  const { EventEmitter } = await import('node:events');
  let capturedSignal;
  const adapter = {
    async prepare() {},
    resolveSenderRoute: () => 'kobold-text',
    dispatch({ requestInit }) {
      capturedSignal = requestInit.signal;
      return new Promise((resolve) => {
        if (capturedSignal.aborted) resolve('aborted');
        else capturedSignal.addEventListener('abort', () => resolve('aborted'), { once: true });
      });
    },
    forwardResponse() {},
  };
  const owner = 'logic-engine-extension:test-cancel-in-flight';
  registerLogicEngineFinalSendAdapter(adapter, owner);
  const request = new EventEmitter();
  request.originalUrl = '/api/backends/kobold/generate';
  request.body = { streaming: true };
  const response = new EventEmitter();
  response.writableEnded = false;
  try {
    const pending = runWithLogicEngineFinalSend(request, response, () =>
      logicEngineFetch('https://provider.example/generate', { method: 'POST' }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(capturedSignal?.aborted, false);
    response.emit('close');
    assert.equal(await pending, 'aborted');
    assert.equal(capturedSignal.aborted, true);
  } finally {
    unregisterLogicEngineFinalSendAdapter(adapter, owner);
  }
});

test('Final-Send hook derives streaming from the native Kobold request field', async () => {
  let observed;
  const adapter = {
    async prepare() {},
    resolveSenderRoute: () => 'kobold-text',
    dispatch(args) { observed = args; return 'ok'; },
    forwardResponse() {},
  };
  const owner = 'logic-engine-extension:test-kobold-stream-flag';
  registerLogicEngineFinalSendAdapter(adapter, owner);
  try {
    const request = {
      originalUrl: '/api/backends/kobold/generate',
      body: { streaming: true },
    };
    assert.equal(await runWithLogicEngineFinalSend(request, {}, () =>
      logicEngineFetch('https://provider.example/generate', { method: 'POST' })), 'ok');
    assert.equal(observed.stream, true);
    assert.equal(observed.hostTransformsStream, false);
  } finally {
    unregisterLogicEngineFinalSendAdapter(adapter, owner);
  }
});

test('managed Host response writes and final end pass through Gateway authorization', async () => {
  const writes = [];
  const response = {
    writableEnded: false,
    write(chunk) { writes.push(['write', chunk]); return true; },
    end() { writes.push(['end']); this.writableEnded = true; },
  };
  const adapter = {
    async prepare() {},
    resolveSenderRoute: () => 'chat-completions',
    dispatch() {},
    forwardResponse() {},
    authorizeResponseWrite(_response, write, final) {
      writes.push(['authorized', final]);
      return write();
    },
  };
  const owner = 'logic-engine-extension:test-response-write-authorization';
  registerLogicEngineFinalSendAdapter(adapter, owner);
  try {
    await runWithLogicEngineFinalSend({
      originalUrl: '/api/backends/chat-completions/generate',
      body: { stream: false },
    }, response, async () => {
      response.write('protected chunk');
      response.end();
    });
    assert.deepEqual(writes, [
      ['authorized', false],
      ['write', 'protected chunk'],
      ['authorized', true],
      ['end'],
    ]);
  } finally {
    unregisterLogicEngineFinalSendAdapter(adapter, owner);
  }
});

test('terminal Gateway denial destroys the Host response instead of reaching fallback middleware', async () => {
  let nativeWrites = 0;
  let destroyed = false;
  const response = {
    writableEnded: false,
    destroyed: false,
    write() { nativeWrites += 1; },
    end() { nativeWrites += 1; },
    destroy() { destroyed = true; this.destroyed = true; },
  };
  const adapter = {
    async prepare() {},
    resolveSenderRoute: () => 'chat-completions',
    dispatch() {},
    forwardResponse() {},
    authorizeResponseWrite() {
      const error = new Error('revoked');
      error.logicEngineFinalSendTerminal = true;
      throw error;
    },
  };
  const owner = 'logic-engine-extension:test-terminal-denial';
  registerLogicEngineFinalSendAdapter(adapter, owner);
  try {
    const result = await runWithLogicEngineFinalSend({
      originalUrl: '/api/backends/chat-completions/generate',
      body: { stream: false },
    }, response, async () => response.write('must not escape'));
    assert.equal(result, undefined);
    assert.equal(nativeWrites, 0);
    assert.equal(destroyed, true);
  } finally {
    unregisterLogicEngineFinalSendAdapter(adapter, owner);
  }
});
