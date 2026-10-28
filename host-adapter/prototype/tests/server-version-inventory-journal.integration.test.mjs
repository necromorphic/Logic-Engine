import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  createHostLifecycleMutationMiddleware,
  getHostConversationInventory,
  prepareHostSaveCapability,
  recordHostCaptureAcknowledgement,
  registerHostConversation,
} from '../server-lifecycle-mutation-journal.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(String(value))).digest('hex');
const makeMessage = ({ messageId, versions, activeVersionIndex }) => ({
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

test('request-bound capability permits a verified swipe-select and swipe-delete transition only once', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'host-version-inventory-journal-'));
  const directories = {
    chats: path.join(root, 'chats'), characters: path.join(root, 'characters'), groups: path.join(root, 'groups'),
    groupChats: path.join(root, 'group_chats'), backups: path.join(root, 'backups'),
  };
  await Promise.all(Object.values(directories).map(directory => mkdir(directory, { recursive: true })));
  const chatDirectory = path.join(directories.chats, 'character-a');
  await mkdir(chatDirectory, { recursive: true });
  const request = {
    method: 'POST', baseUrl: '', path: '/api/chats/save', originalUrl: '/api/chats/save',
    sessionID: 'test-session-1',
    user: { profile: { handle: 'test-user' }, directories },
    headers: {},
  };
  const conversationUuid = randomUUID();
  const installationUuid = randomUUID();
  const messageId = randomUUID();
  const version1 = randomUUID();
  const version2 = randomUUID();
  const conversationId = installationUuid + ':' + conversationUuid;
  const chatPath = path.join(chatDirectory, 'chat-a.jsonl');
  const header = {
    chat_metadata: { logic_engine_conversation_id: conversationUuid },
    user_name: 'unused',
    character_name: 'unused',
  };
  const writeChat = records => writeFile(chatPath, records.map(record => JSON.stringify(record)).join('\\n'));
  const initialMessage = makeMessage({
    messageId,
    versions: [
      { versionId: version1, text: 'private-before' },
      { versionId: version2, text: 'private-after', parentVersionId: version1 },
    ],
    activeVersionIndex: 0,
  });
  const selectedMessage = makeMessage({
    messageId,
    versions: [
      { versionId: version1, text: 'private-before' },
      { versionId: version2, text: 'private-after', parentVersionId: version1 },
    ],
    activeVersionIndex: 1,
  });
  const deletedSwipeMessage = makeMessage({
    messageId,
    versions: [{ versionId: version2, text: 'private-after', parentVersionId: version1 }],
    activeVersionIndex: 0,
  });
  const initialRecords = [header, initialMessage];
  const selectPayload = {
    ch_name: 'Character A',
    file_name: 'chat-a',
    chat: [header, selectedMessage],
    avatar_url: 'character-a.png',
    force: false,
  };
  const deletePayload = {
    ch_name: 'Character A',
    file_name: 'chat-a',
    chat: [header, deletedSwipeMessage],
    avatar_url: 'character-a.png',
    force: false,
  };

  try {
    await writeChat(initialRecords);
    const persistedBefore = await readFile(chatPath, 'utf8');
    await registerHostConversation(request, {
      conversationId,
      sourceLocator: 'chat-a',
      sourcePath: 'character-a/chat-a.jsonl',
      domain: 'chats',
    });
    await recordHostCaptureAcknowledgement(request, {
      conversation_id: conversationId, message_id: messageId, version_id: version1, parent_version_id: null,
      content_sha256: digest('private-before'), active: true, deleted: false,
    });
    await recordHostCaptureAcknowledgement(request, {
      conversation_id: conversationId, message_id: messageId, version_id: version2, parent_version_id: version1,
      content_sha256: digest('private-after'), active: false, deleted: false,
    });
    const before = await getHostConversationInventory(request);
    assert.equal(before.complete, true);
    assert.equal(before.currentVersionCount, 2);

    const selectCapability = await prepareHostSaveCapability(request, {
      route: '/api/chats/save',
      payload: selectPayload,
    });
    assert.equal(selectCapability.status, 'CAPABILITY_ISSUED');
    request.body = selectPayload;
    request.headers = { 'x-logic-engine-save-capability': selectCapability.token };
    const selectResponse = responseMock();
    let selectReachedNativeSave = false;
    await createHostLifecycleMutationMiddleware({ requirePersistedInventory: true })(request, selectResponse, async () => {
      selectReachedNativeSave = true;
      await writeChat(selectPayload.chat);
      selectResponse.json({ ok: true });
    });
    await selectResponse.finished;
    assert.equal(selectReachedNativeSave, true);
    assert.equal(selectResponse.statusCode, 200);
    assert.equal(await readFile(chatPath, 'utf8'), selectPayload.chat.map(JSON.stringify).join('\\n'));

    // A replay of the same one-shot token is rejected before the native handler.
    const replayResponse = responseMock();
    let replayReachedNativeSave = false;
    await createHostLifecycleMutationMiddleware({ requirePersistedInventory: true })(request, replayResponse, async () => {
      replayReachedNativeSave = true;
      await writeChat(selectPayload.chat);
      replayResponse.json({ ok: true });
    });
    await replayResponse.finished;
    assert.equal(replayReachedNativeSave, false);
    assert.equal(replayResponse.statusCode, 409);
    assert.match(String(replayResponse.body), /HOST_SAVE_CAPABILITY_INVALID/);

    await recordHostCaptureAcknowledgement(request, {
      conversation_id: conversationId, message_id: messageId, version_id: version1, parent_version_id: null,
      content_sha256: digest('private-before'), active: false, deleted: false,
    });
    await recordHostCaptureAcknowledgement(request, {
      conversation_id: conversationId, message_id: messageId, version_id: version2, parent_version_id: version1,
      content_sha256: digest('private-after'), active: true, deleted: false,
    });
    const selectedInventory = await getHostConversationInventory(request);
    assert.equal(selectedInventory.complete, true);
    assert.equal(selectedInventory.currentVersionCount, 2);
    const journal = await readFile(path.join(root, '.logic-engine-host', 'mutation-ledger.jsonl'), 'utf8');
    const records = journal.trim().split('\\n').map(line => JSON.parse(line));
    const committed = records.filter(record => record.kind === 'outcome' && record.status === 'COMMITTED');
    assert.equal(committed.length, 1);
    assert.ok(committed[0].versionChanges.some(change => change.change === 'ACTIVE_CHANGED' && change.version_id === version1));
    assert.doesNotMatch(journal, /private-before|private-after/);

    const deleteCapability = await prepareHostSaveCapability(request, {
      route: '/api/chats/save',
      payload: deletePayload,
    });
    assert.equal(deleteCapability.status, 'CAPABILITY_ISSUED');
    request.body = deletePayload;
    request.headers = { 'x-logic-engine-save-capability': deleteCapability.token };
    const deleteResponse = responseMock();
    let deleteReachedNativeSave = false;
    await createHostLifecycleMutationMiddleware({ requirePersistedInventory: true })(request, deleteResponse, async () => {
      deleteReachedNativeSave = true;
      await writeChat(deletePayload.chat);
      deleteResponse.json({ ok: true });
    });
    await deleteResponse.finished;
    assert.equal(deleteReachedNativeSave, true);
    assert.equal(deleteResponse.statusCode, 200);

    await recordHostCaptureAcknowledgement(request, {
      conversation_id: conversationId, message_id: messageId, version_id: version1, parent_version_id: null,
      content_sha256: digest('private-before'), active: false, deleted: true,
    });
    const tombstoneSnapshot = await getHostConversationInventory(request);
    assert.equal(tombstoneSnapshot.complete, true);
    assert.equal(tombstoneSnapshot.historicalCompleteness, 'ENROLLMENT_FORWARD_ONLY');
    assert.equal(tombstoneSnapshot.currentVersionCount, 1);
    assert.equal(tombstoneSnapshot.versionCount, 2);
    assert.equal(tombstoneSnapshot.inventories[0].versions.find(v => v.version_id === version1).deleted, true);
    assert.equal(tombstoneSnapshot.inventories[0].versions.find(v => v.version_id === version2).active, true);

    await writeChat([header, makeMessage({
      messageId,
      versions: [{ versionId: version1, text: 'private-before' }],
      activeVersionIndex: 0,
    })]);
    const rollback = await getHostConversationInventory(request);
    assert.equal(rollback.complete, false);
    assert.ok(rollback.errors.includes('CURRENT_SNAPSHOT_DIVERGES_FROM_LAST_COMMITTED_JOURNAL_SNAPSHOT'));
    assert.equal(rollback.mutationJournal.snapshotConsistency, 'DIVERGES_FROM_LAST_LOCAL_CHECKPOINT');
    assert.notEqual(persistedBefore, await readFile(chatPath, 'utf8'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
