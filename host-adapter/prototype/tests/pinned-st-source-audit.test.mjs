import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Static guard for the pinned SillyTavern operation inventory.
 *
 * This proves that the reviewed source anchors are present in the supplied
 * checkout. It does NOT prove runtime interception, persistence, completeness
 * of third-party extensions, or filesystem inventory correctness.
 *
 * Run:
 *   SILLYTAVERN_SOURCE_ROOT=/path/to/SillyTavern node --test host-adapter/prototype/tests/pinned-st-source-audit.test.mjs
 */
const root = process.env.SILLYTAVERN_SOURCE_ROOT ?? null;

const anchors = [
    ['src/endpoints/chats.js', [
        "router.post('/save'",
        "router.post('/rename'",
        "router.post('/delete'",
        "router.post('/group/import'",
        "router.post('/import'",
        "router.post('/group/delete'",
        "router.post('/group/save'",
        'fs.copyFileSync(pathToOriginalFile, pathToRenamedFile)',
        'fs.unlinkSync(pathToOriginalFile)',
        'tryWriteFileSync(filePath, jsonlData)',
    ]],
    ['src/endpoints/groups.js', [
        "router.post('/create'",
        "router.post('/edit'",
        "router.post('/delete'",
        'fsPromises.copyFile(groupFilePath',
        'writeFileAtomic(chatFilePath',
        'fs.unlinkSync(pathToGroup)',
    ]],
    ['src/endpoints/characters.js', [
        "router.post('/delete'",
        'fs.promises.rm(path.join(request.user.directories.chats',
    ]],
    ['src/endpoints/backups.js', [
        "router.post('/chat/delete'",
        'fsPromises.unlink(filePath)',
    ]],
    ['src/endpoints/data-maid.js', [
        "router.post('/delete'",
        'fs.promises.unlink(pathToFile)',
    ]],
    ['src/endpoints/settings.js', [
        "router.post('/restore-snapshot'",
        'fs.rmSync(pathToSettings',
        'fs.copyFileSync(snapshotPath, pathToSettings)',
    ]],
    ['src/endpoints/users-private.js', [
        "router.post('/reset-step2'",
        'fsPromises.rm(request.user.directories.root',
    ]],
    ['src/users.js', [
        'export async function setUserDataMiddleware',
        "await revokeHostSessionBeforeLogout(request, { reason: 'session_rotation' })",
    ]],
    ['src/endpoints/users-public.js', [
        "router.post('/login'",
        "await revokeHostSessionBeforeLogout(request, { reason: 'session_rotation' })",
    ]],
    ['public/script.js', [
        'export function saveChatDebounced()',
        'event_types.MESSAGE_DELETED',
        'swipe_id',
    ]],
];

test('pinned SillyTavern source root is supplied', { skip: !root }, () => {
    assert.ok(root, 'Set SILLYTAVERN_SOURCE_ROOT to the pinned SillyTavern checkout');
    assert.ok(fs.existsSync(path.join(root, 'src/endpoints/chats.js')), 'SillyTavern source root is invalid');
});

for (const [relativePath, required] of anchors) {
    test(`pinned source anchors: ${relativePath}`, { skip: !root }, () => {
        const fullPath = path.join(root, relativePath);
        assert.ok(fs.existsSync(fullPath), `Missing source file: ${relativePath}`);
        const source = fs.readFileSync(fullPath, 'utf8');
        for (const anchor of required) {
            assert.ok(source.includes(anchor), `Missing reviewed anchor in ${relativePath}: ${anchor}`);
        }
    });
}


test('pinned ST chat-history mutation routes are guarded or explicitly unsupported', { skip: !root }, () => {
    const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
    const requirements = [
        ['src/endpoints/chats.js', "router.post('/save', validateAvatarUrlMiddleware, hostLifecycleSaveGuard"],
        ['src/endpoints/chats.js', "router.post('/rename', validateAvatarUrlMiddleware, hostBulkMutationGuard"],
        ['src/endpoints/chats.js', "router.post('/delete', validateAvatarUrlMiddleware, hostBulkMutationGuard"],
        ['src/endpoints/chats.js', "router.post('/export', validateAvatarUrlMiddleware, hostBulkMutationGuard"],
        ['src/endpoints/chats.js', "router.post('/group/import', hostBulkMutationGuard"],
        ['src/endpoints/chats.js', "router.post('/import', hostBulkMutationGuard"],
        ['src/endpoints/chats.js', "router.post('/group/delete', hostBulkMutationGuard"],
        ['src/endpoints/chats.js', "router.post('/group/save', hostLifecycleSaveGuard"],
        ['src/endpoints/groups.js', "router.post('/create', hostBulkMutationGuard"],
        ['src/endpoints/groups.js', "router.post('/edit', hostBulkMutationGuard"],
        ['src/endpoints/groups.js', "router.post('/delete', hostBulkMutationGuard"],
        ['src/endpoints/characters.js', "router.post('/rename', hostBulkMutationGuard"],
        ['src/endpoints/characters.js', "router.post('/delete', hostBulkMutationGuard"],
        ['src/endpoints/characters.js', "router.post('/import', hostBulkMutationGuard"],
        ['src/endpoints/characters.js', "router.post('/duplicate', hostBulkMutationGuard"],
        ['src/endpoints/backups.js', "router.post('/chat/delete', hostBulkMutationGuard"],
        ['src/endpoints/data-maid.js', "router.post('/delete', hostBulkMutationGuard"],
        ['src/endpoints/settings.js', "router.post('/make-snapshot', hostUnsupportedMutationGuard"],
        ['src/endpoints/settings.js', "router.post('/restore-snapshot', hostBulkMutationGuard"],
        ['src/endpoints/users-private.js', "router.post('/reset-settings', hostBulkMutationGuard"],
        ['src/endpoints/users-public.js', "router.post('/recover-step2', hostUnsupportedMutationGuard"],
        ['src/endpoints/characters.js', "router.post('/create', hostBulkMutationGuard"],
        ['src/endpoints/characters.js', "router.post('/edit', hostBulkMutationGuard"],
        ['src/endpoints/characters.js', "router.post('/edit-avatar', hostBulkMutationGuard"],
        ['src/endpoints/characters.js', "router.post('/edit-attribute', hostBulkMutationGuard"],
        ['src/endpoints/characters.js', "router.post('/merge-attributes', hostBulkMutationGuard"],
        ['src/endpoints/users-private.js', "router.post('/change-avatar', hostUnsupportedMutationGuard"],
        ['src/endpoints/users-private.js', "router.post('/change-password', hostUnsupportedMutationGuard"],
        ['src/endpoints/users-private.js', "router.post('/backup', hostUnsupportedMutationGuard"],
        ['src/endpoints/users-private.js', "router.post('/change-name', hostUnsupportedMutationGuard"],
        ['src/endpoints/users-private.js', "router.post('/reset-step2', hostRootResetGuard"],
        ['src/endpoints/content-manager.js', "router.post('/importURL', hostUnsupportedMutationGuard"],
        ['src/endpoints/content-manager.js', "router.post('/importUUID', hostUnsupportedMutationGuard"],
        ['src/endpoints/image-metadata.js', "router.post('/folders/create', hostUnsupportedMutationGuard"],
        ['src/endpoints/image-metadata.js', "router.post('/folders/set-thumbnails', hostUnsupportedMutationGuard"],
        ['src/endpoints/image-metadata.js', "router.post('/folders/update', hostUnsupportedMutationGuard"],
        ['src/endpoints/image-metadata.js', "router.post('/folders/delete', hostUnsupportedMutationGuard"],
        ['src/endpoints/image-metadata.js', "router.post('/folders/assign', hostUnsupportedMutationGuard"],
        ['src/endpoints/image-metadata.js', "router.post('/folders/unassign', hostUnsupportedMutationGuard"],
        ['src/endpoints/image-metadata.js', "router.post('/', hostUnsupportedMutationGuard"],
        ['src/endpoints/image-metadata.js', "router.post('/cleanup', hostUnsupportedMutationGuard"],
        ['src/endpoints/images.js', "router.post('/upload', hostUnsupportedMutationGuard"],
        ['src/endpoints/images.js', "router.post('/delete', hostUnsupportedMutationGuard"],
        ['src/endpoints/moving-ui.js', "router.post('/save', hostUnsupportedMutationGuard"],
        ['src/endpoints/presets.js', "router.post('/save', hostUnsupportedMutationGuard"],
        ['src/endpoints/presets.js', "router.post('/delete', hostUnsupportedMutationGuard"],
        ['src/endpoints/presets.js', "router.post('/restore', hostUnsupportedMutationGuard"],
        ['src/endpoints/quick-replies.js', "router.post('/save', hostUnsupportedMutationGuard"],
        ['src/endpoints/quick-replies.js', "router.post('/delete', hostUnsupportedMutationGuard"],
        ['src/endpoints/secrets.js', "router.post('/write', hostUnsupportedMutationGuard"],
        ['src/endpoints/secrets.js', "router.post('/delete', hostUnsupportedMutationGuard"],
        ['src/endpoints/secrets.js', "router.post('/rotate', hostUnsupportedMutationGuard"],
        ['src/endpoints/secrets.js', "router.post('/rename', hostUnsupportedMutationGuard"],
        ['src/endpoints/sprites.js', "router.post('/delete', hostUnsupportedMutationGuard"],
        ['src/endpoints/sprites.js', "router.post('/upload-zip', hostUnsupportedMutationGuard"],
        ['src/endpoints/sprites.js', "router.post('/upload', hostUnsupportedMutationGuard"],
        ['src/endpoints/stats.js', "router.post('/recreate', hostUnsupportedMutationGuard"],
        ['src/endpoints/stats.js', "router.post('/update', hostUnsupportedMutationGuard"],
        ['src/endpoints/themes.js', "router.post('/save', hostUnsupportedMutationGuard"],
        ['src/endpoints/themes.js', "router.post('/delete', hostUnsupportedMutationGuard"],
        ['src/endpoints/worldinfo.js', "router.post('/delete', hostUnsupportedMutationGuard"],
        ['src/endpoints/worldinfo.js', "router.post('/import', hostUnsupportedMutationGuard"],
        ['src/endpoints/worldinfo.js', "router.post('/edit', hostUnsupportedMutationGuard"],
        ['src/endpoints/vectors.js', "router.post('/insert', hostUnsupportedMutationGuard"],
        ['src/endpoints/vectors.js', "router.post('/delete', hostUnsupportedMutationGuard"],
        ['src/endpoints/vectors.js', "router.post('/purge-all', hostUnsupportedMutationGuard"],
        ['src/endpoints/vectors.js', "router.post('/purge', hostUnsupportedMutationGuard"],
        ['src/endpoints/extensions.js', "router.post('/install', hostUnsupportedMutationGuard"],
        ['src/endpoints/extensions.js', "router.post('/update', hostUnsupportedMutationGuard"],
        ['src/endpoints/extensions.js', "router.post('/switch', hostUnsupportedMutationGuard"],
        ['src/endpoints/extensions.js', "router.post('/move', hostUnsupportedMutationGuard"],
        ['src/endpoints/extensions.js', "router.post('/delete', hostUnsupportedMutationGuard"],
        ['src/endpoints/backgrounds.js', "router.post('/delete', hostUnsupportedMutationGuard"],
        ['src/endpoints/backgrounds.js', "router.post('/rename', hostUnsupportedMutationGuard"],
        ['src/endpoints/backgrounds.js', "router.post('/upload', hostUnsupportedMutationGuard"],
        ['src/endpoints/avatars.js', "router.post('/delete', hostUnsupportedMutationGuard"],
        ['src/endpoints/avatars.js', "router.post('/upload', hostUnsupportedMutationGuard"],
        ['src/endpoints/assets.js', "router.post('/delete', hostUnsupportedMutationGuard"],
        ['src/endpoints/assets.js', "router.post('/character', hostUnsupportedMutationGuard"],
        ['src/endpoints/files.js', "router.post('/upload', hostUnsupportedMutationGuard"],
        ['src/endpoints/files.js', "router.post('/delete', hostUnsupportedMutationGuard"],
    ];
    for (const [relativePath, required] of requirements) {
        assert.ok(read(relativePath).includes(required), relativePath + ' missing route guard: ' + required);
    }

    const thumbnails = read('src/endpoints/thumbnails.js');
    assert.ok(thumbnails.includes('hostCacheWritesDisabled'),
        'thumbnail cache writes must be suppressed while Host authority is active');
    assert.ok(thumbnails.includes('if (hostCacheWritesDisabled && !fs.existsSync(pathToCachedFile)) return serveOriginal();'),
        'thumbnail cache misses must serve the original without creating an unreceipted account-root file');
    const stableDiffusion = read('src/endpoints/stable-diffusion.js');
    for (const route of ['save-workflow', 'delete-workflow', 'rename-workflow']) {
        assert.ok(stableDiffusion.includes(`comfy.post('/${route}', hostUnsupportedMutationGuard`),
            `ComfyUI workflow mutation /${route} must be fail-closed while Host authority is active`);
    }
    const usersSource = read('src/users.js');
    assert.ok(usersSource.includes('HOST_LIFECYCLE_LEGACY_USER_DATA_MIGRATION_BLOCKED'),
        'legacy public user data must not be moved outside the attested root while Host is active');
    assert.ok(usersSource.includes('HOST_LIFECYCLE_USER_DIRECTORY_MISSING'),
        'Host must not create missing account directories after root authority is enabled');
    assert.ok(usersSource.includes('Skipping system prompt migration while Host authority is active.'),
        'system-prompt migration must not mutate account-root files while Host is active');
    assert.ok(usersSource.includes('delete session.logicEngineSessionId;'),
        'revoked Host session identifiers must be cleared after account-version invalidation');
    assert.ok(usersSource.includes('delete session.logicEngineSessionHandle;'),
        'revoked Host account binding must be cleared after account-version invalidation');
    const serverMain = read('src/server-main.js');
    assert.ok(serverMain.includes('const hostAuthorityConfigured = Boolean(process.env.LOGIC_ENGINE_HOST_IDENTITY_DIR)'),
        'startup account-root migration gate must be installed');
    assert.ok(serverMain.includes('Skipping account-root startup mutations while Host authority is active.'),
        'startup account-root migrations must be skipped while Host authority is active');
    const privateUsers = read('src/endpoints/users-private.js');
    assert.ok(privateUsers.includes('HOST_USER_ROOT_RESET_UNSUPPORTED'),
        'full user-root reset must remain explicitly fail-closed');
    assert.ok(privateUsers.includes('revokeHostSessionBeforeLogout(request)'),
        'native ST logout must revoke the old Core session before clearing the session');
    assert.ok(privateUsers.indexOf('revokeHostSessionBeforeLogout(request)')
        < privateUsers.indexOf('request.session.handle = null;'),
        'Core revocation must complete before ST clears the old session');
    const groups = read('src/endpoints/groups.js');
    assert.ok(groups.includes('assertHostStartupMigrationAllowed'),
        'startup group metadata migration must be gated by full Host inventory');
    const adminUsers = read('src/endpoints/users-admin.js');
    assert.ok(adminUsers.includes("const hostAccountDeleteGuard = createHostUnsupportedMutationGuard({ code: 'HOST_USER_ACCOUNT_DELETE_UNSUPPORTED' });"),
        'account deletion must use its explicit fail-closed guard');
    for (const route of ['disable', 'enable', 'promote', 'demote', 'create', 'delete']) {
        const expectedGuard = route === 'delete' ? 'hostAccountDeleteGuard' : 'hostUnsupportedMutationGuard';
        assert.ok(adminUsers.includes(`router.post('/${route}', requireAdminMiddleware, ${expectedGuard}`),
            `administrative account mutation /${route} must be fail-closed while Host authority is active`);
    }
});



test('settings save and image metadata listing remain unguarded Host-compatible routes', { skip: !root }, () => {
    const settings = fs.readFileSync(path.join(root, 'src/endpoints/settings.js'), 'utf8');
    const metadata = fs.readFileSync(path.join(root, 'src/endpoints/image-metadata.js'), 'utf8');
    assert.ok(settings.includes("router.post('/save', function ("),
        'settings save must remain a functional native settings route');
    assert.equal(settings.includes("router.post('/save', hostUnsupportedMutationGuard"), false,
        'settings save must not be blocked by the unsupported-mutation guard');
    assert.ok(metadata.includes("router.post('/all', async function ("),
        'image metadata listing must remain a functional read route');
    assert.equal(metadata.includes("router.post('/all', hostUnsupportedMutationGuard"), false,
        'image metadata listing must not be blocked by the unsupported-mutation guard');
});

test('native logout must fail closed before clearing the session', { skip: !root }, () => {
    const source = fs.readFileSync(path.join(root, 'src/endpoints/users-private.js'), 'utf8');
    const start = source.indexOf("router.post('/logout'");
    const end = source.indexOf("router.get('/me'", start);
    assert.ok(start >= 0 && end > start, 'native logout route must exist');
    const route = source.slice(start, end);
    const revoke = route.indexOf('await revokeHostSessionBeforeLogout(request)');
    const clear = route.indexOf('request.session.handle = null;');
    assert.ok(revoke >= 0 && clear > revoke,
        'native logout must revoke the Core session before clearing the ST session');
    assert.ok(route.includes("return response.status(503).json({ error: 'Host session revocation unavailable; session was not logged out.' });"),
        'native logout must leave the ST session intact when Core revocation fails');
});

test('account switching and version invalidation revoke the old Host capability before session mutation', { skip: !root }, () => {
    const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
    const users = read('src/users.js');
    const invalidationCall = users.indexOf("await revokeHostSessionBeforeLogout(request, { reason: 'session_rotation' })");
    const invalidationClear = users.indexOf('request.session.handle = null;', invalidationCall);
    assert.ok(invalidationCall >= 0 && invalidationClear > invalidationCall,
        'account-version invalidation must revoke Core capability before clearing the ST session');
    const accountSwitchHelperStart = users.indexOf('async function revokeHostSessionBeforeAccountSwitch');
    const accountSwitchHelperEnd = users.indexOf('export async function tryAutoLogin', accountSwitchHelperStart);
    const accountSwitchHelper = users.slice(accountSwitchHelperStart, accountSwitchHelperEnd);
    assert.ok(accountSwitchHelperStart >= 0 && accountSwitchHelper.includes('session.logicEngineSessionId === undefined'),
        'account-switch helper must distinguish sessions without a Host capability');
    assert.equal(accountSwitchHelper.includes('LOGIC_ENGINE_HOST_IDENTITY_DIR'), false,
        'an existing Host capability must not bypass revocation when deployment configuration disappears');
    const autoSwitchCalls = users.match(/await revokeHostSessionBeforeAccountSwitch\(request,/g) ?? [];
    assert.equal(autoSwitchCalls.length, 3,
        'single-user, trusted-header SSO, and Basic Auth account switches must all revoke the old capability');
    for (const [startMarker, nextMarker, accountAssignment] of [
        ['async function singleUserLogin', 'async function autheliaUserLogin', 'request.session.handle = userHandles[0];'],
        ['async function headerUserLogin', 'async function basicUserLogin', 'request.session.handle = userHandle;'],
        ['async function basicUserLogin', 'export function getAccountVersion', 'request.session.handle = userHandle;'],
    ]) {
        const start = users.indexOf(startMarker);
        const end = users.indexOf(nextMarker, start);
        const body = users.slice(start, end < 0 ? users.length : end);
        assert.ok(start >= 0 && body.indexOf('await revokeHostSessionBeforeAccountSwitch(request,') >= 0
            && body.indexOf('await revokeHostSessionBeforeAccountSwitch(request,') < body.indexOf(accountAssignment),
            startMarker + ' must revoke the old capability before assigning the new account');
    }
    assert.ok(users.includes("response.status(503).send('Host session revocation unavailable; account was not switched.')"),
        'automatic login must fail closed instead of serving the login page after revocation failure');
    const login = read('src/endpoints/users-public.js');
    const loginCall = login.indexOf("await revokeHostSessionBeforeLogout(request, { reason: 'session_rotation' })");
    const loginMutation = login.indexOf('request.session.handle = user.handle;', loginCall);
    assert.ok(loginCall >= 0 && loginMutation > loginCall,
        'account switching must revoke Core capability before changing the authenticated account');
    const loginReset = login.indexOf('delete request.session.logicEngineSessionId;', loginCall);
    assert.ok(loginReset > loginCall && loginReset < loginMutation,
        'account switching must clear the revoked Host identity before issuing a new session');
    assert.ok(users.includes('Host session revocation unavailable; session was not invalidated.'),
        'version invalidation must fail closed when Core revocation is unavailable');
    assert.ok(login.includes('Host session revocation unavailable; account was not switched.'),
        'account switching must fail closed when Core revocation is unavailable');
});

test('Host lifecycle patch embeds the canonical lifecycle source files without drift', () => {
    const repositoryRoot = process.cwd();
    const patchPath = path.join(repositoryRoot, 'host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-hooks.patch');
    const patch = fs.readFileSync(patchPath, 'utf8').replace(/\\r\\n?/g, '\\n');
    const pairs = [
        ['host-adapter/prototype/conversation-identity.mjs', 'public/scripts/logic-engine-lifecycle/conversation-identity.mjs'],
        ['host-adapter/prototype/lifecycle-journal.mjs', 'public/scripts/logic-engine-lifecycle/lifecycle-journal.mjs'],
        ['host-adapter/prototype/st-lifecycle-bridge.mjs', 'public/scripts/logic-engine-lifecycle/st-lifecycle-bridge.mjs'],
    ];

    for (const [sourcePath, installedPath] of pairs) {
        const marker = `diff --git a/${installedPath} b/${installedPath}`;
        const start = patch.indexOf(marker);
        assert.ok(start >= 0, `Lifecycle patch is missing ${installedPath}`);
        const next = patch.indexOf('\\ndiff --git ', start + marker.length);
        const section = patch.slice(start, next < 0 ? patch.length : next);
        assert.ok(section.includes('new file mode 100644'), `${installedPath} must be an explicitly created file`);
        const embedded = section.split('\\n')
            .filter(line => line.startsWith('+') && !line.startsWith('+++ '))
            .map(line => line.slice(1))
            .join('\\n') + '\\n';
        const canonicalSource = fs.readFileSync(path.join(repositoryRoot, sourcePath), 'utf8')
            .replace(/\\r\\n?/g, '\\n');
        assert.equal(embedded, canonicalSource, `${installedPath} in the installer patch drifted from ${sourcePath}`);
    }
});
