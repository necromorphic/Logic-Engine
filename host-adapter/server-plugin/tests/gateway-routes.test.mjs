import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { init } from '../index.mjs';

test('configured Host endpoints are mounted only under the Extension Gateway router', async t => {
    const identityDirectory = await mkdtemp(join(tmpdir(), 'st-host-gateway-'));
    const names = [
        'LOGIC_ENGINE_CORE_URL',
        'LOGIC_ENGINE_API_TOKEN',
        'LOGIC_ENGINE_ADAPTER_ID',
        'LOGIC_ENGINE_ADAPTER_TOKEN',
        'LOGIC_ENGINE_HOST_ACTOR_ENTITY_ID',
        'LOGIC_ENGINE_HOST_IDENTITY_DIR',
        'LOGIC_ENGINE_HOST_BUILD_SHA',
    ];
    const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
    Object.assign(process.env, {
        LOGIC_ENGINE_CORE_URL: 'http://127.0.0.1:8787',
        LOGIC_ENGINE_API_TOKEN: 'core-api-token-long-enough-123456',
        LOGIC_ENGINE_ADAPTER_ID: 'st-host-adapter',
        LOGIC_ENGINE_ADAPTER_TOKEN: 'host-adapter-token-long-enough-123456',
        LOGIC_ENGINE_HOST_ACTOR_ENTITY_ID: 'npc-kiryu',
        LOGIC_ENGINE_HOST_IDENTITY_DIR: identityDirectory,
        LOGIC_ENGINE_HOST_BUILD_SHA: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
    });
    t.after(async () => {
        for (const name of names) {
            if (previous[name] === undefined) delete process.env[name];
            else process.env[name] = previous[name];
        }
        await rm(identityDirectory, { recursive: true, force: true });
    });

    const routes = new Map();
    const router = {
        get(path, handler) { routes.set('GET ' + path, handler); },
        post(path, ...handlers) { routes.set('POST ' + path, handlers); },
    };
    await init(router);

    for (const route of [
        'GET /health',
        'GET /session',
        'GET /identity',
        'GET /inventory',
        'POST /context',
        'POST /host-version-ledger/capture',
        'POST /host-version-ledger/reconcile',
        'POST /host-lifecycle/events',
        'GET /host-lifecycle/status',
    ]) assert.equal(routes.has(route), true, route);

    assert.equal([...routes.keys()].some(route => route.includes('/api/logic-engine')), false);
    assert.equal([...routes.keys()].some(route => route.includes('/v1/')), false);
});
