import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createHostContextRoute, createHostConversationResolver } from '../context-route.mjs';

const sessionId = '2e6b0a80-4e73-4c66-aaf3-7a6e62c7f401';
const installationId = '3e6b0a80-4e73-4c66-aaf3-7a6e62c7f402';
const accountId = '5e6b0a80-4e73-4c66-aaf3-7a6e62c7f404';
const conversationUuid = '4e6b0a80-4e73-4c66-aaf3-7a6e62c7f403';
const conversationId = [installationId, accountId, conversationUuid].join(':');
const directories = { root: '/st', chats: '/st/chats', groups: '/st/groups', groupChats: '/st/groupChats' };
const adapterToken = 'test-adapter-secret-for-context-route';

function makeRequest(overrides = {}) {
    return {
        user: { profile: { handle: 'default-user' }, directories },
        session: { logicEngineSessionId: sessionId, logicEngineSessionHandle: 'default-user' },
        body: { conversation_uuid: conversationUuid },
        ...overrides,
    };
}

function makeResponse() {
    return {
        statusCode: null,
        body: null,
        headers: {},
        set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
        sendStatus(code) { this.statusCode = code; return this; },
    };
}

function dependencies(overrides = {}) {
    return {
        identityStore: {
            async resolveAuthenticatedAccount(handle) {
                assert.equal(handle, 'default-user');
                return { host_installation_id: installationId, authenticated_account_id: accountId };
            },
        },
        enumerate: async input => {
            assert.deepEqual(input.directories, directories);
            return {
                filesystem: { status: 'complete' },
                source: {
                    status: 'DOUBLE_SCAN_CANDIDATE',
                    files: [{ logical_identity: { conversation_uuid: conversationUuid } }],
                },
            };
        },
        ...overrides,
    };
}

test('resolver binds default-user request to server session, installation and inventoried conversation', async () => {
    const resolver = createHostConversationResolver(dependencies());
    assert.equal(await resolver(makeRequest()), conversationId);
});

test('resolver rejects caller-supplied world, actor, account or session fields', async () => {
    const resolver = createHostConversationResolver(dependencies());
    for (const extra of [
        { world_id: 'attacker-world' },
        { actor_id: 'attacker-actor' },
        { account_id: 'attacker-account' },
        { session_id: 'attacker-session' },
    ]) {
        await assert.rejects(resolver(makeRequest({ body: { conversation_uuid: conversationUuid, ...extra } })));
    }
});

test('resolver rejects mismatched account session and incomplete or ambiguous inventory', async () => {
    const resolver = createHostConversationResolver(dependencies());
    await assert.rejects(resolver(makeRequest({
        session: { logicEngineSessionId: sessionId, logicEngineSessionHandle: 'another-user' },
    })));
    await assert.rejects(createHostConversationResolver(dependencies({
        enumerate: async () => ({ filesystem: { status: 'incomplete' }, source: { status: 'DOUBLE_SCAN_CANDIDATE', files: [] } }),
    }))(makeRequest()));
    await assert.rejects(createHostConversationResolver(dependencies({
        enumerate: async () => ({
            filesystem: { status: 'complete' },
            source: { status: 'DOUBLE_SCAN_CANDIDATE', files: [
                { logical_identity: { conversation_uuid: conversationUuid } },
                { logical_identity: { conversation_uuid: conversationUuid } },
            ] },
        }),
    }))(makeRequest()));
});

test('context route sends authenticated installation/account/session identity to Core for world and actor resolution', async () => {
    const calls = [];
    const route = createHostContextRoute({
        ...dependencies(),
        config: { adapterId: 'st-adapter', actorEntityId: 'npc-kiryu', adapterToken },
        corePost: async (path, body) => {
            calls.push({ path, body });
            if (path === '/v1/host-sessions/verify') {
                return {
                    status: 'AUTHENTICATED_HOST_SESSION',
                    conversation_id: conversationId,
                    world_id: 'world-kamurocho',
                    actor_id: 'npc-kiryu',
                };
            }
            return {
                context: {
                    installation_id: installationId,
                    account_id: accountId,
                    session_id: sessionId,
                    conversation_id: conversationId,
                    world_id: 'world-kamurocho',
                    actor_id: 'npc-kiryu',
                    adapter_id: 'st-adapter',
                    authority: 'AUTHENTICATED_ADAPTER_AND_CORE_BINDINGS',
                },
            };
        },
    });
    const request = makeRequest();
    const response = makeResponse();
    let nextCalls = 0;
    await route.middleware(request, response, () => { nextCalls++; });
    assert.equal(nextCalls, 1);
    await route.handler(request, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.identity.installation_id, installationId);
    assert.equal(response.body.identity.account_id, accountId);
    assert.equal(response.body.identity.session_id, sessionId);
    assert.equal(response.body.conversation_id, conversationId);
    assert.equal(response.body.binding.world_id, 'world-kamurocho');
    assert.equal(response.body.binding.actor_id, 'npc-kiryu');
    assert.equal(response.body.authentication, 'AUTHENTICATED_HOST_SESSION');
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], {
        path: '/v1/host-conversation-bindings/resolve-context',
        body: {
            conversation_id: conversationId,
            host_context: {
                installation_id: installationId,
                account_id: accountId,
                session_id: sessionId,
            },
            actor_entity_id: 'npc-kiryu',
        },
    });
    assert.equal(calls[1].path, '/v1/host-sessions/verify');
    const assertion = calls[1].body.assertion;
    assert.equal(assertion.host_installation_id, installationId);
    assert.equal(assertion.authenticated_account_id, accountId);
    assert.equal(assertion.host_session_id, sessionId);
    assert.equal(assertion.conversation_id, conversationId);
    assert.equal(assertion.world_id, 'world-kamurocho');
    assert.equal(assertion.actor_id, 'npc-kiryu');
    assert.equal(assertion.protocol_version, 1);
    assert.equal(typeof assertion.nonce, 'string');
    assert.equal(Number.isSafeInteger(assertion.issued_at), true);
    const canonical = JSON.stringify([
        assertion.protocol_version, assertion.host_installation_id, assertion.authenticated_account_id,
        assertion.host_session_id, assertion.conversation_id, assertion.world_id, assertion.actor_id,
        assertion.issued_at, assertion.nonce,
    ]);
    assert.equal(calls[1].body.signature, createHmac('sha256', adapterToken).update(canonical, 'utf8').digest('hex'));
});

test('context route fails closed when Core world or actor binding cannot be resolved', async () => {
    for (const corePost of [
        async () => { throw new Error('HOST_CONVERSATION_NOT_AUTHORIZED'); },
        async path => path.includes('/actors/') ? { resolution: {} } : { binding: { world_id: 'world-kamurocho' } },
    ]) {
        const route = createHostContextRoute({
            ...dependencies(),
            config: { adapterId: 'st-adapter', actorEntityId: 'npc-kiryu' },
            corePost,
        });
        const request = makeRequest();
        const response = makeResponse();
        await route.middleware(request, response, () => {});
        await route.handler(request, response);
        assert.equal(response.statusCode, 409);
        assert.equal(response.body.status, 'NON_READY');
    }
});
