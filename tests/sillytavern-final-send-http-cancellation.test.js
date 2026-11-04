import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const patchPath = new URL('../host-adapter/patches/sillytavern-1.19.0-final-send.patch', import.meta.url);
const patch = await readFile(patchPath, 'utf8');
const hookMarker = '--- /dev/null\n+++ b/src/logic-engine-final-send-hook.js\n';
const hookStart = patch.indexOf(hookMarker);
assert.notEqual(hookStart, -1, 'Final-Send Hook must be present in the pinned patch');
const hunkStart = patch.indexOf('\n', patch.indexOf('@@ -0,0 +1,169 @@', hookStart)) + 1;
const hookEnd = patch.indexOf('\n--- a/', hunkStart);
assert.ok(hunkStart > 0 && hookEnd > hunkStart, 'Final-Send Hook patch section must be bounded');
const hookSource = patch.slice(hunkStart, hookEnd).split('\n')
  .map((line) => line.startsWith('+') ? line.slice(1) : line).join('\n');

const hookDirectory = await mkdtemp(join(process.cwd(), '.final-send-http-test-'));
const hookFile = join(hookDirectory, 'logic-engine-final-send-hook.js');
await writeFile(hookFile, hookSource);
const hook = await import(pathToFileURL(hookFile).href);
const owner = 'logic-engine-extension:http-cancellation-test';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

async function closeServer(server) {
  if (!server.listening) return;
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

function waitFor(promise, label, timeoutMs = 5000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs);
      timer.unref?.();
    }),
  ]);
}

function makeAdapter(overrides = {}) {
  return {
    prepare: async () => {},
    dispatch: async ({ transport, forwardResponse }) => {
      const upstream = await transport();
      if (forwardResponse) return forwardResponse(upstream);
      return upstream.text();
    },
    forwardResponse: async (upstream, response) => {
      for await (const chunk of upstream.body) response.write(chunk);
      response.end();
    },
    resolveSenderRoute: () => 'http-cancellation-test',
    ...overrides,
  };
}

test('real HTTP disconnect during pending preparation prevents dispatch', async () => {
  let releasePreparation;
  let enteredPreparation;
  const preparationEntered = new Promise((resolve) => { enteredPreparation = resolve; });
  const preparationGate = new Promise((resolve) => { releasePreparation = resolve; });
  let dispatchCalled = false;
  let hostFinishedResolve;
  const hostFinished = new Promise((resolve) => { hostFinishedResolve = resolve; });
  let responseClosedResolve;
  const responseClosed = new Promise((resolve) => { responseClosedResolve = resolve; });
  const adapter = makeAdapter({
    prepare: async () => {
      enteredPreparation();
      await preparationGate;
    },
    dispatch: async () => {
      dispatchCalled = true;
    },
  });
  hook.registerLogicEngineFinalSendAdapter(adapter, owner);

  const host = http.createServer((request, response) => {
    response.once('close', responseClosedResolve);
    void hook.runWithLogicEngineFinalSend(request, response, async () => {
      await hook.logicEngineFetch('http://127.0.0.1:1/unused', {});
    }).finally(hostFinishedResolve);
  });
  const hostUrl = await listen(host);
  const client = http.request(hostUrl, { method: 'POST' });
  client.on('error', () => {});
  client.end('{}');

  try {
    await waitFor(preparationEntered, 'Host preparation');
    client.destroy();
    await waitFor(responseClosed, 'Host response close');
    releasePreparation();
    await waitFor(hostFinished, 'Host request completion');
    assert.equal(dispatchCalled, false, 'dispatch must not start after cancellation during prepare');
  } finally {
    releasePreparation();
    hook.unregisterLogicEngineFinalSendAdapter(adapter, owner);
    await closeServer(host);
  }
});

test('real HTTP disconnect between stream chunks aborts the provider transport', async () => {
  let providerClosedResolve;
  const providerClosed = new Promise((resolve) => { providerClosedResolve = resolve; });
  let firstChunkResolve;
  const firstChunk = new Promise((resolve) => { firstChunkResolve = resolve; });
  let hostFinishedResolve;
  const hostFinished = new Promise((resolve) => { hostFinishedResolve = resolve; });
  let chunksForwarded = 0;
  let providerSignal;

  const provider = http.createServer((_request, response) => {
    response.on('close', providerClosedResolve);
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.write('chunk-1');
    setTimeout(() => {
      if (!response.destroyed) response.write('chunk-2');
    }, 1000).unref?.();
  });
  const providerUrl = await listen(provider);
  const adapter = makeAdapter({
    dispatch: async ({ transport, forwardResponse, requestInit }) => {
      providerSignal = requestInit.signal;
      const upstream = await transport();
      return forwardResponse(upstream);
    },
    forwardResponse: async (upstream, response) => {
      for await (const chunk of upstream.body) {
        chunksForwarded += 1;
        response.write(chunk);
        if (chunksForwarded === 1) firstChunkResolve();
      }
      response.end();
    },
  });
  hook.registerLogicEngineFinalSendAdapter(adapter, owner);

  const host = http.createServer((request, response) => {
    request.body = { stream: true };
    void hook.runWithLogicEngineFinalSend(request, response, async () => {
      await hook.logicEngineFetch(providerUrl, {});
    }).finally(hostFinishedResolve);
  });
  const hostUrl = await listen(host);
  const client = http.request(hostUrl, { method: 'POST' });
  client.on('error', () => {});
  client.end('{}');

  try {
    await waitFor(firstChunk, 'first streamed chunk');
    assert.equal(providerSignal?.aborted, false);
    client.destroy();
    await waitFor(providerClosed, 'provider connection close');
    await waitFor(hostFinished, 'Host request completion');
    assert.equal(providerSignal.aborted, true, 'Host disconnect must abort the exact provider request signal');
    assert.equal(chunksForwarded, 1, 'no later stream chunk may be forwarded after disconnect');
  } finally {
    hook.unregisterLogicEngineFinalSendAdapter(adapter, owner);
    await closeServer(host);
    await closeServer(provider);
  }
});

test.after(async () => {
  await rm(hookDirectory, { recursive: true, force: true });
});
