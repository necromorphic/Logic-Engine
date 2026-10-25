import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';

function createProvider(authorizeRawRead) {
  return new SQLiteMemoryProvider({
    getSnapshot: async () => ({ world_revision: 1, commit_sequence: 1 }),
    validateSourceVersion: async () => true,
    validateInventory: async () => true,
    authorizeRawRead,
  });
}

const capture = {
  world_id: 'world-race',
  conversation_id: 'chat-race',
  message_id: 'message-race',
  version_id: 'version-1',
  role: 'assistant',
  content: 'Must not be disclosed after deletion at the final read boundary.',
};

const key = {
  world_id: capture.world_id,
  conversation_id: capture.conversation_id,
  message_id: capture.message_id,
  version_id: capture.version_id,
};

test('deletion between initial load and final authorization cannot disclose a raw version', async () => {
  let provider;
  let checks = 0;
  provider = createProvider(async () => {
    checks += 1;
    if (checks === 2) provider.markRawSourceDeleted(key);
    return true;
  });
  try {
    provider.captureRawMessage(capture);
    await assert.rejects(
      () => provider.readRawMessageVersion(key),
      (error) => error.message === 'MEMORY_RAW_VERSION_UNAVAILABLE',
    );
    assert.equal(checks, 2);
  } finally {
    provider.close();
  }
});

test('deletion between active-message load and final authorization returns no deleted message', async () => {
  let provider;
  let checks = 0;
  provider = createProvider(async (request) => {
    assert.equal(request.action, 'read_active');
    checks += 1;
    if (checks === 2) provider.markRawSourceDeleted(key);
    return true;
  });
  try {
    provider.captureRawMessage(capture);
    provider.selectActiveRawVersion(key);
    const messages = await provider.readActiveRawMessages({
      world_id: capture.world_id,
      conversation_id: capture.conversation_id,
    });
    assert.deepEqual(messages, []);
    assert.equal(checks, 2);
  } finally {
    provider.close();
  }
});
