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
        groups: path.join(root, 'groups'),
        groupChats: path.join(root, 'groupChats'),
        backups: path.join(root, 'backups'),
    };
    await Promise.all(Object.values(directories).map(directory => mkdir(directory, { recursive: true })));
    const request = {
        method: 'POST',
        baseUrl: '',
        path: '/api/chats/save',
        originalUrl: '/api/chats/save',
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

test('explicit enrollment enables durable before/after journal around direct server mutation routes', async () => {
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
            request.path = '/api/chats/save';
            void middleware(request, response, async () => {
                await rm(directories.backups, { recursive: true, force: true });
                response.statusCode = 200;
                response.setHeader('Content-Type', 'application/json');
                response.setHeader('Content-Length', '11');
                response.setHeader('ETag', '"success-body"');
                response.writeHead(200);
                response.write('{"ok":true}');
                response.end();
            });
        });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const address = server.address();
        const response = await fetch(`http://127.0.0.1:${address.port}/api/chats/save`, { method: 'POST' });
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

test('non-2xx mutation response is journaled UNRESOLVED and blocks subsequent mutations', async () => {
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
        assert.equal(records[1].status, 'UNRESOLVED');
        assert.equal(records[1].httpStatus, 400);

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

