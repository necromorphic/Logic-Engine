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
    ...messages.map(value => JSON.stringify(value)),
  ].join('\n') + '\n');
  const originalFetch = globalThis.fetch;
  const envKeys = ['LOGIC_ENGINE_CORE_URL', 'LOGIC_ENGINE_API_TOKEN', 'LOGIC_ENGINE_ADAPTER_ID', 'LOGIC_ENGINE_ADAPTER_TOKEN'];
  const priorEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  const coreVersions = new Map();
  let coreInventoryStatus = 'READY';
  process.env.LOGIC_ENGINE_CORE_URL = 'http://127.0.0.1:8787';
  process.env.LOGIC_ENGINE_API_TOKEN = 'test-core-api-token-long-enough';
  process.env.LOGIC_ENGINE_ADAPTER_ID = 'adapter-test';
  process.env.LOGIC_ENGINE_ADAPTER_TOKEN = 'test-adapter-token-long-enough';
  globalThis.fetch = async (url, options) => {
    const endpoint = new URL(String(url));
    const body = JSON.parse(options.body);
    if (endpoint.pathname === '/v1/host-version-ledger/capture') {
      const key = JSON.stringify([body.conversation_id, body.message_id, body.version_id]);
      coreVersions.set(key, { ...body });
      return { ok: true, status: 201, json: async () => ({ capture: { status: 'captured' } }) };
    }
    if (endpoint.pathname === '/v1/host-version-ledger/inventory') {
      const versions = [...coreVersions.values()]
        .filter(version => version.conversation_id === body.conversation_id)
        .map(({ conversation_id, message_id, version_id, content_sha256, active, deleted }) =>
          ({ conversation_id, message_id, version_id, content_sha256, active, deleted }));
      return { ok: true, status: 200, json: async () => ({
        inventory: {
          authority: 'CORE_HOST_VERSION_LEDGER',
          conversation_id: body.conversation_id,
          inventory_status: coreInventoryStatus,
          versions,
        },
      }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    await writeChat([makeMessage({ messageId, versions: [{ versionId: version1, text: 'private-before' }], activeVersionIndex: 0 })]);
    const conversationId = installationUuid + ':' + conversationUuid;
    request.body = { avatar_url: 'avatar.png', file_name: 'chat-a', chat: [{ chat_metadata: { logic_engine_conversation_id: conversationUuid } }, makeMessage({ messageId, versions: [{ versionId: version1, text: 'private-before' }, { versionId: version2, text: 'private-after', parentVersionId: version1 }], activeVersionIndex: 1 })] };
    coreVersions.set(JSON.stringify([conversationId, messageId, version1]), { conversation_id: conversationId, message_id: messageId, version_id: version1, content_sha256: digest('private-before'), active: true, deleted: false });
    await registerHostConversation(request, {
      conversationId,
      sourceLocator: 'chat-a', sourcePath: 'chat-a.jsonl', domain: 'chats',
    });
    await recordHostCaptureAcknowledgement(request, {
      conversation_id: conversationId, message_id: messageId, version_id: version1,
      content_sha256: digest('private-before'), active: true, deleted: false,
    });
    const response = responseMock();
    await createHostLifecycleMutationMiddleware({ requirePersistedInventory: true, requireCoreInventory: true })(request, response, async () => {
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

    const checkpoint = await getHostConversationInventory(request, { requireCoreInventory: true });
    assert.equal(checkpoint.complete, true);
    assert.equal(checkpoint.mutationJournal.snapshotConsistency, 'MATCHES_LAST_COMMITTED_LOCAL_CHECKPOINT');

    // Matching digests are not sufficient while Core says its inventory is not ready.
    coreInventoryStatus = 'NON_READY';
    const notReadyResponse = responseMock();
    let notReadyHandlerCalled = false;
    await createHostLifecycleMutationMiddleware({ requirePersistedInventory: true, requireCoreInventory: true })(request, notReadyResponse, async () => {
      notReadyHandlerCalled = true;
      notReadyResponse.json({ ok: true });
    });
    await notReadyResponse.finished;
    assert.equal(notReadyHandlerCalled, false);
    assert.equal(notReadyResponse.statusCode, 503);
    assert.match(notReadyResponse.body, /CORE_HOST_INVENTORY_NOT_READY/);
    coreInventoryStatus = 'READY';

    // Remove a swipe through the guarded save path, then require an explicit
    // Core-accepted tombstone before the observed inventory can stay complete.
    request.body = { avatar_url: 'avatar.png', file_name: 'chat-a', chat: [{ chat_metadata: { logic_engine_conversation_id: conversationUuid } }, makeMessage({ messageId, versions: [{ versionId: version2, text: 'private-after', parentVersionId: version1 }], activeVersionIndex: 0 })] };
    const deleteResponse = responseMock();
    await createHostLifecycleMutationMiddleware({ requirePersistedInventory: true, requireCoreInventory: true })(request, deleteResponse, async () => {
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
    const tombstoneSnapshot = await getHostConversationInventory(request, { requireCoreInventory: true });
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
    const rollback = await getHostConversationInventory(request, { requireCoreInventory: true });
    assert.equal(rollback.complete, false);
    assert.ok(rollback.errors.includes('CORE_HOST_INVENTORY_ROLLBACK_OR_DIVERGENCE'));
    assert.equal(rollback.mutationJournal.snapshotConsistency, 'CORE_ANCHOR_DIVERGENCE');
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of envKeys) {
      if (priorEnv[key] === undefined) delete process.env[key];
      else process.env[key] = priorEnv[key];
    }
    await rm(root, { recursive: true, force: true });
  }
});
