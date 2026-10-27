import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createHostLifecycleMutationMiddleware, registerHostConversation } from '../server-lifecycle-mutation-journal.mjs';

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
    await registerHostConversation(request, {
      conversationId: installationUuid + ':' + conversationUuid,
      sourceLocator: 'chat-a', sourcePath: 'chat-a.jsonl', domain: 'chats',
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
    const journal = await readFile(path.join(root, '.logic-engine-host', 'mutation-ledger.jsonl'), 'utf8');
    const records = journal.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(records.length, 2);
    assert.equal(records[0].beforeConversationInventories[0].versions.length, 1);
    assert.equal(records[1].afterConversationInventories[0].versions.length, 2);
    assert.ok(records[0].beforeConversationInventoryDigest);
    assert.ok(records[1].afterConversationInventoryDigest);
    assert.ok(records[1].versionChanges.some(change => change.change === 'ADDED' && change.version_id === version2));
    assert.ok(records[1].versionChanges.some(change => change.change === 'ACTIVE_CHANGED' && change.version_id === version1));
    assert.doesNotMatch(journal, /private-before|private-after/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
