import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createHostLifecycleMutationMiddleware, getHostConversationInventory, recordHostCaptureAcknowledgement, registerHostConversation } from '../server-lifecycle-mutation-journal.mjs';

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

test('enforced server mutation journal records before/after persisted version inventories and active-pointer changes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'host-version-inventory-journal-'));
  const directories = {
    chats: path.join(root, 'chats'), groups: path.join(root, 'groups'),
    groupChats: path.join(root, 'group_chats'), backups: path.join(root, 'backups'),
  };
  await Promise.all(Object.values(directories).map(directory => mkdir(directory, { recursive: true })));
  const request = { method: 'POST', baseUrl: '', path: '/api/chats/save', originalUrl: '/api/chats/save',
    user: { profile: { handle: 'test-user' }, directories } };
  const conversationUuid = randomUUID();
  const installationUuid = randomUUID();
  const messageId = randomUUID();
  const version1 = randomUUID();
  const version2 = randomUUID();
  const chatPath = path.join(directories.chats, 'chat-a.jsonl');
  const writeChat = messages => writeFile(chatPath, [
    JSON.stringify({ chat_metadata: { logic_engine_conversation_id: conversationUuid } }),
    ...messages.map(JSON.stringify),
  ].join('\n') + '\n');
  try {
    await writeChat([makeMessage({ messageId, versions: [{ versionId: version1, text: 'private-before' }], activeVersionIndex: 0 })]);
    const conversationId = installationUuid + ':' + conversationUuid;
    await registerHostConversation(request, {
      conversationId,
      sourceLocator: 'chat-a', sourcePath: 'chat-a.jsonl', domain: 'chats',
    });
    await recordHostCaptureAcknowledgement(request, {
      conversation_id: conversationId, message_id: messageId, version_id: version1,
      content_sha256: digest('private-before'), active: true, deleted: false,
    });
    const response = responseMock();
    await createHostLifecycleMutationMiddleware({ requirePersistedInventory: true })(request, response, async () => {
      await writeChat([makeMessage({
        messageId,
        versions: [
          { versionId: version1, text: 'private-before' },
          { versionId: version2, text: 'private-after', parentVersionId: version1 },
        ],
        activeVersionIndex: 1,
      })]);
      response.json({ ok: true });
    });
    await response.finished;
    assert.equal(response.statusCode, 200);
    await recordHostCaptureAcknowledgement(request, {
      conversation_id: conversationId, message_id: messageId, version_id: version1,
      content_sha256: digest('private-before'), active: false, deleted: false,
    });
    await recordHostCaptureAcknowledgement(request, {
      conversation_id: conversationId, message_id: messageId, version_id: version2,
      content_sha256: digest('private-after'), active: true, deleted: false,
    });
    const journal = await readFile(path.join(root, '.logic-engine-host', 'mutation-ledger.jsonl'), 'utf8');
    const records = journal.trim().split('\n').map(line => JSON.parse(line));
    const mutationRecords = records.filter(record => record.kind === 'intent' || record.kind === 'outcome');
    assert.equal(mutationRecords.length, 2);
    assert.equal(mutationRecords[0].beforeConversationInventories[0].versions.length, 1);
    assert.equal(mutationRecords[1].afterConversationInventories[0].versions.length, 2);
    assert.ok(mutationRecords[0].beforeConversationInventoryDigest);
    assert.ok(mutationRecords[1].afterConversationInventoryDigest);
    assert.ok(mutationRecords[1].versionChanges.some(change => change.change === 'ADDED' && change.version_id === version2));
    assert.ok(mutationRecords[1].versionChanges.some(change => change.change === 'ACTIVE_CHANGED' && change.version_id === version1));
    assert.doesNotMatch(journal, /private-before|private-after/);

    const checkpoint = await getHostConversationInventory(request);
    assert.equal(checkpoint.complete, true);
    assert.equal(checkpoint.mutationJournal.snapshotConsistency, 'MATCHES_LAST_COMMITTED_LOCAL_CHECKPOINT');

    // Remove a swipe through the guarded save path, then require an explicit
    // Core-accepted tombstone before the observed inventory can stay complete.
    const deleteResponse = responseMock();
    await createHostLifecycleMutationMiddleware({ requirePersistedInventory: true })(request, deleteResponse, async () => {
      await writeChat([makeMessage({
        messageId,
        versions: [{ versionId: version2, text: 'private-after', parentVersionId: version1 }],
        activeVersionIndex: 0,
      })]);
      deleteResponse.json({ ok: true });
    });
    await deleteResponse.finished;
    assert.equal(deleteResponse.statusCode, 200);
    await recordHostCaptureAcknowledgement(request, {
      conversation_id: conversationId, message_id: messageId, version_id: version1,
      content_sha256: digest('private-before'), active: false, deleted: true,
    });
    const tombstoneSnapshot = await getHostConversationInventory(request);
    assert.equal(tombstoneSnapshot.complete, true);
    assert.equal(tombstoneSnapshot.historicalCompleteness, 'ENROLLMENT_FORWARD_ONLY');
    assert.equal(tombstoneSnapshot.currentVersionCount, 1);
    assert.equal(tombstoneSnapshot.versionCount, 2);
    assert.equal(tombstoneSnapshot.inventories[0].versions.find(v => v.version_id === version1).deleted, true);
    assert.equal(tombstoneSnapshot.inventories[0].versions.find(v => v.version_id === version2).active, true);

    // A locally restored older chat file must diverge from the last committed
    // version inventory and fail closed. The local journal itself still shares
    // the Host restore domain, so this is detection evidence, not anti-rollback authority.
    await writeChat([makeMessage({
      messageId,
      versions: [{ versionId: version1, text: 'private-before' }],
      activeVersionIndex: 0,
    })]);
    const rollback = await getHostConversationInventory(request);
    assert.equal(rollback.complete, false);
    assert.ok(rollback.errors.includes('CURRENT_SNAPSHOT_DIVERGES_FROM_LAST_COMMITTED_JOURNAL_SNAPSHOT'));
    assert.equal(rollback.mutationJournal.snapshotConsistency, 'DIVERGES_FROM_LAST_LOCAL_CHECKPOINT');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
