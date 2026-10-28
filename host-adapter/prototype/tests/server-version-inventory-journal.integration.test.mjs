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

test('enrolled chat save stays blocked until a request-bound lifecycle capability exists', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'host-version-inventory-journal-'));
  const directories = {
    chats: path.join(root, 'chats'), characters: path.join(root, 'characters'), groups: path.join(root, 'groups'),
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
  const chatDirectory = path.join(directories.chats, 'character-a');
  await mkdir(chatDirectory, { recursive: true });
  const chatPath = path.join(chatDirectory, 'chat-a.jsonl');
  try {
    const persisted = [
      JSON.stringify({ chat_metadata: { logic_engine_conversation_id: conversationUuid } }),
      JSON.stringify(makeMessage({ messageId, versions: [{ versionId: version1, text: 'private-before' }], activeVersionIndex: 0 })),
      '',
    ].join('\n');
    await writeFile(chatPath, persisted);
    const conversationId = installationUuid + ':' + conversationUuid;
    await registerHostConversation(request, {
      conversationId,
      sourceLocator: 'chat-a', sourcePath: 'character-a/chat-a.jsonl', domain: 'chats',
    });
    await recordHostCaptureAcknowledgement(request, {
      conversation_id: conversationId, message_id: messageId, version_id: version1, parent_version_id: null,
      content_sha256: digest('private-before'), active: true, deleted: false,
    });

    const before = await getHostConversationInventory(request);
    assert.equal(before.complete, true);
    assert.equal(before.currentVersionCount, 1);
    request.body = {
      avatar_url: 'character-a.png',
      file_name: 'chat-a',
      chat: [makeMessage({
        messageId,
        versions: [
          { versionId: version1, text: 'private-before' },
          { versionId: version2, text: 'private-after', parentVersionId: version1 },
        ],
        activeVersionIndex: 1,
      })],
    };
    const response = responseMock();
    let reachedNativeSave = false;
    await createHostLifecycleMutationMiddleware({ requirePersistedInventory: true })(request, response, async () => {
      reachedNativeSave = true;
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

    assert.equal(reachedNativeSave, false, 'native overwrite must not run without the request-bound capability');
    assert.equal(response.statusCode, 409);
    assert.match(String(response.body), /HOST_ENROLLED_HISTORY_SAVE_CAPABILITY_REQUIRED/);
    assert.equal(await readFile(chatPath, 'utf8'), persisted, 'blocked save must leave persisted source byte-for-byte unchanged');

    const after = await getHostConversationInventory(request);
    assert.equal(after.complete, true);
    assert.equal(after.currentVersionCount, 1);
    assert.equal(after.versionCount, 1);
    assert.doesNotMatch(await readFile(chatPath, 'utf8'), /private-after/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
