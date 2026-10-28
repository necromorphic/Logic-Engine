import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  createHostLifecycleMutationMiddleware,
  getHostMutationJournalStatus,
  prepareHostSaveCapability,
  recordHostCaptureAcknowledgement,
  registerHostConversation,
} from '../server-lifecycle-mutation-journal.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(String(value))).digest('hex');
const responseMock = () => {
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
};

test('post-intent prewrite recheck blocks a file change before native handler execution', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'host-save-prewrite-race-'));
  const directories = {
    chats: path.join(root, 'chats'), characters: path.join(root, 'characters'), groups: path.join(root, 'groups'),
    groupChats: path.join(root, 'group_chats'), backups: path.join(root, 'backups'),
  };
  await Promise.all(Object.values(directories).map(directory => mkdir(directory, { recursive: true })));
  const chatDirectory = path.join(directories.chats, 'character-a');
  await mkdir(chatDirectory, { recursive: true });
  const request = {
    method: 'POST', baseUrl: '', path: '/api/chats/save', originalUrl: '/api/chats/save',
    sessionID: 'race-test-session',
    user: { profile: { handle: 'race-test-user' }, directories },
    headers: {},
  };
  const conversationUuid = randomUUID();
  const conversationId = randomUUID() + ':' + conversationUuid;
  const messageId = randomUUID();
  const versionId = randomUUID();
  const header = {
    chat_metadata: { logic_engine_conversation_id: conversationUuid },
    user_name: 'unused',
    character_name: 'unused',
  };
  const message = {
    mes: 'race-before', swipes: ['race-before'], swipe_id: 0,
    _logicEngineLifecycle: {
      messageId,
      activeVersionIndex: 0,
      versions: [{ versionId, payloadDigest: digest('race-before'), parentVersionId: null }],
    },
  };
  const chatPath = path.join(chatDirectory, 'chat-a.jsonl');
  const initialRecords = [header, message];
  const writeChat = records => writeFile(chatPath, records.map(record => JSON.stringify(record)).join('\n'));
  const payload = {
    ch_name: 'Character A', file_name: 'chat-a', chat: initialRecords,
    avatar_url: 'character-a.png', force: false,
  };

  try {
    await writeChat(initialRecords);
    const originalBytes = await readFile(chatPath, 'utf8');
    await registerHostConversation(request, {
      conversationId, sourceLocator: 'chat-a', sourcePath: 'character-a/chat-a.jsonl', domain: 'chats',
    });
    await recordHostCaptureAcknowledgement(request, {
      conversation_id: conversationId, message_id: messageId, version_id: versionId,
      parent_version_id: null, content_sha256: digest('race-before'), active: true, deleted: false,
    });
    const capability = await prepareHostSaveCapability(request, { route: '/api/chats/save', payload });
    assert.equal(capability.status, 'CAPABILITY_ISSUED');

    const saveRequest = {
      ...request,
      body: payload,
      headers: { 'x-logic-engine-save-capability': capability.token },
    };
    const response = responseMock();
    let reachedNativeSave = false;
    await createHostLifecycleMutationMiddleware({
      requirePersistedInventory: true,
      beforeSavePrestateRecheck: async () => {
        // Simulate an external writer after the durable intent, before the
        // immediate prewrite check. The handler must never see this request.
        await writeFile(chatPath, originalBytes + '\n');
      },
    })(saveRequest, response, async () => {
      reachedNativeSave = true;
      await writeChat(payload.chat);
      response.json({ ok: true });
    });
    await response.finished;

    assert.equal(reachedNativeSave, false);
    assert.equal(response.statusCode, 409);
    assert.match(String(response.body), /HOST_SAVE_CAPABILITY_STALE_PRESTATE/);
    assert.equal(await readFile(chatPath, 'utf8'), originalBytes + '\n');
    assert.equal((await getHostMutationJournalStatus(request)).status, 'RECONCILIATION_REQUIRED');
    const journal = await readFile(path.join(root, '.logic-engine-host', 'mutation-ledger.jsonl'), 'utf8');
    assert.match(journal, /HOST_SAVE_CAPABILITY_STALE_PRESTATE/);
    assert.doesNotMatch(journal, /race-before/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test('final native-handoff recheck blocks a target-file race after the inventory precheck', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'host-save-native-handoff-race-'));
  const directories = {
    chats: path.join(root, 'chats'), characters: path.join(root, 'characters'), groups: path.join(root, 'groups'),
    groupChats: path.join(root, 'group_chats'), backups: path.join(root, 'backups'),
  };
  await Promise.all(Object.values(directories).map(directory => mkdir(directory, { recursive: true })));
  const chatDirectory = path.join(directories.chats, 'character-a');
  await mkdir(chatDirectory, { recursive: true });
  const request = {
    method: 'POST', baseUrl: '', path: '/api/chats/save', originalUrl: '/api/chats/save',
    sessionID: 'native-handoff-race-session',
    user: { profile: { handle: 'native-handoff-race-user' }, directories },
    headers: {},
  };
  const conversationUuid = randomUUID();
  const conversationId = randomUUID() + ':' + conversationUuid;
  const messageId = randomUUID();
  const versionId = randomUUID();
  const header = {
    chat_metadata: { logic_engine_conversation_id: conversationUuid },
    user_name: 'unused',
    character_name: 'unused',
  };
  const message = {
    mes: 'handoff-before', swipes: ['handoff-before'], swipe_id: 0,
    _logicEngineLifecycle: {
      messageId,
      activeVersionIndex: 0,
      versions: [{ versionId, payloadDigest: digest('handoff-before'), parentVersionId: null }],
    },
  };
  const chatPath = path.join(chatDirectory, 'chat-a.jsonl');
  const initialRecords = [header, message];
  const writeChat = records => writeFile(chatPath, records.map(record => JSON.stringify(record)).join('\n'));
  const payload = {
    ch_name: 'Character A', file_name: 'chat-a', chat: initialRecords,
    avatar_url: 'character-a.png', force: false,
  };

  try {
    await writeChat(initialRecords);
    const originalBytes = await readFile(chatPath, 'utf8');
    await registerHostConversation(request, {
      conversationId, sourceLocator: 'chat-a', sourcePath: 'character-a/chat-a.jsonl', domain: 'chats',
    });
    await recordHostCaptureAcknowledgement(request, {
      conversation_id: conversationId, message_id: messageId, version_id: versionId,
      parent_version_id: null, content_sha256: digest('handoff-before'), active: true, deleted: false,
    });
    const capability = await prepareHostSaveCapability(request, { route: '/api/chats/save', payload });
    assert.equal(capability.status, 'CAPABILITY_ISSUED');

    const saveRequest = {
      ...request,
      body: payload,
      headers: { 'x-logic-engine-save-capability': capability.token },
    };
    const response = responseMock();
    let reachedNativeSave = false;
    const changedBytes = originalBytes + '\n';
    await createHostLifecycleMutationMiddleware({
      requirePersistedInventory: true,
      beforeSaveNativeHandoff: async () => {
        // The earlier post-intent inventory check has completed. Simulate an
        // external writer in the final gap before the native save handoff.
        await writeFile(chatPath, changedBytes);
      },
    })(saveRequest, response, async () => {
      reachedNativeSave = true;
      await writeChat(payload.chat);
      response.json({ ok: true });
    });
    await response.finished;

    assert.equal(reachedNativeSave, false, 'native save must not run after the final pre-handoff check fails');
    assert.equal(response.statusCode, 409);
    assert.match(String(response.body), /HOST_SAVE_CAPABILITY_STALE_PRESTATE_AT_NATIVE_HANDOFF/);
    assert.equal(await readFile(chatPath, 'utf8'), changedBytes, 'the middleware must preserve the bytes present at rejection');
    assert.equal((await getHostMutationJournalStatus(request)).status, 'RECONCILIATION_REQUIRED');
    const journal = await readFile(path.join(root, '.logic-engine-host', 'mutation-ledger.jsonl'), 'utf8');
    assert.match(journal, /HOST_SAVE_CAPABILITY_STALE_PRESTATE_AT_NATIVE_HANDOFF/);
    assert.doesNotMatch(journal, /handoff-before/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
