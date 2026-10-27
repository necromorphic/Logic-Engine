import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { migrateGroupChatsMetadataFormat } from '../src/endpoints/groups.js';

async function fixture() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'st-startup-migration-'));
    const userDirs = {
        root,
        groups: path.join(root, 'groups'),
        groupChats: path.join(root, 'group chats'),
        backups: path.join(root, 'backups'),
    };
    await Promise.all([
        mkdir(userDirs.groups, { recursive: true }),
        mkdir(userDirs.groupChats, { recursive: true }),
        mkdir(userDirs.backups, { recursive: true }),
    ]);
    return { root, userDirs };
}

async function addMigrationCandidate(userDirs, chatId = 'chat-a') {
    await writeFile(path.join(userDirs.groups, 'group-a.json'), JSON.stringify({
        id: 'group-a',
        chat_id: chatId,
        chats: [chatId],
        chat_metadata: { test: true },
        past_metadata: {},
    }, null, 4));
    await writeFile(path.join(userDirs.groupChats, `${chatId}.jsonl`), JSON.stringify({ mes: 'existing message' }) + '\n');
}

async function addRegistry(root, conversations) {
    const stateDirectory = path.join(root, '.logic-engine-host');
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(path.join(stateDirectory, 'enrollments.json'), JSON.stringify({ version: 1, conversations }));
}

test('registered affected group chat blocks the entire migration before any write', async () => {
    const { root, userDirs } = await fixture();
    try {
        await addMigrationCandidate(userDirs);
        await addRegistry(root, [{ conversationId: 'conversation-a', sourceLocator: 'chat-a', domain: 'group_chats' }]);
        const groupPath = path.join(userDirs.groups, 'group-a.json');
        const chatPath = path.join(userDirs.groupChats, 'chat-a.jsonl');
        const before = [await readFile(groupPath), await readFile(chatPath)];
        await assert.rejects(migrateGroupChatsMetadataFormat([userDirs]), /HOST_STARTUP_MIGRATION_BLOCKED/);
        assert.deepEqual(await readFile(groupPath), before[0]);
        assert.deepEqual(await readFile(chatPath), before[1]);
        assert.deepEqual(await readdir(userDirs.backups), []);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('corrupt Host registry blocks before any migration write', async () => {
    const { root, userDirs } = await fixture();
    try {
        await addMigrationCandidate(userDirs);
        await mkdir(path.join(root, '.logic-engine-host'), { recursive: true });
        await writeFile(path.join(root, '.logic-engine-host', 'enrollments.json'), '{broken');
        const groupPath = path.join(userDirs.groups, 'group-a.json');
        const chatPath = path.join(userDirs.groupChats, 'chat-a.jsonl');
        const before = [await readFile(groupPath), await readFile(chatPath)];
        await assert.rejects(migrateGroupChatsMetadataFormat([userDirs]), /HOST_STARTUP_MIGRATION_BLOCKED/);
        assert.deepEqual(await readFile(groupPath), before[0]);
        assert.deepEqual(await readFile(chatPath), before[1]);
        assert.deepEqual(await readdir(userDirs.backups), []);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('Host state directory without registry is ambiguous and blocks startup migration', async () => {
    const { root, userDirs } = await fixture();
    try {
        await addMigrationCandidate(userDirs);
        await mkdir(path.join(root, '.logic-engine-host'), { recursive: true });
        await assert.rejects(migrateGroupChatsMetadataFormat([userDirs]), /HOST_STARTUP_MIGRATION_BLOCKED/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('unenrolled user retains the legacy migration behavior', async () => {
    const { root, userDirs } = await fixture();
    try {
        await addMigrationCandidate(userDirs);
        await migrateGroupChatsMetadataFormat([userDirs]);
        const migratedGroup = JSON.parse(await readFile(path.join(userDirs.groups, 'group-a.json'), 'utf8'));
        const migratedChat = JSON.parse((await readFile(path.join(userDirs.groupChats, 'chat-a.jsonl'), 'utf8')).trim().split('\n')[0]);
        assert.equal(Object.hasOwn(migratedGroup, 'chat_metadata'), false);
        assert.deepEqual(migratedChat.chat_metadata, { test: true });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('one enrolled user prevents partial writes for all users in the migration batch', async () => {
    const first = await fixture();
    const second = await fixture();
    try {
        await addMigrationCandidate(first.userDirs, 'chat-safe');
        await addMigrationCandidate(second.userDirs, 'chat-enrolled');
        await addRegistry(second.root, [{ conversationId: 'conversation-b', sourceLocator: 'chat-enrolled', domain: 'group_chats' }]);
        const paths = [
            path.join(first.userDirs.groups, 'group-a.json'),
            path.join(first.userDirs.groupChats, 'chat-safe.jsonl'),
            path.join(second.userDirs.groups, 'group-a.json'),
            path.join(second.userDirs.groupChats, 'chat-enrolled.jsonl'),
        ];
        const before = await Promise.all(paths.map(file => readFile(file)));
        await assert.rejects(migrateGroupChatsMetadataFormat([first.userDirs, second.userDirs]), /HOST_STARTUP_MIGRATION_BLOCKED/);
        for (let i = 0; i < paths.length; i++) assert.deepEqual(await readFile(paths[i]), before[i]);
        assert.deepEqual(await readdir(first.userDirs.backups), []);
        assert.deepEqual(await readdir(second.userDirs.backups), []);
    } finally {
        await rm(first.root, { recursive: true, force: true });
        await rm(second.root, { recursive: true, force: true });
    }
});
