import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { createHostLifecycleMutationMiddleware, prepareHostSaveCapability, recordHostCaptureAcknowledgement, registerHostConversation, verifyEnrolledChatSavePersistence } from '../server-lifecycle-mutation-journal.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(String(value))).digest('hex');
const message = ({ messageId, versions, activeVersionIndex }) => ({
  mes: versions[activeVersionIndex].text,
  swipes: versions.map(version => version.text),
  swipe_id: activeVersionIndex,
  _logicEngineLifecycle: {
    messageId,
    activeVersionIndex,
    versions: versions.map(version => ({
      versionId: version.versionId,
      payloadDigest: digest(version.text),
      parentVersionId: version.parentVersionId ?? null,
    })),
  },
});

async function authorizeSave(request, conversationId, messageId, versionId, text, route = '/api/chats/save') {
  request.sessionID = 'save-receipt-test-session';
  await recordHostCaptureAcknowledgement(request, {
    conversation_id: conversationId,
    message_id: messageId,
    version_id: versionId,
    parent_version_id: null,
    content_sha256: digest(text),
    active: true,
    deleted: false,
  });
  const capability = await prepareHostSaveCapability(request, {
    route,
    payload: request.body,
  });
  assert.equal(capability.status, 'CAPABILITY_ISSUED');
  request.headers = { 'x-logic-engine-save-capability': capability.token };
}

function responseMock() {
  let finish;
  const finished = new Promise(resolve => { finish = resolve; });
  const response = {
    statusCode: 200, headersSent: false, headers: {}, body: undefined,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    removeHeader(name) { delete this.headers[name.toLowerCase()]; },
    writeHead(code, headers = {}) { this.statusCode = code; Object.assign(this.headers, headers); this.headersSent = true; return this; },
    write(value) { this.headersSent = true; this.body = (this.body ?? '') + String(value); return true; },
    flushHeaders() { this.headersSent = true; },
    json(value) { return this.end(JSON.stringify(value)); },
    end(value) { this.headersSent = true; if (value !== undefined) this.body = (this.body ?? '') + String(value); finish(); return this; },
  };
  response.finished = finished;
  return response;
}

test('enrolled chat save without matching persisted payload fails closed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'host-save-receipt-'));
  const directories = {
    chats: path.join(root, 'chats'),
    characters: path.join(root, 'characters'),
    groups: path.join(root, 'groups'),
    groupChats: path.join(root, 'group_chats'),
    backups: path.join(root, 'backups'),
  };
  const chatDirectory = path.join(directories.chats, 'avatar');
  await Promise.all([...Object.values(directories), chatDirectory].map(directory =>
    mkdir(directory, { recursive: true })));

  const conversationUuid = randomUUID();
  const installationUuid = randomUUID();
  const conversationId = installationUuid + ':' + conversationUuid;
  const messageId = randomUUID();
  const version1 = randomUUID();
  const version2 = randomUUID();
  const chatPath = path.join(chatDirectory, 'chat-a.jsonl');
  const header = { chat_metadata: { logic_engine_conversation_id: conversationUuid } };
  const before = message({ messageId, versions: [{ versionId: version1, text: 'persisted-before' }], activeVersionIndex: 0 });
  await writeFile(chatPath, [JSON.stringify(header), JSON.stringify(before)].join('\n'));

  const request = {
    method: 'POST', baseUrl: '/api/chats', path: '/save', originalUrl: '/api/chats/save',
    body: {
      avatar_url: 'avatar.png',
      file_name: 'chat-a',
      chat: [
        header,
        message({
          messageId,
          versions: [
            { versionId: version1, text: 'persisted-before' },
            { versionId: version2, text: 'new-but-not-written', parentVersionId: version1 },
          ],
          activeVersionIndex: 1,
        }),
      ],
    },
    user: { profile: { handle: 'save-receipt-test' }, directories },
  };

  try {
    await registerHostConversation(request, {
      conversationId, sourceLocator: 'chat-a', sourcePath: 'avatar/chat-a.jsonl', domain: 'chats',
    });
    await authorizeSave(request, conversationId, messageId, version1, 'persisted-before');

    const response = responseMock();
    await createHostLifecycleMutationMiddleware({ requirePersistedInventory: true })(request, response, async () => {
      // Simulate a native save path that reports success but leaves the old
      // persisted JSONL untouched (the failure mode the client helper hides).
      response.json({ ok: true });
    });
    await response.finished;

    assert.equal(response.statusCode, 503);
    assert.match(response.body, /HOST_SAVE_CAPABILITY_POSTSTATE_MISMATCH/);
    assert.doesNotMatch(response.body, /"ok":true/);

    const journalText = await readFile(path.join(root, '.logic-engine-host', 'mutation-ledger.jsonl'), 'utf8');
    const records = journalText.trim().split('\n').map(line => JSON.parse(line));
    const outcome = records.find(record => record.kind === 'outcome');
    assert.equal(outcome.status, 'UNRESOLVED');
    assert.equal(outcome.afterSnapshotStatus, 'HOST_SAVE_CAPABILITY_POSTSTATE_MISMATCH');
    assert.doesNotMatch(journalText, /persisted-before|new-but-not-written/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test('matching persisted enrolled chat receives success only after the version inventory matches', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'host-save-receipt-success-'));
  const directories = {
    chats: path.join(root, 'chats'),
    characters: path.join(root, 'characters'),
    groups: path.join(root, 'groups'),
    groupChats: path.join(root, 'group_chats'),
    backups: path.join(root, 'backups'),
  };
  const chatDirectory = path.join(directories.chats, 'avatar');
  await Promise.all([...Object.values(directories), chatDirectory].map(directory =>
    mkdir(directory, { recursive: true })));

  const conversationUuid = randomUUID();
  const conversationId = randomUUID() + ':' + conversationUuid;
  const messageId = randomUUID();
  const version1 = randomUUID();
  const version2 = randomUUID();
  const chatPath = path.join(chatDirectory, 'chat-a.jsonl');
  const header = { chat_metadata: { logic_engine_conversation_id: conversationUuid } };
  const before = message({ messageId, versions: [{ versionId: version1, text: 'before' }], activeVersionIndex: 0 });
  const after = message({
    messageId,
    versions: [
      { versionId: version1, text: 'before' },
      { versionId: version2, text: 'after', parentVersionId: version1 },
    ],
    activeVersionIndex: 1,
  });
  await writeFile(chatPath, [JSON.stringify(header), JSON.stringify(before)].join('\n'));

  const request = {
    method: 'POST', baseUrl: '/api/chats', path: '/save', originalUrl: '/api/chats/save',
    body: { avatar_url: 'avatar.png', file_name: 'chat-a', chat: [header, after] },
    user: { profile: { handle: 'save-receipt-success-test' }, directories },
  };
  try {
    await registerHostConversation(request, {
      conversationId, sourceLocator: 'chat-a', sourcePath: 'avatar/chat-a.jsonl', domain: 'chats',
    });
    await authorizeSave(request, conversationId, messageId, version1, 'before');
    const response = responseMock();
    await createHostLifecycleMutationMiddleware({ requirePersistedInventory: true })(request, response, async () => {
      await writeFile(chatPath, request.body.chat.map(JSON.stringify).join('\n'));
      response.json({ ok: true });
    });
    await response.finished;
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { ok: true });

    const journalText = await readFile(path.join(root, '.logic-engine-host', 'mutation-ledger.jsonl'), 'utf8');
    const outcome = journalText.trim().split('\n').map(line => JSON.parse(line)).find(record => record.kind === 'outcome');
    assert.equal(outcome.status, 'COMMITTED');
    assert.equal(outcome.persistenceVerification, undefined);
    assert.doesNotMatch(journalText, /\"mes\":\"(?:before|after)\"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test('group-chat save with a stale persisted inventory records UNRESOLVED and returns 503', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'host-group-save-receipt-'));
  const directories = {
    chats: path.join(root, 'chats'),
    characters: path.join(root, 'characters'),
    groups: path.join(root, 'groups'),
    groupChats: path.join(root, 'group_chats'),
    backups: path.join(root, 'backups'),
  };
  await Promise.all(Object.values(directories).map(directory => mkdir(directory, { recursive: true })));

  const conversationUuid = randomUUID();
  const conversationId = randomUUID() + ':' + conversationUuid;
  const messageId = randomUUID();
  const version1 = randomUUID();
  const version2 = randomUUID();
  const chatPath = path.join(directories.groupChats, 'group-a.jsonl');
  const header = { chat_metadata: { logic_engine_conversation_id: conversationUuid } };
  const before = message({ messageId, versions: [{ versionId: version1, text: 'before' }], activeVersionIndex: 0 });
  await writeFile(chatPath, [JSON.stringify(header), JSON.stringify(before)].join('\n'));

  const request = {
    method: 'POST', baseUrl: '/api/chats/group', path: '/save', originalUrl: '/api/chats/group/save',
    body: {
      id: 'group-a',
      chat: [header, message({
        messageId,
        versions: [
          { versionId: version1, text: 'before' },
          { versionId: version2, text: 'not-persisted', parentVersionId: version1 },
        ],
        activeVersionIndex: 1,
      })],
    },
    user: { profile: { handle: 'group-save-receipt-test' }, directories },
  };

  try {
    await registerHostConversation(request, {
      conversationId, sourceLocator: 'group-a', sourcePath: 'group-a.jsonl', domain: 'group_chats',
    });
    await authorizeSave(request, conversationId, messageId, version1, 'before', '/api/chats/group/save');
    const response = responseMock();
    await createHostLifecycleMutationMiddleware({ requirePersistedInventory: true })(request, response, async () => {
      // Simulate a native group-save route returning 2xx without persisting the proposed version.
      response.json({ ok: true });
    });
    await response.finished;

    assert.equal(response.statusCode, 503);
    assert.match(response.body, /HOST_SAVE_CAPABILITY_POSTSTATE_MISMATCH/);
    const journalText = await readFile(path.join(root, '.logic-engine-host', 'mutation-ledger.jsonl'), 'utf8');
    const records = journalText.trim().split('\n').map(line => JSON.parse(line));
    const outcome = records.find(record => record.kind === 'outcome');
    assert.equal(outcome.status, 'UNRESOLVED');
    assert.equal(outcome.httpStatus, 200);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('server persistence receipt covers group-chat save and rejects a stale persisted inventory', () => {
  const conversationUuid = randomUUID();
  const conversationId = randomUUID() + ':' + conversationUuid;
  const messageId = randomUUID();
  const version1 = randomUUID();
  const version2 = randomUUID();
  const header = { chat_metadata: { logic_engine_conversation_id: conversationUuid } };
  const record = message({
    messageId,
    versions: [
      { versionId: version1, text: 'active-version' },
      { versionId: version2, text: 'inactive-version', parentVersionId: version1 },
    ],
    activeVersionIndex: 0,
  });
  const request = {
    method: 'POST',
    baseUrl: '/api/chats/group',
    path: '/save',
    originalUrl: '/api/chats/group/save',
    body: { id: 'group-a', chat: [header, record] },
  };
  const registry = {
    conversations: [{ domain: 'group_chats', sourcePath: 'group-a.jsonl', conversationId }],
  };
  const actualVersions = record._logicEngineLifecycle.versions.map((version, index) => ({
    message_id: messageId,
    version_id: version.versionId,
    payload_sha256: version.payloadDigest,
    parent_version_id: version.parentVersionId,
    active: index === 0,
  }));
  const after = {
    conversationInventory: {
      inventories: [{
        conversation_id: conversationId,
        versions: actualVersions.map((version, index) => index === 1
          ? { ...version, payload_sha256: '0'.repeat(64) }
          : version),
      }],
    },
  };
  assert.deepEqual(verifyEnrolledChatSavePersistence(request, registry, after), {
    ok: false,
    code: 'HOST_SAVE_PERSISTENCE_MISMATCH',
  });
});

test('server persistence receipt rejects a modified inactive version digest', () => {
  const conversationUuid = randomUUID();
  const conversationId = randomUUID() + ':' + conversationUuid;
  const messageId = randomUUID();
  const version1 = randomUUID();
  const version2 = randomUUID();
  const header = { chat_metadata: { logic_engine_conversation_id: conversationUuid } };
  const record = message({
    messageId,
    versions: [
      { versionId: version1, text: 'active-version' },
      { versionId: version2, text: 'inactive-version', parentVersionId: version1 },
    ],
    activeVersionIndex: 0,
  });
  record._logicEngineLifecycle.versions[1].payloadDigest = '0'.repeat(64);
  const request = {
    method: 'POST',
    baseUrl: '/api/chats/group',
    path: '/save',
    originalUrl: '/api/chats/group/save',
    body: { id: 'group-a', chat: [header, record] },
  };
  const registry = {
    conversations: [{ domain: 'group_chats', sourcePath: 'group-a.jsonl', conversationId }],
  };
  assert.deepEqual(verifyEnrolledChatSavePersistence(request, registry, { conversationInventory: { inventories: [] } }), {
    ok: false,
    code: 'HOST_SAVE_VERSION_DIGEST_MISMATCH',
  });
});

test('pinned production startup enables persisted inventory receipts', async () => {
  const patchUrl = new URL('../patches/sillytavern-1.19.0-lifecycle-hooks.patch', import.meta.url);
  const patch = (await readFile(patchUrl, 'utf8')).replace(/\\r\\n/g, '\\n');
  assert.match(
    patch,
    /app\\.use\\(createHostLifecycleMutationMiddleware\\(\\{\\s*requirePersistedInventory:\\s*true,\\s*getUserDirectories\\s*\\}\\)\\);/,
    'pinned server-startup.js must enable persisted inventory verification in production',
  );
});

test('pinned browser bridge executes save and verifies regular/group persisted readback', async () => {
  const patchUrl = new URL('../patches/sillytavern-1.19.0-lifecycle-hooks.patch', import.meta.url);
  const patch = (await readFile(patchUrl, 'utf8')).replace(/\r\n/g, '\n');
  const startMarker = 'saveChat: async () => {';
  const endMarker = '\n+            },\n+            publishDigest:';
  const start = patch.indexOf(startMarker);
  const end = patch.indexOf(endMarker, start);
  assert.notEqual(start, -1, 'saveChat implementation exists in the pinned patch');
  assert.notEqual(end, -1, 'saveChat implementation has a bounded extractable body');
  const body = patch.slice(start + startMarker.length, end)
    .split('\n')
    .map(line => line.startsWith('+') ? line.slice(1) : line)
    .join('\n');
  const makeSaveChat = ({ chat, persistedChat, conversationUuid, groupId = null, fetchOk = true, readbackThrows = false }) => {
    const calls = { saves: [], fetches: [] };
    const context = {
      chat,
      selected_group: groupId,
      characters: [{ avatar: 'avatar.png' }],
      this_chid: 0,
      saveChatConditional: async options => { calls.saves.push(options); },
      getLogicEngineConversationId: async () => 'installation:' + conversationUuid,
      getRequestHeaders: () => ({ 'Content-Type': 'application/json', 'X-Test': 'receipt' }),
      getCurrentChatId: () => 'chat-a',
      fetch: async (url, options) => {
        calls.fetches.push({ url, options });
        if (!fetchOk) return { ok: false, status: 503, json: async () => ({ error: 'unavailable' }) };
        return {
          ok: true,
          json: async () => {
            if (readbackThrows) throw new Error('readback failed');
            return persistedChat;
          },
        };
      },
    };
    const saveChat = runInNewContext('({ saveChat: async () => {' + body + '\n} }).saveChat', context);
    return { saveChat, calls };
  };

  const conversationUuid = randomUUID();
  const header = { chat_metadata: { logic_engine_conversation_id: conversationUuid }, name: 'header' };
  const chat = [{
    mes: 'message',
    swipes: ['message', 'inactive-version'],
    swipe_id: 0,
    _logicEngineLifecycle: {
      messageId: randomUUID(),
      activeVersionIndex: 0,
      versions: [
        { versionId: randomUUID(), payloadDigest: digest('message'), parentVersionId: null },
        { versionId: randomUUID(), payloadDigest: digest('inactive-version'), parentVersionId: null },
      ],
    },
  }];
  const regular = makeSaveChat({ chat, persistedChat: [header, { ...chat[0] }], conversationUuid });
  await regular.saveChat();
  assert.equal(regular.calls.saves.length, 1);
  assert.equal(regular.calls.saves[0].throwOnError, true);
  assert.equal(regular.calls.fetches[0].url, '/api/chats/get');
  assert.deepEqual(JSON.parse(regular.calls.fetches[0].options.body), { avatar_url: 'avatar.png', file_name: 'chat-a' });

  const group = makeSaveChat({ chat, persistedChat: [header, { ...chat[0] }], conversationUuid, groupId: 'group-a' });
  await group.saveChat();
  assert.equal(group.calls.fetches[0].url, '/api/chats/group/get');
  assert.deepEqual(JSON.parse(group.calls.fetches[0].options.body), { id: 'group-a' });

  const reorderedKeysHeader = { name: 'header', chat_metadata: { logic_engine_conversation_id: conversationUuid } };
  const reorderedKeysRecord = {
    _logicEngineLifecycle: chat[0]._logicEngineLifecycle,
    swipe_id: 0,
    swipes: ['message', 'inactive-version'],
    mes: 'message',
  };
  const stableKeyOrder = makeSaveChat({ chat, persistedChat: [reorderedKeysHeader, reorderedKeysRecord], conversationUuid });
  await stableKeyOrder.saveChat();

  const inactiveMismatch = makeSaveChat({
    chat,
    persistedChat: [header, { ...chat[0], swipes: ['message', 'changed-inactive-version'] }],
    conversationUuid,
  });
  await assert.rejects(inactiveMismatch.saveChat(), /differs from the current message\/version state/);

  const unavailable = makeSaveChat({ chat, persistedChat: [], conversationUuid, fetchOk: false });
  await assert.rejects(unavailable.saveChat(), /persisted Host save receipt unavailable/);
  const readbackError = makeSaveChat({ chat, persistedChat: [], conversationUuid, readbackThrows: true });
  await assert.rejects(readbackError.saveChat(), /differs from the current message\/version state/);
});
