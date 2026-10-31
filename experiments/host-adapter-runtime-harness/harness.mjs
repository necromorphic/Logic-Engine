import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';

const stRoot = resolve(process.env.SILLYTAVERN_DIR ?? 'SillyTavern');
const expectedSha = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';

// Capture console output without forwarding it to CI. The pinned upstream
// handler has a console.debug path that serializes the request body, so debug
// output is suppressed and separately counted rather than retained as text.
const loggedOutput = [];
let suppressedDebugCalls = 0;
const originalConsoleMethods = Object.fromEntries(
  ['debug', 'info', 'log', 'warn', 'error'].map(name => [name, console[name]]),
);
for (const name of Object.keys(originalConsoleMethods)) {
  console[name] = (...args) => {
    if (name === 'debug') {
      suppressedDebugCalls += 1;
      return;
    }
    const rendered = args.map(arg => {
      try {
        return typeof arg === 'string' ? arg : JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    }).join(' ');
    loggedOutput.push({ method: name, rendered });
  };
}

const requireFromST = createRequire(resolve(stRoot, 'package.json'));
const express = requireFromST('express');
const stUtil = await import(pathToFileURL(resolve(stRoot, 'src/util.js')).href);
stUtil.setConfigFilePath(resolve(stRoot, 'default/config.yaml'));
const { router } = await import(pathToFileURL(resolve(stRoot, 'src/endpoints/backends/chat-completions.js')).href);

test('real pinned server Chat Completions handler reaches a recording fake provider exactly once', async (t) => {
  if (existsSync(resolve(stRoot, '.git'))) {
    const { execFileSync } = await import('node:child_process');
    const actualSha = execFileSync('git', ['-C', stRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    assert.equal(actualSha, expectedSha, 'test must run against the exact pinned SillyTavern checkout');
  } else {
    // The self-hosted runner may receive the immutable checkout as a REST
    // archive because Git is not installed in its service account PATH.
    assert.equal(process.env.SILLYTAVERN_CHECKED_OUT_REF, expectedSha,
      'REST archive harness requires the exact immutable checkout ref');
  }

  let requestCount = 0;
  const arrivals = [];
  const fakeProvider = requireFromST('node:http').createServer((req, res) => {
    requestCount += 1;
    arrivals.push({ method: req.method, path: req.url });
    req.resume(); // discard request body; never parse, log, or persist prompt content
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'fake-response',
        object: 'chat.completion',
        created: 1,
        model: 'fake-model',
        choices: [{ index: 0, message: { role: 'assistant', content: 'harness-ok' }, finish_reason: 'stop' }],
      }));
    });
  });

  await new Promise((resolveListen, reject) => {
    fakeProvider.once('error', reject);
    fakeProvider.listen(0, '127.0.0.1', resolveListen);
  });
  const providerAddress = fakeProvider.address();
  assert.ok(providerAddress && typeof providerAddress === 'object');

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
      new Promise(resolveClose => fakeProvider.close(resolveClose)),
    ]);
    for (const [name, method] of Object.entries(originalConsoleMethods)) {
      console[name] = method;
    }
  });

  const response = await fetch(`http://127.0.0.1:${stAddress.port}/api/backends/chat-completions/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_completion_source: 'openai',
      reverse_proxy: `http://127.0.0.1:${providerAddress.port}/v1`,
      proxy_password: 'test-only-not-a-real-secret',
      model: 'fake-model',
      messages: [{ role: 'user', content: 'HARNESS_SENTINEL_DO_NOT_LOG' }],
      stream: false,
      temperature: 0,
      max_tokens: 8,
    }),
  });

  assert.equal(response.status, 200, 'the actual pinned handler should return the fake provider response');
  const responseJson = await response.json();
  assert.equal(responseJson.choices?.[0]?.message?.content, 'harness-ok');
  assert.equal(requestCount, 1, 'exactly one outbound request should arrive at the fake provider');
  assert.deepEqual(arrivals, [{ method: 'POST', path: '/v1/chat/completions' }]);
  assert.equal(JSON.stringify(arrivals).includes('HARNESS_SENTINEL_DO_NOT_LOG'), false);
  assert.ok(suppressedDebugCalls > 0, 'the upstream body-serializing debug path must be suppressed');
  assert.equal(
    loggedOutput.some(entry => entry.rendered.includes('HARNESS_SENTINEL_DO_NOT_LOG')),
    false,
    'request-body sentinel must not appear in any forwarded/captured non-debug console output',
  );
});
