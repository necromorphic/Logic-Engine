import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';

const stRoot = resolve(process.env.SILLYTAVERN_DIR ?? 'SillyTavern');
const expectedSha = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';

// Prevent the upstream route's debug log from serializing request bodies.
// The fake gateway/provider below only drains bytes; it never parses, logs, or persists prompt content.
const originalDebug = console.debug;
console.debug = () => {};

const requireFromST = createRequire(resolve(stRoot, 'package.json'));
const express = requireFromST('express');
const stUtil = await import(pathToFileURL(resolve(stRoot, 'src/util.js')).href);
stUtil.setConfigFilePath(resolve(stRoot, 'default/config.yaml'));
const { router } = await import(pathToFileURL(resolve(stRoot, 'src/endpoints/backends/chat-completions.js')).href);

test('real pinned handler sends OpenAI-compatible and Google AI Studio requests to their configured local gateway exactly once', async (t) => {
  const { execFileSync } = await import('node:child_process');
  const actualSha = execFileSync('git', ['-C', stRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(actualSha, expectedSha, 'test must run against the exact pinned SillyTavern checkout');

  let requestCount = 0;
  const arrivals = [];
  const fakeGateway = requireFromST('node:http').createServer((req, res) => {
    requestCount += 1;
    arrivals.push({ method: req.method, path: req.url });
    req.resume(); // discard request body; never parse, log, or persist prompt content
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.url.includes(':generateContent')) {
        res.end(JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'gateway-ok' }] } }],
        }));
      } else {
        res.end(JSON.stringify({
          id: 'fake-response',
          object: 'chat.completion',
          created: 1,
          model: 'fake-model',
          choices: [{ index: 0, message: { role: 'assistant', content: 'harness-ok' }, finish_reason: 'stop' }],
        }));
      }
    });
  });

  await new Promise((resolveListen, reject) => {
    fakeGateway.once('error', reject);
    fakeGateway.listen(0, '127.0.0.1', resolveListen);
  });
  const gatewayAddress = fakeGateway.address();
  assert.ok(gatewayAddress && typeof gatewayAddress === 'object');
  const gatewayUrl = `http://127.0.0.1:${gatewayAddress.port}`;

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    req.user = { directories: {} };
    next();
  });
  app.use('/api/backends/chat-completions', router);
  const stHarnessServer = app.listen(0, '127.0.0.1');
  await once(stHarnessServer, 'listening');
  const stAddress = stHarnessServer.address();
  assert.ok(stAddress && typeof stAddress === 'object');

  t.after(async () => {
    await Promise.all([
      new Promise(resolveClose => stHarnessServer.close(resolveClose)),
      new Promise(resolveClose => fakeGateway.close(resolveClose)),
    ]);
    console.debug = originalDebug;
  });

  const openAiResponse = await fetch(`http://127.0.0.1:${stAddress.port}/api/backends/chat-completions/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_completion_source: 'openai',
      reverse_proxy: `${gatewayUrl}/v1`,
      proxy_password: 'test-only-not-a-real-secret',
      model: 'fake-model',
      messages: [{ role: 'user', content: 'HARNESS_SENTINEL_DO_NOT_LOG_OPENAI' }],
      stream: false,
      temperature: 0,
      max_tokens: 8,
    }),
  });

  assert.equal(openAiResponse.status, 200, 'the pinned handler should return the fake OpenAI-compatible response');
  const openAiJson = await openAiResponse.json();
  assert.equal(openAiJson.choices?.[0]?.message?.content, 'harness-ok');
  assert.equal(requestCount, 1, 'OpenAI-compatible request should reach the gateway exactly once');
  assert.deepEqual(arrivals, [{ method: 'POST', path: '/v1/chat/completions' }]);

  const googleResponse = await fetch(`http://127.0.0.1:${stAddress.port}/api/backends/chat-completions/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_completion_source: 'makersuite',
      reverse_proxy: gatewayUrl,
      proxy_password: 'test-only-google-proxy-password',
      model: 'gemini-test-model',
      messages: [{ role: 'user', content: 'HARNESS_SENTINEL_DO_NOT_LOG_GOOGLE' }],
      stream: false,
      temperature: 0,
      max_tokens: 8,
    }),
  });

  assert.equal(googleResponse.status, 200, 'the pinned Google AI Studio branch should return the fake gateway response');
  const googleJson = await googleResponse.json();
  assert.equal(googleJson.choices?.[0]?.message?.content, 'gateway-ok');
  assert.equal(requestCount, 2, 'Google AI Studio request should reach the configured gateway exactly once');
  assert.deepEqual(arrivals, [
    { method: 'POST', path: '/v1/chat/completions' },
    { method: 'POST', path: '/v1beta/models/gemini-test-model:generateContent?key=test-only-google-proxy-password' },
  ]);
  assert.equal(JSON.stringify(arrivals).includes('HARNESS_SENTINEL_DO_NOT_LOG'), false);
});
