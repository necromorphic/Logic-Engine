import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHostLifecycleMutationMiddleware, getHostMutationJournalStatus, reconcileHostMutation, registerHostConversation } from '../server-lifecycle-mutation-journal.mjs';

async function fixture() {
    const root = await fsMkdtemp();
    const directories = {
        chats: path.join(root, 'chats'),
        characters: path.join(root, 'characters'),
        groups: path.join(root, 'groups'),
        groupChats: path.join(root, 'groupChats'),
        backups: path.join(root, 'backups'),
    };
    await Promise.all(Object.values(directories).map(directory => mkdir(directory, { recursive: true })));
    const request = {
        method: 'POST',
        baseUrl: '',
        path: '/api/characters/create',
        originalUrl: '/api/characters/create',
        user: { profile: { handle: 'test-user' }, directories },
    };
    return { root, directories, request };
}

async function fsMkdtemp() {
    const { mkdtemp } = await import('node:fs/promises');
    return mkdtemp(path.join(os.tmpdir(), 'host-mutation-journal-'));
}

function responseMock() {
    let finish;
    const finished = new Promise(resolve => { finish = resolve; });
    const response = {
        statusCode: 200,
        headersSent: false,
        headers: {},
        body: undefined,
        status(code) { this.statusCode = code; return this; },
        setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
        removeHeader(name) { delete this.headers[name.toLowerCase()]; },
        writeHead(code, headers = {}) {
            this.statusCode = code;
            Object.assign(this.headers, headers);
            this.headersSent = true;
            return this;
        },
        write(value) { this.headersSent = true; this.body = (this.body ?? '') + String(value); return true; },
        flushHeaders() { this.headersSent = true; },
        json(value) { return this.end(JSON.stringify(value)); },
        end(value) {
            this.headersSent = true;
            if (value !== undefined) this.body = (this.body ?? '') + String(value);
            finish();
            return this;
        },
    };
    response.finished = finished;
    return response;
}

test('explicit enrollment enables durable before/after journal around a non-blocked direct server mutation route', async () => {
    const { root, directories, request } = await fixture();
    try {
        const chatPath = path.join(directories.chats, 'chat-1.jsonl');
        await writeFile(chatPath, '{"mes":"before"}\n');
        assert.deepEqual(await registerHostConversation(request, {
            conversationId: 'conversation-1',
            sourceLocator: 'chat-1',
            domain: 'chats',
        }), { status: 'ENROLLED' });

        const response = responseMock();
        const middleware = createHostLifecycleMutationMiddleware();
        await middleware(request, response, async () => {
            await writeFile(chatPath, '{"mes":"after"}\n');
            response.json({ ok: true });
        });
        await response.finished;

        assert.equal(response.statusCode, 200);
        assert.deepEqual(JSON.parse(response.body), { ok: true });
        const ledger = await readFile(path.join(root, '.logic-engine-host', 'mutation-ledger.jsonl'), 'utf8');
        const records = ledger.trim().split('\n').map(line => JSON.parse(line));
        assert.deepEqual(records.map(record => record.kind), ['intent', 'outcome']);
        assert.equal(records[1].status, 'COMMITTED');
        assert.ok(records[1].changes.some(change => change.artifactId === 'chats:chat-1.jsonl'));
        assert.ok(records.every(record => record.recordHash && record.previousHash));
        assert.doesNotMatch(ledger, /"mes":"after"/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('incomplete post-scan overrides a pre-flushed success response before headers reach the client', async () => {
    const { root, directories, request } = await fixture();
    try {
        await writeFile(path.join(directories.chats, 'chat-1.jsonl'), '{"mes":"before"}\n');
        await registerHostConversation(request, {
            conversationId: 'conversation-1',
            sourceLocator: 'chat-1',
            domain: 'chats',
        });
        const response = responseMock();
        await createHostLifecycleMutationMiddleware()(request, response, async () => {
            await rm(directories.backups, { recursive: true, force: true });
            response.setHeader('Content-Length', '11');
            response.setHeader('ETag', '"success-body"');
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.write('{"ok":true}');
            response.end();
        });
        await response.finished;
        assert.equal(response.statusCode, 503);
        assert.match(String(response.body), /HOST_POST_MUTATION_SCAN_INCOMPLETE/);
        assert.doesNotMatch(String(response.body), /"ok":true/);
        assert.equal(response.headers['content-length'], undefined, 'discarded success length must not be reused for the 503 body');
        assert.equal(response.headers.etag, undefined, 'discarded success ETag must not be reused for the 503 body');
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('real HTTP response cannot leak a success body when post-scan is incomplete', async () => {
    const { root, directories, request: fixtureRequest } = await fixture();
    let server;
    try {
        await writeFile(path.join(directories.chats, 'chat-1.jsonl'), '{"mes":"before"}\\n');
        await registerHostConversation(fixtureRequest, {
            conversationId: 'conversation-1',
            sourceLocator: 'chat-1',
            domain: 'chats',
        });
        const middleware = createHostLifecycleMutationMiddleware();
        server = createServer((request, response) => {
            request.user = fixtureRequest.user;
            request.baseUrl = '';
            request.path = '/api/characters/create';
            request.originalUrl = '/api/characters/create';
            // The middleware is mounted in Express in SillyTavern. This raw
            // node:http harness supplies the two Express response helpers it
            // relies on, while keeping the test on a real HTTP socket.
            response.status = function status(code) {
                this.statusCode = code;
                return this;
            };
            response.json = function json(value) {
                if (!this.headersSent) this.setHeader('Content-Type', 'application/json; charset=utf-8');
                this.end(JSON.stringify(value));
                return this;
            };
            void middleware(request, response, async () => {
                await rm(directories.backups, { recursive: true, force: true });
                response.statusCode = 200;
                response.setHeader('Content-Type', 'application/json');
                response.setHeader('Content-Length', '11');
                response.setHeader('ETag', '"success-body"');
                response.writeHead(200);
                response.write('{"ok":true}');
                response.end();
            }, () => {
                response.statusCode = 599;
                response.end('lifecycle middleware bypassed');
            });
        });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const address = server.address();
        const response = await fetch(`http://127.0.0.1:${address.port}/api/characters/create`, { method: 'POST' });
        const body = await response.text();
        assert.equal(response.status, 503);
        assert.match(body, /HOST_POST_MUTATION_SCAN_INCOMPLETE/);
        assert.doesNotMatch(body, /"ok":true/);
        assert.equal(response.headers.get('content-length'), null);
        assert.equal(response.headers.get('etag'), null);
    } finally {
        if (server?.listening) {
            server.close();
            await once(server, 'close');
        }
        await rm(root, { recursive: true, force: true });
    }
});

test('re-enrollment with a conflicting locator fails rather than remapping identity', async () => {
    const { root, request } = await fixture();
    try {
        await registerHostConversation(request, {
            conversationId: 'conversation-1',
            sourceLocator: 'chat-1',
            domain: 'chats',
        });
        await assert.rejects(
            registerHostConversation(request, {
                conversationId: 'conversation-1',
                sourceLocator: 'different-chat',
                domain: 'chats',
            }),
            /HOST_ENROLLMENT_IDENTITY_CONFLICT/,
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('a pending or invalid journal fails closed before the next managed mutation', async () => {
    const { root, directories, request } = await fixture();
    try {
        await registerHostConversation(request, {
            conversationId: 'conversation-1',
            sourceLocator: 'chat-1',
            domain: 'chats',
        });
        const stateDirectory = path.join(root, '.logic-engine-host');
        await mkdir(stateDirectory, { recursive: true });
        await writeFile(path.join(stateDirectory, 'mutation-ledger.jsonl'), '{"kind":"intent","operationId":"unfinished"}\n');
        const response = responseMock();
        let reachedHandler = false;
        await createHostLifecycleMutationMiddleware()(request, response, async () => {
            reachedHandler = true;
            response.json({ ok: true });
        });
        await response.finished;
        assert.equal(reachedHandler, false);
        assert.equal(response.statusCode, 503);
        assert.match(String(response.body), /HOST_JOURNAL_PREPARE_FAILED|HOST_JOURNAL_RECONCILIATION_REQUIRED/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('rejected 4xx with no observed mutation is terminal and does not block subsequent mutations', async () => {
    const { root, directories, request } = await fixture();
    try {
        await writeFile(path.join(directories.chats, 'chat-1.jsonl'), '{"mes":"before"}\n');
        await registerHostConversation(request, {
            conversationId: 'conversation-1',
            sourceLocator: 'chat-1',
            domain: 'chats',
        });

        const response = responseMock();
        await createHostLifecycleMutationMiddleware()(request, response, async () => {
            response.statusCode = 400;
            response.end('mutation rejected');
        });
        await response.finished;

        const ledger = await readFile(path.join(root, '.logic-engine-host', 'mutation-ledger.jsonl'), 'utf8');
        const records = ledger.trim().split('\n').map(line => JSON.parse(line));
        assert.deepEqual(records.map(record => record.kind), ['intent', 'outcome']);
        assert.equal(records[1].status, 'REJECTED_NO_MUTATION');
        assert.equal(records[1].httpStatus, 400);

        const second = responseMock();
        let reachedHandler = false;
        await createHostLifecycleMutationMiddleware()(request, second, async () => {
            reachedHandler = true;
            second.json({ ok: true });
        });
        await second.finished;
        assert.equal(reachedHandler, true);
        assert.equal(second.statusCode, 200);
        assert.deepEqual(JSON.parse(String(second.body)), { ok: true });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('rejected 4xx that changed an artifact remains unresolved', async () => {
    const { root, directories, request } = await fixture();
    try {
        const chatPath = path.join(directories.chats, 'chat-1.jsonl');
        await writeFile(chatPath, '{"mes":"before"}\n');
        await registerHostConversation(request, {
            conversationId: 'conversation-1',
            sourceLocator: 'chat-1',
            domain: 'chats',
        });
        const response = responseMock();
        await createHostLifecycleMutationMiddleware()(request, response, async () => {
            await writeFile(chatPath, '{"mes":"changed"}\n');
            response.statusCode = 400;
            response.end('bad request after side effect');
        });
        await response.finished;
        const ledger = await readFile(path.join(root, '.logic-engine-host', 'mutation-ledger.jsonl'), 'utf8');
        const records = ledger.trim().split('\n').map(record => JSON.parse(record));
        assert.equal(records.at(-1).status, 'UNRESOLVED');
        const second = responseMock();
        let reachedHandler = false;
        await createHostLifecycleMutationMiddleware()(request, second, async () => {
            reachedHandler = true;
            second.json({ ok: true });
        });
        await second.finished;
        assert.equal(reachedHandler, false);
        assert.equal(second.statusCode, 503);
        assert.match(String(second.body), /HOST_JOURNAL_RECONCILIATION_REQUIRED/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('5xx response with no persisted changes remains unresolved', async () => {
    const { root, directories, request } = await fixture();
    try {
        await writeFile(path.join(directories.chats, 'chat-1.jsonl'), '{"mes":"before"}\n');
        await registerHostConversation(request, {
            conversationId: 'conversation-1',
            sourceLocator: 'chat-1',
            domain: 'chats',
        });

        const response = responseMock();
        await createHostLifecycleMutationMiddleware()(request, response, async () => {
            response.statusCode = 500;
            response.end('internal error');
        });
        await response.finished;

        const ledger = await readFile(path.join(root, '.logic-engine-host', 'mutation-ledger.jsonl'), 'utf8');
        const records = ledger.trim().split('\n').map(record => JSON.parse(record));
        assert.equal(records.at(-1).status, 'UNRESOLVED');
        assert.equal(records.at(-1).httpStatus, 500);

        const second = responseMock();
        let reachedHandler = false;
        await createHostLifecycleMutationMiddleware()(request, second, async () => {
            reachedHandler = true;
            second.json({ ok: true });
        });
        await second.finished;
        assert.equal(reachedHandler, false);
        assert.equal(second.statusCode, 503);
        assert.match(String(second.body), /HOST_JOURNAL_RECONCILIATION_REQUIRED/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('character file mutations are included in the durable before/after snapshot', async () => {
    const { root, directories, request } = await fixture();
    try {
        const avatarPath = path.join(directories.characters, 'character-a.png');
        await writeFile(avatarPath, 'avatar-before');
        await registerHostConversation(request, {
            conversationId: 'conversation-1',
            sourceLocator: 'chat-1',
            domain: 'chats',
        });
        request.path = '/api/characters/edit-avatar';
        request.originalUrl = request.path;

        const response = responseMock();
        await createHostLifecycleMutationMiddleware()(request, response, async () => {
            await writeFile(avatarPath, 'avatar-after');
            response.json({ ok: true });
        });
        await response.finished;

        const ledger = await readFile(path.join(root, '.logic-engine-host', 'mutation-ledger.jsonl'), 'utf8');
        const records = ledger.trim().split('\n').map(record => JSON.parse(record));
        assert.equal(records.at(-1).status, 'COMMITTED');
        assert.ok(records.at(-1).changes.some(change => change.artifactId === 'characters:character-a.png'));
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('character rename is rejected before it can orphan an enrolled chat path', async () => {
    const { root, directories, request } = await fixture();
    try {
        const chatDirectory = path.join(directories.chats, 'character-a');
        await mkdir(chatDirectory, { recursive: true });
        const chatPath = path.join(chatDirectory, 'chat-1.jsonl');
        await writeFile(chatPath, '{"chat_metadata":{"logic_engine_conversation_id":"00000000-0000-4000-8000-000000000002"}}\n{"mes":"before"}\n');
        await registerHostConversation(request, {
            conversationId: '00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000002',
            sourceLocator: 'chat-1',
            sourcePath: 'character-a/chat-1.jsonl',
            domain: 'chats',
        });
        request.path = '/api/characters/rename';
        request.originalUrl = request.path;
        request.body = { avatar_url: 'character-a.png', new_name: 'renamed' };

        const response = responseMock();
        let reachedHandler = false;
        await createHostLifecycleMutationMiddleware()(request, response, async () => {
            reachedHandler = true;
            response.json({ ok: true });
        });
        await response.finished;

        assert.equal(reachedHandler, false);
        assert.equal(response.statusCode, 409);
        assert.match(String(response.body), /HOST_ENROLLED_HISTORY_PATH_MUTATION_UNSUPPORTED/);
        assert.equal(await readFile(chatPath, 'utf8'), '{"chat_metadata":{"logic_engine_conversation_id":"00000000-0000-4000-8000-000000000002"}}\n{"mes":"before"}\n');
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('character deletion with chat cleanup is rejected before enrolled history is removed', async () => {
    const { root, directories, request } = await fixture();
    try {
        const chatDirectory = path.join(directories.chats, 'character-a');
        await mkdir(chatDirectory, { recursive: true });
        const chatPath = path.join(chatDirectory, 'chat-1.jsonl');
        await writeFile(chatPath, '{"chat_metadata":{"logic_engine_conversation_id":"00000000-0000-4000-8000-000000000002"}}\n{"mes":"before"}\n');
        await registerHostConversation(request, {
            conversationId: '00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000002',
            sourceLocator: 'chat-1',
            sourcePath: 'character-a/chat-1.jsonl',
            domain: 'chats',
        });
        request.path = '/api/characters/delete';
        request.originalUrl = request.path;
        request.body = { avatar_url: 'character-a.png', delete_chats: true };

        const response = responseMock();
        let reachedHandler = false;
        await createHostLifecycleMutationMiddleware()(request, response, async () => {
            reachedHandler = true;
            response.json({ ok: true });
        });
        await response.finished;

        assert.equal(reachedHandler, false);
        assert.equal(response.statusCode, 409);
        assert.match(String(response.body), /HOST_ENROLLED_HISTORY_PATH_MUTATION_UNSUPPORTED/);
        assert.equal(await readFile(chatPath, 'utf8'), '{"chat_metadata":{"logic_engine_conversation_id":"00000000-0000-4000-8000-000000000002"}}\n{"mes":"before"}\n');
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('chat rename and deletion routes refuse enrolled source paths before mutation', async () => {
    const identity = '00000000-0000-4000-8000-000000000002';
    const conversationId = '00000000-0000-4000-8000-000000000001:' + identity;
    const persistedChat = '{"chat_metadata":{"logic_engine_conversation_id":"' + identity + '"}}\n{"mes":"before"}\n';
    const cases = [
        {
            route: '/api/chats/delete',
            domain: 'chats',
            sourceLocator: 'chat-1',
            sourcePath: 'character-a/chat-1.jsonl',
            body: { avatar_url: 'character-a.png', chatfile: 'chat-1.jsonl' },
        },
        {
            route: '/api/chats/rename',
            domain: 'chats',
            sourceLocator: 'chat-1',
            sourcePath: 'character-a/chat-1.jsonl',
            body: { avatar_url: 'character-a.png', original_file: 'chat-1.jsonl', renamed_file: 'chat-2.jsonl', is_group: false },
        },
        {
            route: '/api/chats/group/delete',
            domain: 'group_chats',
            sourceLocator: 'group-chat-a',
            sourcePath: 'group-chat-a.jsonl',
            body: { id: 'group-chat-a' },
        },
    ];
    for (const scenario of cases) {
        const { root, directories, request } = await fixture();
        try {
            const domainRoot = scenario.domain === 'chats' ? directories.chats : directories.groupChats;
            const filePath = path.join(domainRoot, ...scenario.sourcePath.split('/'));
            await mkdir(path.dirname(filePath), { recursive: true });
            await writeFile(filePath, persistedChat);
            await registerHostConversation(request, {
                conversationId,
                sourceLocator: scenario.sourceLocator,
                sourcePath: scenario.sourcePath,
                domain: scenario.domain,
            });
            request.path = scenario.route;
            request.originalUrl = request.path;
            request.body = scenario.body;

            const response = responseMock();
            let reachedHandler = false;
            await createHostLifecycleMutationMiddleware()(request, response, async () => {
                reachedHandler = true;
                response.json({ ok: true });
            });
            await response.finished;

            assert.equal(reachedHandler, false, scenario.route + ' must reject before the handler');
            assert.equal(response.statusCode, 409);
            assert.match(String(response.body), /HOST_ENROLLED_HISTORY_PATH_MUTATION_UNSUPPORTED/);
            assert.equal(await readFile(filePath, 'utf8'), persistedChat);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    }
});

test('replayed operation ID is rejected before a second mutation', async () => {
    const { root, directories, request } = await fixture();
    try {
        const chatPath = path.join(directories.chats, 'chat-1.jsonl');
        await writeFile(chatPath, '{"mes":"initial"}\n');
        await registerHostConversation(request, {
            conversationId: 'conversation-1',
            sourceLocator: 'chat-1',
            domain: 'chats',
        });
        request.headers = { 'x-logic-engine-operation-id': 'operation-1' };
        request.body = { chat: 'chat-1', payload: 'private text' };
        const middleware = createHostLifecycleMutationMiddleware();
        const first = responseMock();
        await middleware(request, first, async () => {
            await writeFile(chatPath, '{"mes":"first mutation"}\n');
            first.json({ ok: true });
        });
        await first.finished;

        const second = responseMock();
        let reachedHandler = false;
        await middleware(request, second, async () => {
            reachedHandler = true;
            await writeFile(chatPath, '{"mes":"duplicate mutation"}\n');
            second.json({ ok: true });
        });
        await second.finished;
        assert.equal(reachedHandler, false);
        assert.equal(second.statusCode, 409);
        assert.match(String(second.body), /HOST_OPERATION_ALREADY_RECORDED/);
        const ledger = await readFile(path.join(root, '.logic-engine-host', 'mutation-ledger.jsonl'), 'utf8');
        assert.doesNotMatch(ledger, /private text/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('explicit reconciliation records uncertainty and permits future journaling without claiming completeness', async () => {
    const { root, directories, request } = await fixture();
    try {
        const chatPath = path.join(directories.chats, 'chat-1.jsonl');
        await writeFile(chatPath, '{"mes":"before"}\n');
        await registerHostConversation(request, {
            conversationId: 'conversation-1',
            sourceLocator: 'chat-1',
            domain: 'chats',
        });
        const response = responseMock();
        await createHostLifecycleMutationMiddleware()(request, response, async () => {
            await writeFile(chatPath, '{"mes":"mutated"}\n');
            await rm(directories.backups, { recursive: true, force: true });
            response.json({ ok: true });
        });
        await response.finished;
        assert.equal(response.statusCode, 503);

        const ledgerPath = path.join(root, '.logic-engine-host', 'mutation-ledger.jsonl');
        const records = (await readFile(ledgerPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
        const intent = records.find(record => record.kind === 'intent');
        assert.ok(intent);
        assert.equal((await getHostMutationJournalStatus(request)).status, 'RECONCILIATION_REQUIRED');

        await mkdir(directories.backups, { recursive: true });
        const reconciled = await reconcileHostMutation(request, {
            operationId: intent.operationId,
            acknowledge: 'I_ACCEPT_UNKNOWN_MUTATION_OUTCOME',
            reason: 'Operator reviewed uncertain persisted state',
        });
        assert.equal(reconciled.status, 'RECONCILED_WITH_GAP');
        const status = await getHostMutationJournalStatus(request);
        assert.equal(status.status, 'NON_READY_HISTORY_GAP');
        assert.equal(status.authority, 'NON_AUTHORITATIVE');
        assert.equal(status.historicalCompleteness, 'UNKNOWN');
        assert.equal(status.pendingOperations.length, 0);
        assert.equal(status.degraded, true);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('deleting an enrolled registry fails closed instead of disabling the middleware', async () => {
    const { root, request } = await fixture();
    try {
        await registerHostConversation(request, {
            conversationId: 'conversation-1',
            sourceLocator: 'chat-1',
            domain: 'chats',
        });
        await rm(path.join(root, '.logic-engine-host', 'enrollments.json'));
        const response = responseMock();
        let reachedHandler = false;
        await createHostLifecycleMutationMiddleware()(request, response, async () => {
            reachedHandler = true;
            response.json({ ok: true });
        });
        await response.finished;
        assert.equal(reachedHandler, false);
        assert.equal(response.statusCode, 503);
        assert.match(String(response.body), /HOST_JOURNAL_UNAVAILABLE/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('deleting an enrolled journal fails closed instead of starting a new empty history', async () => {
    const { root, request } = await fixture();
    try {
        await registerHostConversation(request, {
            conversationId: 'conversation-1',
            sourceLocator: 'chat-1',
            domain: 'chats',
        });
        await rm(path.join(root, '.logic-engine-host', 'mutation-ledger.jsonl'));
        const response = responseMock();
        let reachedHandler = false;
        await createHostLifecycleMutationMiddleware()(request, response, async () => {
            reachedHandler = true;
            response.json({ ok: true });
        });
        await response.finished;
        assert.equal(reachedHandler, false);
        assert.equal(response.statusCode, 503);
        assert.match(String(response.body), /HOST_JOURNAL_PREPARE_FAILED/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('strict lifecycle mode blocks mutation when enrollment state directory disappears', async () => {
    const { root, request } = await fixture();
    try {
        await registerHostConversation(request, {
            conversationId: 'conversation-1',
            sourceLocator: 'chat-1',
            domain: 'chats',
        });
        await rm(path.join(root, '.logic-engine-host'), { recursive: true, force: true });
        const response = responseMock();
        let reachedHandler = false;
        await createHostLifecycleMutationMiddleware({ enforce: true })(request, response, async () => {
            reachedHandler = true;
            response.json({ ok: true });
        });
        await response.finished;
        assert.equal(reachedHandler, false);
        assert.equal(response.statusCode, 503);
        assert.match(String(response.body), /HOST_JOURNAL_UNAVAILABLE/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});



test('backup deletion is rejected while Host history is enrolled because backups may hold prior versions', async () => {
    const { root, directories, request } = await fixture();
    try {
        const chatPath = path.join(directories.chats, 'chat-1.jsonl');
        const backupPath = path.join(directories.backups, 'chat_backup_chat-1.jsonl');
        await writeFile(chatPath, '{"mes":"current"}\n');
        await writeFile(backupPath, '{"mes":"older version"}\n');
        await registerHostConversation(request, {
            conversationId: 'conversation-1',
            sourceLocator: 'chat-1',
            domain: 'chats',
        });
        request.path = '/api/backups/chat/delete';
        request.originalUrl = request.path;
        request.body = { name: 'chat_backup_chat-1.jsonl' };

        const response = responseMock();
        let reachedHandler = false;
        await createHostLifecycleMutationMiddleware()(request, response, async () => {
            reachedHandler = true;
            await rm(backupPath, { force: true });
            response.json({ ok: true });
        });
        await response.finished;

        assert.equal(reachedHandler, false);
        assert.equal(response.statusCode, 409);
        assert.match(String(response.body), /HOST_ENROLLED_HISTORY_PATH_MUTATION_UNSUPPORTED/);
        assert.equal(await readFile(backupPath, 'utf8'), '{"mes":"older version"}\n');
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});


test('chat and group-chat imports are rejected while their respective Host histories are enrolled', async () => {
    const cases = [
        {
            route: '/api/chats/import',
            domain: 'chats',
            sourceLocator: 'chat-1',
            sourcePath: 'character-a/chat-1.jsonl',
            directory: 'chats',
            identity: '00000000-0000-4000-8000-000000000002',
            message: 'preserve chat',
        },
        {
            route: '/api/chats/group/import',
            domain: 'group_chats',
            sourceLocator: 'group-1',
            sourcePath: 'group-1.jsonl',
            directory: 'groupChats',
            identity: '00000000-0000-4000-8000-000000000004',
            message: 'preserve group chat',
        },
    ];
    for (const item of cases) {
        const { root, directories, request } = await fixture();
        try {
            const directory = item.directory === 'chats'
                ? path.join(directories.chats, 'character-a')
                : directories.groupChats;
            await mkdir(directory, { recursive: true });
            const chatPath = path.join(directory, path.basename(item.sourcePath));
            const persisted = [
                JSON.stringify({ chat_metadata: { logic_engine_conversation_id: item.identity } }),
                JSON.stringify({ mes: item.message }),
            ].join('\n') + '\n';
            await writeFile(chatPath, persisted);
            await registerHostConversation(request, {
                conversationId: '00000000-0000-4000-8000-000000000001:' + item.identity,
                sourceLocator: item.sourceLocator,
                sourcePath: item.sourcePath,
                domain: item.domain,
            });
            request.path = item.route;
            request.originalUrl = item.route;
            request.body = { import_data: 'replacement payload' };

            const response = responseMock();
            let reachedHandler = false;
            await createHostLifecycleMutationMiddleware()(request, response, async () => {
                reachedHandler = true;
                await writeFile(chatPath, JSON.stringify({ mes: 'imported replacement' }) + '\n');
                response.json({ ok: true });
            });
            await response.finished;

            assert.equal(reachedHandler, false, item.route + ' must be rejected before native import');
            assert.equal(response.statusCode, 409);
            assert.match(String(response.body), /HOST_ENROLLED_HISTORY_PATH_MUTATION_UNSUPPORTED/);
            assert.equal(await readFile(chatPath, 'utf8'), persisted);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    }
});


test('enrolled chat save without a request-bound lifecycle capability is rejected before native overwrite', async () => {
    const { root, directories, request } = await fixture();
    try {
        const directory = path.join(directories.chats, 'character-a');
        await mkdir(directory, { recursive: true });
        const chatPath = path.join(directory, 'chat-1.jsonl');
        const persisted = JSON.stringify({
            chat_metadata: { logic_engine_conversation_id: '00000000-0000-4000-8000-000000000002' },
        }) + '\n' + JSON.stringify({ mes: 'preserve enrolled history' }) + '\n';
        await writeFile(chatPath, persisted);
        await registerHostConversation(request, {
            conversationId: '00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000002',
            sourceLocator: 'chat-1',
            sourcePath: 'character-a/chat-1.jsonl',
            domain: 'chats',
        });
        request.path = '/api/chats/save';
        request.originalUrl = '/api/chats/save';
        request.body = {
            avatar_url: 'character-a.png',
            file_name: 'chat-1',
            chat: [{ mes: 'stale or unbound replacement' }],
        };
        const response = responseMock();
        let reachedNativeSave = false;
        await createHostLifecycleMutationMiddleware()(request, response, async () => {
            reachedNativeSave = true;
            await writeFile(chatPath, JSON.stringify({ mes: 'overwritten' }) + '\\n');
            response.json({ ok: true });
        });
        await response.finished;
        assert.equal(reachedNativeSave, false);
        assert.equal(response.statusCode, 409);
        assert.match(String(response.body), /HOST_ENROLLED_HISTORY_SAVE_CAPABILITY_REQUIRED/);
        assert.equal(await readFile(chatPath, 'utf8'), persisted);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});


test('enrolled group-chat save without a request-bound lifecycle capability is rejected before overwrite', async () => {
    const { root, directories, request } = await fixture();
    try {
        const chatPath = path.join(directories.groupChats, 'group-1.jsonl');
        const persisted = JSON.stringify({
            chat_metadata: { logic_engine_conversation_id: '00000000-0000-4000-8000-000000000004' },
        }) + '\n' + JSON.stringify({ mes: 'preserve enrolled group history' }) + '\n';
        await writeFile(chatPath, persisted);
        await registerHostConversation(request, {
            conversationId: '00000000-0000-4000-8000-000000000003:00000000-0000-4000-8000-000000000004',
            sourceLocator: 'group-1',
            sourcePath: 'group-1.jsonl',
            domain: 'group_chats',
        });
        request.path = '/api/chats/group/save';
        request.originalUrl = '/api/chats/group/save';
        request.body = { id: 'group-1', chat: [{ mes: 'stale replacement' }] };
        const response = responseMock();
        let reachedNativeSave = false;
        await createHostLifecycleMutationMiddleware()(request, response, async () => {
            reachedNativeSave = true;
            await writeFile(chatPath, JSON.stringify({ mes: 'overwritten' }) + '\n');
            response.json({ ok: true });
        });
        await response.finished;
        assert.equal(reachedNativeSave, false);
        assert.equal(response.statusCode, 409);
        assert.match(String(response.body), /HOST_ENROLLED_HISTORY_SAVE_CAPABILITY_REQUIRED/);
        assert.equal(await readFile(chatPath, 'utf8'), persisted);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

