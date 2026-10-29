import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';

const stRoot = resolve(process.env.SILLYTAVERN_DIR ?? 'SillyTavern');
const expectedSha = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';

// Capture console output without forwarding it to CI. The pinned upstream
// handler has a console.debug path that serializes the request body, so debug
// output is suppressed and separately counted rather than retained as text.
let capturedDebugCalls = 0;
let debugMetadataSeen = false;
let promptSentinelInDebugOutput = false;
let promptSentinelInOtherOutput = false;
const containsPromptSentinel = value => {
  if (typeof value === 'string') return value.includes('HARNESS_SENTINEL_DO_NOT_LOG');
  if (Array.isArray(value)) return value.some(containsPromptSentinel);
  if (value && typeof value === 'object') return Object.values(value).some(containsPromptSentinel);
  return false;
};
const originalConsoleMethods = Object.fromEntries(
  ['debug', 'info', 'log', 'warn', 'error'].map(name => [name, console[name]]),
);
for (const name of Object.keys(originalConsoleMethods)) {
  console[name] = (...args) => {
    if (name === 'debug') {
      // Inspect only booleans and known metadata fields; never retain or print
      // raw console arguments or request content.
      capturedDebugCalls += 1;
      if (args.some(containsPromptSentinel)) promptSentinelInDebugOutput = true;
      const metadata = args.find(arg => arg && typeof arg === 'object' && !Array.isArray(arg));
      if (typeof args[0] === 'string' && args[0].includes('request metadata')
          && metadata?.model === 'fake-model' && metadata?.messageCount === 1) {
        debugMetadataSeen = true;
      }
      return;
    }
    if (args.some(containsPromptSentinel)) promptSentinelInOtherOutput = true;
    // Do not retain console text in the harness or forward it to CI.
  };
}

test('patched clearChat remains a UI unload and is not treated as persisted deletion', async () => {
  const script = await readFile(resolve(stRoot, 'public/script.js'), 'utf8');
  const start = script.indexOf('export async function clearChat({ clearData = false } = {}) {');
  assert.notEqual(start, -1, 'pinned clearChat entry point must exist');
  const end = script.indexOf('\n}', start);
  assert.ok(end > start, 'clearChat function boundary must exist');
  const body = script.slice(start, end);
  assert.doesNotMatch(body, /logicEngineHostLifecycle.*(?:guardOperation|beforeMutation)|guardOperation\(['"]clear-chat['"]/s,
    'clearChat unload must not be recorded as persisted deletion');
  assert.match(body, /cancelDebouncedChatSave\(\);/, 'clearChat should retain ordinary unload behavior');
});

const requireFromST = createRequire(resolve(stRoot, 'package.json'));
const express = requireFromST('express');
const stUtil = await import(pathToFileURL(resolve(stRoot, 'src/util.js')).href);
stUtil.setConfigFilePath(resolve(stRoot, 'default/config.yaml'));
const { router } = await import(pathToFileURL(resolve(stRoot, 'src/endpoints/backends/chat-completions.js')).href);
const { router: chatsRouter } = await import(pathToFileURL(resolve(stRoot, 'src/endpoints/chats.js')).href);
const { router: groupsRouter } = await import(pathToFileURL(resolve(stRoot, 'src/endpoints/groups.js')).href);
const { router: charactersRouter } = await import(pathToFileURL(resolve(stRoot, 'src/endpoints/characters.js')).href);
const { router: backupsRouter } = await import(pathToFileURL(resolve(stRoot, 'src/endpoints/backups.js')).href);
const { createHostLifecycleMutationMiddleware, getHostConversationInventory, recordHostCaptureAcknowledgement, registerHostConversation } = await import(pathToFileURL(resolve(stRoot, 'src/endpoints/logic-engine-host-journal.mjs')).href);
const { router: logicEngineLifecycleRouter } = await import(pathToFileURL(resolve(stRoot, 'src/endpoints/logic-engine-lifecycle.js')).href);

test('real pinned chat deletion route refuses an enrolled file before mutation', async (t) => {
  const { execFileSync } = await import('node:child_process');
  const actualSha = execFileSync('git', ['-C', stRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(actualSha, expectedSha, 'test must run against the exact pinned SillyTavern checkout');

  const root = await mkdtemp(join(os.tmpdir(), 'st-host-lifecycle-route-'));
  const directories = {
    chats: join(root, 'chats'),
    characters: join(root, 'characters'),
    groups: join(root, 'groups'),
    groupChats: join(root, 'group_chats'),
    backups: join(root, 'backups'),
  };
  await Promise.all(Object.values(directories).map(directory => mkdir(directory, { recursive: true })));
  const conversationUuid = randomUUID();
  const conversationId = randomUUID() + ':' + conversationUuid;
  const chatDirectory = join(directories.chats, 'character-a');
  await mkdir(chatDirectory, { recursive: true });
  const chatPath = join(chatDirectory, 'chat-a.jsonl');
  const persistedChat = JSON.stringify({ chat_metadata: { logic_engine_conversation_id: conversationUuid } }) + '\n';
  await writeFile(chatPath, persistedChat);
  const user = { profile: { handle: 'runtime-route-test' }, directories };
  await registerHostConversation({ user }, {
    conversationId,
    sourceLocator: 'chat-a',
    sourcePath: 'character-a/chat-a.jsonl',
    domain: 'chats',
  });

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use(createHostLifecycleMutationMiddleware({ requirePersistedInventory: true }));
  app.use('/api/chats', chatsRouter);
  app.use('/api/backups', backupsRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  t.after(async () => {
    await new Promise(resolveClose => server.close(resolveClose));
    await rm(root, { recursive: true, force: true });
  });

  const response = await fetch('http://127.0.0.1:' + address.port + '/api/chats/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ avatar_url: 'character-a.png', chatfile: 'chat-a.jsonl' }),
  });
  assert.equal(response.status, 409, 'Host guard must reject deletion before the pinned handler runs');
  assert.deepEqual(await response.json(), {
    error: { code: 'HOST_ENROLLED_HISTORY_PATH_MUTATION_UNSUPPORTED' },
  });
  assert.equal(await readFile(chatPath, 'utf8'), persistedChat, 'the enrolled source file must remain unchanged');
});

test('real pinned regular and group save routes consume one-shot capabilities before native writes', async (t) => {
  const { execFileSync } = await import('node:child_process');
  const actualSha = execFileSync('git', ['-C', stRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(actualSha, expectedSha, 'test must run against the exact pinned SillyTavern checkout');

  const root = await mkdtemp(join(os.tmpdir(), 'st-host-save-capability-'));
  const directories = {
    chats: join(root, 'chats'),
    characters: join(root, 'characters'),
    groups: join(root, 'groups'),
    groupChats: join(root, 'group_chats'),
    backups: join(root, 'backups'),
  };
  await Promise.all(Object.values(directories).map(directory => mkdir(directory, { recursive: true })));
  await writeFile(join(directories.characters, 'character-a.png'), 'test avatar');
  const regularDirectory = join(directories.chats, 'character-a');
  await mkdir(regularDirectory, { recursive: true });

  const user = { profile: { handle: 'runtime-save-capability-test' }, directories };
  const regularUuid = randomUUID();
  const groupUuid = randomUUID();
  const regularConversationId = randomUUID() + ':' + regularUuid;
  const groupConversationId = randomUUID() + ':' + groupUuid;
  const regularMessageId = randomUUID();
  const regularV1 = randomUUID();
  const regularV2 = randomUUID();
  const groupMessageId = randomUUID();
  const groupV1 = randomUUID();
  const groupV2 = randomUUID();
  const groupV3 = randomUUID();
  const hostDigest = value => createHash('sha256').update(JSON.stringify(String(value))).digest('hex');
  const makeMessage = (messageId, versions, activeIndex) => ({
    mes: versions[activeIndex].text,
    swipes: versions.map(version => version.text),
    swipe_id: activeIndex,
    _logicEngineLifecycle: {
      messageId,
      activeVersionIndex: activeIndex,
      versions: versions.map(version => ({
        versionId: version.versionId,
        payloadDigest: hostDigest(version.text),
        parentVersionId: version.parentVersionId ?? null,
      })),
    },
  });
  const regularHeader = {
    chat_metadata: { logic_engine_conversation_id: regularUuid },
    user_name: 'unused',
    character_name: 'unused',
  };
  const groupHeader = {
    chat_metadata: { logic_engine_conversation_id: groupUuid },
    user_name: 'unused',
    character_name: 'unused',
  };
  const regularV1Text = 'regular-before';
  const regularV2Text = 'regular-after';
  const groupV1Text = 'group-old';
  const groupV2Text = 'group-active';
  const groupV3Text = 'group-new-swipe';
  const regularInitial = [
    regularHeader,
    makeMessage(regularMessageId, [
      { versionId: regularV1, text: regularV1Text },
      { versionId: regularV2, text: regularV2Text, parentVersionId: regularV1 },
    ], 0),
  ];
  const regularSelected = [
    regularHeader,
    makeMessage(regularMessageId, [
      { versionId: regularV1, text: regularV1Text },
      { versionId: regularV2, text: regularV2Text, parentVersionId: regularV1 },
    ], 1),
  ];
  const groupInitial = [
    groupHeader,
    makeMessage(groupMessageId, [
      { versionId: groupV1, text: groupV1Text },
      { versionId: groupV2, text: groupV2Text, parentVersionId: groupV1 },
    ], 1),
  ];
  const groupAppend = [
    groupHeader,
    makeMessage(groupMessageId, [
      { versionId: groupV1, text: groupV1Text },
      { versionId: groupV2, text: groupV2Text, parentVersionId: groupV1 },
      { versionId: groupV3, text: groupV3Text, parentVersionId: groupV2 },
    ], 2),
  ];
  const regularPath = join(regularDirectory, 'chat-a.jsonl');
  const groupPath = join(directories.groupChats, 'group-a.jsonl');
  const writeJsonl = (file, records) => writeFile(file, records.map(record => JSON.stringify(record)).join('\n'));
  await writeJsonl(regularPath, regularInitial);
  await writeJsonl(groupPath, groupInitial);

  const enrollmentRequest = { user };
  await registerHostConversation(enrollmentRequest, {
    conversationId: regularConversationId, sourceLocator: 'chat-a',
    sourcePath: 'character-a/chat-a.jsonl', domain: 'chats',
  });
  await registerHostConversation(enrollmentRequest, {
    conversationId: groupConversationId, sourceLocator: 'group-a',
    sourcePath: 'group-a.jsonl', domain: 'group_chats',
  });
  const acknowledge = (conversationId, messageId, versionId, text, { parentVersionId = null, active, deleted = false }) =>
    recordHostCaptureAcknowledgement(enrollmentRequest, {
      conversation_id: conversationId, message_id: messageId, version_id: versionId,
      parent_version_id: parentVersionId, content_sha256: hostDigest(text), active, deleted,
    });
  await acknowledge(regularConversationId, regularMessageId, regularV1, regularV1Text, { active: true });
  await acknowledge(regularConversationId, regularMessageId, regularV2, regularV2Text, { parentVersionId: regularV1, active: false });
  await acknowledge(groupConversationId, groupMessageId, groupV1, groupV1Text, { active: false });
  await acknowledge(groupConversationId, groupMessageId, groupV2, groupV2Text, { parentVersionId: groupV1, active: true });
  const initialInventory = await getHostConversationInventory(enrollmentRequest);
  assert.equal(initialInventory.complete, true, JSON.stringify({
    status: initialInventory.status,
    errors: initialInventory.errors,
    mutationJournal: initialInventory.mutationJournal,
  }));

  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use((req, _res, next) => {
    req.user = user;
    req.sessionID = 'runtime-save-session';
    next();
  });
  app.use(createHostLifecycleMutationMiddleware({ requirePersistedInventory: true }));
  app.use('/api/logic-engine', logicEngineLifecycleRouter);
  app.use('/api/chats', chatsRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  t.after(async () => {
    await new Promise(resolveClose => server.close(resolveClose));
    await rm(root, { recursive: true, force: true });
  });

  // Import APIs are separate direct-server mutation paths. Prove the real pinned routers
  // reject both before they can replace an enrolled regular or group-chat history.
  const regularBytesBeforeImport = await readFile(regularPath, 'utf8');
  const groupBytesBeforeImport = await readFile(groupPath, 'utf8');
  for (const route of ['/api/chats/import', '/api/chats/group/import', '/api/backups/chat/delete']) {
    const importResponse = await fetch('http://127.0.0.1:' + address.port + route, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(importResponse.status, 409, route + ' must fail closed before the native import handler');
    assert.deepEqual(await importResponse.json(), {
      error: { code: 'HOST_ENROLLED_HISTORY_PATH_MUTATION_UNSUPPORTED' },
    });
    assert.equal(await readFile(regularPath, 'utf8'), regularBytesBeforeImport,
      route + ' must not change enrolled regular-chat bytes');
    assert.equal(await readFile(groupPath, 'utf8'), groupBytesBeforeImport,
      route + ' must not change enrolled group-chat bytes');
  }

  const regularPayload = {
    ch_name: 'Character A', file_name: 'chat-a', chat: regularSelected,
    avatar_url: 'character-a.png', force: false,
  };
  const beforeRegular = await readFile(regularPath, 'utf8');
  const deniedRegular = await fetch('http://127.0.0.1:' + address.port + '/api/chats/save', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(regularPayload),
  });
  assert.equal(deniedRegular.status, 409, 'an enrolled native save without a capability must be rejected before write');
  assert.match(JSON.stringify(await deniedRegular.json()), /HOST_ENROLLED_HISTORY_SAVE_CAPABILITY_REQUIRED/);
  assert.equal(await readFile(regularPath, 'utf8'), beforeRegular);

  const prepareRegular = await fetch('http://127.0.0.1:' + address.port + '/api/logic-engine/host-lifecycle/save-capability/prepare', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ route: '/api/chats/save', payload: regularPayload }),
  });
  assert.equal(prepareRegular.status, 200);
  const regularCapability = await prepareRegular.json();
  assert.equal(regularCapability.status, 'CAPABILITY_ISSUED');
  assert.equal(typeof regularCapability.token, 'string');
  const regularSave = await fetch('http://127.0.0.1:' + address.port + '/api/chats/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-logic-engine-save-capability': regularCapability.token },
    body: JSON.stringify(regularPayload),
  });
  assert.equal(regularSave.status, 200, 'pinned native regular save should consume a valid capability');
  assert.deepEqual(await regularSave.json(), { ok: true });
  await acknowledge(regularConversationId, regularMessageId, regularV1, regularV1Text, { active: false });
  await acknowledge(regularConversationId, regularMessageId, regularV2, regularV2Text, { parentVersionId: regularV1, active: true });
  assert.equal((await getHostConversationInventory(enrollmentRequest)).complete, true);

  const groupPayload = { id: 'group-a', chat: groupAppend, force: false };
  const prepareGroup = await fetch('http://127.0.0.1:' + address.port + '/api/logic-engine/host-lifecycle/save-capability/prepare', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ route: '/api/chats/group/save', payload: groupPayload }),
  });
  assert.equal(prepareGroup.status, 200);
  const groupCapability = await prepareGroup.json();
  assert.equal(groupCapability.status, 'CAPABILITY_ISSUED');
  const groupSave = await fetch('http://127.0.0.1:' + address.port + '/api/chats/group/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-logic-engine-save-capability': groupCapability.token },
    body: JSON.stringify(groupPayload),
  });
  assert.equal(groupSave.status, 200, 'pinned native group save should consume a valid capability');
  await groupSave.json();
  await acknowledge(groupConversationId, groupMessageId, groupV2, groupV2Text, { parentVersionId: groupV1, active: false });
  await acknowledge(groupConversationId, groupMessageId, groupV3, groupV3Text, { parentVersionId: groupV2, active: true });
  const finalInventory = await getHostConversationInventory(enrollmentRequest);
  assert.equal(finalInventory.complete, true);
  assert.equal(finalInventory.currentVersionCount, 5);

  const journal = await readFile(join(root, '.logic-engine-host', 'mutation-ledger.jsonl'), 'utf8');
  assert.doesNotMatch(journal, /regular-before|regular-after|group-old|group-active|group-new-swipe/);
});

test('real pinned server Chat Completions handler reaches a recording fake provider exactly once', async (t) => {
  const { execFileSync } = await import('node:child_process');
  const actualSha = execFileSync('git', ['-C', stRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(actualSha, expectedSha, 'test must run against the exact pinned SillyTavern checkout');

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
        candidates: [{ content: { parts: [{ text: 'harness-ok' }] } }],
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
      chat_completion_source: 'makersuite',
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
  assert.deepEqual(arrivals, [{ method: 'POST', path: '/v1/v1beta/models/fake-model:generateContent?key=test-only-not-a-real-secret' }]);
  assert.equal(JSON.stringify(arrivals).includes('HARNESS_SENTINEL_DO_NOT_LOG'), false);
  assert.ok(capturedDebugCalls > 0, 'the handler should emit debug diagnostics');
  assert.ok(debugMetadataSeen, 'the debug diagnostic should expose known metadata fields only');
  assert.equal(promptSentinelInDebugOutput, false, 'request-body sentinel must not reach debug output');
  assert.equal(promptSentinelInOtherOutput, false, 'request-body sentinel must not reach other console output');
});


test('real pinned server OpenAI Chat Completions handler reaches a recording fake provider exactly once', async (t) => {
  const { execFileSync } = await import('node:child_process');
  const actualSha = execFileSync('git', ['-C', stRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(actualSha, expectedSha, 'test must run against the exact pinned SillyTavern checkout');

  let requestCount = 0;
  const arrivals = [];
  const fakeProvider = requireFromST('node:http').createServer((req, res) => {
    requestCount += 1;
    arrivals.push({ method: req.method, path: req.url });
    req.resume();
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

  const savedConsole = Object.fromEntries(
    ['debug', 'info', 'log', 'warn', 'error'].map(name => [name, console[name]]),
  );
  let promptSentinelObserved = false;
  const containsSentinel = value => {
    if (typeof value === 'string') return value.includes('HARNESS_SENTINEL_DO_NOT_LOG');
    if (Array.isArray(value)) return value.some(containsSentinel);
    if (value && typeof value === 'object') return Object.values(value).some(containsSentinel);
    return false;
  };
  for (const name of Object.keys(savedConsole)) {
    console[name] = (...args) => {
      // The mainline probe suppresses debug output because the pinned upstream
      // handler may serialize request bodies there. This assertion covers only
      // non-debug output and never stores console text.
      if (name === 'debug') return;
      if (args.some(containsSentinel)) promptSentinelObserved = true;
    };
  }

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
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  t.after(async () => {
    await Promise.all([
      new Promise(resolveClose => server.close(resolveClose)),
      new Promise(resolveClose => fakeProvider.close(resolveClose)),
    ]);
    for (const [name, method] of Object.entries(savedConsole)) console[name] = method;
  });

  const response = await fetch(`http://127.0.0.1:${address.port}/api/backends/chat-completions/generate`, {
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

  assert.equal(response.status, 200, 'the pinned OpenAI handler should return the fake provider response');
  const responseJson = await response.json();
  assert.equal(responseJson.choices?.[0]?.message?.content, 'harness-ok');
  assert.equal(requestCount, 1, 'exactly one outbound request should arrive at the fake provider');
  assert.deepEqual(arrivals, [{ method: 'POST', path: '/v1/chat/completions' }]);
  assert.equal(promptSentinelObserved, false, 'prompt sentinel must not appear in console output');
});


test('real pinned group deletion route refuses to cascade-delete any enrolled group chat', async (t) => {
  const { execFileSync } = await import('node:child_process');
  const actualSha = execFileSync('git', ['-C', stRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(actualSha, expectedSha, 'test must run against the exact pinned SillyTavern checkout');

  const root = await mkdtemp(join(os.tmpdir(), 'st-host-group-delete-'));
  const directories = {
    chats: join(root, 'chats'),
    characters: join(root, 'characters'),
    groups: join(root, 'groups'),
    groupChats: join(root, 'group_chats'),
    backups: join(root, 'backups'),
  };
  await Promise.all(Object.values(directories).map(directory => mkdir(directory, { recursive: true })));

  const groupId = 'group-a';
  const groupChatId = 'group-chat-a';
  const conversationUuid = randomUUID();
  const conversationId = randomUUID() + ':' + conversationUuid;
  const groupMetadataPath = join(directories.groups, groupId + '.json');
  const groupChatPath = join(directories.groupChats, groupChatId + '.jsonl');
  const groupMetadata = JSON.stringify({ id: groupId, name: 'Test group', chats: [groupChatId] }, null, 2);
  const persistedGroupChat = JSON.stringify({ chat_metadata: { logic_engine_conversation_id: conversationUuid } }) + '\n';
  await writeFile(groupMetadataPath, groupMetadata);
  await writeFile(groupChatPath, persistedGroupChat);

  const user = { profile: { handle: 'runtime-group-delete-test' }, directories };
  await registerHostConversation({ user }, {
    conversationId,
    sourceLocator: groupChatId,
    sourcePath: groupChatId + '.jsonl',
    domain: 'group_chats',
  });

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use(createHostLifecycleMutationMiddleware({ requirePersistedInventory: true }));
  app.use('/api/groups', groupsRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  t.after(async () => {
    await new Promise(resolveClose => server.close(resolveClose));
    await rm(root, { recursive: true, force: true });
  });

  const response = await fetch('http://127.0.0.1:' + address.port + '/api/groups/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: groupId }),
  });
  assert.equal(response.status, 409, 'Host guard must reject cascade deletion before the pinned handler runs');
  assert.deepEqual(await response.json(), {
    error: { code: 'HOST_ENROLLED_HISTORY_PATH_MUTATION_UNSUPPORTED' },
  });
  assert.equal(await readFile(groupMetadataPath, 'utf8'), groupMetadata, 'group metadata must remain unchanged');
  assert.equal(await readFile(groupChatPath, 'utf8'), persistedGroupChat, 'enrolled group-chat bytes must remain unchanged');
});


test('real pinned character deletion cannot bypass the Host guard with string delete_chats', async (t) => {
  const { execFileSync } = await import('node:child_process');
  const actualSha = execFileSync('git', ['-C', stRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(actualSha, expectedSha, 'test must run against the exact pinned SillyTavern checkout');

  const root = await mkdtemp(join(os.tmpdir(), 'st-host-character-delete-'));
  const directories = {
    chats: join(root, 'chats'),
    characters: join(root, 'characters'),
    groups: join(root, 'groups'),
    groupChats: join(root, 'group_chats'),
    backups: join(root, 'backups'),
  };
  await Promise.all(Object.values(directories).map(directory => mkdir(directory, { recursive: true })));

  const avatarPath = join(directories.characters, 'character-a.png');
  const chatDirectory = join(directories.chats, 'character-a');
  await mkdir(chatDirectory, { recursive: true });
  const chatPath = join(chatDirectory, 'chat-a.jsonl');
  const avatarBytes = 'character fixture bytes';
  const conversationUuid = randomUUID();
  const conversationId = randomUUID() + ':' + conversationUuid;
  const persistedChat = JSON.stringify({ chat_metadata: { logic_engine_conversation_id: conversationUuid } }) + '\n';
  await writeFile(avatarPath, avatarBytes);
  await writeFile(chatPath, persistedChat);

  const user = { profile: { handle: 'runtime-character-delete-test' }, directories };
  await registerHostConversation({ user }, {
    conversationId,
    sourceLocator: 'chat-a',
    sourcePath: 'character-a/chat-a.jsonl',
    domain: 'chats',
  });

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use(createHostLifecycleMutationMiddleware({ requirePersistedInventory: true }));
  app.use('/api/characters', charactersRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  t.after(async () => {
    await new Promise(resolveClose => server.close(resolveClose));
    await rm(root, { recursive: true, force: true });
  });

  // The pinned native handler uses loose equality to true; a string "1" can
  // request recursive chat-folder deletion. The Host boundary blocks all
  // deletes of a character that owns an enrolled history, independent of flag.
  const response = await fetch('http://127.0.0.1:' + address.port + '/api/characters/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ avatar_url: 'character-a.png', delete_chats: '1' }),
  });
  assert.equal(response.status, 409, 'Host guard must reject character deletion before the pinned handler runs');
  assert.deepEqual(await response.json(), {
    error: { code: 'HOST_ENROLLED_HISTORY_PATH_MUTATION_UNSUPPORTED' },
  });
  assert.equal(await readFile(avatarPath, 'utf8'), avatarBytes, 'character file must remain unchanged');
  assert.equal(await readFile(chatPath, 'utf8'), persistedChat, 'enrolled chat bytes must remain unchanged');
});


test('real pinned direct import routes fail closed when enrolled source histories exist', async (t) => {
  const { execFileSync } = await import('node:child_process');
  const actualSha = execFileSync('git', ['-C', stRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(actualSha, expectedSha, 'test must run against the exact pinned SillyTavern checkout');

  const root = await mkdtemp(join(os.tmpdir(), 'st-host-import-routes-'));
  const directories = {
    chats: join(root, 'chats'),
    characters: join(root, 'characters'),
    groups: join(root, 'groups'),
    groupChats: join(root, 'group_chats'),
    backups: join(root, 'backups'),
  };
  await Promise.all(Object.values(directories).map(directory => mkdir(directory, { recursive: true })));

  const regularUuid = randomUUID();
  const groupUuid = randomUUID();
  const regularConversationId = randomUUID() + ':' + regularUuid;
  const groupConversationId = randomUUID() + ':' + groupUuid;
  const regularPath = join(directories.chats, 'regular-enrolled.jsonl');
  const groupPath = join(directories.groupChats, 'group-enrolled.jsonl');
  const regularBytes = JSON.stringify({ chat_metadata: { logic_engine_conversation_id: regularUuid } }) + '\n';
  const groupBytes = JSON.stringify({ chat_metadata: { logic_engine_conversation_id: groupUuid } }) + '\n';
  await writeFile(regularPath, regularBytes);
  await writeFile(groupPath, groupBytes);

  const user = { profile: { handle: 'runtime-import-route-test' }, directories };
  await registerHostConversation({ user }, {
    conversationId: regularConversationId,
    sourceLocator: 'regular-enrolled',
    sourcePath: 'regular-enrolled.jsonl',
    domain: 'chats',
  });
  await registerHostConversation({ user }, {
    conversationId: groupConversationId,
    sourceLocator: 'group-enrolled',
    sourcePath: 'group-enrolled.jsonl',
    domain: 'group_chats',
  });

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use(createHostLifecycleMutationMiddleware({ requirePersistedInventory: true }));
  app.use('/api/chats', chatsRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  t.after(async () => {
    await new Promise(resolveClose => server.close(resolveClose));
    await rm(root, { recursive: true, force: true });
  });

  for (const route of ['/api/chats/import', '/api/chats/group/import']) {
    const response = await fetch('http://127.0.0.1:' + address.port + route, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 409, route + ' must be rejected by server middleware before the native import handler');
    assert.deepEqual(await response.json(), {
      error: { code: 'HOST_ENROLLED_HISTORY_PATH_MUTATION_UNSUPPORTED' },
    });
  }

  assert.equal(await readFile(regularPath, 'utf8'), regularBytes, 'regular enrolled history must remain unchanged');
  assert.equal(await readFile(groupPath, 'utf8'), groupBytes, 'group enrolled history must remain unchanged');
});
