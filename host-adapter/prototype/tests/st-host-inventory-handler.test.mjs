import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const test = nodeTest;

import { createHostBulkMutationGuard, createHostIdentityHandler, createHostInventoryHandler, createHostSessionHandler } from '../st-host-inventory-handler.mjs';

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

test('server bulk mutation guard blocks imports when any enrolled conversation exists', async () => {
  const root = join(tmpdir(), 'st-host-bulk-guard');
  const directories = {
    root,
    chats: join(root, 'chats'),
    groups: join(root, 'groups'),
    groupChats: join(root, 'groupChats'),
  };
  let nextCalls = 0;
  const guard = createHostBulkMutationGuard({
    pinnedHostCommit: pinned,
    enumerate: async input => {
      assert.deepEqual(input.directories, directories);
      return {
        filesystem: { status: 'complete' },
        source: {
          status: 'DOUBLE_SCAN_CANDIDATE',
          files: [{
            logical_identity: {
              conversation_uuid: '11111111-1111-4111-8111-111111111111',
            },
          }],
        },
      };
    },
  });
  const blocked = makeResponse();
  await guard({ user: { directories } }, blocked, () => { nextCalls++; });
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.body.code, 'HOST_LIFECYCLE_BULK_MUTATION_BLOCKED');
  assert.equal(nextCalls, 0);
});

test('server bulk mutation guard permits imports only when a complete scan finds no enrolled chats', async () => {
  const root = join(tmpdir(), 'st-host-bulk-guard-empty');
  const directories = {
    root,
    chats: join(root, 'chats'),
    groups: join(root, 'groups'),
    groupChats: join(root, 'groupChats'),
  };
  let nextCalls = 0;
  const guard = createHostBulkMutationGuard({
    pinnedHostCommit: pinned,
    enumerate: async () => ({
      filesystem: { status: 'complete' },
      source: { status: 'DOUBLE_SCAN_CANDIDATE', files: [{ logical_identity: null }] },
    }),
  });
  const response = makeResponse();
  await guard({ user: { directories } }, response, () => { nextCalls++; });
  assert.equal(response.statusCode, null);
  assert.equal(nextCalls, 1);
});

test('server bulk mutation guard fails closed when inventory is incomplete', async () => {
  const root = join(tmpdir(), 'st-host-bulk-guard-incomplete');
  const directories = {
    root,
    chats: join(root, 'chats'),
    groups: join(root, 'groups'),
    groupChats: join(root, 'groupChats'),
  };
  let nextCalls = 0;
  const guard = createHostBulkMutationGuard({
    pinnedHostCommit: pinned,
    enumerate: async () => ({ filesystem: { status: 'incomplete' }, source: { status: 'NON_READY', files: [] } }),
  });
  const response = makeResponse();
  await guard({ user: { directories } }, response, () => { nextCalls++; });
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.code, 'HOST_BULK_MUTATION_INVENTORY_INCOMPLETE');
  assert.equal(nextCalls, 0);
});

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

test('host inventory route rejects an authenticated account whose signed session handle differs', async () => {
  let calls = 0;
  const handler = createHostInventoryHandler({
    enumerate: async () => { calls += 1; return {}; },
    pinnedHostCommit: pinned,
    hostBuildClaim: pinned,
  });
  const response = makeResponse();
  await handler({
    user: { profile: { handle: 'alice' }, directories: {} },
    session: { handle: 'bob', logicEngineSessionId: '3e6b0a80-4e73-4c66-aaf3-7a6e62c7f402', logicEngineSessionHandle: 'bob' },
  }, response);
  assert.equal(response.statusCode, 403);
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
  await handler({ user: { profile: { handle: 'default-user' }, directories: {} }, session: { handle: 'default-user', logicEngineSessionId: '2e6b0a80-4e73-4c66-aaf3-7a6e62c7f401', logicEngineSessionHandle: 'default-user' } }, response);
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, { status: 'NON_READY', code: 'HOST_BUILD_NOT_PINNED' });
  assert.equal(calls, 0);
});

test('host inventory route passes only the authenticated user data roots and returns a non-authoritative manifest', async () => {
  let observed;
  const inventory = {
    filesystem: {
      status: 'complete',
      snapshot_sha256: 'b'.repeat(64),
      file_count: 12,
      total_bytes: '3456',
      snapshot_id: 'snapshot-id',
      snapshot_provider: 'windows-vss-client-accessible',
      snapshot_consistency: 'VSS_POINT_IN_TIME_READ_ONLY',
      reparse_points: 'ALL_FILE_ATTRIBUTE_REPARSE_POINT_ENTRIES_REJECTED',
      entries: [{ path: 'characters/private-card.json' }],
    },
    source: {
      status: 'DOUBLE_SCAN_CANDIDATE',
      authority: 'NON_AUTHORITATIVE',
      inventory_sha256: 'a'.repeat(64),
      blockers: ['NO_PRE_ENROLLMENT_DELETED_HISTORY'],
      files: [],
    },
    snapshot_alignment: 'SHARED_VSS_SNAPSHOT',
  };
  const handler = createHostInventoryHandler({
    enumerate: async input => { observed = input; return inventory; },
    pinnedHostCommit: pinned,
    hostBuildClaim: pinned,
  });
  const response = makeResponse();
  const directories = {
    root: 'C:\\st\\data',
    chats: 'C:\\st\\data\\chats',
    groups: 'C:\\st\\data\\groups',
    groupChats: 'C:\\st\\data\\group chats',
    characters: 'C:\\st\\data\\characters',
    backups: 'C:\\st\\data\\backups',
  };
  await handler({
    user: { profile: { handle: 'alice' }, directories },
    session: { handle: 'alice', logicEngineSessionId: '2e6b0a80-4e73-4c66-aaf3-7a6e62c7f401', logicEngineSessionHandle: 'alice' },
    query: { conversation_uuid: '4e6b0a80-4e73-4c66-aaf3-7a6e62c7f403' },
  }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store, private');
  assert.equal(response.headers.vary, 'Cookie');
  assert.deepEqual(observed, {
    directories: {
      root: directories.root,
      chats: directories.chats,
      groups: directories.groups,
      groupChats: directories.groupChats,
    },
    hostCommit: pinned,
  });
  assert.equal(response.body.authority, 'NON_AUTHORITATIVE');
  assert.equal(response.body.filesystem_inventory.snapshot_sha256, 'b'.repeat(64));
  assert.equal(response.body.filesystem_inventory.file_count, 12);
  assert.equal(response.body.filesystem_inventory.scope, 'single-root-regular-files-only');
  assert.equal(response.body.filesystem_inventory.snapshot_alignment, 'SHARED_VSS_SNAPSHOT');
  assert.ok(response.body.blockers.includes('NO_DURABLE_FULL_ROOT_BASELINE'));
  assert.ok(response.body.blockers.includes('NO_FULL_ROOT_PER_FILE_DIFF'));
  assert.ok(response.body.blockers.includes('NO_GLOBAL_SILLYTAVERN_DATA_ROOT_COVERAGE'));
  assert.ok(response.body.blockers.includes('NO_SEMANTIC_CHARACTER_PERSONA_IDENTITY'));
  assert.ok(response.body.blockers.includes('UNVERIFIED_MUTATION_ROUTE_COVERAGE'));
  assert.ok(response.body.blockers.includes('UNVERIFIED_MUTATION_RUNTIME_ACCEPTANCE'));
  assert.equal(response.body.filesystem_inventory.entries, undefined);
  assert.equal(response.body.host_user_handle, 'alice');
  assert.equal(response.body.requested_conversation_uuid, '4e6b0a80-4e73-4c66-aaf3-7a6e62c7f403');
  assert.equal(response.body.host_build_claim_type, 'DEPLOYMENT_ASSERTION_NOT_RUNTIME_ATTESTATION');
  assert.equal(JSON.stringify(response.body).includes('raw-chat-message'), false);
});

test('host inventory persists the full root manifest server-side and removes only the completed baseline blockers', async () => {
  let observed;
  const inventory = {
    filesystem: {
      status: 'complete',
      root: '/srv/st/data',
      snapshot_sha256: 'b'.repeat(64),
      file_count: 1,
      total_bytes: 64,
      entries: [{
        path: 'chats/main.jsonl',
        identity: { dev: '1', ino: '2', mode: 33188, size: 64, mtimeMs: 1, ctimeMs: 1 },
        sha256: 'c'.repeat(64),
      }],
    },
    source: {
      status: 'DOUBLE_SCAN_CANDIDATE',
      authority: 'NON_AUTHORITATIVE',
      inventory_sha256: 'a'.repeat(64),
      blockers: ['NO_PRE_ENROLLMENT_DELETED_HISTORY'],
      files: [],
    },
    snapshot_alignment: 'SHARED_VSS_SNAPSHOT',
  };
  const handler = createHostInventoryHandler({
    enumerate: async () => inventory,
    persistRootInventory: async input => {
      observed = input;
      return {
        status: 'BASELINED_REVIEW_ONLY',
        integrity_status: 'INTEGRITY_OK',
        sequence: 1,
        manifest_sha256: 'd'.repeat(64),
        upstream_status: 200,
      };
    },
    pinnedHostCommit: pinned,
    hostBuildClaim: pinned,
  });
  const response = makeResponse();
  const directories = {
    root: '/srv/st/data',
    chats: '/srv/st/data/chats',
    groups: '/srv/st/data/groups',
    groupChats: '/srv/st/data/group chats',
  };
  await handler({
    user: { profile: { handle: 'alice' }, directories },
    session: {
      handle: 'alice',
      logicEngineSessionId: '2e6b0a80-4e73-4c66-aaf3-7a6e62c7f401',
      logicEngineSessionHandle: 'alice',
    },
    query: { conversation_uuid: '4e6b0a80-4e73-4c66-aaf3-7a6e62c7f403' },
  }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(observed.userHandle, 'alice');
  assert.equal(observed.rootPath, directories.root);
  assert.deepEqual(observed.entries, inventory.filesystem.entries);
  assert.ok(!response.body.blockers.includes('NO_DURABLE_FULL_ROOT_BASELINE'));
  assert.ok(!response.body.blockers.includes('NO_FULL_ROOT_PER_FILE_DIFF'));
  assert.equal(response.body.root_inventory_reconciliation.status, 'BASELINED_REVIEW_ONLY');
  assert.equal(response.body.root_inventory_reconciliation.sequence, 1);
  assert.equal(response.body.filesystem_inventory.entries, undefined);
  assert.equal(JSON.stringify(response.body).includes('chats/main.jsonl'), false);
});

test('persisted but unexplained root drift remains an explicit NON_READY blocker', async () => {
  const handler = createHostInventoryHandler({
    enumerate: async () => ({
      filesystem: {
        status: 'complete',
        root: '/srv/st/data',
        snapshot_sha256: 'b'.repeat(64),
        file_count: 1,
        total_bytes: 64,
        entries: [{
          path: 'chats/main.jsonl',
          identity: { dev: '1', ino: '2', mode: 33188, size: 64, mtimeMs: 2, ctimeMs: 2 },
          sha256: 'c'.repeat(64),
        }],
      },
      source: { status: 'DOUBLE_SCAN_CANDIDATE', authority: 'NON_AUTHORITATIVE', blockers: [], files: [] },
      snapshot_alignment: 'SHARED_VSS_SNAPSHOT',
    }),
    persistRootInventory: async () => ({
      status: 'NON_READY',
      integrity_status: 'INTEGRITY_OK',
      sequence: 2,
      manifest_sha256: 'd'.repeat(64),
      delta_sha256: 'e'.repeat(64),
      counts: { added: 0, removed: 0, modified: 1, metadata_changed: 0, replaced: 0, moved: 0 },
    }),
    pinnedHostCommit: pinned,
    hostBuildClaim: pinned,
  });
  const response = makeResponse();
  await handler({
    user: { profile: { handle: 'alice' }, directories: {
      root: '/srv/st/data', chats: '/srv/st/data/chats',
      groups: '/srv/st/data/groups', groupChats: '/srv/st/data/group chats',
    } },
    session: {
      handle: 'alice', logicEngineSessionId: '2e6b0a80-4e73-4c66-aaf3-7a6e62c7f401',
      logicEngineSessionHandle: 'alice',
    },
    query: { conversation_uuid: '4e6b0a80-4e73-4c66-aaf3-7a6e62c7f403' },
  }, response);
  assert.equal(response.statusCode, 200);
  assert.ok(!response.body.blockers.includes('NO_DURABLE_FULL_ROOT_BASELINE'));
  assert.ok(!response.body.blockers.includes('NO_FULL_ROOT_PER_FILE_DIFF'));
  assert.ok(response.body.blockers.includes('ROOT_INVENTORY_DELTA_UNRESOLVED'));
  assert.equal(response.body.root_inventory_reconciliation.delta_sha256, 'e'.repeat(64));
});

test('host inventory route filters the response to the requested conversation logical identity', async () => {
  const conversationUuid = '2e6b0a80-4e73-4c66-aaf3-7a6e62c7f401';
  const otherUuid = '3e6b0a80-4e73-4c66-aaf3-7a6e62c7f402';
  const selected = { conversation_uuid: conversationUuid, identity_status: 'CURRENT_IDENTITIES_VERIFIED', messages: [] };
  const other = { conversation_uuid: otherUuid, identity_status: 'CURRENT_IDENTITIES_VERIFIED', messages: [] };
  const handler = createHostInventoryHandler({
    enumerate: async () => ({
      filesystem: {
        status: 'complete',
        snapshot_sha256: 'c'.repeat(64),
        file_count: 2,
        total_bytes: '10',
      },
      source: {
        status: 'DOUBLE_SCAN_CANDIDATE',
        authority: 'NON_AUTHORITATIVE',
        files: [
          { locator: 'private-chat-path.jsonl', file_identity: 'private-file-identity', logical_identity: selected },
          { locator: 'other-chat-path.jsonl', file_identity: 'other-file-identity', logical_identity: other },
        ],
        inventory_sha256: 'a'.repeat(64),
        blockers: [],
      },
      snapshot_alignment: 'INDEPENDENT_DOUBLE_SCAN',
    }),
    pinnedHostCommit: pinned,
    hostBuildClaim: pinned,
  });
  const response = makeResponse();
  await handler({
    user: {
      profile: { handle: 'alice' },
      directories: {
        root: 'C:\\st\\data',
        chats: 'C:\\st\\data\\chats',
        groups: 'C:\\st\\data\\groups',
        groupChats: 'C:\\st\\data\\group chats',
      },
    },
    session: { handle: 'alice', logicEngineSessionId: '2e6b0a80-4e73-4c66-aaf3-7a6e62c7f401', logicEngineSessionHandle: 'alice' },
    query: { conversation_uuid: conversationUuid },
  }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.requested_conversation_uuid, conversationUuid);
  assert.deepEqual(response.body.files, [{ logical_identity: selected }]);
  assert.ok(response.body.blockers.includes('NO_SHARED_POINT_IN_TIME_SNAPSHOT'));
  assert.equal(JSON.stringify(response.body).includes('private-chat-path'), false);
  assert.equal(JSON.stringify(response.body).includes('private-file-identity'), false);
});

test('host inventory route rejects malformed conversation filters before scanning', async () => {
  let calls = 0;
  const handler = createHostInventoryHandler({
    enumerate: async () => { calls += 1; return { files: [] }; },
    pinnedHostCommit: pinned,
    hostBuildClaim: pinned,
  });
  const response = makeResponse();
  await handler({
    user: { profile: { handle: 'alice' }, directories: {} },
    session: { handle: 'alice', logicEngineSessionId: '2e6b0a80-4e73-4c66-aaf3-7a6e62c7f401', logicEngineSessionHandle: 'alice' },
    query: { conversation_uuid: '../not-a-uuid' },
  }, response);
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { status: 'NON_READY', code: 'HOST_CONVERSATION_UUID_INVALID' });
  assert.equal(calls, 0);
});

test('host inventory route hides scanner errors and absolute paths from the HTTP response', async () => {
  const handler = createHostInventoryHandler({
    enumerate: async () => { throw Object.assign(new Error('C:\\private\\chat.jsonl'), { code: 'SOURCE_FILE_UNAVAILABLE' }); },
    pinnedHostCommit: pinned,
    hostBuildClaim: pinned,
  });
  const response = makeResponse();
  await handler({
    user: { profile: { handle: 'alice' }, directories: {} },
    session: { handle: 'alice', logicEngineSessionId: '2e6b0a80-4e73-4c66-aaf3-7a6e62c7f401', logicEngineSessionHandle: 'alice' },
    query: { conversation_uuid: '4e6b0a80-4e73-4c66-aaf3-7a6e62c7f403' },
  }, response);
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, { status: 'NON_READY', code: 'SOURCE_INVENTORY_UNAVAILABLE' });
  assert.equal(JSON.stringify(response.body).includes('private'), false);
});


test('Host session identity is generated once inside the authenticated signed session', () => {
  const id = '2e6b0a80-4e73-4c66-aaf3-7a6e62c7f401';
  const handler = createHostSessionHandler({ createId: () => id });
  const session = { handle: 'alice' };
  const request = { session, user: { profile: { handle: 'alice' } } };
  const first = makeResponse();
  handler(request, first);
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.host_session_id, id);
  assert.equal(first.body.host_session_identity, 'SIGNED_AUTHENTICATED_ST_SESSION');
  assert.equal(session.logicEngineSessionId, id);
  assert.equal(session.logicEngineSessionHandle, 'alice');
  const second = makeResponse();
  handler(request, second);
  assert.equal(second.body.host_session_id, id);
});

test('Host session identity rotates when the authenticated account changes', () => {
  const ids = [
    '2e6b0a80-4e73-4c66-aaf3-7a6e62c7f401',
    '3e6b0a80-4e73-4c66-aaf3-7a6e62c7f402',
  ];
  const session = { handle: 'alice' };
  const handler = createHostSessionHandler({ createId: () => ids.shift() });
  const first = makeResponse();
  handler({ session, user: { profile: { handle: 'alice' } } }, first);
  assert.equal(first.body.host_session_id, '2e6b0a80-4e73-4c66-aaf3-7a6e62c7f401');
  session.handle = 'bob';
  const second = makeResponse();
  handler({ session, user: { profile: { handle: 'bob' } } }, second);
  assert.equal(second.body.host_session_id, '3e6b0a80-4e73-4c66-aaf3-7a6e62c7f402');
  assert.equal(session.logicEngineSessionHandle, 'bob');
});

test('Host session identity rejects unauthenticated, mismatched, or malformed sessions', () => {
  const handler = createHostSessionHandler({
    createId: () => '2e6b0a80-4e73-4c66-aaf3-7a6e62c7f401',
  });
  const missing = makeResponse();
  handler({}, missing);
  assert.equal(missing.statusCode, 403);
  const mismatch = makeResponse();
  handler({ session: { handle: 'bob' }, user: { profile: { handle: 'alice' } } }, mismatch);
  assert.equal(mismatch.statusCode, 403);
  const malformed = makeResponse();
  handler({
    session: { handle: 'alice', logicEngineSessionId: 'not-a-uuid' },
    user: { profile: { handle: 'alice' } },
  }, malformed);
  assert.equal(malformed.statusCode, 503);
  assert.deepEqual(malformed.body, { status: 'NON_READY', code: 'HOST_SESSION_ID_INVALID' });
});

test('Host session identity responses are private and never expose cookie material', () => {
  const handler = createHostSessionHandler({
    createId: () => '2e6b0a80-4e73-4c66-aaf3-7a6e62c7f401',
  });
  const response = makeResponse();
  handler({
    session: { handle: 'alice', logicEngineSessionId: '2e6b0a80-4e73-4c66-aaf3-7a6e62c7f401', logicEngineSessionHandle: 'alice' },
    user: { profile: { handle: 'alice' } },
    headers: { cookie: 'session=secret-cookie-value' },
  }, response);
  assert.equal(response.headers['cache-control'], 'no-store, private');
  assert.equal(response.headers.vary, 'Cookie');
  assert.equal(JSON.stringify(response.body).includes('secret-cookie-value'), false);
});


test('Host identity route returns installation/account IDs only for the matching signed ST session', async () => {
  let observedHandle = null;
  const handler = createHostIdentityHandler({
    identityStore: {
      resolveAuthenticatedAccount: async handle => {
        observedHandle = handle;
        return { host_installation_id: '11111111-1111-4111-8111-111111111111', authenticated_account_id: '22222222-2222-4222-8222-222222222222' };
      },
    },
  });
  const response = makeResponse();
  await handler({
    user: { profile: { handle: 'alice' } },
    session: {
      handle: 'alice',
      logicEngineSessionId: '33333333-3333-4333-8333-333333333333',
      logicEngineSessionHandle: 'alice',
    },
  }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(observedHandle, 'alice');
  assert.equal(response.body.host_installation_id, '11111111-1111-4111-8111-111111111111');
  assert.equal(response.body.authenticated_account_id, '22222222-2222-4222-8222-222222222222');
  assert.equal(response.body.host_session_id, '33333333-3333-4333-8333-333333333333');
  assert.equal(response.headers['cache-control'], 'no-store, private');
  assert.equal(response.headers.vary, 'Cookie');
});

test('Host identity route rejects a session/account mismatch before resolving identity', async () => {
  let calls = 0;
  const handler = createHostIdentityHandler({
    identityStore: { resolveAuthenticatedAccount: async () => { calls += 1; return {}; } },
  });
  const response = makeResponse();
  await handler({
    user: { profile: { handle: 'alice' } },
    session: {
      handle: 'bob',
      logicEngineSessionId: '33333333-3333-4333-8333-333333333333',
      logicEngineSessionHandle: 'bob',
    },
  }, response);
  assert.equal(response.statusCode, 403);
  assert.equal(calls, 0);
});
