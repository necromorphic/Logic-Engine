import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const patch = await readFile(new URL('../patches/sillytavern-1.19.0-lifecycle-hooks.patch', import.meta.url), 'utf8');
const bridge = await readFile(new URL('../st-lifecycle-bridge.mjs', import.meta.url), 'utf8');

test('pinned SillyTavern patch runs automatic Host enrollment on CHAT_CHANGED', () => {
  assert.match(patch, /eventSource\.on\(event_types\.CHAT_CHANGED, async changedLocator => \{/,
    'the installed Host patch must subscribe to the native SillyTavern chat-change event');
  assert.match(patch, /await captureLogicEngineHostChatOnLoad\(changedLocator\)/,
    'the chat-change event must await automatic capture before the event completes');
  assert.match(patch, /const enrollment = await bridge\.ensureCurrentConversationEnrolled\(\)/,
    'chat-load capture must restore or create the Host baseline without a console action');
  assert.match(patch, /const inventory = await bridge\.syncCurrentDigestInventory\(\)/,
    'chat-load capture must automatically sync the current inventory after enrollment');
});

test('Host bridge exposes idempotent chat-load enrollment and verifies existing journal identity', () => {
  assert.match(bridge, /async function ensureCurrentConversationEnrolled\(\)/);
  assert.match(bridge, /await assertIdentitySnapshotMatches\(conversationId, chat\)/);
  assert.match(bridge, /await journal\.verifyIntegrity\(conversationId\)/);
  assert.match(bridge, /ensureCurrentConversationEnrolled,/);
});
