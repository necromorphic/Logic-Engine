import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HostLifecycleJournal } from '../src/application/host-lifecycle-journal.js';

const installation = 'host-installation-001';
const account = 'account-principal-001';
const conversation = '00000000-0000-4000-8000-000000000001';
const message = '00000000-0000-4000-8000-000000000002';
const version = '00000000-0000-4000-8000-000000000003';
const digest = (text) => createHash('sha256').update(text).digest('hex');

function setup(t, authorize = () => true) {
  const directory = mkdtempSync(join(tmpdir(), 'logic-host-lifecycle-journal-'));
  const journal = new HostLifecycleJournal({
    path: join(directory, 'host-journal.sqlite'),
    coordinatorPath: join(directory, 'coordinator.sqlite'),
    resolveIdentity: (input) => ({
      authorized: authorize(input) === true,
      host_installation_id: input.host_installation_id,
      authenticated_account_id: input.authenticated_account_id,
      conversation_uuid: input.conversation_uuid,
    }),
    resolveRootIdentity: (input) => ({
      authorized: authorize(input) === true,
      host_installation_id: input.host_installation_id,
      authenticated_account_id: input.authenticated_account_id,
      root_id: input.root_id,
    }),
  });
  t.after(() => {
    try { journal.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });
  return { journal, directory };
}
function event(overrides = {}) {
  return {
    event_id: 'event-1',
    host_installation_id: installation,
    authenticated_account_id: account,
    conversation_uuid: conversation,
    event_type: 'VERSION_CREATED',
    message_id: message,
    version_id: version,
    parent_version_id: null,
    payload_sha256: digest('payload'),
    active: true,
    ...overrides,
  };
}

test('appends lifecycle events with a monotonic sequence and verifiable hash chain', (t) => {
  const { journal } = setup(t);
  const first = journal.append(event());
  assert.equal(first.status, 'appended');
  assert.equal(first.sequence, 1);
  const second = journal.append(event({
    event_id: 'event-2',
    event_type: 'VERSION_SELECTED',
    parent_version_id: undefined,
    payload_sha256: undefined,
    active: true,
  }));
  assert.equal(second.sequence, 2);
  const head = journal.getHead(installation, account);
  assert.equal(head.sequence, 2);
  assert.equal(journal.verifyChain(installation, account).valid, true);
});

test('identical event replay is idempotent and changed replay conflicts', (t) => {
  const { journal } = setup(t);
  const first = event();
  assert.equal(journal.append(first).status, 'appended');
  assert.equal(journal.append(first).status, 'duplicate');
  assert.throws(() => journal.append(event({ payload_sha256: digest('changed') })), /HOST_LIFECYCLE_EVENT_ID_CONFLICT/);
  assert.equal(journal.getHead(installation, account).sequence, 1);
});

test('rejects identity not authorized by the trusted server-side resolver', (t) => {
  const { journal } = setup(t, () => false);
  assert.throws(() => journal.append(event()), /HOST_LIFECYCLE_IDENTITY_NOT_AUTHORIZED/);
  assert.equal(journal.getHead(installation, account).sequence, 0);
});

test('serializes lifecycle append against competing Core writers under the shared Coordinator lease', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-host-lifecycle-lock-'));
  const coordinatorPath = join(directory, 'coordinator.sqlite');
  const competing = new DatabaseSync(coordinatorPath);
  competing.exec('PRAGMA busy_timeout=0;');
  const journal = new HostLifecycleJournal({
    path: join(directory, 'host-journal.sqlite'),
    coordinatorPath,
    resolveIdentity: (input) => {
      assert.throws(() => competing.exec('BEGIN IMMEDIATE'), /locked|busy/i);
      return {
        authorized: true,
        host_installation_id: input.host_installation_id,
        authenticated_account_id: input.authenticated_account_id,
        conversation_uuid: input.conversation_uuid,
      };
    },
  });
  t.after(() => {
    try { journal.close(); } catch {}
    try { competing.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });
  assert.equal(journal.append(event()).status, 'appended');
  competing.exec('BEGIN IMMEDIATE; ROLLBACK;');
});

test('append-only SQL triggers reject event update and deletion', (t) => {
  const { journal } = setup(t);
  journal.append(event());
  assert.throws(() => journal.db.exec("UPDATE host_lifecycle_events SET event_type='VERSION_DELETED'"), /HOST_LIFECYCLE_JOURNAL_APPEND_ONLY/);
  assert.throws(() => journal.db.exec('DELETE FROM host_lifecycle_events'), /HOST_LIFECYCLE_JOURNAL_APPEND_ONLY/);
  assert.equal(journal.verifyChain(installation, account).valid, true);
});

test('event validation rejects mutable or incomplete Host version identities', (t) => {
  const { journal } = setup(t);
  assert.throws(() => journal.append(event({ message_id: 'mutable-index-0' })), /stable message and version UUIDs/);
  assert.throws(() => journal.append(event({ parent_version_id: 'not-a-uuid' })), /immutable parent and payload digest/);
  assert.throws(() => journal.append(event({ payload_sha256: 'not-a-digest' })), /immutable parent and payload digest/);
});


test('durable lifecycle journal survives close/reopen and replay remains idempotent', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-host-lifecycle-restart-'));
  const path = join(directory, 'host-journal.sqlite');
  const coordinatorPath = join(directory, 'coordinator.sqlite');
  const resolveIdentity = input => ({
    authorized: true,
    host_installation_id: input.host_installation_id,
    authenticated_account_id: input.authenticated_account_id,
    conversation_uuid: input.conversation_uuid,
  });
  let first = new HostLifecycleJournal({ path, coordinatorPath, resolveIdentity });
  const appended = first.append(event());
  assert.equal(appended.status, 'appended');
  assert.equal(first.verifyChain(installation, account).valid, true);
  first.close();

  const reopened = new HostLifecycleJournal({ path, coordinatorPath, resolveIdentity });
  t.after(() => {
    try { reopened.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });
  const reopenedHead = reopened.getHead(installation, account);
  assert.equal(reopenedHead.sequence, 1);
  assert.equal(reopenedHead.head_sha256, appended.event_sha256);
  assert.equal(reopened.verifyChain(installation, account).valid, true);
  assert.equal(reopened.append(event()).status, 'duplicate');
  assert.equal(reopened.getHead(installation, account).sequence, 1);
});


const rootId = digest('installation/account/canonical-data-root');
const rootEntries = (contentDigest, fileIdentity = '101') => [{
  path: 'chats/main.jsonl',
  identity: { dev: '1', ino: fileIdentity, mode: 33188, size: 64, mtimeMs: 1, ctimeMs: 1 },
  sha256: contentDigest,
}];
const rootFile = (path, ino, content, metadata = {}) => ({
  path,
  identity: {
    dev: '1', ino, mode: 33188, size: 64, mtimeMs: 1, ctimeMs: 1, ...metadata,
  },
  sha256: digest(content),
});
const rootInput = (overrides = {}) => ({
  host_installation_id: installation,
  authenticated_account_id: account,
  root_id: rootId,
  event_id: 'root-event-1',
  entries: rootEntries(digest('first')),
  ...overrides,
});

test('root inventory baseline is installation/account/root scoped and survives SQLite restart', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-host-root-inventory-restart-'));
  const path = join(directory, 'host-journal.sqlite');
  const coordinatorPath = join(directory, 'coordinator.sqlite');
  const resolveIdentity = input => ({
    authorized: true,
    host_installation_id: input.host_installation_id,
    authenticated_account_id: input.authenticated_account_id,
    conversation_uuid: input.conversation_uuid,
  });
  const resolveRootIdentity = input => ({
    authorized: true,
    host_installation_id: input.host_installation_id,
    authenticated_account_id: input.authenticated_account_id,
    root_id: input.root_id,
  });
  const first = new HostLifecycleJournal({ path, coordinatorPath, resolveIdentity, resolveRootIdentity });
  const enrolled = first.enrollRootInventory(rootInput());
  assert.equal(enrolled.status, 'BASELINED_REVIEW_ONLY');
  assert.equal(enrolled.sequence, 1);
  assert.equal(first.verifyRootInventory(rootInput()).status, 'INTEGRITY_OK');
  first.close();

  const reopened = new HostLifecycleJournal({ path, coordinatorPath, resolveIdentity, resolveRootIdentity });
  t.after(() => {
    try { reopened.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });
  const verified = reopened.verifyRootInventory(rootInput());
  assert.equal(verified.status, 'INTEGRITY_OK');
  assert.equal(verified.sequence, 1);
  assert.equal(verified.status === 'INTEGRITY_OK' && verified.baseline_manifest_sha256, enrolled.manifest_sha256);
  assert.equal(reopened.enrollRootInventory(rootInput()).status, 'duplicate');
});

test('root file delta is durable, replay-idempotent and never accepted without an operation receipt', (t) => {
  const { journal } = setup(t);
  const baseline = rootInput();
  journal.enrollRootInventory(baseline);
  const changed = rootInput({
    event_id: 'root-delta-1',
    entries: rootEntries(digest('edited')),
  });
  const observed = journal.observeRootInventory(changed);
  assert.equal(observed.status, 'NON_READY');
  assert.equal(observed.sequence, 2);
  assert.equal(observed.delta.modified.length, 1);
  assert.equal(journal.verifyRootInventory(changed).status, 'INTEGRITY_OK');

  const sameEventReplay = journal.observeRootInventory(changed);
  assert.equal(sameEventReplay.status, 'NON_READY');
  assert.equal(sameEventReplay.duplicate, true);
  assert.equal(sameEventReplay.sequence, observed.sequence);
  assert.throws(() => journal.observeRootInventory({
    ...changed,
    entries: rootEntries(digest('different-payload')),
  }), /HOST_ROOT_INVENTORY_EVENT_ID_CONFLICT/);

  const replay = journal.observeRootInventory({ ...changed, event_id: 'root-delta-replay' });
  assert.equal(replay.status, 'NON_READY');
  assert.equal(replay.duplicate, true);
  assert.equal(replay.sequence, 2);

  const restored = journal.observeRootInventory({
    ...baseline,
    event_id: 'root-restored-after-observation',
  });
  assert.equal(restored.status, 'NON_READY');
  assert.match(restored.reason, /previously observed root inventory delta remains unresolved/);
  assert.equal(journal.verifyRootInventory(baseline).status, 'INTEGRITY_OK');
});

test('root file-level reconciliation classifies add, remove, modify, metadata, replace and move', (t) => {
  const { journal } = setup(t);
  const baseline = rootInput({
    entries: [
      rootFile('chats/metadata.jsonl', '102', 'same', { mtimeMs: 2 }),
      rootFile('chats/modify.jsonl', '103', 'before'),
      rootFile('chats/move-from.jsonl', '104', 'move-before'),
      rootFile('chats/remove.jsonl', '105', 'remove'),
      rootFile('chats/replace.jsonl', '106', 'replace-before'),
    ],
  });
  journal.enrollRootInventory(baseline);
  const observed = journal.observeRootInventory(rootInput({
    event_id: 'root-delta-classification',
    entries: [
      rootFile('chats/added.jsonl', '107', 'added'),
      rootFile('chats/metadata.jsonl', '102', 'same', { mtimeMs: 3 }),
      rootFile('chats/modify.jsonl', '103', 'after'),
      rootFile('chats/move-to.jsonl', '104', 'move-after'),
      rootFile('chats/replace.jsonl', '108', 'replace-after'),
    ],
  }));
  assert.equal(observed.status, 'NON_READY');
  assert.equal(observed.delta.added.length, 1);
  assert.equal(observed.delta.added[0].path, 'chats/added.jsonl');
  assert.equal(observed.delta.removed.length, 1);
  assert.equal(observed.delta.removed[0].path, 'chats/remove.jsonl');
  assert.equal(observed.delta.modified.length, 1);
  assert.equal(observed.delta.modified[0].path, 'chats/modify.jsonl');
  assert.equal(observed.delta.metadata_changed.length, 1);
  assert.equal(observed.delta.metadata_changed[0].path, 'chats/metadata.jsonl');
  assert.equal(observed.delta.replaced.length, 1);
  assert.equal(observed.delta.replaced[0].path, 'chats/replace.jsonl');
  assert.equal(observed.delta.moved.length, 1);
  assert.equal(observed.delta.moved[0].from, 'chats/move-from.jsonl');
  assert.equal(observed.delta.moved[0].to, 'chats/move-to.jsonl');
  assert.equal(observed.delta.moved[0].content_changed, true);
  assert.equal(journal.verifyRootInventory(baseline).status, 'INTEGRITY_OK');
});

test('root inventory delta chain survives close/reopen and rejects changed replay', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-host-root-delta-restart-'));
  const path = join(directory, 'host-journal.sqlite');
  const coordinatorPath = join(directory, 'coordinator.sqlite');
  const resolveIdentity = input => ({
    authorized: true,
    host_installation_id: input.host_installation_id,
    authenticated_account_id: input.authenticated_account_id,
    conversation_uuid: input.conversation_uuid,
  });
  const resolveRootIdentity = input => ({
    authorized: true,
    host_installation_id: input.host_installation_id,
    authenticated_account_id: input.authenticated_account_id,
    root_id: input.root_id,
  });
  const first = new HostLifecycleJournal({ path, coordinatorPath, resolveIdentity, resolveRootIdentity });
  const baseline = rootInput();
  first.enrollRootInventory(baseline);
  const changed = rootInput({ event_id: 'root-delta-restart', entries: rootEntries(digest('after')) });
  const observed = first.observeRootInventory(changed);
  assert.equal(observed.status, 'NON_READY');
  first.close();

  const reopened = new HostLifecycleJournal({ path, coordinatorPath, resolveIdentity, resolveRootIdentity });
  t.after(() => {
    try { reopened.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });
  const verified = reopened.verifyRootInventory(changed);
  assert.equal(verified.status, 'INTEGRITY_OK');
  assert.equal(verified.sequence, 2);
  const replay = reopened.observeRootInventory(changed);
  assert.equal(replay.status, 'NON_READY');
  assert.equal(replay.duplicate, true);
  assert.equal(replay.sequence, 2);
  assert.throws(() => reopened.observeRootInventory({
    ...changed,
    entries: rootEntries(digest('conflicting-after')),
  }), /HOST_ROOT_INVENTORY_EVENT_ID_CONFLICT/);
});

test('root inventory identity is isolated by installation, account and canonical root', (t) => {
  const { journal } = setup(t);
  const first = rootInput();
  journal.enrollRootInventory(first);
  const otherAccount = rootInput({
    authenticated_account_id: 'account-principal-002',
    event_id: 'other-account-baseline',
  });
  assert.equal(journal.enrollRootInventory(otherAccount).status, 'BASELINED_REVIEW_ONLY');
  const otherRoot = rootInput({
    root_id: digest('another-canonical-root'),
    event_id: 'other-root-baseline',
  });
  assert.equal(journal.enrollRootInventory(otherRoot).status, 'BASELINED_REVIEW_ONLY');
  assert.equal(journal.verifyRootInventory(first).status, 'INTEGRITY_OK');
  assert.equal(journal.verifyRootInventory(otherAccount).status, 'INTEGRITY_OK');
  assert.equal(journal.verifyRootInventory(otherRoot).status, 'INTEGRITY_OK');
});

test('root inventory rejects unauthorized root identity and hard-link aliases', (t) => {
  const { journal } = setup(t, input => input.root_id !== digest('forged-root'));
  assert.throws(() => journal.enrollRootInventory(rootInput({
    root_id: digest('forged-root'),
  })), /HOST_ROOT_INVENTORY_IDENTITY_NOT_AUTHORIZED/);
  assert.throws(() => journal.enrollRootInventory(rootInput({
    entries: [
      ...rootEntries(digest('one'), '101'),
      { path: 'chats/alias.jsonl',
        identity: { dev: '1', ino: '101', mode: 33188, size: 64, mtimeMs: 1, ctimeMs: 1 },
        sha256: digest('two') },
    ],
  })), /HOST_ROOT_INVENTORY_PHYSICAL_IDENTITY_DUPLICATE/);
});

test('root inventory append-only events and independent head detect tampering', (t) => {
  const { journal } = setup(t);
  journal.enrollRootInventory(rootInput());
  assert.throws(() => journal.db.exec("UPDATE host_root_inventory_events SET event_type='DELTA_OBSERVED'"),
    /HOST_ROOT_INVENTORY_APPEND_ONLY/);
  assert.throws(() => journal.db.exec('DELETE FROM host_root_inventory_events'),
    /HOST_ROOT_INVENTORY_APPEND_ONLY/);
  journal.db.exec("UPDATE host_root_inventory_heads SET head_sha256='" + 'f'.repeat(64) + "'");
  assert.equal(journal.verifyRootInventory(rootInput()).status, 'NON_READY');
});


test('over-limit root drift is durably recorded and cannot disappear after a restore', (t) => {
  const { journal } = setup(t);
  const baseline = rootInput({ entries: [] });
  journal.enrollRootInventory(baseline);
  const entries = Array.from({ length: 5_001 }, (_, index) => ({
    path: 'files/' + String(index).padStart(5, '0') + '.bin',
    identity: {
      dev: '1', ino: String(index + 1), mode: 33188, size: 1,
      mtimeMs: 1, ctimeMs: 1,
    },
    sha256: digest('file-' + index),
  }));
  const observed = journal.observeRootInventory({
    ...baseline,
    event_id: 'root-over-limit-delta',
    entries,
  });
  assert.equal(observed.status, 'NON_READY');
  assert.equal(observed.reason, 'HOST_ROOT_INVENTORY_DELTA_LIMIT');
  assert.equal(observed.changed_files, 5_001);
  assert.equal(journal.verifyRootInventory(baseline).status, 'INTEGRITY_OK');
  const restored = journal.observeRootInventory({
    ...baseline,
    event_id: 'root-over-limit-restored',
  });
  assert.equal(restored.status, 'NON_READY');
  assert.match(restored.reason, /previously observed root inventory delta remains unresolved/);
});
