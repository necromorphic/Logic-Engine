import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostInventoryHandler } from '../server-plugin/st-host-inventory-handler.mjs';

function fakeResponse() {
  return {
    statusCode: null,
    body: null,
    set() {},
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

test('inventory failure emits a bounded server diagnostic and keeps browser response opaque', async t => {
  const originalError = console.error;
  const diagnostics = [];
  console.error = (...args) => diagnostics.push(args);
  t.after(() => { console.error = originalError; });

  const handler = createHostInventoryHandler({
    enumerate: async () => {
      throw new TypeError('Cannot read C:\\Users\\alice\\private-chat.json for 11111111-1111-4111-8111-111111111111');
    },
    pinnedHostCommit: 'a'.repeat(40),
    hostBuildClaim: '',
  });
  const response = fakeResponse();
  await handler({
    user: {
      profile: { handle: 'alice' },
      directories: {
        root: '/tmp/st-data',
        chats: '/tmp/st-data/chats',
        groups: '/tmp/st-data/groups',
        groupChats: '/tmp/st-data/groupChats',
        extensions: '/tmp/st-data/extensions',
      },
    },
    session: {
      logicEngineSessionId: '22222222-2222-4222-8222-222222222222',
      logicEngineSessionHandle: 'alice',
    },
    query: { conversation_uuid: '33333333-3333-4333-8333-333333333333' },
  }, response);

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, {
    status: 'NON_READY',
    code: 'SOURCE_INVENTORY_UNAVAILABLE',
    reason: 'HOST_INVENTORY_INTERNAL_ERROR',
  });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0][0], '[LogicEngine] Host inventory failed');
  assert.equal(diagnostics[0][1].error_name, 'TypeError');
  assert.match(diagnostics[0][1].diagnostic, /<path>/);
  assert.match(diagnostics[0][1].diagnostic, /<uuid>/);
  assert.doesNotMatch(JSON.stringify(response.body), /Users|alice|private-chat|11111111/);
  assert.doesNotMatch(JSON.stringify(diagnostics), /C:\\\\Users\\\\alice|private-chat\.json|11111111-1111/);
});

test('inventory failure preserves explicit Host diagnostic markers', async () => {
  const handler = createHostInventoryHandler({
    enumerate: async () => { throw new Error('HOST_VSS_CREATE_FAILED:9'); },
    pinnedHostCommit: 'a'.repeat(40),
    hostBuildClaim: '',
  });
  const response = fakeResponse();
  const originalError = console.error;
  console.error = () => {};
  try {
    await handler({
      user: {
        profile: { handle: 'alice' },
        directories: {
          root: '/tmp/st-data',
          chats: '/tmp/st-data/chats',
          groups: '/tmp/st-data/groups',
          groupChats: '/tmp/st-data/groupChats',
        },
      },
      session: {
        logicEngineSessionId: '22222222-2222-4222-8222-222222222222',
        logicEngineSessionHandle: 'alice',
      },
      query: { conversation_uuid: '33333333-3333-4333-8333-333333333333' },
    }, response);
  } finally {
    console.error = originalError;
  }
  assert.equal(response.body.reason, 'HOST_VSS_CREATE_FAILED:9');
});
