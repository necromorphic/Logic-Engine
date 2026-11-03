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
        ['src/endpoints/settings.js', "router.post('/restore-snapshot', hostBulkMutationGuard"],
        ['src/endpoints/users-private.js', "router.post('/reset-settings', hostBulkMutationGuard"],
    ];
    for (const [relativePath, required] of requirements) {
        assert.ok(read(relativePath).includes(required), relativePath + ' missing route guard: ' + required);
    }

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
    assert.ok(adminUsers.includes('HOST_USER_ACCOUNT_DELETE_UNSUPPORTED'),
        'account-root deletion must remain explicitly fail-closed');
});


test('account switching and version invalidation revoke the old Host capability before session mutation', { skip: !root }, () => {
    const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
    const users = read('src/users.js');
    const invalidationCall = users.indexOf("await revokeHostSessionBeforeLogout(request, { reason: 'session_rotation' })");
    const invalidationClear = users.indexOf('request.session.handle = null;', invalidationCall);
    assert.ok(invalidationCall >= 0 && invalidationClear > invalidationCall,
        'account-version invalidation must revoke Core capability before clearing the ST session');
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
