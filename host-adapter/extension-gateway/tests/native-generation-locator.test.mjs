import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHostGenerationIdentity } from '../index.js';

const conversationUuid = '44444444-4444-4444-8444-444444444444';

function eventContext() {
  const listeners = new Map();
  const eventSource = {
    on(name, callback) { listeners.set(name, callback); },
    removeListener(name, callback) {
      if (listeners.get(name) === callback) listeners.delete(name);
    },
  };
  return {
    listeners,
    context: {
      eventSource,
      eventTypes: {
        CHAT_COMPLETION_SETTINGS_READY: 'chat-completion-settings-ready',
        GENERATE_AFTER_DATA: 'generate-after-data',
      },
    },
  };
}

test('native ST generation events receive only bounded Host locators before request serialization', async () => {
  const { listeners, context } = eventContext();
  const unregister = await registerHostGenerationIdentity(context, {
    resolveHostContext: async ({ getHostContext }) => {
      assert.equal(getHostContext, context);
      return { conversationUuid, maxContext: 8192 };
    },
  });
  const chat = { model: 'selected-model', messages: [{ role: 'user', content: 'hello' }] };
  const text = { type: 'continue', prompt: 'hello' };
  await listeners.get('chat-completion-settings-ready')(chat);
  await listeners.get('generate-after-data')(text);

  for (const data of [chat, text]) {
    assert.equal(data.logic_engine_conversation_uuid, conversationUuid);
    assert.match(data.logic_engine_request_id, /^[0-9a-f-]{36}$/i);
    assert.match(data.logic_engine_generation_id, /^[0-9a-f-]{36}$/i);
    assert.notEqual(data.logic_engine_generation_id, data.logic_engine_request_id);
    assert.equal(data.logic_engine_context_size, 8192);
    assert.equal(data.logic_engine_generation_type, data.type ?? 'normal');
    assert.equal('world_id' in data, false);
    assert.equal('actor_id' in data, false);
    assert.equal('memory' in data, false);
  }
  unregister();
  assert.equal(listeners.size, 0);
});

test('locator preparation failure does not break ordinary generation; protected Host rejects missing locator', async () => {
  const { listeners, context } = eventContext();
  await registerHostGenerationIdentity(context, {
    resolveHostContext: async () => { throw new Error('identity unavailable'); },
  });
  const data = { type: 'normal', prompt: 'ordinary generation' };
  await listeners.get('generate-after-data')(data);
  assert.equal(data.prompt, 'ordinary generation');
  assert.equal(data.logic_engine_conversation_uuid, undefined);
  assert.equal(data.logic_engine_request_id, undefined);
  assert.equal(data.logic_engine_generation_id, undefined);
});
