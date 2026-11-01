import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const test = nodeTest;

import { createHostBulkMutationGuard, createHostIdentityHandler, createHostInventoryHandler, createHostLifecycleSaveGuard, createHostRequestAuthenticationGate, createHostSessionHandler, resolveHostDataDirectories } from '../st-host-inventory-handler.mjs';

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
const absoluteTestDirectories = {
  root: resolve('/tmp/st-root'),
  chats: resolve('/tmp/st-root/chats'),
  groups: resolve('/tmp/st-root/groups'),
  groupChats: resolve('/tmp/st-root/groupChats'),
};

test('relative ST account directories are resolved against the server working directory', () => {
  const resolved = resolveHostDataDirectories({
    root: './data/default-user',
    chats: './data/default-user/chats',
    groups: './data/default-user/groups',
    groupChats: './data/default-user/group chats',
  });
  assert.deepEqual(resolved, {
    root: resolve('./data/default-user'),
    chats: resolve('./data/default-user/chats'),
    groups: resolve('./data/default-user/groups'),
    groupChats: resolve('./data/default-user/group chats'),
  });
  assert.equal(Object.isFrozen(resolved), true);
});

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
  await guard({ user: { profile: { handle: 'alice' }, directories }, session: { handle: 'alice' } }, blocked, () => { nextCalls++; });
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
  await guard({ user: { profile: { handle: 'alice' }, directories }, session: { handle: 'alice' } }, response, () => { nextCalls++; });
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
  await guard({ user: { profile: { handle: 'alice' }, directories }, session: { handle: 'alice' } }, response, () => { nextCalls++; });
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
  await handler({ user: { profile: { handle: 'default-user' }, directories: absoluteTestDirectories }, session: { handle: 'default-user', logicEngineSessionId: '2e6b0a80-4e73-4c66-aaf3-7a6e62c7f401', logicEngineSessionHandle: 'default-user' } }, response);
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
    ...absoluteTestDirectories,
    characters: resolve('/tmp/st-root/characters'),
    backups: resolve('/tmp/st-root/backups'),
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
      ...absoluteTestDirectories,
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
  assert.equal(observed.rootPath, resolve(directories.root));
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
      directories: absoluteTestDirectories,
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
    user: { profile: { handle: 'alice' }, directories: absoluteTestDirectories },
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
    user: { profile: { handle: 'alice' }, directories: absoluteTestDirectories },
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
    getDataRoot: () => join(tmpdir(), 'st-host-global-data-root'),
    identityStore: {
      assertOutsideRoot: async () => true,
      resolveAuthenticatedAccount: async handle => {
        observedHandle = handle;
        return { host_installation_id: '11111111-1111-4111-8111-111111111111', authenticated_account_id: '22222222-2222-4222-8222-222222222222' };
      },
    },
  });
  const response = makeResponse();
  await handler({
    user: { profile: { handle: 'alice' }, directories: { root: join(tmpdir(), 'st-host-identity-test-root') } },
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
    identityStore: {
      assertOutsideRoot: async () => true,
      resolveAuthenticatedAccount: async () => { calls += 1; return {}; },
    },
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

function lifecycleSaveRequest(directories, permit = null) {
  return {
    path: '/save',
    body: { avatar_url: 'Harness Character.png', file_name: 'chat-one', chat: [{ chat_metadata: { logic_engine_conversation_id: lifecycleSavePermit.conversation_uuid } }] },
    user: { profile: { handle: 'alice' }, directories },
    session: {
      handle: 'alice',
      logicEngineSessionHandle: 'alice',
      logicEngineSessionId: '33333333-3333-4333-8333-333333333333',
      ...(permit ? { logicEngineHostPreparedMutation: permit } : {}),
    },
  };
}

const lifecycleSavePermit = {
  protocol_version: 1,
  host_installation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  authenticated_account_id: '22222222-2222-4222-8222-222222222222',
  host_session_id: '33333333-3333-4333-8333-333333333333',
  conversation_uuid: '44444444-4444-4444-8444-444444444444',
  mutation_id: '55555555-5555-4555-8555-555555555555',
  event_id: '66666666-6666-4666-8666-666666666666',
  operation: 'edit-message',
  mutation_digest: 'a'.repeat(64),
};

test('enrolled chat save API requires a matching server PREPARED permit and consumes it once', async () => {
  const root = join(tmpdir(), 'st-host-save-guard');
  const directories = { root, chats: join(root, 'chats'), groups: join(root, 'groups'), groupChats: join(root, 'groupChats') };
  const enumerate = async () => ({
    filesystem: { status: 'complete' },
    source: { status: 'DOUBLE_SCAN_CANDIDATE', files: [{
      kind: 'character-chat',
      locator: 'Harness Character/chat-one.jsonl',
      logical_identity: { conversation_uuid: lifecycleSavePermit.conversation_uuid },
    }] },
  });
  const guard = createHostLifecycleSaveGuard({ pinnedHostCommit: pinned, enumerate });
  const denied = makeResponse();
  let nextCalls = 0;
  await guard(lifecycleSaveRequest(directories), denied, () => { nextCalls++; });
  assert.equal(denied.statusCode, 409);
  assert.equal(denied.body.code, 'HOST_LIFECYCLE_PREPARED_SAVE_REQUIRED');
  assert.equal(nextCalls, 0);

  const request = lifecycleSaveRequest(directories, { ...lifecycleSavePermit });
  const allowed = makeResponse();
  await guard(request, allowed, () => { nextCalls++; });
  assert.equal(allowed.statusCode, null);
  assert.equal(nextCalls, 1);
  assert.equal(request.session.logicEngineHostPreparedMutation, undefined);

  const replay = makeResponse();
  await guard(request, replay, () => { nextCalls++; });
  assert.equal(replay.statusCode, 409);
  assert.equal(nextCalls, 1);
});

test('group save resolves the extensionless group-chat inventory locator', async () => {
  const root = join(tmpdir(), 'st-host-group-save-guard');
  const directories = { root, chats: join(root, 'chats'), groups: join(root, 'groups'), groupChats: join(root, 'groupChats') };
  const guard = createHostLifecycleSaveGuard({
    pinnedHostCommit: pinned,
    enumerate: async () => ({
      filesystem: { status: 'complete' },
      source: { status: 'DOUBLE_SCAN_CANDIDATE', files: [{
        kind: 'group-chat', locator: 'group-one',
        logical_identity: { conversation_uuid: lifecycleSavePermit.conversation_uuid },
      }] },
    }),
  });
  const request = lifecycleSaveRequest(directories, { ...lifecycleSavePermit });
  request.path = '/group/save';
  request.body = { id: 'group-one', chat: [{ chat_metadata: { logic_engine_conversation_id: lifecycleSavePermit.conversation_uuid } }] };
  const response = makeResponse();
  let nextCalls = 0;
  await guard(request, response, () => { nextCalls++; });
  assert.equal(response.statusCode, null);
  assert.equal(nextCalls, 1);
  assert.equal(request.session.logicEngineHostPreparedMutation, undefined);
  assert.equal(request.logicEngineLifecycleSaveAuthorized, true);
  assert.equal(request.logicEngineLifecycleOperation, lifecycleSavePermit.operation);
});

test('enrolled chat save API rejects permits scoped to another conversation or session', async () => {
  const root = join(tmpdir(), 'st-host-save-guard-scope');
  const directories = { root, chats: join(root, 'chats'), groups: join(root, 'groups'), groupChats: join(root, 'groupChats') };
  const guard = createHostLifecycleSaveGuard({
    pinnedHostCommit: pinned,
    enumerate: async () => ({
      filesystem: { status: 'complete' },
      source: { status: 'DOUBLE_SCAN_CANDIDATE', files: [{
        kind: 'character-chat', locator: 'Harness Character/chat-one.jsonl',
        logical_identity: { conversation_uuid: lifecycleSavePermit.conversation_uuid },
      }] },
    }),
  });
  const mismatchedPayload = lifecycleSaveRequest(directories, { ...lifecycleSavePermit });
  mismatchedPayload.body.chat[0].chat_metadata.logic_engine_conversation_id = '77777777-7777-4777-8777-777777777777';
  const payloadResponse = makeResponse();
  let payloadNextCalls = 0;
  await guard(mismatchedPayload, payloadResponse, () => { payloadNextCalls++; });
  assert.equal(payloadResponse.statusCode, 409);
  assert.equal(payloadResponse.body.code, 'HOST_LIFECYCLE_SAVE_PAYLOAD_IDENTITY_MISMATCH');
  assert.equal(payloadNextCalls, 0);

  for (const permit of [
    { ...lifecycleSavePermit, conversation_uuid: '77777777-7777-4777-8777-777777777777' },
    { ...lifecycleSavePermit, host_session_id: '88888888-8888-4888-8888-888888888888' },
  ]) {
    const response = makeResponse();
    let nextCalls = 0;
    await guard(lifecycleSaveRequest(directories, permit), response, () => { nextCalls++; });
    assert.equal(response.statusCode, 409);
    assert.equal(nextCalls, 0);
  }
});



const defaultUserSessionId = '2e6b0a80-4e73-4c66-aaf3-7a6e62c7f401';
const defaultUserConversationUuid = '4e6b0a80-4e73-4c66-aaf3-7a6e62c7f403';
const defaultUserInstallationId = '3e6b0a80-4e73-4c66-aaf3-7a6e62c7f402';
const defaultUserAccountId = '6e6b0a80-4e73-4c66-aaf3-7a6e62c7f406';

test('default-user mode creates and reuses a Host session identity without session.handle', () => {
  const handler = createHostSessionHandler({ createId: () => defaultUserSessionId });
  const session = {};
  const request = { session, user: { profile: { handle: 'default-user' } } };
  const first = makeResponse();
  handler(request, first);
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.host_session_id, defaultUserSessionId);
  assert.equal(session.logicEngineSessionId, defaultUserSessionId);
  assert.equal(session.logicEngineSessionHandle, 'default-user');
  const second = makeResponse();
  handler(request, second);
  assert.equal(second.body.host_session_id, defaultUserSessionId);
});

test('default-user inventory accepts absent session.handle only after signed Host identity is bound', async () => {
  const directories = {
    root: join(tmpdir(), 'st-default-user-root'),
    chats: join(tmpdir(), 'st-default-user-root', 'chats'),
    groups: join(tmpdir(), 'st-default-user-root', 'groups'),
    groupChats: join(tmpdir(), 'st-default-user-root', 'groupChats'),
  };
  const handler = createHostInventoryHandler({
    enumerate: async () => ({
      filesystem: { status: 'complete', entries: [] },
      source: { status: 'DOUBLE_SCAN_CANDIDATE', files: [], blockers: [] },
      snapshot_alignment: 'SHARED_VSS_SNAPSHOT',
    }),
    persistRootInventory: async () => ({
      status: 'BASELINED_REVIEW_ONLY', integrity_status: 'INTEGRITY_OK',
      sequence: 1, manifest_sha256: 'a'.repeat(64),
    }),
    pinnedHostCommit: pinned,
    hostBuildClaim: pinned,
  });
  const response = makeResponse();
  await handler({
    user: { profile: { handle: 'default-user' }, directories },
    session: {
      logicEngineSessionId: defaultUserSessionId,
      logicEngineSessionHandle: 'default-user',
    },
    query: { conversation_uuid: defaultUserConversationUuid },
  }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.host_user_handle, 'default-user');
  assert.equal(response.body.host_build_claim_type, 'DEPLOYMENT_ASSERTION_NOT_RUNTIME_ATTESTATION');
});

test('default-user inventory rejects missing/mismatched signed session before scanning', async () => {
  let scans = 0;
  const handler = createHostInventoryHandler({
    enumerate: async () => { scans++; return {}; },
    pinnedHostCommit: pinned,
    hostBuildClaim: pinned,
  });
  const base = {
    user: { profile: { handle: 'default-user' }, directories: {} },
    query: { conversation_uuid: defaultUserConversationUuid },
  };
  const missing = makeResponse();
  await handler({ ...base, session: {} }, missing);
  assert.equal(missing.statusCode, 403);
  const mismatch = makeResponse();
  await handler({
    ...base,
    session: {
      logicEngineSessionId: defaultUserSessionId,
      logicEngineSessionHandle: 'another-user',
    },
  }, mismatch);
  assert.equal(mismatch.statusCode, 403);
  assert.equal(scans, 0);
});

test('request authentication gate brands only the exact request after trusted server resolution', async () => {
  const resolved = new WeakMap();
  const request = {
    user: { profile: { handle: 'default-user' }, directories: absoluteTestDirectories },
    session: {
      logicEngineSessionId: defaultUserSessionId,
      logicEngineSessionHandle: 'default-user',
    },
    body: { conversation_id: 'attacker-selected' },
  };
  const conversationId = [
    defaultUserInstallationId, defaultUserAccountId, defaultUserConversationUuid,
  ].join(':');
  resolved.set(request, {
    host_installation_id: defaultUserInstallationId,
    authenticated_account_id: defaultUserAccountId,
    host_session_id: defaultUserSessionId,
    conversation_id: conversationId,
  });
  const gate = createHostRequestAuthenticationGate({
    resolveConversationId: candidate => resolved.get(candidate),
  });
  assert.equal(gate.isAuthenticatedHostRequest(request), false);
  const response = makeResponse();
  let nextCalls = 0;
  await gate.middleware(request, response, () => { nextCalls++; });
  assert.equal(response.statusCode, null);
  assert.equal(nextCalls, 1);
  assert.equal(gate.isAuthenticatedHostRequest(request), true);
  assert.equal(gate.resolveHostConversationId(request), conversationId);
  assert.equal(gate.isAuthenticatedHostRequest({ ...request }), false);
});

test('request authentication gate rejects account mismatch and a conversation from another session', async () => {
  const binding = {
    host_installation_id: defaultUserInstallationId,
    authenticated_account_id: defaultUserAccountId,
    host_session_id: defaultUserSessionId,
    conversation_id: [defaultUserInstallationId, defaultUserAccountId, defaultUserConversationUuid].join(':'),
  };
  const gate = createHostRequestAuthenticationGate({ resolveConversationId: () => binding });
  for (const session of [
    { handle: 'other-account', logicEngineSessionId: defaultUserSessionId, logicEngineSessionHandle: 'default-user' },
    { logicEngineSessionId: '5e6b0a80-4e73-4c66-aaf3-7a6e62c7f405', logicEngineSessionHandle: 'default-user' },
  ]) {
    const response = makeResponse();
    let nextCalls = 0;
    await gate.middleware({
      user: { profile: { handle: 'default-user' }, directories: {} },
      session,
    }, response, () => { nextCalls++; });
    assert.equal(response.statusCode, 403);
    assert.equal(nextCalls, 0);
  }
});


test('request authentication gate returns NON_READY when authoritative inventory proof is absent', async () => {
  const gate = createHostRequestAuthenticationGate({
    resolveConversationId: () => ({ status: 'NON_READY', code: 'HOST_INVENTORY_NOT_AUTHORITATIVE' }),
  });
  const response = makeResponse();
  let nextCalls = 0;
  await gate.middleware({
    user: { profile: { handle: 'default-user' }, directories: absoluteTestDirectories },
    session: { logicEngineSessionId: defaultUserSessionId, logicEngineSessionHandle: 'default-user' },
  }, response, () => { nextCalls++; });
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.code, 'HOST_INVENTORY_NOT_AUTHORITATIVE');
  assert.equal(nextCalls, 0);
});
