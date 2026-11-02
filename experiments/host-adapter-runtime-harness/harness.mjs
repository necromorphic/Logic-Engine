import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';

const stRoot = resolve(process.env.SILLYTAVERN_DIR ?? 'SillyTavern');
const expectedSha = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';
const sentinel = 'HARNESS_SENTINEL_DO_NOT_LOG';
const requireFromST = createRequire(resolve(stRoot, 'package.json'));
const http = requireFromST('node:http');
const https = requireFromST('node:https');
const originalHttpsRequest = https.request;

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

const providerRequests = [];
const fakeProvider = http.createServer((req, res) => {
  providerRequests.push({ method: req.method, path: req.url });
  req.resume();
  req.on('end', () => {
    let body;
    if (req.url.includes('/chat/completions')) {
      body = {
        id: 'fake-chat-response',
        object: 'chat.completion',
        created: 1,
        model: 'fake-model',
        choices: [{ index: 0, message: { role: 'assistant', content: 'chat-ok' }, finish_reason: 'stop' }],
      };
    } else if (req.url.endsWith('/v1/completions')) {
      body = { id: 'fake-text-response', choices: [{ text: 'text-completions-ok', index: 0 }] };
    } else if (req.url.endsWith('/v1/generate')) {
      body = { results: [{ text: 'kobold-ok' }] };
    } else if (req.url.endsWith('/ai/generate')) {
      body = { output: 'novelai-ok' };
    } else if (req.url.includes('/api/v2/generate/text/async')) {
      body = { id: 'horde-fake-task', message: 'horde-ok' };
    } else {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'unexpected fake-provider path' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
});

await new Promise((resolveListen, reject) => {
  fakeProvider.once('error', reject);
  fakeProvider.listen(0, '127.0.0.1', resolveListen);
});
const providerAddress = fakeProvider.address();
assert.ok(providerAddress && typeof providerAddress === 'object');

// The pinned NovelAI and Horde handlers use fixed HTTPS origins. Redirect only
// those exact upstream hostnames to the local fake provider; all other HTTPS
// traffic retains the native transport.
const fakeHttpsHosts = new Set(['api.novelai.net', 'text.novelai.net', 'aihorde.net']);
https.request = function (input, options, callback) {
  let parsed;
  try {
    parsed = input instanceof URL ? input : new URL(String(input));
  } catch {
    return originalHttpsRequest.call(https, input, options, callback);
  }
  if (!fakeHttpsHosts.has(parsed.hostname)) {
    return originalHttpsRequest.call(https, input, options, callback);
  }
  const redirected = {
    ...(options && typeof options === 'object' ? options : {}),
    protocol: 'http:',
    hostname: '127.0.0.1',
    host: '127.0.0.1',
    port: providerAddress.port,
    path: parsed.pathname + parsed.search,
    agent: undefined,
  };
  delete redirected.servername;
  return http.request(redirected, typeof options === 'function' ? options : callback);
};

const stUtil = await import(pathToFileURL(resolve(stRoot, 'src/util.js')).href);
stUtil.setConfigFilePath(resolve(stRoot, 'default/config.yaml'));
const { CHAT_COMPLETION_SOURCES, TEXTGEN_TYPES } = await import(
  pathToFileURL(resolve(stRoot, 'src/constants.js')).href,
);
const hook = await import(pathToFileURL(resolve(stRoot, 'src/logic-engine-final-send-hook.js')).href);
const { createSillyTavernFinalSendAdapter } = await import(
  pathToFileURL(resolve(process.cwd(), 'host-adapter/sillytavern-final-send-adapter.mjs')).href,
);

let gatewayDispatches = 0;
let finalRevalidations = 0;
let failAfterHandoffRoute = null;
let requestSequence = 0;
const dispatchRoutes = [];
const gateway = {
  dispatchProtectedRequest(request) {
    gatewayDispatches += 1;
    dispatchRoutes.push(request.senderRoute);
    const upstream = request.transport();
    if (failAfterHandoffRoute === request.senderRoute) {
      failAfterHandoffRoute = null;
      return Promise.resolve(upstream).then(async response => {
        await response.arrayBuffer();
        throw new Error('FAKE_DISPATCH_FAILED_AFTER_HANDOFF');
      });
    }
    return upstream;
  },
  authorizeResponseWrite(requestId, write, options) {
    assert.equal(typeof requestId, 'string');
    if (options.final) finalRevalidations += 1;
    return write();
  },
};
const adapter = createSillyTavernFinalSendAdapter({
  gateway,
  resolveProtectedMemory: () => ({
    requestId: 'harness-request-' + (++requestSequence),
    model: 'fake-model',
    worldId: 'harness-world',
    actorId: 'harness-actor',
    purpose: 'npc_decision',
    sources: [{
      source_kind: 'canonical_entity',
      source_entity_id: 'harness-entity',
      source_version: 'v1',
    }],
    candidates: [{
      record_ref: 'harness-record',
      record_version: 'v1',
      authorization_generation: 1,
      source_kind: 'canonical_entity',
      source_entity_id: 'harness-entity',
      source_version: 'v1',
    }],
  }),
  chatCompletionSources: CHAT_COMPLETION_SOURCES,
  nativeForwardFetchResponse: stUtil.forwardFetchResponse,
});
const owner = 'logic-engine-extension:harness';
hook.registerLogicEngineFinalSendAdapter(adapter, owner);

const { router: chatCompletionsRouter } = await import(
  pathToFileURL(resolve(stRoot, 'src/endpoints/backends/chat-completions.js')).href,
);
const { router: textCompletionsRouter } = await import(
  pathToFileURL(resolve(stRoot, 'src/endpoints/backends/text-completions.js')).href,
);
const { router: koboldRouter } = await import(
  pathToFileURL(resolve(stRoot, 'src/endpoints/backends/kobold.js')).href,
);
const { router: novelAiRouter } = await import(
  pathToFileURL(resolve(stRoot, 'src/endpoints/novelai.js')).href,
);
const { router: hordeRouter } = await import(
  pathToFileURL(resolve(stRoot, 'src/endpoints/horde.js')).href,
);

test('all five pinned protected ST generation handlers use one Gateway handoff and final response gate', async (t) => {
  const manifest = JSON.parse(await readFile(resolve(process.cwd(),
    'host-adapter/patches/sillytavern-1.19.0-final-send.manifest.json'), 'utf8'));
  const packageJson = JSON.parse(await readFile(resolve(stRoot, 'package.json'), 'utf8'));
  assert.equal(manifest.host.commit, expectedSha);
  assert.equal(packageJson.version, manifest.host.version,
    'test must run against the exact SillyTavern release pinned by the manifest');

  const userRoot = await mkdtemp(join(process.cwd(), '.st-final-send-harness-user-'));
  await writeFile(join(userRoot, 'secrets.json'), JSON.stringify({
    api_key_novel: [{ id: 'harness-novel', value: 'harness-only-token', label: 'harness', active: true }],
  }));

  const express = requireFromST('express');
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    req.user = { directories: { root: userRoot } };
    next();
  });
  app.use('/api/backends/chat-completions', chatCompletionsRouter);
  app.use('/api/backends/text-completions', textCompletionsRouter);
  app.use('/api/backends/kobold', koboldRouter);
  app.use('/api/novelai', novelAiRouter);
  app.use('/api/horde', hordeRouter);
  const stHarnessServer = app.listen(0, '127.0.0.1');
  await once(stHarnessServer, 'listening');
  const stAddress = stHarnessServer.address();
  assert.ok(stAddress && typeof stAddress === 'object');

  t.after(async () => {
    try { hook.unregisterLogicEngineFinalSendAdapter(adapter, owner); } catch {}
    https.request = originalHttpsRequest;
    stHarnessServer.closeAllConnections?.();
    fakeProvider.closeAllConnections?.();
    await Promise.all([
      new Promise(resolveClose => stHarnessServer.close(resolveClose)),
      new Promise(resolveClose => fakeProvider.close(resolveClose)),
      rm(userRoot, { recursive: true, force: true }),
    ]);
    for (const [name, method] of Object.entries(originalConsoleMethods)) {
      console[name] = method;
    }
  });

  const base = 'http://127.0.0.1:' + stAddress.port;
  const provider = 'http://127.0.0.1:' + providerAddress.port;
  const requests = [
    {
      url: base + '/api/backends/chat-completions/generate',
      route: 'openai',
      body: {
        chat_completion_source: CHAT_COMPLETION_SOURCES.OPENAI,
        reverse_proxy: provider + '/v1',
        proxy_password: 'harness-only',
        model: 'fake-model',
        messages: [{ role: 'user', content: sentinel }],
        stream: false,
        temperature: 0,
        max_tokens: 8,
      },
      verify: data => data.choices?.[0]?.message?.content === 'chat-ok',
    },
    {
      url: base + '/api/backends/text-completions/generate',
      route: 'text-completions',
      body: {
        api_type: TEXTGEN_TYPES.GENERIC,
        api_server: provider,
        model: 'fake-model',
        prompt: sentinel,
        stream: false,
        max_tokens: 8,
      },
      verify: data => data.choices?.[0]?.text === 'text-completions-ok',
    },
    {
      url: base + '/api/backends/kobold/generate',
      route: 'kobold',
      body: {
        api_server: provider,
        prompt: sentinel,
        max_context_length: 2048,
        max_length: 8,
        gui_settings: false,
        streaming: false,
        can_abort: false,
      },
      verify: data => data.results?.[0]?.text === 'kobold-ok',
    },
    {
      url: base + '/api/novelai/generate',
      route: 'novelai-text',
      body: {
        model: 'clio',
        input: sentinel,
        max_length: 8,
        temperature: 0.7,
        streaming: false,
      },
      verify: data => data.output === 'novelai-ok',
    },
    {
      url: base + '/api/horde/generate-text',
      route: 'horde-text',
      body: { prompt: sentinel, params: { max_length: 8 } },
      verify: data => data.id === 'horde-fake-task',
    },
  ];

  for (const item of requests) {
    let response;
    try {
      response = await fetch(item.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(item.body),
      });
    } catch (error) {
      throw new Error(
        item.route + ' handler transport failed; providerRequests='
          + JSON.stringify(providerRequests) + '; gatewayDispatches=' + gatewayDispatches
          + '; cause=' + (error.cause?.code ?? error.cause?.message ?? error.message),
        { cause: error },
      );
    }
    assert.equal(response.status, 200, item.route + ' handler should return the fake provider response');
    assert.ok(item.verify(await response.json()), item.route + ' handler response shape');
  }

  assert.equal(providerRequests.length, 5, 'each protected route must make exactly one upstream request');
  assert.deepEqual(providerRequests.map(item => item.path), [
    '/v1/chat/completions',
    '/v1/completions',
    '/v1/generate',
    '/ai/generate',
    '/api/v2/generate/text/async',
  ]);
  assert.equal(gatewayDispatches, 5, 'each protected route must enter the shared Gateway exactly once');
  assert.deepEqual(dispatchRoutes, ['openai', 'text-completions', 'kobold', 'novelai-text', 'horde-text']);
  assert.equal(finalRevalidations, 5, 'every client response must pass final Gateway revalidation');
  assert.ok(suppressedDebugCalls > 0, 'the upstream request-body debug paths must be suppressed');
  assert.equal(
    JSON.stringify(loggedOutput).includes(sentinel),
    false,
    'prompt sentinel must not appear in captured non-debug console output',
  );

  // Kobold has a native retry loop. A terminal protected dispatch failure after
  // the one transport handoff must escape that loop rather than retry upstream.
  failAfterHandoffRoute = 'kobold';
  await assert.rejects(fetch(base + '/api/backends/kobold/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      api_server: provider,
      prompt: sentinel,
      max_context_length: 2048,
      max_length: 8,
      gui_settings: false,
      streaming: false,
      can_abort: false,
    }),
  }));
  assert.equal(providerRequests.length, 6, 'terminal Kobold failure must not retry the upstream call');
  assert.equal(gatewayDispatches, 6, 'failed protected dispatch must still be admitted only once');
  assert.equal(providerRequests[5].path, '/v1/generate');
});
