import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createHostLifecycleSaveGuard } from '../server-plugin/st-host-inventory-handler.mjs';

const PINNED_HOST_COMMIT = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';
const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const ENROLLED_CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_CONVERSATION_ID = '33333333-3333-4333-8333-333333333333';

function responseRecorder() {
  return {
    statusCode: null,
    payload: null,
    headers: {},
    set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    sendStatus(code) { this.statusCode = code; return this; },
  };
}

async function setupDirectories(t) {
  const parent = await mkdtemp(join(tmpdir(), 'host-lifecycle-save-guard-'));
  const root = join(parent, 'default-user');
  const directories = {
    root,
    chats: join(root, 'chats'),
    groups: join(root, 'groups'),
    groupChats: join(root, 'groupChats'),
    extensions: join(root, 'extensions'),
  };
  await Promise.all([
    mkdir(join(directories.chats, 'Assistant'), { recursive: true }),
    mkdir(directories.groups, { recursive: true }),
    mkdir(directories.groupChats, { recursive: true }),
    mkdir(directories.extensions, { recursive: true }),
  ]);
  t.after(() => rm(parent, { recursive: true, force: true }));
  return directories;
}

function saveRequest(directories, chatMetadata = {}) {
  return {
    path: '/save',
    body: {
      avatar_url: 'Assistant.png',
      file_name: 'new-chat',
      chat: [{ chat_metadata: chatMetadata }],
    },
    user: {
      profile: { handle: 'default-user' },
      directories,
    },
    session: {
      logicEngineSessionHandle: 'default-user',
      logicEngineSessionId: SESSION_ID,
    },
  };
}

test('ordinary un-enrolled new and existing chats save without requiring VSS inventory', async t => {
  const directories = await setupDirectories(t);
  const target = join(directories.chats, 'Assistant', 'new-chat.jsonl');
  let inventoryCalls = 0;
  let nextCalls = 0;
  const guard = createHostLifecycleSaveGuard({
    pinnedHostCommit: PINNED_HOST_COMMIT,
    enumerate: async () => {
      inventoryCalls++;
      throw new Error('VSS must not be required for un-enrolled chat saves');
    },
  });

  const newChatResponse = responseRecorder();
  await guard(saveRequest(directories), newChatResponse, () => { nextCalls++; });
  assert.equal(newChatResponse.statusCode, null);
  assert.equal(nextCalls, 1);
  assert.equal(inventoryCalls, 0);

  await writeFile(target, JSON.stringify({ chat_metadata: {} }) + '\n', 'utf8');
  const existingChatResponse = responseRecorder();
  await guard(saveRequest(directories), existingChatResponse, () => { nextCalls++; });
  assert.equal(existingChatResponse.statusCode, null);
  assert.equal(nextCalls, 2);
  assert.equal(inventoryCalls, 0);
});

test('an enrolled target still requires full inventory and rejects a payload with its identity removed', async t => {
  const directories = await setupDirectories(t);
  const target = join(directories.chats, 'Assistant', 'new-chat.jsonl');
  await writeFile(target, JSON.stringify({
    chat_metadata: { logic_engine_conversation_id: ENROLLED_CONVERSATION_ID },
  }) + '\n', 'utf8');

  let inventoryCalls = 0;
  let nextCalls = 0;
  const guard = createHostLifecycleSaveGuard({
    pinnedHostCommit: PINNED_HOST_COMMIT,
    enumerate: async () => {
      inventoryCalls++;
      return {
        filesystem: { status: 'complete' },
        source: {
          status: 'DOUBLE_SCAN_CANDIDATE',
          files: [{
            kind: 'character-chat',
            locator: 'Assistant/new-chat.jsonl',
            logical_identity: { conversation_uuid: ENROLLED_CONVERSATION_ID },
          }],
        },
      };
    },
  });

  const response = responseRecorder();
  await guard(saveRequest(directories), response, () => { nextCalls++; });
  assert.equal(inventoryCalls, 1);
  assert.equal(response.statusCode, 409);
  assert.equal(response.payload.code, 'HOST_LIFECYCLE_SAVE_PAYLOAD_IDENTITY_MISMATCH');
  assert.equal(nextCalls, 0);
});

test('a new chat claiming a Host conversation identity still passes through inventory policy', async t => {
  const directories = await setupDirectories(t);
  let inventoryCalls = 0;
  let nextCalls = 0;
  const guard = createHostLifecycleSaveGuard({
    pinnedHostCommit: PINNED_HOST_COMMIT,
    enumerate: async () => {
      inventoryCalls++;
      return {
        filesystem: { status: 'complete' },
        source: {
          status: 'DOUBLE_SCAN_CANDIDATE',
          files: [{
            kind: 'character-chat',
            locator: 'Assistant/other-chat.jsonl',
            logical_identity: { conversation_uuid: OTHER_CONVERSATION_ID },
          }],
        },
      };
    },
  });

  const response = responseRecorder();
  await guard(saveRequest(directories, {
    logic_engine_conversation_id: ENROLLED_CONVERSATION_ID,
  }), response, () => { nextCalls++; });
  assert.equal(inventoryCalls, 1);
  assert.equal(response.statusCode, 409);
  assert.equal(response.payload.code, 'HOST_LIFECYCLE_SAVE_TARGET_NOT_ENROLLED');
  assert.equal(nextCalls, 0);
});
