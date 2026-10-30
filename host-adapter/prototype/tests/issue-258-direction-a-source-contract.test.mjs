import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const patch = await readFile(resolve(here, '../patches/issue-258-direction-a-delete-safety.patch'), 'utf8');

test('stale editor selection fails closed without DOM-index substitution', () => {
  assert.ok(patch.includes('if (!Number.isInteger(id) || id < 0 || id >= chat.length)'));
  assert.ok(patch.includes('expectedMessage !== undefined && targetMessage !== expectedMessage'));
  assert.ok(patch.includes('const editIndex = this_edit_mes_id;'));
  assert.ok(patch.includes('this_edit_mes_target = editMessage;'));
  assert.ok(patch.includes('message !== this_edit_mes_target'));
  assert.ok(patch.includes('domIndex !== editIndex'));
  assert.ok(!patch.includes('const editIndex = domIndex'));
  assert.ok(patch.includes('true, this_edit_mes_target);'));
});

test('delete-last, bulk-delete and swipe targets are revalidated after asynchronous write-ahead', () => {
  assert.ok(patch.includes('const targetIndex = targetChat.length - 1;'));
  assert.ok(patch.includes('chat.length - 1 !== targetIndex'));
  assert.ok(patch.includes('const deletedTargets = messageIds.map(messageId => targetChat[messageId]);'));
  assert.ok(patch.includes('messageIds.some((messageId, index) => chat[messageId] !== deletedTargets[index])'));
  assert.ok(patch.includes('const swipeSnapshot = targetSwipes.slice();'));
  assert.ok(patch.includes('targetSwipes.some((value, index) => value !== swipeSnapshot[index])'));
  assert.ok(patch.includes('getCurrentChatId() !== targetLocator'));
});

test('/delname participates in lifecycle write-ahead and revalidates every selected message', () => {
  assert.ok(patch.includes("lifecycle.guardOperation('delete-message', messageIndexes, { source: 'slash-command-delname' })"));
  assert.ok(patch.includes('messagesToDelete.some(item => chat[item.index] !== item.message)'));
  assert.ok(patch.includes('messagesToDelete.slice().reverse()'));
  assert.ok(!patch.split('\n').some(line => line.startsWith('+') && line.includes('console.debug(`/delname: Deleting message #${index}`, message)')));
  assert.ok(patch.includes("lifecycle.completeOperation('delete-message', { source: 'slash-command-delname' })"));
});
