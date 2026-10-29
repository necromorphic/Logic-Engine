import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createHostLifecycleMutationMiddleware, registerHostConversation } from '../server-lifecycle-mutation-journal.mjs';

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

test('sanitized filename alias cannot bypass the enrolled chat save persistence receipt', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'host-save-receipt-'));
  const directories = {
    chats: path.join(root, 'chats'),
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
  await writeFile(chatPath, [JSON.stringify(header), JSON.stringify(before)].join('\n') + '\n');

  const request = {
    method: 'POST', baseUrl: '/api/chats', path: '/save', originalUrl: '/api/chats/save',
    body: {
      avatar_url: 'avatar.png',
      file_name: 'chat-a?',
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

    const response = responseMock();
    await createHostLifecycleMutationMiddleware({ requirePersistedInventory: true })(request, response, async () => {
      // Simulate a native save path that reports success but leaves the old
      // persisted JSONL untouched (the failure mode the client helper hides).
      response.json({ ok: true });
    });
    await response.finished;

    assert.equal(response.statusCode, 503);
    assert.match(response.body, /HOST_SAVE_PERSISTENCE_MISMATCH/);
    assert.doesNotMatch(response.body, /"ok":true/);

    const journalText = await readFile(path.join(root, '.logic-engine-host', 'mutation-ledger.jsonl'), 'utf8');
    const records = journalText.trim().split('\n').map(line => JSON.parse(line));
    const outcome = records.find(record => record.kind === 'outcome');
    assert.equal(outcome.status, 'UNRESOLVED');
    assert.equal(outcome.persistenceVerification, 'HOST_SAVE_PERSISTENCE_MISMATCH');
    assert.doesNotMatch(journalText, /persisted-before|new-but-not-written/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test('matching persisted enrolled chat receives success only after the version inventory matches', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'host-save-receipt-success-'));
  const directories = {
    chats: path.join(root, 'chats'),
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
  await writeFile(chatPath, [JSON.stringify(header), JSON.stringify(before)].join('\n') + '\n');

  const request = {
    method: 'POST', baseUrl: '/api/chats', path: '/save', originalUrl: '/api/chats/save',
    body: { avatar_url: 'avatar.png', file_name: 'chat-a', chat: [header, after] },
    user: { profile: { handle: 'save-receipt-success-test' }, directories },
  };
  try {
    await registerHostConversation(request, {
      conversationId, sourceLocator: 'chat-a', sourcePath: 'avatar/chat-a.jsonl', domain: 'chats',
    });
    const response = responseMock();
    await createHostLifecycleMutationMiddleware({ requirePersistedInventory: true })(request, response, async () => {
      await writeFile(chatPath, request.body.chat.map(JSON.stringify).join('\n') + '\n');
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


test('pinned browser bridge verifies persisted chat before committing its lifecycle checkpoint', async () => {
  const patchUrl = new URL('../patches/sillytavern-1.19.0-lifecycle-hooks.patch', import.meta.url);
  const patch = await readFile(patchUrl, 'utf8');
  assert.match(patch, /saveChat: async \(\) => \{/);
  assert.match(patch, /await saveChatConditional\(\);[\s\S]*?\/api\/chats\/group\/get[\s\S]*?\/api\/chats\/get/);
  assert.match(patch, /persistedChat\.length !== chat\.length \+ 1/);
  assert.match(patch, /persisted Host chat differs from the current message\/version state/);
});
