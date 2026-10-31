import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { HostLifecycleReceiptStore } from '../st-host-lifecycle-receipt-store.mjs';

const INSTALLATION = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const CONVERSATION = '44444444-4444-4444-8444-444444444444';
const MUTATION = '55555555-5555-4555-8555-555555555555';
const PREPARED_EVENT = '66666666-6666-4666-8666-666666666666';
const TERMINAL_EVENT = '77777777-7777-4777-8777-777777777777';
const digest = value => createHash('sha256').update(String(value)).digest('hex');
const version = (id, content, active = true) => ({
  version_id: id,
  version_index: 0,
  parent_version_id: null,
  content_sha256: digest(content),
  active,
});
const message = (id, content, versionId) => ({
  message_id: id,
  active_version_index: 0,
  versions: [version(versionId, content)],
});
const logicalMessage = (id, activeIndex, versions) => ({
  message_id: id,
  active_version_index: activeIndex,
  versions,
});
const logicalVersion = (id, content, index, parent = null, active = false) => ({
  version_id: id,
  version_index: index,
  parent_version_id: parent,
  content_sha256: digest(content),
  active,
});
const receiptTestRoot = join(tmpdir(), 'host-lifecycle-receipt-fixture');
const directories = {
  root: receiptTestRoot,
  chats: join(receiptTestRoot, 'chats'),
  groups: join(receiptTestRoot, 'groups'),
  groupChats: join(receiptTestRoot, 'groupChats'),
};
const scope = overrides => ({
  host_installation_id: INSTALLATION,
  authenticated_account_id: ACCOUNT,
  host_session_id: SESSION,
  conversation_uuid: CONVERSATION,
  mutation_id: MUTATION,
  event_id: PREPARED_EVENT,
  operation: 'create-message',
  mutation_digest: digest('a'),
  occurred_at: '2026-10-31T00:00:00.000Z',
  ...overrides,
});

function inventory(state) {
  const target = {
    kind: 'root-chat',
    locator: 'main.jsonl',
    file_identity: '1:' + state.fileIdentity,
    content_sha256: digest(state.content),
    logical_identity: {
      conversation_uuid: CONVERSATION,
      identity_status: 'CURRENT_IDENTITIES_VERIFIED',
      missing_message_identity_count: 0,
      messages: state.messages,
    },
  };
  const entries = [{
    path: 'chats/main.jsonl',
    identity: {
      dev: '1', ino: state.fileIdentity,
      mode: 33188, size: 100, mtimeMs: state.fileIdentity === '101' ? 1 : 2, ctimeMs: 1,
    },
    sha256: target.content_sha256,
  }, ...(state.extraFile ? [{
    path: 'characters/alice.png',
    identity: { dev: '1', ino: '303', mode: 33188, size: 12, mtimeMs: 1, ctimeMs: 1 },
    sha256: digest(state.extraFile),
  }] : [])];
  return {
    filesystem: { status: 'complete', entries },
    source: {
      status: 'DOUBLE_SCAN_CANDIDATE',
      host_commit: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
      files: [target],
      inventory_sha256: digest(state.content + ':inventory'),
    },
    snapshot_alignment: 'INDEPENDENT_DOUBLE_SCAN',
  };
}

function fixture(t, states) {
  const directory = mkdtempSync(join(tmpdir(), 'host-lifecycle-receipt-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let index = 0;
  const enumerate = async () => inventory(states[Math.min(index++, states.length - 1)]);
  const store = new HostLifecycleReceiptStore({ directory, enumerate });
  return { directory, store, get scans() { return index; } };
}

test('receipt store must be outside the scanned data root before it creates any files', async t => {
  const base = mkdtempSync(join(tmpdir(), 'host-lifecycle-receipt-scope-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const dataRoot = join(base, 'data');
  mkdirSync(dataRoot);
  const outside = new HostLifecycleReceiptStore({ directory: join(base, 'receipts') });
  assert.equal(await outside.assertOutsideRoot(dataRoot), true);
  const insidePath = join(dataRoot, 'receipts');
  const inside = new HostLifecycleReceiptStore({ directory: insidePath });
  await assert.rejects(inside.assertOutsideRoot(dataRoot), /HOST_LIFECYCLE_RECEIPT_DIRECTORY_INSIDE_DATA_ROOT/);
  assert.equal(existsSync(insidePath), false, 'invalid in-root receipt path is rejected before directory creation');
});

test('server receipt store persists prepare and verifies a real logical create-message transition', async t => {
  const before = { fileIdentity: '101', content: 'before', messages: [message('m1', 'old', 'v1')] };
  const after = { fileIdentity: '102', content: 'after', messages: [
    message('m1', 'old', 'v1'),
    message('m2', 'new', 'v2'),
  ] };
  const f = fixture(t, [before, after]);
  const prepared = await f.store.prepare(scope(), directories);
  assert.equal(prepared.status, 'appended');
  assert.equal(prepared.prepared.before.target_content_sha256, digest('before'));
  const committed = await f.store.commit(scope({
    event_id: TERMINAL_EVENT,
    prepared_event_id: PREPARED_EVENT,
    occurred_at: '2026-10-31T00:00:01.000Z',
  }), directories);
  assert.equal(committed.status, 'appended');
  assert.match(committed.receipt_digest, /^[a-f0-9]{64}$/);
  assert.equal(committed.occurred_at, '2026-10-31T00:00:01.000Z');
});

test('server receipt store survives restart and exact terminal retry returns the same receipt', async t => {
  const before = { fileIdentity: '101', content: 'before', messages: [message('m1', 'old', 'v1')] };
  const after = { fileIdentity: '102', content: 'after', messages: [
    message('m1', 'old', 'v1'),
    message('m2', 'new', 'v2'),
  ] };
  const f = fixture(t, [before, after]);
  await f.store.prepare(scope(), directories);
  const terminalScope = scope({
    event_id: TERMINAL_EVENT,
    prepared_event_id: PREPARED_EVENT,
    occurred_at: '2026-10-31T00:00:01.000Z',
  });
  const first = await f.store.commit(terminalScope, directories);
  const restarted = new HostLifecycleReceiptStore({
    directory: f.directory,
    enumerate: async () => { throw new Error('must not rescan an already committed receipt'); },
  });
  const replay = await restarted.commit(terminalScope, directories);
  assert.equal(replay.status, 'duplicate');
  assert.equal(replay.receipt_digest, first.receipt_digest);
  assert.equal(replay.occurred_at, first.occurred_at);
});

test('server receipt store rejects unrelated root drift and an invalid logical transition', async t => {
  const before = { fileIdentity: '101', content: 'before', messages: [message('m1', 'old', 'v1')], extraFile: 'same' };
  const unrelatedDrift = { fileIdentity: '102', content: 'after', messages: [
    message('m1', 'old', 'v1'), message('m2', 'new', 'v2'),
  ], extraFile: 'changed' };
  const f = fixture(t, [before, unrelatedDrift]);
  await f.store.prepare(scope(), directories);
  await assert.rejects(f.store.commit(scope({
    event_id: TERMINAL_EVENT, prepared_event_id: PREPARED_EVENT,
    occurred_at: '2026-10-31T00:00:01.000Z',
  }), directories), /HOST_LIFECYCLE_RECEIPT_PERSISTED_STATE_MISMATCH/);

  const invalid = fixture(t, [before, {
    fileIdentity: '102', content: 'after', messages: [message('m1', 'different', 'v1')],
    extraFile: 'same',
  }]);
  await invalid.store.prepare(scope(), directories);
  await assert.rejects(invalid.store.commit(scope({
    event_id: TERMINAL_EVENT, prepared_event_id: PREPARED_EVENT,
    occurred_at: '2026-10-31T00:00:01.000Z',
  }), directories), /HOST_LIFECYCLE_RECEIPT_PERSISTED_STATE_MISMATCH/);
});

test('server receipt store verifies swipe selection/deletion, message deletion and edit transitions', async t => {
  const cases = [
    {
      operation: 'create-swipe',
      before: [logicalMessage('m1', 0, [logicalVersion('v1', 'one', 0, null, true)])],
      after: [logicalMessage('m1', 1, [
        logicalVersion('v1', 'one', 0, null, false),
        logicalVersion('v2', 'two', 1, 'v1', true),
      ])],
    },
    {
      operation: 'select-swipe',
      before: [logicalMessage('m1', 0, [
        logicalVersion('v1', 'one', 0, null, true),
        logicalVersion('v2', 'two', 1, 'v1', false),
      ])],
      after: [logicalMessage('m1', 1, [
        logicalVersion('v1', 'one', 0, null, false),
        logicalVersion('v2', 'two', 1, 'v1', true),
      ])],
    },
    {
      operation: 'delete-swipe',
      before: [logicalMessage('m1', 1, [
        logicalVersion('v1', 'one', 0, null, false),
        logicalVersion('v2', 'two', 1, 'v1', true),
      ])],
      after: [logicalMessage('m1', 0, [logicalVersion('v1', 'one', 0, null, true)])],
    },
    {
      operation: 'delete-message',
      before: [message('m1', 'one', 'v1'), message('m2', 'two', 'v2')],
      after: [message('m1', 'one', 'v1')],
    },
    {
      operation: 'edit-message',
      before: [message('m1', 'old', 'v1')],
      after: [logicalMessage('m1', 0, [logicalVersion('v2', 'edited', 0, 'v1', true)])],
    },
  ];
  for (const [index, item] of cases.entries()) {
    const f = fixture(t, [
      { fileIdentity: '101', content: 'before-' + item.operation, messages: item.before },
      { fileIdentity: '102', content: 'after-' + item.operation, messages: item.after },
    ]);
    const preparedScope = scope({
      operation: item.operation,
      mutation_id: `55555555-5555-4555-8555-55555555555${index}`,
      event_id: `66666666-6666-4666-8666-66666666666${index}`,
    });
    await f.store.prepare(preparedScope, directories);
    const committed = await f.store.commit({
      ...preparedScope,
      event_id: `77777777-7777-4777-8777-77777777777${index}`,
      prepared_event_id: preparedScope.event_id,
      occurred_at: '2026-10-31T00:00:01.000Z',
    }, directories);
    assert.equal(committed.status, 'appended', item.operation);
  }
});

test('concurrent exact prepare and terminal retries remain idempotent across timestamps', async t => {
  const before = { fileIdentity: '101', content: 'before', messages: [message('m1', 'old', 'v1')] };
  const after = { fileIdentity: '102', content: 'after', messages: [
    message('m1', 'old', 'v1'), message('m2', 'new', 'v2'),
  ] };
  const f = fixture(t, [before, before, after, after]);
  const [firstPrepare, retryPrepare] = await Promise.all([
    f.store.prepare(scope({ occurred_at: '2026-10-31T00:00:00.000Z' }), directories),
    f.store.prepare(scope({ occurred_at: '2026-10-31T00:00:00.001Z' }), directories),
  ]);
  assert.deepEqual([firstPrepare.status, retryPrepare.status].sort(), ['appended', 'duplicate']);
  const terminalBase = scope({
    event_id: TERMINAL_EVENT,
    prepared_event_id: PREPARED_EVENT,
    occurred_at: '2026-10-31T00:00:01.000Z',
  });
  const [firstCommit, retryCommit] = await Promise.all([
    f.store.commit(terminalBase, directories),
    f.store.commit({ ...terminalBase, occurred_at: '2026-10-31T00:00:01.001Z' }, directories),
  ]);
  assert.deepEqual([firstCommit.status, retryCommit.status].sort(), ['appended', 'duplicate']);
  assert.equal(firstCommit.receipt_digest, retryCommit.receipt_digest);
  assert.equal(firstCommit.occurred_at, retryCommit.occurred_at);
});

test('server recovery commits exact post-state, aborts exact pre-state, and leaves partial state unresolved', async t => {
  const before = { fileIdentity: '101', content: 'before', messages: [message('m1', 'old', 'v1')] };
  const after = { fileIdentity: '102', content: 'after', messages: [
    message('m1', 'old', 'v1'), message('m2', 'new', 'v2'),
  ] };
  const committedFixture = fixture(t, [before, after, after]);
  await committedFixture.store.prepare(scope(), directories);
  const committed = await committedFixture.store.recover({
    ...scope({ prepared_event_id: PREPARED_EVENT }),
    occurred_at: '2026-10-31T00:00:02.000Z',
  }, directories);
  assert.equal(committed.status, 'COMMITTED');
  assert.match(committed.receipt_digest, /^[a-f0-9]{64}$/);

  const abortedFixture = fixture(t, [before, before, before]);
  await abortedFixture.store.prepare(scope(), directories);
  const aborted = await abortedFixture.store.recover({
    ...scope({ prepared_event_id: PREPARED_EVENT }),
    occurred_at: '2026-10-31T00:00:02.000Z',
  }, directories);
  assert.equal(aborted.status, 'ABORTED');
  assert.match(aborted.receipt_digest, /^[a-f0-9]{64}$/);

  const partialFixture = fixture(t, [before, {
    fileIdentity: '102', content: 'partial', messages: [message('m1', 'partially-edited', 'v1')],
  }]);
  await partialFixture.store.prepare(scope(), directories);
  const partial = await partialFixture.store.recover({
    ...scope({ prepared_event_id: PREPARED_EVENT }),
    occurred_at: '2026-10-31T00:00:02.000Z',
  }, directories);
  assert.equal(partial.status, 'RECOVERY_REQUIRED');
});

test('ABORTED receipt requires exact unchanged persisted state and is mutually exclusive with COMMITTED', async t => {
  const unchanged = { fileIdentity: '101', content: 'before', messages: [message('m1', 'old', 'v1')] };
  const f = fixture(t, [unchanged, unchanged]);
  await f.store.prepare(scope(), directories);
  const aborted = await f.store.abort(scope({
    event_id: TERMINAL_EVENT, prepared_event_id: PREPARED_EVENT,
    occurred_at: '2026-10-31T00:00:01.000Z',
  }), directories);
  assert.equal(aborted.status, 'appended');
  await assert.rejects(f.store.commit(scope({
    event_id: '88888888-8888-4888-8888-888888888888',
    occurred_at: '2026-10-31T00:00:02.000Z',
  }), directories), /HOST_LIFECYCLE_RECEIPT_TERMINAL_CONFLICT/);
});
