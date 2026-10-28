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

test('request-bound capability permits only append/select transitions and rejects destructive changes', async () => {
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
    sessionID: 'test-session-1', user: { profile: { handle: 'test-user' }, directories }, headers: {},
  };
  const conversationUuid = randomUUID();
  const installationUuid = randomUUID();
  const messageId = randomUUID();
  const messageId2 = randomUUID();
  const version1 = randomUUID();
  const version2 = randomUUID();
  const version3 = randomUUID();
  const version4 = randomUUID();
  const conversationId = installationUuid + ':' + conversationUuid;
  const chatPath = path.join(chatDirectory, 'chat-a.jsonl');
  const header = { chat_metadata: { logic_engine_conversation_id: conversationUuid }, user_name: 'unused', character_name: 'unused' };
  const writeChat = records => writeFile(chatPath, records.map(record => JSON.stringify(record)).join('\n'));
  const payload = messages => ({
    ch_name: 'Character A', file_name: 'chat-a', chat: [header, ...messages], avatar_url: 'character-a.png', force: false,
  });
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
  const appendedMessage = makeMessage({
    messageId,
    versions: [
      { versionId: version1, text: 'private-before' },
      { versionId: version2, text: 'private-after', parentVersionId: version1 },
      { versionId: version3, text: 'private-third', parentVersionId: version2 },
    ],
    activeVersionIndex: 2,
  });
  const deletedSwipeMessage = makeMessage({
    messageId,
    versions: [{ versionId: version2, text: 'private-after', parentVersionId: version1 }],
    activeVersionIndex: 0,
  });
  const newMessage = makeMessage({
    messageId: messageId2,
    versions: [{ versionId: version4, text: 'new message', parentVersionId: null }],
    activeVersionIndex: 0,
  });
  const invokeSave = async (savePayload, token) => {
    const saveRequest = { ...request, body: savePayload, headers: { 'x-logic-engine-save-capability': token } };
    const response = responseMock();
    let reachedNativeSave = false;
    await createHostLifecycleMutationMiddleware({ requirePersistedInventory: true })(saveRequest, response, async () => {
      reachedNativeSave = true;
      await writeChat(savePayload.chat);
      response.json({ ok: true });
    });
    await response.finished;
    return { response, reachedNativeSave };
  };
  const prepare = savePayload => prepareHostSaveCapability(request, { route: '/api/chats/save', payload: savePayload });
  const acknowledge = async (message, versionId, text, { parentVersionId = null, active, deleted = false } = {}) =>
    recordHostCaptureAcknowledgement(request, {
      conversation_id: conversationId, message_id: message, version_id: versionId, parent_version_id: parentVersionId,
      content_sha256: digest(text), active, deleted,
    });

  try {
    await writeChat([header, initialMessage]);
    const persistedBefore = await readFile(chatPath, 'utf8');
    await registerHostConversation(request, {
      conversationId, sourceLocator: 'chat-a', sourcePath: 'character-a/chat-a.jsonl', domain: 'chats',
    });
    await acknowledge(messageId, version1, 'private-before', { active: true });
    await acknowledge(messageId, version2, 'private-after', { parentVersionId: version1, active: false });
    const before = await getHostConversationInventory(request);
    assert.equal(before.complete, true);
    assert.equal(before.currentVersionCount, 2);

    // A capability is bound to the exact request body; a modified body must fail before native persistence.
    const selectPayload = payload([selectedMessage]);
    const persistedBeforeRejectedBody = await readFile(chatPath, 'utf8');
    const bodyCapability = await prepare(selectPayload);
    const changedBody = { ...selectPayload, force: true };
    const changedBodyResult = await invokeSave(changedBody, bodyCapability.token);
    assert.equal(changedBodyResult.reachedNativeSave, false);
    assert.notEqual(changedBodyResult.response.statusCode, 200);
    assert.equal(await readFile(chatPath, 'utf8'), persistedBeforeRejectedBody);

    // A capability cannot authorize bytes that changed after preparation.
    const staleFileCapability = await prepare(selectPayload);
    const tamperedBytes = persistedBeforeRejectedBody.replace('"user_name":"unused"', '"user_name":"changed"');
    assert.notEqual(tamperedBytes, persistedBeforeRejectedBody);
    await writeFile(chatPath, tamperedBytes);
    const staleFileResult = await invokeSave(selectPayload, staleFileCapability.token);
    assert.equal(staleFileResult.reachedNativeSave, false);
    assert.notEqual(staleFileResult.response.statusCode, 200);
    assert.equal(await readFile(chatPath, 'utf8'), tamperedBytes);
    await writeFile(chatPath, persistedBeforeRejectedBody);
    assert.equal((await getHostConversationInventory(request)).complete, true);

    // The one-shot capability permits one save and rejects replay before another native write.
    const selectCapability = await prepare(selectPayload);
    assert.equal(selectCapability.status, 'CAPABILITY_ISSUED');
    const select = await invokeSave(selectPayload, selectCapability.token);
    assert.equal(select.reachedNativeSave, true);
    assert.equal(select.response.statusCode, 200);
    const selectedBytes = await readFile(chatPath, 'utf8');

    const replay = await invokeSave(selectPayload, selectCapability.token);
    assert.equal(replay.reachedNativeSave, false);
    assert.notEqual(replay.response.statusCode, 200);
    assert.equal(await readFile(chatPath, 'utf8'), selectedBytes);

    await acknowledge(messageId, version1, 'private-before', { active: false });
    await acknowledge(messageId, version2, 'private-after', { parentVersionId: version1, active: true });
    const afterSelectInventory = await getHostConversationInventory(request);
    assert.equal(afterSelectInventory.complete, true, JSON.stringify({
      errors: afterSelectInventory.errors, mutationJournal: afterSelectInventory.mutationJournal,
    }));

    // Append-only version creation is allowed; previous IDs/digests/ancestry remain intact.
    const appendPayload = payload([appendedMessage]);
    const appendCapability = await prepare(appendPayload);
    assert.equal(appendCapability.status, 'CAPABILITY_ISSUED');
    const append = await invokeSave(appendPayload, appendCapability.token);
    assert.equal(append.reachedNativeSave, true);
    assert.equal(append.response.statusCode, 200);
    await acknowledge(messageId, version1, 'private-before', { active: false });
    await acknowledge(messageId, version2, 'private-after', { parentVersionId: version1, active: false });
    await acknowledge(messageId, version3, 'private-third', { parentVersionId: version2, active: true });
    assert.equal((await getHostConversationInventory(request)).complete, true);

    const createPayload = payload([appendedMessage, newMessage]);
    const createCapability = await prepare(createPayload);
    assert.equal(createCapability.status, 'CAPABILITY_ISSUED');
    const create = await invokeSave(createPayload, createCapability.token);
    assert.equal(create.reachedNativeSave, true);
    assert.equal(create.response.statusCode, 200);
    await acknowledge(messageId2, version4, 'new message', { active: true });
    const finalInventory = await getHostConversationInventory(request);
    assert.equal(finalInventory.complete, true);
    assert.equal(finalInventory.currentVersionCount, 4);
    assert.equal(finalInventory.versionCount, 4);

    // Deletion and reordering are unsupported until a separately reviewed tombstone contract exists.
    const persistedBeforeRejected = await readFile(chatPath, 'utf8');
    for (const rejectedPayload of [
      payload([newMessage, appendedMessage]),
      payload([deletedSwipeMessage, newMessage]),
      payload([appendedMessage]),
    ]) {
      await assert.rejects(
        () => prepare(rejectedPayload),
        error => error.message === 'HOST_SAVE_CAPABILITY_TRANSITION_UNSUPPORTED',
      );
      assert.equal(await readFile(chatPath, 'utf8'), persistedBeforeRejected);
    }

    const journal = await readFile(path.join(root, '.logic-engine-host', 'mutation-ledger.jsonl'), 'utf8');
    assert.doesNotMatch(journal, /private-before|private-after|private-third|new message/);

    // Restoring an older file is detected as divergence, not accepted as a valid transition.
    await writeChat([header, initialMessage]);
    const rollback = await getHostConversationInventory(request);
    assert.equal(rollback.complete, false);
    assert.ok(rollback.errors.includes('CURRENT_SNAPSHOT_DIVERGES_FROM_LAST_COMMITTED_JOURNAL_SNAPSHOT'));
    assert.equal(rollback.mutationJournal.snapshotConsistency, 'DIVERGES_FROM_LAST_LOCAL_CHECKPOINT');
    assert.equal(persistedBefore, await readFile(chatPath, 'utf8'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
