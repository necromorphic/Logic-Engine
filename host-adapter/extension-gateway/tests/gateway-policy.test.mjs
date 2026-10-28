import test from 'node:test';
import assert from 'node:assert/strict';
import { interceptProtectedGeneration } from '../gateway-policy.mjs';

test('ordinary generation passes through when no protected request is armed', async () => {
    let aborted = false;
    const result = await interceptProtectedGeneration({
        pendingRequest: null,
        chat: [],
        contextSize: 4096,
        type: 'normal',
        abort: () => { aborted = true; },
        dispatch: async () => { throw new Error('must not run'); },
    });
    assert.equal(result.status, 'PASS_THROUGH');
    assert.equal(aborted, false);
});

test('protected generation aborts native send before invoking trusted dispatch', async () => {
    const order = [];
    const result = await interceptProtectedGeneration({
        pendingRequest: { requestId: 'req-1' },
        chat: [{ mes: 'test-only' }],
        contextSize: 4096,
        type: 'normal',
        abort: immediate => { order.push(['abort', immediate]); },
        dispatch: async request => {
            order.push(['dispatch', request.requestId]);
        },
    });
    assert.deepEqual(order, [['abort', true], ['dispatch', 'req-1']]);
    assert.equal(result.status, 'DISPATCH_DELEGATED');
});

test('protected generation fails closed when dispatch callback is missing', async () => {
    let aborted = false;
    const result = await interceptProtectedGeneration({
        pendingRequest: { requestId: 'req-2' },
        chat: [],
        contextSize: 4096,
        type: 'normal',
        abort: immediate => { aborted = immediate; },
        dispatch: null,
    });
    assert.equal(aborted, true);
    assert.equal(result.status, 'BLOCKED_NO_TRUSTED_DISPATCH');
});

test('protected generation fails closed when dispatch throws without exposing error text', async () => {
    let aborted = false;
    const result = await interceptProtectedGeneration({
        pendingRequest: { requestId: 'req-3' },
        chat: [],
        contextSize: 4096,
        type: 'normal',
        abort: immediate => { aborted = immediate; },
        dispatch: async () => { throw new Error('secret prompt content'); },
    });
    assert.equal(aborted, true);
    assert.equal(result.status, 'BLOCKED_DISPATCH_FAILED');
    assert.equal(JSON.stringify(result).includes('secret prompt content'), false);
});
