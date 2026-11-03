import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';

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
  'src/endpoints/users-public.js',
  'src/users.js',
  'src/endpoints/users-admin.js',
  'src/endpoints/backends/kobold.js',
  'src/endpoints/openai.js',
  'src/endpoints/speech.js',
  'src/endpoints/tokenizers.js',
  'src/endpoints/extensions.js',
  'src/endpoints/content-manager.js',
  'src/endpoints/image-metadata.js',
  'src/endpoints/images.js',
  'src/endpoints/moving-ui.js',
  'src/endpoints/secrets.js',
  'src/endpoints/sprites.js',
  'src/endpoints/stable-diffusion.js',
  'src/endpoints/thumbnails.js',
  'src/endpoints/stats.js',
];
const [events, script, groupChats, chatBackups, serverMain, pluginLoader, extensionLoader, hostRoutePatch, lifecyclePatch, rootMutationPatch, ...mutationContents] = await Promise.all([
  readFile(resolve(root, 'public/scripts/events.js'), 'utf8'),
  readFile(resolve(root, 'public/script.js'), 'utf8'),
  readFile(resolve(root, 'public/scripts/group-chats.js'), 'utf8'),
  readFile(resolve(root, 'public/scripts/chat-backups.js'), 'utf8'),
  readFile(resolve(root, 'src/server-main.js'), 'utf8'),
  readFile(resolve(root, 'src/plugin-loader.js'), 'utf8'),
  readFile(resolve(root, 'public/scripts/extensions.js'), 'utf8'),
  readFile(resolve(process.cwd(), 'host-adapter/prototype/patches/sillytavern-1.19.0-source-inventory-route.patch'), 'utf8'),
  readFile(resolve(process.cwd(), 'host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-hooks.patch'), 'utf8'),
  readFile(resolve(process.cwd(), 'host-adapter/prototype/patches/sillytavern-1.19.0-root-mutation-guards.patch'), 'utf8'),
  ...mutationPaths.map(path => readFile(resolve(root, path), 'utf8')),
]);
const mutationSources = Object.fromEntries(
  mutationPaths.map((path, index) => [path, mutationContents[index]]),
);

const endpointDirectory = resolve(root, 'src/endpoints');
async function listEndpointFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listEndpointFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(fullPath);
  }
  return files;
}
const endpointFiles = await listEndpointFiles(endpointDirectory);
const endpointMutationCandidates = [];
const filesystemMutationPrimitive = /\b(?:fs|fsPromises|fs\.promises)\.(?:writeFile(?:Sync)?|writeFileAtomicSync?|writeFileSyncAtomic|tryWriteFileSync|appendFile(?:Sync)?|copyFile(?:Sync)?|cp(?:Sync)?|rename(?:Sync)?|unlink(?:Sync)?|rm(?:Sync)?|rmdir(?:Sync)?|mkdir(?:Sync)?|truncate(?:Sync)?|createWriteStream)\b|\b(?:writeFileAtomicSync?|writeFileSyncAtomic|tryWriteFileSync)\s*\(/;
for (const fullPath of endpointFiles) {
  const relative = 'src/endpoints/' + fullPath.slice(endpointDirectory.length + 1).split(sep).join('/');
  const source = mutationSources[relative] ?? await readFile(fullPath, 'utf8');
  if (filesystemMutationPrimitive.test(source) && !mutationPaths.includes(relative)) {
    endpointMutationCandidates.push(relative);
  }
}

test('every endpoint module with direct filesystem mutation primitives is in the reviewed source inventory', () => {
  assert.deepEqual(endpointMutationCandidates, [],
    'Add each newly discovered mutating endpoint to mutationPaths, SOURCE_FILE_PATHS, and an explicit route disposition');
});

test('server and browser extension loaders reject unreviewed third-party code before activation', async () => {
  assert.match(pluginLoader, /await updatePlugins\(pluginsPath\)/);
  assert.match(pluginLoader, /await loadFromDirectory\(app, pluginFilePath, exitHooks\)/);
  assert.match(extensionLoader, /fetch\('\/api\/extensions\/discover'\)/,
    'pinned browser loader must obtain extension names from the guarded server discovery route');
  const pluginStart = lifecyclePatch.indexOf('diff --git a/src/plugin-loader.js ');
  assert.ok(pluginStart >= 0, 'lifecycle patch must include the server plugin loader');
  const pluginEnd = lifecyclePatch.indexOf('\ndiff --git ', pluginStart + 10);
  const pluginSection = lifecyclePatch.slice(pluginStart, pluginEnd < 0 ? undefined : pluginEnd);
  const files = pluginLoader.indexOf('const files = fs.readdirSync(pluginsPath)');
  const update = pluginSection.indexOf('Skipping server-plugin auto-update while Host authority is active.');
  const allowlist = pluginSection.indexOf('HOST_UNREVIEWED_SERVER_PLUGIN_BLOCKED');
  const pluginFilePath = pluginSection.indexOf('const pluginFilePath = path.join(pluginsPath, file)');
  assert.ok(files >= 0 && pluginLoader.indexOf('await updatePlugins(pluginsPath)') > files
    && pluginSection.includes('if (hostAuthorityConfigured) {')
    && update >= 0 && allowlist > update && pluginFilePath > allowlist,
  'server plugin updates must be disabled in Host mode and unreviewed plugins rejected before import');

  const extensionStart = rootMutationPatch.indexOf('diff --git a/src/endpoints/extensions.js ');
  const extensionEnd = rootMutationPatch.indexOf('\ndiff --git ', extensionStart + 10);
  const extensionSection = rootMutationPatch.slice(extensionStart, extensionEnd < 0 ? undefined : extensionEnd);
  assert.match(extensionSection, /const hostAuthorityConfigured = Boolean\(process\.env\.LOGIC_ENGINE_HOST_IDENTITY_DIR\)/);
  assert.match(extensionSection, /\.filter\(f => !hostAuthorityConfigured\)/);
  assert.match(extensionSection, /f === 'logic-engine-extension-gateway'/);

  const attestation = await readFile(resolve(process.cwd(),
    'host-adapter/extension-gateway/server-plugin/st-source-attestation.mjs'), 'utf8');
  assert.match(attestation, /HOST_UNREVIEWED_USER_EXTENSION_PRESENT/);
  assert.match(attestation, /userExtensionsPath/);
  const hostHandler = await readFile(resolve(process.cwd(),
    'host-adapter/extension-gateway/server-plugin/st-host-inventory-handler.mjs'), 'utf8');
  assert.match(hostHandler, /'extensions'/);
  assert.match(hostHandler, /path\.relative\(resolved\.root, resolved\[key\]\)/);
});
 
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
    /logicEngineHostLifecycle(?:\?\.|\.)guardBulkMutation(?:\?\.)?\(\)/);

  const groupImportStart = groupChats.indexOf('export async function importGroupChat(');
  const groupImportEnd = groupChats.indexOf('\n}', groupImportStart);
  assert.ok(groupImportStart >= 0 && groupImportEnd > groupImportStart);
  assert.match(groupChats.slice(groupImportStart, groupImportEnd),
    /logicEngineHostLifecycle(?:\?\.|\.)guardBulkMutation(?:\?\.)?\(\)/);

  const bookmarkStart = groupChats.indexOf('export async function saveGroupBookmarkChat(');
  const bookmarkEnd = groupChats.indexOf('\n}', bookmarkStart);
  assert.ok(bookmarkStart >= 0 && bookmarkEnd > bookmarkStart);
  assert.match(groupChats.slice(bookmarkStart, bookmarkEnd),
    /logicEngineHostLifecycle(?:\?\.|\.)guardBulkMutation(?:\?\.)?\(\)/);

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
    'src/endpoints/users-private.js': ['/change-avatar', '/change-password', '/backup', '/reset-settings', '/change-name', '/reset-step2'],
    'src/endpoints/users-public.js': ['/recover-step2'],
    'src/endpoints/users-admin.js': ['/delete'],
    'src/endpoints/backends/kobold.js': ['/transcribe-audio'],
    'src/endpoints/openai.js': ['/transcribe-audio', '/groq/transcribe-audio', '/mistral/transcribe-audio', '/zai/transcribe-audio', '/chutes/transcribe-audio'],
    'src/endpoints/speech.js': ['/recognize'],
    'src/endpoints/tokenizers.js': ['/llama/encode', '/llama/decode', '/openai/encode', '/openai/decode'],
    'src/endpoints/extensions.js': ['/install', '/update', '/switch', '/move', '/delete'],
    'src/endpoints/content-manager.js': ['/importURL', '/importUUID'],
    'src/endpoints/image-metadata.js': ['/folders/create', '/folders/set-thumbnails', '/folders/update', '/folders/delete', '/folders/assign', '/folders/unassign', '/', '/all', '/cleanup'],
    'src/endpoints/images.js': ['/upload', '/delete'],
    'src/endpoints/moving-ui.js': ['/save'],
    'src/endpoints/secrets.js': ['/write', '/delete', '/rotate', '/rename'],
    'src/endpoints/sprites.js': ['/delete', '/upload-zip', '/upload'],
    'src/endpoints/stats.js': ['/recreate', '/update'],
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

test('legacy user-data migration cannot run under Host authority and system-prompt migration is skipped', () => {
  const users = mutationSources['src/users.js'];
  assert.match(users, /HOST_LIFECYCLE_LEGACY_USER_DATA_MIGRATION_BLOCKED/);
  assert.match(users, /HOST_LIFECYCLE_USER_DIRECTORY_MISSING/);
  assert.match(users, /Skipping system prompt migration while Host authority is active/);
  assert.match(users, /delete (?:request\.)?session\.logicEngineSessionId;/);
  assert.match(users, /delete (?:request\.)?session\.logicEngineSessionHandle;/);
  const legacyCheck = users.indexOf('if (!fs.existsSync(legacyCharactersDirectory))');
  const legacyBlock = users.indexOf('HOST_LIFECYCLE_LEGACY_USER_DATA_MIGRATION_BLOCKED');
  assert.ok(legacyCheck >= 0 && legacyBlock > legacyCheck);
});

test('startup account-root migrations are skipped while Host authority is configured', () => {
  const start = serverMain.indexOf('const hostAuthorityConfigured = Boolean(process.env.LOGIC_ENGINE_HOST_IDENTITY_DIR)');
  const check = serverMain.indexOf('await checkForNewContent(directories)', start);
  const cache = serverMain.indexOf('await diskCache.verify(directories)', start);
  const secrets = serverMain.indexOf('migrateFlatSecrets(directories)', start);
  const settings = serverMain.indexOf('await settingsInit()', start);
  const stats = serverMain.indexOf('await statsInit()', start);
  assert.ok(start >= 0 && check > start && cache > check && secrets > cache);
  assert.ok(settings > secrets && stats > settings);
  const guarded = serverMain.slice(start, stats + 'await statsInit()'.length);
  assert.match(guarded, /if \(hostAuthorityConfigured\)/);
  assert.match(guarded, /if \(!hostAuthorityConfigured\)/);
  assert.match(guarded, /Skipping account-root startup mutations/);
});

test('account recovery password reset is blocked while Host authority is active', () => {
  const usersPublic = mutationSources['src/endpoints/users-public.js'];
  assert.match(usersPublic,
    /router\.post\('\/recover-step2',\s*hostUnsupportedMutationGuard,/);
});

test('bulk mutation guards do not authorize writes from a pre-mutation filesystem scan', async () => {
  const handler = await readFile(resolve(process.cwd(),
    'host-adapter/extension-gateway/server-plugin/st-host-inventory-handler.mjs'), 'utf8');
  const start = handler.indexOf('export function createHostBulkMutationGuard(');
  const end = handler.indexOf('export async function assertHostStartupMigrationAllowed(', start);
  assert.ok(start >= 0 && end > start);
  const guard = handler.slice(start, end);
  assert.match(guard, /hostConfigured/);
  assert.match(guard, /hostSessionActive/);
  assert.match(guard, /HOST_BULK_MUTATION_UNSUPPORTED/);
  assert.doesNotMatch(guard, /hasEnrolledConversation/);
  assert.doesNotMatch(guard, /return next\(\);[\s\S]*?enumerate/);
});

test('settings save and snapshot creation are blocked while Host authority is active', () => {
  const source = mutationSources['src/endpoints/settings.js'];
  assert.match(source, /router\.post\('\/save',\s*hostUnsupportedMutationGuard,/);
  assert.match(source, /router\.post\('\/make-snapshot',\s*hostUnsupportedMutationGuard,/);
});

test('ComfyUI workflow file mutations are guarded and included in source identity coverage', async () => {
  const source = mutationSources['src/endpoints/stable-diffusion.js'];
  assert.match(source, /comfy\.post\('\/save-workflow',\s*hostUnsupportedMutationGuard,/);
  assert.match(source, /comfy\.post\('\/delete-workflow',\s*hostUnsupportedMutationGuard,/);
  assert.match(source, /comfy\.post\('\/rename-workflow',\s*hostUnsupportedMutationGuard,/);
  const attestation = await readFile(resolve(process.cwd(),
    'host-adapter/extension-gateway/server-plugin/st-source-attestation.mjs'), 'utf8');
  assert.match(attestation, /'src\/endpoints\/stable-diffusion\.js'/);
});

test('thumbnail GET falls back to originals instead of writing unreceipted account cache files', () => {
  const source = mutationSources['src/endpoints/thumbnails.js'];
  assert.match(source, /hostCacheWritesDisabled/);
  assert.match(source, /hostCacheWritesDisabled && !fs\.existsSync\(pathToCachedFile\)/);
  assert.match(source, /return serveOriginal\(\)/);
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

test('Host inventory route is mounted only behind SillyTavern authentication middleware', () => {
  const loginMiddleware = serverMain.indexOf('app.use(requireLoginMiddleware);');
  const privateEndpointMount = serverMain.indexOf('setupPrivateEndpoints(app);');
  assert.ok(loginMiddleware >= 0, 'requireLoginMiddleware mount must exist');
  assert.ok(privateEndpointMount > loginMiddleware,
    'private endpoint routers must be mounted after requireLoginMiddleware');
  assert.ok(hostRoutePatch.includes("app.use('/api/logic-engine/host', logicEngineHostInventoryRouter);"),
    'pinned Host route must be mounted at the reviewed private endpoint');
});


test('every pinned chat-history mutation route is either receipted or fail-closed', () => {
  const section = file => {
    const extract = patch => {
      const start = patch.indexOf('diff --git a/' + file + ' ');
      if (start < 0) return '';
      const end = patch.indexOf('\\ndiff --git ', start + 10);
      return patch.slice(start, end < 0 ? undefined : end);
    };
    const combined = [extract(lifecyclePatch), extract(rootMutationPatch)].filter(Boolean).join('\\n');
    assert.ok(combined, 'missing lifecycle/root-mutation patch section: ' + file);
    return combined;
  };
  const guardedRoutes = [
    ['src/endpoints/chats.js', '/save', 'hostLifecycleSaveGuard'],
    ['src/endpoints/chats.js', '/rename', 'hostBulkMutationGuard'],
    ['src/endpoints/chats.js', '/delete', 'hostBulkMutationGuard'],
    ['src/endpoints/chats.js', '/export', 'hostBulkMutationGuard'],
    ['src/endpoints/chats.js', '/group/import', 'hostBulkMutationGuard'],
    ['src/endpoints/chats.js', '/import', 'hostBulkMutationGuard'],
    ['src/endpoints/chats.js', '/group/delete', 'hostBulkMutationGuard'],
    ['src/endpoints/chats.js', '/group/save', 'hostLifecycleSaveGuard'],
    ['src/endpoints/groups.js', '/create', 'hostBulkMutationGuard'],
    ['src/endpoints/groups.js', '/edit', 'hostBulkMutationGuard'],
    ['src/endpoints/groups.js', '/delete', 'hostBulkMutationGuard'],
    ['src/endpoints/characters.js', '/rename', 'hostBulkMutationGuard'],
    ['src/endpoints/characters.js', '/delete', 'hostBulkMutationGuard'],
    ['src/endpoints/characters.js', '/import', 'hostBulkMutationGuard'],
    ['src/endpoints/characters.js', '/duplicate', 'hostBulkMutationGuard'],
    ['src/endpoints/backups.js', '/chat/delete', 'hostBulkMutationGuard'],
    ['src/endpoints/data-maid.js', '/delete', 'hostBulkMutationGuard'],
    ['src/endpoints/settings.js', '/restore-snapshot', 'hostBulkMutationGuard'],
    ['src/endpoints/users-private.js', '/change-avatar', 'hostUnsupportedMutationGuard'],
    ['src/endpoints/users-private.js', '/change-password', 'hostUnsupportedMutationGuard'],
    ['src/endpoints/users-private.js', '/backup', 'hostUnsupportedMutationGuard'],
    ['src/endpoints/users-private.js', '/reset-settings', 'hostBulkMutationGuard'],
    ['src/endpoints/users-private.js', '/change-name', 'hostUnsupportedMutationGuard'],
    ['src/endpoints/users-admin.js', '/disable', 'hostUnsupportedMutationGuard'],
    ['src/endpoints/users-admin.js', '/enable', 'hostUnsupportedMutationGuard'],
    ['src/endpoints/users-admin.js', '/promote', 'hostUnsupportedMutationGuard'],
    ['src/endpoints/users-admin.js', '/demote', 'hostUnsupportedMutationGuard'],
    ['src/endpoints/users-admin.js', '/create', 'hostUnsupportedMutationGuard'],
    ['src/endpoints/users-admin.js', '/delete', 'hostAccountDeleteGuard'],
  ];
  for (const [file, route, guard] of guardedRoutes) {
    const lines = section(file).split('\n').filter(line => line.startsWith('+router.post('));
    assert.ok(lines.some(line => line.includes("'" + route + "'") && line.includes(guard)),
      file + ' ' + route + ' must use ' + guard);
  }

  const privateUsers = section('src/endpoints/users-private.js');
  assert.match(privateUsers, /HOST_USER_ROOT_RESET_UNSUPPORTED/,
    'full user-root reset must fail closed while Host history is enabled');
  const adminUsers = section('src/endpoints/users-admin.js');
  assert.match(adminUsers, /HOST_USER_ACCOUNT_DELETE_UNSUPPORTED/,
    'account-root deletion must fail closed while Host history is enabled');

  const groups = section('src/endpoints/groups.js');
  assert.match(groups, /assertHostStartupMigrationAllowed/);
  assert.match(groups, /await assertHostStartupMigrationAllowed\(\{/,
    'startup group metadata migration must check enrolled histories before writes');
});


test('additional account-root and source mutation routes are fail-closed under Host authority', () => {
  const requirements = [
    ['src/endpoints/content-manager.js', '/importURL'],
    ['src/endpoints/content-manager.js', '/importUUID'],
    ['src/endpoints/image-metadata.js', '/folders/create'],
    ['src/endpoints/image-metadata.js', '/folders/set-thumbnails'],
    ['src/endpoints/image-metadata.js', '/folders/update'],
    ['src/endpoints/image-metadata.js', '/folders/delete'],
    ['src/endpoints/image-metadata.js', '/folders/assign'],
    ['src/endpoints/image-metadata.js', '/folders/unassign'],
    ['src/endpoints/image-metadata.js', '/'],
    ['src/endpoints/image-metadata.js', '/all'],
    ['src/endpoints/image-metadata.js', '/cleanup'],
    ['src/endpoints/images.js', '/upload'],
    ['src/endpoints/images.js', '/delete'],
    ['src/endpoints/moving-ui.js', '/save'],
    ['src/endpoints/presets.js', '/save'],
    ['src/endpoints/presets.js', '/delete'],
    ['src/endpoints/presets.js', '/restore'],
    ['src/endpoints/quick-replies.js', '/save'],
    ['src/endpoints/quick-replies.js', '/delete'],
    ['src/endpoints/secrets.js', '/write'],
    ['src/endpoints/secrets.js', '/delete'],
    ['src/endpoints/secrets.js', '/rotate'],
    ['src/endpoints/secrets.js', '/rename'],
    ['src/endpoints/sprites.js', '/delete'],
    ['src/endpoints/sprites.js', '/upload-zip'],
    ['src/endpoints/sprites.js', '/upload'],
    ['src/endpoints/stats.js', '/recreate'],
    ['src/endpoints/stats.js', '/update'],
    ['src/endpoints/themes.js', '/save'],
    ['src/endpoints/themes.js', '/delete'],
    ['src/endpoints/worldinfo.js', '/delete'],
    ['src/endpoints/worldinfo.js', '/import'],
    ['src/endpoints/worldinfo.js', '/edit'],
    ['src/endpoints/vectors.js', '/insert'],
    ['src/endpoints/vectors.js', '/delete'],
    ['src/endpoints/vectors.js', '/purge-all'],
    ['src/endpoints/vectors.js', '/purge'],
    ['src/endpoints/extensions.js', '/install'],
    ['src/endpoints/extensions.js', '/update'],
    ['src/endpoints/extensions.js', '/switch'],
    ['src/endpoints/extensions.js', '/move'],
    ['src/endpoints/extensions.js', '/delete'],
    ['src/endpoints/backgrounds.js', '/delete'],
    ['src/endpoints/backgrounds.js', '/rename'],
    ['src/endpoints/backgrounds.js', '/upload'],
    ['src/endpoints/avatars.js', '/delete'],
    ['src/endpoints/avatars.js', '/upload'],
    ['src/endpoints/assets.js', '/delete'],
    ['src/endpoints/assets.js', '/character'],
    ['src/endpoints/files.js', '/upload'],
    ['src/endpoints/files.js', '/delete'],
  ];
  for (const [file, route] of requirements) {
    const source = mutationSources[file];
    const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const expression = new RegExp("router\\.post\\(['\\\"]" + escaped + "['\\\"]\\s*,\\s*hostUnsupportedMutationGuard\\s*,");
    assert.match(source, expression, file + ' ' + route + ' must be fail-closed');
  }
  assert.match(rootMutationPatch, /createHostUnsupportedMutationGuard/);
});
