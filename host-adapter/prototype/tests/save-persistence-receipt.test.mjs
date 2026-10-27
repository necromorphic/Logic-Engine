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
    const originalFetch = globalThis.fetch;
    const envKeys = ['LOGIC_ENGINE_CORE_URL', 'LOGIC_ENGINE_API_TOKEN', 'LOGIC_ENGINE_ADAPTER_ID', 'LOGIC_ENGINE_ADAPTER_TOKEN'];
    const priorEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
    const captured = [];
    const remoteVersions = new Map([[JSON.stringify([conversationId, messageId, version1]), {
      message_id: messageId, version_id: version1, content_sha256: digest('before'), active: true, deleted: false,
    }]]);
    process.env.LOGIC_ENGINE_CORE_URL = 'http://127.0.0.1:8787';
    process.env.LOGIC_ENGINE_API_TOKEN = 'test-core-api-token-long-enough';
    process.env.LOGIC_ENGINE_ADAPTER_ID = 'adapter-test';
    process.env.LOGIC_ENGINE_ADAPTER_TOKEN = 'test-adapter-token-long-enough';
    globalThis.fetch = async (url, options) => {
      const endpoint = new URL(String(url));
      if (endpoint.pathname.endsWith('/inventory')) {
        return { ok: true, status: 200, json: async () => ({ inventory: {
          authority: 'CORE_HOST_VERSION_LEDGER', conversation_id: conversationId,
          inventory_status: 'NON_READY', versions: [...remoteVersions.values()],
        } }) };
      }
      const body = JSON.parse(options.body);
      captured.push({ url: String(url), body });
      if (body.active) {
        for (const [key, value] of remoteVersions) {
          if (value.message_id === body.message_id) remoteVersions.set(key, { ...value, active: false });
        }
      }
      const key = JSON.stringify([body.conversation_id, body.message_id, body.version_id]);
      remoteVersions.set(key, { message_id: body.message_id, version_id: body.version_id,
        content_sha256: body.content_sha256, active: body.active, deleted: body.deleted });
      return { ok: true, status: 201, json: async () => ({ capture: { status: 'captured' } }) };
    };
    try {
      await createHostLifecycleMutationMiddleware({ requirePersistedInventory: true })(request, response, async () => {
        await writeFile(chatPath, request.body.chat.map(JSON.stringify).join('\\n') + '\\n');
        response.json({ ok: true });
      });
      await response.finished;
    } finally {
      globalThis.fetch = originalFetch;
      for (const key of envKeys) {
        if (priorEnv[key] === undefined) delete process.env[key];
        else process.env[key] = priorEnv[key];
      }
    }
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { ok: true });
    assert.equal(captured.length, 2);
    assert.ok(captured.every(item => item.url === 'http://127.0.0.1:8787/v1/host-version-ledger/capture'));
    assert.ok(captured.every(item => Object.keys(item.body).sort().join(',') === 'active,content_sha256,conversation_id,deleted,message_id,version_id'));
    assert.doesNotMatch(JSON.stringify(captured), /"mes"|before|after/);

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


test('pinned Host inventory checks the independent Core ledger and fails closed on rollback divergence', async () => {
  const patchUrl = new URL('../patches/sillytavern-1.19.0-lifecycle-hooks.patch', import.meta.url);
  const patch = await readFile(patchUrl, 'utf8');
  assert.match(patch, /\/v1\/host-version-ledger\/inventory/);
  assert.match(patch, /CORE_HOST_INVENTORY_UNAVAILABLE/);
  assert.match(patch, /CORE_HOST_INVENTORY_ROLLBACK_OR_DIVERGENCE/);
  assert.match(patch, /remote\.payload_sha256 !== local\.payload_sha256/);
  assert.match(patch, /remote\.active !== local\.active/);
  assert.match(patch, /redirect: 'error'/);
  assert.match(patch, /publishCoreInventorySnapshot\(before, after\)/);
  assert.match(patch, /HOST_MUTATION_PATH_NOT_PROVEN/);
  assert.match(patch, /CORE_HOST_CAPTURE_FAILED/);
  assert.match(patch, /raw content|message text/i);
});


test('enrolled destructive mutation is blocked before the native handler runs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'host-destructive-guard-'));
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
  const chatPath = path.join(chatDirectory, 'chat-a.jsonl');
  const header = { chat_metadata: { logic_engine_conversation_id: conversationUuid } };
  await writeFile(chatPath, JSON.stringify(header) + '\\n');
  const request = {
    method: 'POST', baseUrl: '/api/chats', path: '/delete', originalUrl: '/api/chats/delete',
    body: { file_name: 'chat-a', avatar_url: 'avatar.png' },
    user: { profile: { handle: 'destructive-guard-test' }, directories },
  };
  try {
    await registerHostConversation(request, {
      conversationId, sourceLocator: 'chat-a', sourcePath: 'avatar/chat-a.jsonl', domain: 'chats',
    });
    const response = responseMock();
    let nextCalled = false;
    await createHostLifecycleMutationMiddleware({ requirePersistedInventory: true })(request, response, async () => {
      nextCalled = true;
      response.json({ ok: true });
    });
    await response.finished;
    assert.equal(nextCalled, false);
    assert.equal(response.statusCode, 503);
    assert.match(response.body, /HOST_MUTATION_PATH_NOT_PROVEN/);
    assert.equal(await readFile(chatPath, 'utf8'), JSON.stringify(header) + '\\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('enrolled save fails closed when Core cannot durably capture the digest inventory', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'host-core-capture-fail-'));
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
  const versionId = randomUUID();
  const chatPath = path.join(chatDirectory, 'chat-a.jsonl');
  const header = { chat_metadata: { logic_engine_conversation_id: conversationUuid } };
  const current = message({ messageId, versions: [{ versionId, text: 'private message text' }], activeVersionIndex: 0 });
  await writeFile(chatPath, [JSON.stringify(header), JSON.stringify(current)].join('\\n') + '\\n');
  const request = {
    method: 'POST', baseUrl: '/api/chats', path: '/save', originalUrl: '/api/chats/save',
    body: { avatar_url: 'avatar.png', file_name: 'chat-a', chat: [header, current] },
    user: { profile: { handle: 'core-capture-fail-test' }, directories },
  };
  const envKeys = ['LOGIC_ENGINE_CORE_URL', 'LOGIC_ENGINE_API_TOKEN', 'LOGIC_ENGINE_ADAPTER_ID', 'LOGIC_ENGINE_ADAPTER_TOKEN'];
  const priorEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  process.env.LOGIC_ENGINE_CORE_URL = 'http://127.0.0.1:8787';
  process.env.LOGIC_ENGINE_API_TOKEN = 'test-core-api-token-long-enough';
  process.env.LOGIC_ENGINE_ADAPTER_ID = 'adapter-test';
  process.env.LOGIC_ENGINE_ADAPTER_TOKEN = 'test-adapter-token-long-enough';
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/inventory')) {
      return { ok: true, status: 200, json: async () => ({ inventory: {
        authority: 'CORE_HOST_VERSION_LEDGER', conversation_id: conversationId,
        inventory_status: 'NON_READY',
        versions: [{ message_id: messageId, version_id: versionId, content_sha256: digest('private message text'), active: true, deleted: false }],
      } }) };
    }
    throw new Error('Core unavailable');
  };
  try {
    await registerHostConversation(request, {
      conversationId, sourceLocator: 'chat-a', sourcePath: 'avatar/chat-a.jsonl', domain: 'chats',
    });
    const response = responseMock();
    await createHostLifecycleMutationMiddleware({ requirePersistedInventory: true })(request, response, async () => {
      await writeFile(chatPath, request.body.chat.map(JSON.stringify).join('\\n') + '\\n');
      response.json({ ok: true });
    });
    await response.finished;
    assert.equal(response.statusCode, 503);
    assert.match(response.body, /CORE_HOST_CAPTURE_FAILED/);
    const journalText = await readFile(path.join(root, '.logic-engine-host', 'mutation-ledger.jsonl'), 'utf8');
    const outcome = journalText.trim().split('\\n').map(line => JSON.parse(line)).find(record => record.kind === 'outcome');
    assert.equal(outcome.status, 'UNRESOLVED');
    assert.doesNotMatch(journalText, /private message text/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of envKeys) {
      if (priorEnv[key] === undefined) delete process.env[key];
      else process.env[key] = priorEnv[key];
    }
    await rm(root, { recursive: true, force: true });
  }
});


test('preflight blocks a save before mutation when Core retains a newer version than restored local files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'host-core-rollback-preflight-'));
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
  const header = { chat_metadata: { logic_engine_conversation_id: conversationUuid } };
  const oldMessage = message({ messageId, versions: [{ versionId: version1, text: 'old state' }], activeVersionIndex: 0 });
  const chatPath = path.join(chatDirectory, 'chat-a.jsonl');
  await writeFile(chatPath, [JSON.stringify(header), JSON.stringify(oldMessage)].join('\\n') + '\\n');
  const request = {
    method: 'POST', baseUrl: '/api/chats', path: '/save', originalUrl: '/api/chats/save',
    body: { avatar_url: 'avatar.png', file_name: 'chat-a', chat: [header, oldMessage] },
    user: { profile: { handle: 'core-rollback-preflight-test' }, directories },
  };
  const envKeys = ['LOGIC_ENGINE_CORE_URL', 'LOGIC_ENGINE_API_TOKEN', 'LOGIC_ENGINE_ADAPTER_ID', 'LOGIC_ENGINE_ADAPTER_TOKEN'];
  const priorEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  process.env.LOGIC_ENGINE_CORE_URL = 'http://127.0.0.1:8787';
  process.env.LOGIC_ENGINE_API_TOKEN = 'test-core-api-token-long-enough';
  process.env.LOGIC_ENGINE_ADAPTER_ID = 'adapter-test';
  process.env.LOGIC_ENGINE_ADAPTER_TOKEN = 'test-adapter-token-long-enough';
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ inventory: {
    authority: 'CORE_HOST_VERSION_LEDGER', conversation_id: conversationId,
    inventory_status: 'NON_READY',
    versions: [
      { message_id: messageId, version_id: version1, content_sha256: digest('old state'), active: false, deleted: false },
      { message_id: messageId, version_id: version2, content_sha256: digest('new state'), active: true, deleted: false },
    ],
  } }) });
  try {
    await registerHostConversation(request, {
      conversationId, sourceLocator: 'chat-a', sourcePath: 'avatar/chat-a.jsonl', domain: 'chats',
    });
    const response = responseMock();
    let nextCalled = false;
    await createHostLifecycleMutationMiddleware({ requirePersistedInventory: true })(request, response, async () => {
      nextCalled = true;
      response.json({ ok: true });
    });
    await response.finished;
    assert.equal(nextCalled, false);
    assert.equal(response.statusCode, 503);
    assert.match(response.body, /CORE_HOST_INVENTORY_ROLLBACK_OR_DIVERGENCE/);
    assert.equal(await readFile(chatPath, 'utf8'), [JSON.stringify(header), JSON.stringify(oldMessage)].join('\\n') + '\\n');
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of envKeys) {
      if (priorEnv[key] === undefined) delete process.env[key];
      else process.env[key] = priorEnv[key];
    }
    await rm(root, { recursive: true, force: true });
  }
});
