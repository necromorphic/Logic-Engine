import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostInventoryHandler } from '../st-host-inventory-handler.mjs';

function makeResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    sendStatus(code) { this.statusCode = code; return this; },
  };
}

const pinned = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';

test('host inventory route rejects unauthenticated and incomplete user sessions', async () => {
  let calls = 0;
  const handler = createHostInventoryHandler({
    enumerate: async () => { calls += 1; return {}; },
    pinnedHostCommit: pinned,
    hostBuildClaim: pinned,
  });
  const unauthenticated = makeResponse();
  await handler({}, unauthenticated);
  assert.equal(unauthenticated.statusCode, 403);
  const noHandle = makeResponse();
  await handler({ user: { directories: {} } }, noHandle);
  assert.equal(noHandle.statusCode, 403);
  assert.equal(calls, 0);
});

test('host inventory route fails closed unless the deployment build claim matches the pinned target', async () => {
  let calls = 0;
  const handler = createHostInventoryHandler({
    enumerate: async () => { calls += 1; return {}; },
    pinnedHostCommit: pinned,
    hostBuildClaim: '',
  });
  const response = makeResponse();
  await handler({ user: { profile: { handle: 'default-user' }, directories: {} } }, response);
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, { status: 'NON_READY', code: 'HOST_BUILD_NOT_PINNED' });
  assert.equal(calls, 0);
});

test('host inventory route passes only the authenticated user data roots and returns a non-authoritative manifest', async () => {
  let observed;
  const inventory = {
    status: 'STABLE_SCAN_CANDIDATE',
    authority: 'NON_AUTHORITATIVE',
    file_count: 2,
    inventory_sha256: 'a'.repeat(64),
    blockers: ['NO_PRE_ENROLLMENT_DELETED_HISTORY'],
  };
  const handler = createHostInventoryHandler({
    enumerate: async input => { observed = input; return inventory; },
    pinnedHostCommit: pinned,
    hostBuildClaim: pinned,
  });
  const response = makeResponse();
  const directories = {
    chats: 'C:\\st\\data\\chats',
    groups: 'C:\\st\\data\\groups',
    groupChats: 'C:\\st\\data\\group chats',
    characters: 'C:\\st\\data\\characters',
    backups: 'C:\\st\\data\\backups',
  };
  await handler({ user: { profile: { handle: 'alice' }, directories } }, response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(observed, {
    directories: {
      chats: directories.chats,
      groups: directories.groups,
      groupChats: directories.groupChats,
    },
    hostCommit: pinned,
  });
  assert.equal(response.body.authority, 'NON_AUTHORITATIVE');
  assert.equal(response.body.host_user_handle, 'alice');
  assert.equal(response.body.host_build_claim_type, 'DEPLOYMENT_ASSERTION_NOT_RUNTIME_ATTESTATION');
  assert.equal(JSON.stringify(response.body).includes('raw-chat-message'), false);
});

test('host inventory route hides scanner errors and absolute paths from the HTTP response', async () => {
  const handler = createHostInventoryHandler({
    enumerate: async () => { throw Object.assign(new Error('C:\\private\\chat.jsonl'), { code: 'SOURCE_FILE_UNAVAILABLE' }); },
    pinnedHostCommit: pinned,
    hostBuildClaim: pinned,
  });
  const response = makeResponse();
  await handler({ user: { profile: { handle: 'alice' }, directories: {} } }, response);
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, { status: 'NON_READY', code: 'SOURCE_INVENTORY_UNAVAILABLE' });
  assert.equal(JSON.stringify(response.body).includes('private'), false);
});
