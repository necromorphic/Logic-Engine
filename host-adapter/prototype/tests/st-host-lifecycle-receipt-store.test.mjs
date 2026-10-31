import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HostLifecycleReceiptStore } from '../st-host-lifecycle-receipt-store.mjs';

const INSTALLATION = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const CONVERSATION = '44444444-4444-4444-8444-444444444444';
const MUTATION = '55555555-5555-4555-8555-555555555555';
const PREPARED_EVENT = '66666666-6666-4666-8666-666666666666';
const TERMINAL_EVENT = '77777777-7777-4777-8777-777777777777';
const digest = value => value.repeat(64).slice(0, 64);
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
