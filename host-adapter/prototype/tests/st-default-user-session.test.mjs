import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostInventoryHandler, createHostSessionHandler } from '../st-host-inventory-handler.mjs';

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

const pinned = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';
const id = '2e6b0a80-4e73-4c66-aaf3-7a6e62c7f401';
const conversation = '4e6b0a80-4e73-4c66-aaf3-7a6e62c7f403';

test('default-user mode creates Host identity in signed session without session.handle', () => {
  const handler = createHostSessionHandler({ createId: () => id });
  const session = {};
  const response = makeResponse();
  handler({ session, user: { profile: { handle: 'default-user' }, directories: {} } }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.host_session_id, id);
  assert.equal(session.logicEngineSessionId, id);
  assert.equal(session.logicEngineSessionHandle, 'default-user');
  assert.equal(response.body.host_user_handle, 'default-user');
});

test('default-user mode reuses its signed-session identity across requests', () => {
  const handler = createHostSessionHandler({ createId: () => id });
  const session = { logicEngineSessionId: id, logicEngineSessionHandle: 'default-user' };
  const request = { session, user: { profile: { handle: 'default-user' }, directories: {} } };
  const first = makeResponse();
  const second = makeResponse();
  handler(request, first);
  handler(request, second);
  assert.equal(first.body.host_session_id, id);
  assert.equal(second.body.host_session_id, id);
});

test('default-user inventory request is accepted only after Host session identity exists', async () => {
  let calls = 0;
  const root = join(tmpdir(), 'st-default-user-root');
  const directories = {
    root,
    chats: join(root, 'chats'),
    groups: join(root, 'groups'),
    groupChats: join(root, 'groupChats'),
  };
  const handler = createHostInventoryHandler({
    enumerate: async input => {
      calls++;
      assert.deepEqual(input.directories, directories);
      return {
        filesystem: { status: 'complete', entries: [] },
        source: { status: 'DOUBLE_SCAN_CANDIDATE', files: [], blockers: [] },
        snapshot_alignment: 'SHARED_VSS_SNAPSHOT',
      };
    },
    persistRootInventory: async () => ({
      status: 'BASELINED_REVIEW_ONLY',
      integrity_status: 'INTEGRITY_OK',
      sequence: 1,
      manifest_sha256: 'a'.repeat(64),
    }),
    pinnedHostCommit: pinned,
    hostBuildClaim: pinned,
  });
  const response = makeResponse();
  await handler({
    user: { profile: { handle: 'default-user' }, directories },
    session: { logicEngineSessionId: id, logicEngineSessionHandle: 'default-user' },
    query: { conversation_uuid: conversation },
  }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.host_user_handle, 'default-user');
  assert.equal(response.body.host_build_claim_type, 'DEPLOYMENT_ASSERTION_NOT_RUNTIME_ATTESTATION');
  assert.equal(calls, 1);
});
test('default-user inventory request rejects missing or mismatched signed-session identity', async () => {
  let calls = 0;
  const handler = createHostInventoryHandler({
    enumerate: async () => { calls++; return { files: [] }; },
    pinnedHostCommit: pinned,
    hostBuildClaim: pinned,
  });
  const missing = makeResponse();
  await handler({
    user: { profile: { handle: 'default-user' }, directories: {} },
    session: {},
    query: { conversation_uuid: conversation },
  }, missing);
  assert.equal(missing.statusCode, 403);

  const mismatch = makeResponse();
  await handler({
    user: { profile: { handle: 'default-user' }, directories: {} },
    session: { logicEngineSessionId: id, logicEngineSessionHandle: 'another-user' },
    query: { conversation_uuid: conversation },
  }, mismatch);
  assert.equal(mismatch.statusCode, 403);
  assert.equal(calls, 0);
});

test('account-enabled mode still rejects a signed session account mismatch', () => {
  const handler = createHostSessionHandler({ createId: () => id });
  const response = makeResponse();
  handler({
    session: { handle: 'bob' },
    user: { profile: { handle: 'alice' }, directories: {} },
  }, response);
  assert.equal(response.statusCode, 403);
});
