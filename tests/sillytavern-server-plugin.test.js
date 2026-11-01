import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogicEnginePlugin } from '../server-plugin/index.mjs';

function fakeRouter() {
    const routes = new Map();
    return {
        routes,
        get(path, handler) { routes.set(path, handler); },
    };
}

function fakeResponse() {
    return {
        statusCode: 200,
        headers: {},
        body: null,
        status(code) { this.statusCode = code; return this; },
        set(name, value) { this.headers[name] = value; return this; },
        json(value) { this.body = value; return this; },
    };
}

test('server plugin exposes only routes behind the authenticated ST user context', async () => {
    const router = fakeRouter();
    const plugin = createLogicEnginePlugin({
        coreUrl: 'http://127.0.0.1:8787',
        fetchImpl: async () => new Response(JSON.stringify({
            ok: true, service: 'logic-engine', protocol_version: 'v1',
        }), { status: 200, headers: { 'content-type': 'application/json' } }),
        hostId: 'test-install',
    });
    plugin.init(router);

    const sessionRoute = router.routes.get('/session');
    assert.equal(typeof sessionRoute, 'function');
    const denied = fakeResponse();
    sessionRoute({}, denied);
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.body.error.code, 'ST_USER_CONTEXT_REQUIRED');

    const allowed = fakeResponse();
    sessionRoute({ user: { profile: { handle: 'test-user' } } }, allowed);
    assert.equal(allowed.statusCode, 200);
    assert.equal(allowed.body.host_context_valid, true);
    assert.equal(allowed.body.adapter, 'sillytavern-server-plugin');
    assert.notEqual(allowed.body.subject_id, 'test-user');
    assert.match(allowed.body.subject_id, /^[a-f0-9]{64}$/);

    const health = fakeResponse();
    await router.routes.get('/health')(
        { user: { profile: { handle: 'test-user' } } },
        health,
    );
    assert.equal(health.statusCode, 200);
    assert.equal(health.body.ok, true);
    assert.equal(health.body.host_adapter, true);
});

test('server plugin does not accept a Core URL from browser request data', async () => {
    let requestedUrl;
    const router = fakeRouter();
    createLogicEnginePlugin({
        coreUrl: 'http://127.0.0.1:8787',
        fetchImpl: async (url) => {
            requestedUrl = url;
            return new Response(JSON.stringify({
                ok: true, service: 'logic-engine', protocol_version: 'v1',
            }), { status: 200, headers: { 'content-type': 'application/json' } });
        },
    }).init(router);

    const response = fakeResponse();
    await router.routes.get('/health')({
        user: { profile: { handle: 'test-user' } },
        body: { coreUrl: 'http://attacker.example' },
        query: { coreUrl: 'http://attacker.example' },
    }, response);
    assert.equal(requestedUrl, 'http://127.0.0.1:8787/health');
});

test('server plugin fails closed when Core cannot be reached', async () => {
    const router = fakeRouter();
    createLogicEnginePlugin({
        fetchImpl: async () => { throw new Error('offline'); },
    }).init(router);
    const response = fakeResponse();
    await router.routes.get('/health')({
        user: { profile: { handle: 'test-user' } },
    }, response);
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.error.code, 'CORE_UNREACHABLE');
});
