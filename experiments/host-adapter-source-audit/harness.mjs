import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.env.SILLYTAVERN_DIR ?? resolve(process.cwd(), 'SillyTavern');
const targetSha = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';

const mutationPaths = [
  'src/endpoints/characters.js',
  'src/endpoints/chats.js',
  'src/endpoints/groups.js',
  'src/endpoints/settings.js',
  'src/endpoints/avatars.js',
  'src/endpoints/backups.js',
  'src/endpoints/files.js',
  'src/endpoints/worldinfo.js',
  'src/endpoints/presets.js',
  'src/endpoints/quick-replies.js',
  'src/endpoints/themes.js',
  'src/endpoints/backgrounds.js',
  'src/endpoints/assets.js',
  'src/endpoints/data-maid.js',
  'src/endpoints/vectors.js',
  'src/endpoints/users-private.js',
  'src/endpoints/users-admin.js',
  'src/endpoints/extensions.js',
];
const [events, script, groupChats, chatBackups, ...mutationContents] = await Promise.all([
  readFile(resolve(root, 'public/scripts/events.js'), 'utf8'),
  readFile(resolve(root, 'public/script.js'), 'utf8'),
  readFile(resolve(root, 'public/scripts/group-chats.js'), 'utf8'),
  readFile(resolve(root, 'public/scripts/chat-backups.js'), 'utf8'),
  ...mutationPaths.map(path => readFile(resolve(root, path), 'utf8')),
]);
const mutationSources = Object.fromEntries(
  mutationPaths.map((path, index) => [path, mutationContents[index]]),
);

test('audit input is the exact pinned SillyTavern commit', async () => {
  if (existsSync(resolve(root, '.git'))) {
    const { execFileSync } = await import('node:child_process');
    const actual = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    assert.equal(actual, targetSha, 'Do not run this audit against an unpinned or different checkout');
    return;
  }
  // actions/checkout deliberately downloads a REST archive when the runner
  // has no Git executable. In that mode the workflow passes the checkout
  // action's resolved immutable ref as an explicit assertion.
  assert.equal(process.env.SILLYTAVERN_CHECKED_OUT_REF, targetSha,
    'REST archive audit requires the exact immutable checkout ref');
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


test('chat imports, group bookmark copies and backup restore fail closed while any chat is enrolled', () => {
  const characterImportStart = script.indexOf('export async function importCharacterChat(');
  const characterImportEnd = script.indexOf('\n}', characterImportStart);
  assert.ok(characterImportStart >= 0 && characterImportEnd > characterImportStart);
  assert.match(script.slice(characterImportStart, characterImportEnd),
    /logicEngineHostLifecycle\?\.guardBulkMutation\?\.\(\)/);

  const groupImportStart = groupChats.indexOf('export async function importGroupChat(');
  const groupImportEnd = groupChats.indexOf('\n}', groupImportStart);
  assert.ok(groupImportStart >= 0 && groupImportEnd > groupImportStart);
  assert.match(groupChats.slice(groupImportStart, groupImportEnd),
    /logicEngineHostLifecycle\?\.guardBulkMutation\?\.\(\)/);

  const bookmarkStart = groupChats.indexOf('export async function saveGroupBookmarkChat(');
  const bookmarkEnd = groupChats.indexOf('\n}', bookmarkStart);
  assert.ok(bookmarkStart >= 0 && bookmarkEnd > bookmarkStart);
  assert.match(groupChats.slice(bookmarkStart, bookmarkEnd),
    /logicEngineHostLifecycle\?\.guardBulkMutation\?\.\(\)/);

  const restoreStart = chatBackups.indexOf('async restoreBackup(name)');
  const restoreEnd = chatBackups.indexOf('\n    }', restoreStart);
  assert.ok(restoreStart >= 0 && restoreEnd > restoreStart);
  assert.match(chatBackups.slice(restoreStart, restoreEnd), /const importFn = context\.groupId \? importGroupChat : importCharacterChat/);
  assert.match(chatBackups.slice(restoreStart, restoreEnd), /await importFn\(formData/);
});

test('pinned server import routes reject bulk imports while any enrolled conversation exists', () => {
  const chats = mutationSources['src/endpoints/chats.js'];
  assert.match(chats, /createHostBulkMutationGuard/);
  assert.match(chats, /router\.post\('\/group\/import', hostBulkMutationGuard,/);
  assert.match(chats, /router\.post\('\/import', hostBulkMutationGuard,/);
});

test('pinned server mutation routes remain in the reviewed inventory', () => {
  const routeRequirements = {
    'src/endpoints/characters.js': [
      '/create', '/rename', '/edit', '/edit-avatar', '/edit-attribute',
      '/merge-attributes', '/delete', '/import', '/duplicate', '/export',
    ],
    'src/endpoints/chats.js': [
      '/save', '/rename', '/delete', '/export', '/group/import',
      '/import', '/group/delete', '/group/save',
    ],
    'src/endpoints/groups.js': ['/create', '/edit', '/delete'],
    'src/endpoints/settings.js': ['/save', '/load-snapshot', '/make-snapshot', '/restore-snapshot'],
    'src/endpoints/avatars.js': ['/delete', '/upload'],
    'src/endpoints/backups.js': ['/chat/delete'],
    'src/endpoints/files.js': ['/upload', '/delete'],
    'src/endpoints/worldinfo.js': ['/delete', '/import', '/edit'],
    'src/endpoints/presets.js': ['/save', '/delete', '/restore'],
    'src/endpoints/quick-replies.js': ['/save', '/delete'],
    'src/endpoints/themes.js': ['/save', '/delete'],
    'src/endpoints/backgrounds.js': ['/delete', '/rename', '/upload'],
    'src/endpoints/assets.js': ['/delete', '/character'],
    'src/endpoints/data-maid.js': ['/delete'],
    'src/endpoints/vectors.js': ['/insert', '/delete', '/purge-all', '/purge'],
    'src/endpoints/users-private.js': ['/reset-settings', '/reset-step2'],
    'src/endpoints/users-admin.js': ['/delete'],
    'src/endpoints/extensions.js': ['/install', '/update', '/switch', '/move', '/delete'],
  };

  for (const [file, routes] of Object.entries(routeRequirements)) {
    const source = mutationSources[file];
    assert.equal(typeof source, 'string', 'mutation source must be loaded: ' + file);
    for (const route of routes) {
      const singleQuoted = "router.post('" + route + "'";
      const doubleQuoted = 'router.post("' + route + '"';
      assert.ok(source.includes(singleQuoted) || source.includes(doubleQuoted),
        file + ' must retain reviewed mutation route ' + route);
    }
  }
});

test('pinned high-impact mutation implementations retain their write/delete primitives', () => {
  const requirements = {
    'src/endpoints/characters.js': ['writeFileAtomicSync', 'fs.cpSync', 'fs.rmSync', 'fs.copyFileSync'],
    'src/endpoints/chats.js': ['writeFileAtomicSync', 'fs.copyFileSync', 'fs.unlinkSync'],
    'src/endpoints/groups.js': ['writeFileAtomic', 'fsPromises.copyFile', 'fs.unlinkSync'],
    'src/endpoints/settings.js': ['writeFileAtomicSync', 'fs.copyFileSync'],
    'src/endpoints/avatars.js': ['writeFileAtomicSync', 'fs.unlinkSync'],
    'src/endpoints/backups.js': ['fsPromises.unlink'],
    'src/endpoints/files.js': ['writeFileSyncAtomic', 'fs.unlinkSync'],
    'src/endpoints/worldinfo.js': ['writeFileAtomicSync', 'fs.unlinkSync'],
    'src/endpoints/presets.js': ['writeFileAtomicSync', 'fs.unlinkSync'],
    'src/endpoints/quick-replies.js': ['writeFileAtomicSync', 'fs.unlinkSync'],
    'src/endpoints/themes.js': ['writeFileAtomicSync', 'fs.unlinkSync'],
    'src/endpoints/backgrounds.js': ['fs.copyFileSync', 'fs.unlinkSync'],
    'src/endpoints/assets.js': ['fs.createWriteStream', 'fs.copyFileSync', 'fs.unlinkSync'],
    'src/endpoints/data-maid.js': ['fs.promises.unlink'],
    'src/endpoints/vectors.js': ['fs.promises.rm'],
    'src/endpoints/users-private.js': ['fsPromises.rm'],
    'src/endpoints/users-admin.js': ['fsPromises.rm'],
    'src/endpoints/extensions.js': ['fs.promises.rm'],
  };

  for (const [file, primitives] of Object.entries(requirements)) {
    for (const primitive of primitives) {
      assert.ok(mutationSources[file].includes(primitive),
        file + ' must retain reviewed mutation primitive ' + primitive);
    }
  }
});
