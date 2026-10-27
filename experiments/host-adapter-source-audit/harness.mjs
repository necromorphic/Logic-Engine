import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.env.SILLYTAVERN_DIR ?? resolve(process.cwd(), 'SillyTavern');
const targetSha = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';

const [events, script] = await Promise.all([
  readFile(resolve(root, 'public/scripts/events.js'), 'utf8'),
  readFile(resolve(root, 'public/script.js'), 'utf8'),
]);

test('audit input is the exact pinned SillyTavern commit', async () => {
  const { execFileSync } = await import('node:child_process');
  const actual = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(actual, targetSha, 'Do not run this audit against an unpinned or different checkout');
});

test('pinned event catalog declares lifecycle hooks under audit', () => {
  for (const name of [
    'MESSAGE_SENT', 'MESSAGE_RECEIVED', 'MESSAGE_EDITED', 'MESSAGE_UPDATED',
    'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'MESSAGE_SWIPE_DELETED',
    'GENERATION_STARTED', 'GENERATION_STOPPED', 'GENERATION_ENDED',
    'CHAT_CHANGED', 'CHAT_LOADED', 'USER_MESSAGE_RENDERED', 'CHARACTER_MESSAGE_RENDERED',
  ]) {
    assert.match(events, new RegExp('\\b' + name + ':'));
  }
});

test('user send emits MESSAGE_SENT after save and before render notification', () => {
  const start = script.indexOf('async function sendMessageAsUser(');
  assert.notEqual(start, -1, 'sendMessageAsUser source site must exist');
  const end = script.indexOf('Gets the maximum context token limit', start);
  assert.notEqual(end, -1, 'sendMessageAsUser end boundary must exist');
  const body = script.slice(start, end);
  const save = body.indexOf('await saveChatConditional();');
  const sent = body.indexOf('await eventSource.emit(event_types.MESSAGE_SENT,');
  const rendered = body.indexOf('await eventSource.emit(event_types.USER_MESSAGE_RENDERED,');
  assert.ok(save >= 0 && sent > save && rendered > sent, 'expected save → MESSAGE_SENT → USER_MESSAGE_RENDERED');
  assert.match(body, /event_types\.MESSAGE_SENT,\s*(?:insertAt|chat_id)\s*\)/);
});

test('generated-message receive event is emitted during finalization before finish handler saves', () => {
  const finalizerStart = script.indexOf('async finalizeIntermediaryMessage(');
  const finishStart = script.indexOf('async onFinishStreaming(', finalizerStart);
  const errorStart = script.indexOf('onErrorStreaming()', finishStart);
  assert.ok(finalizerStart >= 0 && finishStart > finalizerStart && errorStart > finishStart);
  const finalizer = script.slice(finalizerStart, finishStart);
  const finish = script.slice(finishStart, errorStart);
  assert.match(finalizer, /eventSource\.emit\(event_types\.MESSAGE_RECEIVED,\s*this\.messageId,\s*this\.type\)/);
  const finalizeCall = finish.indexOf('this.finalizeIntermediaryMessage(');
  const saveCall = finish.indexOf('await saveChatConditional();');
  assert.ok(finalizeCall >= 0 && saveCall > finalizeCall, 'MESSAGE_RECEIVED finalization precedes the save call');
});

test('delete notification carries chat.length rather than a durable deleted-message identity', () => {
  assert.match(script, /chat\.length\s*=\s*chat\.length\s*-\s*1;[\s\S]{0,240}event_types\.MESSAGE_DELETED,\s*chat\.length/);
});

test('swipe notification carries the host-local message index', () => {
  assert.match(script, /event_types\.MESSAGE_SWIPED,\s*\(mesId\)/);
});

test('edit/update notifications use the current host-local edit index', () => {
  assert.match(script, /event_types\.MESSAGE_EDITED,\s*this_edit_mes_id/);
  assert.match(script, /event_types\.MESSAGE_UPDATED,\s*this_edit_mes_id/);
});


test('server-side Host mutation middleware covers pinned direct API routes for enrolled users', async () => {
  const chatsRoutes = await readFile(resolve(root, 'src/endpoints/chats.js'), 'utf8');
  const backupRoutes = await readFile(resolve(root, 'src/endpoints/backups.js'), 'utf8');
  const groupRoutes = await readFile(resolve(root, 'src/endpoints/groups.js'), 'utf8');
  const dataMaidRoutes = await readFile(resolve(root, 'src/endpoints/data-maid.js'), 'utf8');
  const characterRoutes = await readFile(resolve(root, 'src/endpoints/characters.js'), 'utf8');
  const startup = await readFile(resolve(root, 'src/server-startup.js'), 'utf8');
  const serverMain = await readFile(resolve(root, 'src/server-main.js'), 'utf8');
  const hostJournal = await readFile(resolve(root, 'src/endpoints/logic-engine-host-journal.mjs'), 'utf8');
  const lifecycleRoutes = await readFile(resolve(root, 'src/endpoints/logic-engine-lifecycle.js'), 'utf8');

  for (const route of [
    "router.post('/save'", "router.post('/rename'", "router.post('/delete'",
    "router.post('/group/import'", "router.post('/import'",
    "router.post('/group/delete'", "router.post('/group/save'",
  ]) assert.ok(chatsRoutes.includes(route), `pinned chat mutation route must be reviewed: ${route}`);
  assert.ok(backupRoutes.includes("router.post('/chat/delete'"), 'backup deletion route must be covered');
  for (const route of ["router.post('/create'", "router.post('/edit'", "router.post('/delete'"]) {
    assert.ok(groupRoutes.includes(route), `pinned group mutation route must be covered: ${route}`);
  }
  assert.ok(dataMaidRoutes.includes("router.post('/delete'"), 'Data Maid deletion route must be covered');
  for (const route of ["router.post('/rename'", "router.post('/delete'", "router.post('/import'", "router.post('/duplicate'"]) {
    assert.ok(characterRoutes.includes(route), `pinned character mutation route must be covered: ${route}`);
  }

  assert.match(startup, /app\.use\(createHostLifecycleMutationMiddleware\((?:\{[^}]*\})?\)\);[\s\S]*?app\.use\('\/', userDataRouter\)/);
  assert.ok(serverMain.indexOf('app.use(setUserDataMiddleware);') >= 0 && serverMain.indexOf('app.use(setUserDataMiddleware);') < serverMain.indexOf('setupPrivateEndpoints(app);'), 'global user binding must precede private endpoint registration');
  assert.ok(serverMain.indexOf('app.use(requireLoginMiddleware);') >= 0 && serverMain.indexOf('app.use(requireLoginMiddleware);') < serverMain.indexOf('setupPrivateEndpoints(app);'), 'global login guard must precede private endpoint registration');
  assert.match(startup, /createHostLifecycleMutationMiddleware/);
  assert.match(
    startup,
    /createHostLifecycleMutationMiddleware\\(\\{\\s*requirePersistedInventory:\\s*true,\\s*requireCoreInventory:\\s*true\\s*\\}\\)/,
    'the pinned Host startup must require both persisted-save receipts and independent Core inventory',
  );
  for (const route of [
    "'POST /api/chats/save'", "'POST /api/chats/rename'", "'POST /api/chats/delete'",
    "'POST /api/chats/group/import'", "'POST /api/chats/import'",
    "'POST /api/chats/group/delete'", "'POST /api/chats/group/save'",
    "'POST /api/groups/create'", "'POST /api/groups/edit'", "'POST /api/groups/delete'",
    "'POST /api/characters/rename'", "'POST /api/characters/delete'",
    "'POST /api/characters/import'", "'POST /api/characters/duplicate'",
    "'POST /api/backups/chat/delete'", "'POST /api/data-maid/delete'",
  ]) assert.ok(hostJournal.includes(route), `Host journal must intercept direct route ${route}`);

  assert.match(hostJournal, /kind: 'intent'/);
  assert.match(hostJournal, /kind: 'outcome'/);
  assert.match(hostJournal, /await handle\.sync\(\)/);
  assert.match(hostJournal, /HOST_JOURNAL_RECONCILIATION_REQUIRED/);
  assert.match(hostJournal, /HOST_OPERATION_ALREADY_RECORDED/);
  assert.match(hostJournal, /beforeArtifacts:/);
  assert.match(hostJournal, /UNCERTAINTY_ACKNOWLEDGED/);
  assert.match(hostJournal, /HOST_POST_MUTATION_SCAN_INCOMPLETE/);
  assert.match(lifecycleRoutes, /registerHostConversation/);
  assert.match(lifecycleRoutes, /host-lifecycle\/enroll/);
  assert.match(lifecycleRoutes, /host-lifecycle\/status/);
  assert.match(lifecycleRoutes, /host-lifecycle\/reconcile/);
});

test('server-side Core digest proxy exists and never exposes its credentials to browser code', async () => {
  const proxyPath = resolve(root, 'src/endpoints/logic-engine-lifecycle-proxy.mjs');
  const { createHostDigestProxyHandler } = await import(pathToFileURL(proxyPath).href);
  assert.equal(typeof createHostDigestProxyHandler, 'function');
  const proxySource = await readFile(proxyPath, 'utf8');
  assert.match(proxySource, /authorization:\s*'Bearer '\s*\+\s*target\.apiToken/);
  assert.match(proxySource, /'x-adapter-token':\s*target\.adapterToken/);
  assert.match(proxySource, /redirect:\s*'error'/);
  assert.doesNotMatch(script, /LOGIC_ENGINE_(?:API_TOKEN|ADAPTER_TOKEN)/);
});

test('Core digest proxy sends only allowlisted digests to a fixed configured endpoint', async () => {
  const { createHostDigestProxyHandler } = await import(pathToFileURL(
    resolve(root, 'src/endpoints/logic-engine-lifecycle-proxy.mjs'),
  ).href);
  const env = {
    LOGIC_ENGINE_CORE_URL: 'https://logic-engine-pc.example:8787',
    LOGIC_ENGINE_API_TOKEN: 'a'.repeat(24),
    LOGIC_ENGINE_ADAPTER_ID: 'st-desktop',
    LOGIC_ENGINE_ADAPTER_TOKEN: 'b'.repeat(24),
  };
  const calls = [];
  const handler = createHostDigestProxyHandler({
    env,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 201, json: async () => ({ capture: { status: 'captured' } }) };
    },
  });
  const response = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  const entry = {
    conversation_id: 'conversation-1',
    message_id: 'message-1',
    version_id: 'version-1',
    content_sha256: 'c'.repeat(64),
    active: true,
    deleted: false,
  };
  await handler({ body: entry }, response);
  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.body, { ok: true, inventory_status: 'NON_READY' });
  assert.equal(calls.length, 1);
  assert.equal(String(calls[0].url), 'https://logic-engine-pc.example:8787/v1/host-version-ledger/capture');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.headers.authorization, 'Bearer ' + env.LOGIC_ENGINE_API_TOKEN);
  assert.equal(calls[0].options.headers['x-adapter-id'], env.LOGIC_ENGINE_ADAPTER_ID);
  assert.equal(calls[0].options.headers['x-adapter-token'], env.LOGIC_ENGINE_ADAPTER_TOKEN);
  assert.deepEqual(JSON.parse(calls[0].options.body), entry);
  assert.doesNotMatch(calls[0].options.body, /raw|text_body|message_body/i);
});

test('Core digest proxy rejects caller-supplied authority and hides upstream diagnostics', async () => {
  const { createHostDigestProxyHandler } = await import(pathToFileURL(
    resolve(root, 'src/endpoints/logic-engine-lifecycle-proxy.mjs'),
  ).href);
  const env = {
    LOGIC_ENGINE_CORE_URL: 'http://127.0.0.1:8787',
    LOGIC_ENGINE_API_TOKEN: 'a'.repeat(24),
    LOGIC_ENGINE_ADAPTER_ID: 'st-desktop',
    LOGIC_ENGINE_ADAPTER_TOKEN: 'b'.repeat(24),
  };
  let calls = 0;
  const handler = createHostDigestProxyHandler({
    env,
    fetchImpl: async () => { calls++; return { ok: false, status: 403, json: async () => ({ message: 'sensitive upstream detail' }) }; },
  });
  const makeResponse = () => ({
    statusCode: null, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  });
  const invalid = makeResponse();
  await handler({ body: {
    conversation_id: 'conversation-1', message_id: 'message-1', version_id: 'version-1',
    content_sha256: 'c'.repeat(64), active: true, deleted: false, world_id: 'caller-controlled',
  } }, invalid);
  assert.equal(invalid.statusCode, 400);
  assert.equal(calls, 0);

  const rejected = makeResponse();
  await handler({ body: {
    conversation_id: 'conversation-1', message_id: 'message-1', version_id: 'version-1',
    content_sha256: 'c'.repeat(64), active: true, deleted: false,
  } }, rejected);
  assert.equal(rejected.statusCode, 403);
  assert.deepEqual(rejected.body, { error: { code: 'LOGIC_ENGINE_CAPTURE_REJECTED', message: 'Logic-Engine did not accept the digest capture.' } });
  assert.doesNotMatch(JSON.stringify(rejected.body), /sensitive upstream detail/);
});


test('server-side inventory endpoint is digest-only and never reports historical completeness', async () => {
  const lifecycleRoutes = await readFile(resolve(root, 'src/endpoints/logic-engine-lifecycle.js'), 'utf8');
  const inventoryScanner = await readFile(resolve(root, 'src/endpoints/logic-engine-host-inventory.mjs'), 'utf8');
  assert.match(lifecycleRoutes, /router\.post\('\/host-artifact-inventory\/scan'/);
  assert.match(lifecycleRoutes, /request\.user\?\.directories\?\.chats/);
  assert.match(lifecycleRoutes, /request\.user\?\.directories\?\.groups/);
  assert.match(lifecycleRoutes, /request\.user\?\.directories\?\.groupChats/);
  assert.match(lifecycleRoutes, /request\.user\?\.directories\?\.backups/);
  assert.match(lifecycleRoutes, /historicalCompleteness:\s*'UNKNOWN'/);
  assert.match(inventoryScanner, /createHash\('sha256'\)/);
  assert.match(inventoryScanner, /historicalCompleteness:\s*'UNKNOWN'/);
  assert.match(inventoryScanner, /authority:\s*'NON_AUTHORITATIVE'/);
  assert.match(inventoryScanner, /INVENTORY_INCOMPLETE/);
  assert.doesNotMatch(inventoryScanner, /response\.send\(|response\.download\(/);
});
