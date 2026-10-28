import test from 'node:test';
import assert from 'node:assert/strict';
import {
    armProtectedRequest,
    cancelProtectedRequest,
    getStatus,
} from '../index.js';

test('gateway exports do not create an extra public global API', () => {
    assert.equal(globalThis.logicEngineExtensionGateway, undefined);
    assert.equal(typeof globalThis.logicEngineExtensionGatewayGenerationInterceptor, 'function');
});

test('arming validates request IDs and allows only one pending request', () => {
    assert.throws(() => armProtectedRequest('', async () => {}), /requestId is required/);
    armProtectedRequest('validation-test', async () => {});
    assert.throws(() => armProtectedRequest('second-request', async () => {}), /already armed/);
    assert.equal(cancelProtectedRequest('validation-test'), true);
});

test('arming is consumed once and interceptor aborts native generation before dispatch', async () => {
    const order = [];
    armProtectedRequest('index-test-1', async request => {
        order.push(['dispatch', request.requestId]);
    });

    await globalThis.logicEngineExtensionGatewayGenerationInterceptor(
        [{ mes: 'test only' }],
        4096,
        immediately => order.push(['abort', immediately]),
        'normal',
    );

    let replayAborted = false;
    await globalThis.logicEngineExtensionGatewayGenerationInterceptor(
        [{ mes: 'second generation' }],
        4096,
        immediately => { replayAborted = immediately; },
        'normal',
    );

    assert.deepEqual(order, [['abort', true], ['dispatch', 'index-test-1']]);
    assert.equal(replayAborted, false);
    assert.deepEqual(getStatus(), { status: 'DISPATCH_DELEGATED', hasPendingRequest: false });
});

test('missing dispatch callback aborts native generation and fails closed', async () => {
    armProtectedRequest('index-test-2', null);
    let aborted = false;

    await globalThis.logicEngineExtensionGatewayGenerationInterceptor(
        [],
        4096,
        immediately => { aborted = immediately; },
        'normal',
    );

    assert.equal(aborted, true);
    assert.deepEqual(getStatus(), { status: 'BLOCKED_NO_TRUSTED_DISPATCH', hasPendingRequest: false });
});

test('cancel only affects the matching pending request', () => {
    armProtectedRequest('index-test-3', async () => {});
    assert.equal(cancelProtectedRequest('wrong-id'), false);
    assert.equal(getStatus().hasPendingRequest, true);
    assert.equal(cancelProtectedRequest('index-test-3'), true);
    assert.deepEqual(getStatus(), { status: 'CANCELLED', hasPendingRequest: false });
});
