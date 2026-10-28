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
    assert.deepEqual(getStatus(), { status: 'DISPATCH_DELEGATED', hasPendingRequest: false, dispatchInFlight: false, protectedFailureLockout: false });
});



test('cancel only affects the matching pending request', () => {
    armProtectedRequest('index-test-3', async () => {});
    assert.equal(cancelProtectedRequest('wrong-id'), false);
    assert.equal(getStatus().hasPendingRequest, true);
    assert.equal(cancelProtectedRequest('index-test-3'), true);
    assert.deepEqual(getStatus(), { status: 'CANCELLED', hasPendingRequest: false, dispatchInFlight: false, protectedFailureLockout: false });
});

test('concurrent generation is aborted while protected dispatch is still in flight', async () => {
    let releaseDispatch;
    const dispatchWait = new Promise(resolve => { releaseDispatch = resolve; });
    const order = [];
    armProtectedRequest('index-test-concurrent', async request => {
        order.push(['dispatch-start', request.requestId]);
        await dispatchWait;
        order.push(['dispatch-end', request.requestId]);
    });

    const first = globalThis.logicEngineExtensionGatewayGenerationInterceptor(
        [{ mes: 'protected test context' }],
        4096,
        immediately => order.push(['first-abort', immediately]),
        'normal',
    );

    // Let the first interceptor consume the arm and reach the pending callback.
    await Promise.resolve();
    await Promise.resolve();

    let secondAborted = false;
    await globalThis.logicEngineExtensionGatewayGenerationInterceptor(
        [{ mes: 'concurrent context' }],
        4096,
        immediately => { secondAborted = immediately; },
        'normal',
    );

    assert.equal(secondAborted, true);
    assert.equal(getStatus().dispatchInFlight, true);
    assert.equal(getStatus().protectedFailureLockout, false);
    assert.deepEqual(order, [
        ['first-abort', true],
        ['dispatch-start', 'index-test-concurrent'],
    ]);

    releaseDispatch();
    await first;

    assert.equal(getStatus().dispatchInFlight, false);
    assert.equal(getStatus().protectedFailureLockout, false);
    assert.deepEqual(order, [
        ['first-abort', true],
        ['dispatch-start', 'index-test-concurrent'],
        ['dispatch-end', 'index-test-concurrent'],
    ]);
});

test('missing dispatch callback locks out later native generation instead of allowing fallback', async () => {
    armProtectedRequest('index-test-2', null);
    let aborted = false;

    await globalThis.logicEngineExtensionGatewayGenerationInterceptor(
        [],
        4096,
        immediately => { aborted = immediately; },
        'normal',
    );

    assert.equal(aborted, true);
    assert.deepEqual(getStatus(), {
        status: 'BLOCKED_NO_TRUSTED_DISPATCH',
        hasPendingRequest: false,
        dispatchInFlight: false,
        protectedFailureLockout: true,
    });
    assert.throws(() => armProtectedRequest('retry-after-failure', async () => {}), /reload required/);

    let retryAborted = false;
    await globalThis.logicEngineExtensionGatewayGenerationInterceptor(
        [{ mes: 'retry must not reach native provider' }],
        4096,
        immediately => { retryAborted = immediately; },
        'normal',
    );
    assert.equal(retryAborted, true);
    assert.equal(getStatus().status, 'BLOCKED_AFTER_PROTECTED_FAILURE');
    assert.equal(getStatus().protectedFailureLockout, true);
});
