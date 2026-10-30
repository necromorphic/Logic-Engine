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
