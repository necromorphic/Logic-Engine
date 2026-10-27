import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.env.SILLYTAVERN_DIR ?? resolve(process.cwd(), 'SillyTavern');
const targetSha = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';

const [events, script] = await Promise.all([
  readFile(resolve(root, 'public/scripts/events.js'), 'utf8'),
  readFile(resolve(root, 'public/script.js'), 'utf8'),
]);

test('audit input is the exact pinned SillyTavern commit', async () => {
  const { execFileSync } = await import('node:child_process');
  const actual = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(actual, targetSha, 'Do not run this audit against an unpinned or different checkout');
});

test('pinned event catalog declares lifecycle hooks under audit', () => {
  for (const name of [
    'MESSAGE_SENT', 'MESSAGE_RECEIVED', 'MESSAGE_EDITED', 'MESSAGE_UPDATED',
    'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'MESSAGE_SWIPE_DELETED',
    'GENERATION_STARTED', 'GENERATION_STOPPED', 'GENERATION_ENDED',
    'CHAT_CHANGED', 'CHAT_LOADED', 'USER_MESSAGE_RENDERED', 'CHARACTER_MESSAGE_RENDERED',
  ]) {
    assert.match(events, new RegExp('\\b' + name + ':'));
  }
});

test('user send emits MESSAGE_SENT after save and before render notification', () => {
  const start = script.indexOf('async function sendMessageAsUser(');
  assert.notEqual(start, -1, 'sendMessageAsUser source site must exist');
  const end = script.indexOf('Gets the maximum context token limit', start);
  assert.notEqual(end, -1, 'sendMessageAsUser end boundary must exist');
  const body = script.slice(start, end);
  const save = body.indexOf('await saveChatConditional();');
  const sent = body.indexOf('await eventSource.emit(event_types.MESSAGE_SENT,');
  const rendered = body.indexOf('await eventSource.emit(event_types.USER_MESSAGE_RENDERED,');
  assert.ok(save >= 0 && sent > save && rendered > sent, 'expected save → MESSAGE_SENT → USER_MESSAGE_RENDERED');
  assert.match(body, /event_types\.MESSAGE_SENT,\s*(?:insertAt|chat_id)\s*\)/);
});

test('generated-message receive event is emitted during finalization before finish handler saves', () => {
  const finalizerStart = script.indexOf('async finalizeIntermediaryMessage(');
  const finishStart = script.indexOf('async onFinishStreaming(', finalizerStart);
  const errorStart = script.indexOf('onErrorStreaming()', finishStart);
  assert.ok(finalizerStart >= 0 && finishStart > finalizerStart && errorStart > finishStart);
  const finalizer = script.slice(finalizerStart, finishStart);
  const finish = script.slice(finishStart, errorStart);
  assert.match(finalizer, /eventSource\.emit\(event_types\.MESSAGE_RECEIVED,\s*this\.messageId,\s*this\.type\)/);
  const finalizeCall = finish.indexOf('this.finalizeIntermediaryMessage(');
  const saveCall = finish.indexOf('await saveChatConditional();');
  assert.ok(finalizeCall >= 0 && saveCall > finalizeCall, 'MESSAGE_RECEIVED finalization precedes the save call');
});

test('delete notification carries chat.length rather than a durable deleted-message identity', () => {
  assert.match(script, /chat\.length\s*=\s*chat\.length\s*-\s*1;[\s\S]{0,240}event_types\.MESSAGE_DELETED,\s*chat\.length/);
});

test('swipe notification carries the host-local message index', () => {
  assert.match(script, /event_types\.MESSAGE_SWIPED,\s*\(mesId\)/);
});

test('edit/update notifications use the current host-local edit index', () => {
  assert.match(script, /event_types\.MESSAGE_EDITED,\s*this_edit_mes_id/);
  assert.match(script, /event_types\.MESSAGE_UPDATED,\s*this_edit_mes_id/);
});


test('server-side chat mutation routes remain an explicit NON_READY boundary (static audit, not a runtime guard test)', async () => {
  const chatsRoutes = await readFile(resolve(root, 'src/endpoints/chats.js'), 'utf8');
  const backupRoutes = await readFile(resolve(root, 'src/endpoints/backups.js'), 'utf8');

  // These handlers operate on server-side artifacts and are not called through
  // the browser's localStorage enrollment marker or Host lifecycle bridge.
  // This test deliberately records the gap; it does NOT claim the routes are safe.
  for (const route of [
    "router.post('/save'",
    "router.post('/rename'",
    "router.post('/delete'",
    "router.post('/group/import'",
    "router.post('/import'",
    "router.post('/group/delete'",
    "router.post('/group/save'",
  ]) {
    assert.ok(chatsRoutes.includes(route), `pinned server mutation route must be reviewed: ${route}`);
  }
  assert.ok(backupRoutes.includes("router.post('/chat/delete'"), 'backup deletion route must be reviewed');

  assert.match(chatsRoutes, /await trySaveChat\(chatData, chatFilePath/);
  assert.match(chatsRoutes, /tryDeleteFile\(chatFilePath\)/);
  assert.match(chatsRoutes, /fs\.copyFileSync\(pathToUpload, pathToNewFile\)/);
  assert.match(backupRoutes, /await fsPromises\.unlink\(filePath\)/);

  assert.doesNotMatch(chatsRoutes, /logic-engine-host-lifecycle|guardOperation\(/,
    'pinned chats.js has no Host enrollment/bridge guard; do not claim direct server API calls are intercepted');
  assert.doesNotMatch(backupRoutes, /logic-engine-host-lifecycle|guardOperation\(/,
    'pinned backups.js has no Host enrollment/bridge guard; backup deletion remains outside browser protection');
});
