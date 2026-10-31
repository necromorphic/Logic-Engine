import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HostLifecycleJournal } from '../src/application/host-lifecycle-journal.js';

const installation = '11111111-1111-4111-8111-111111111111';
const account = '22222222-2222-4222-8222-222222222222';
const hostSession = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const authority = { authority_id: 'test-host-authority', generation: 1, snapshot_fingerprint: 'b'.repeat(64) };
const conversation = '00000000-0000-4000-8000-000000000001';
const message = '00000000-0000-4000-8000-000000000002';
const version = '00000000-0000-4000-8000-000000000003';
const digest = (text) => createHash('sha256').update(text).digest('hex');

function setup(t, authorize = () => true, authorizeRoot = () => true) {
  const directory = mkdtempSync(join(tmpdir(), 'logic-host-lifecycle-journal-'));
  const journal = new HostLifecycleJournal({
    path: join(directory, 'host-journal.sqlite'),
    coordinatorPath: join(directory, 'coordinator.sqlite'),
    verifyMutationReceipt: () => true,
    resolveIdentity: (input) => ({
      authorized: authorize(input) === true,
      host_installation_id: input.host_installation_id,
      authenticated_account_id: input.authenticated_account_id,
      host_session_id: input.host_session_id,
      conversation_uuid: input.conversation_uuid,
      adapter_id: 'test-adapter',
      root_id: rootId,
      ...authority,
    }),
    resolveRootIdentity: (input) => ({
      authorized: authorizeRoot(input) === true,
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
    event_id: '00000000-0000-4000-8000-000000000010',
    host_installation_id: installation,
    authenticated_account_id: account,
    host_session_id: hostSession,
    conversation_uuid: conversation,
    ...authority,
    occurred_at: '2026-10-31T00:00:00.000Z',
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
  const { journal } = setupLifecycle(t);
  const first = journal.append(event());
  assert.equal(first.status, 'appended');
  assert.equal(first.sequence, 1);
  const second = journal.append(event({
    event_id: '00000000-0000-4000-8000-000000000020',
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
  const { journal } = setupLifecycle(t);
  const first = event();
  assert.equal(journal.append(first).status, 'appended');
  assert.equal(journal.append(first).status, 'duplicate');
  assert.throws(() => journal.append(event({ payload_sha256: digest('changed') })), /HOST_LIFECYCLE_EVENT_ID_CONFLICT/);
  assert.equal(journal.getHead(installation, account).sequence, 1);
});

test('rejects identity not authorized by the trusted server-side resolver', (t) => {
  const { journal } = setupLifecycle(t, () => false);
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
    verifyMutationReceipt: () => true,
    resolveRootIdentity: input => ({
      authorized: true,
      host_installation_id: input.host_installation_id,
      authenticated_account_id: input.authenticated_account_id,
      root_id: input.root_id,
    }),
    resolveIdentity: (input) => {
      assert.throws(() => competing.exec('BEGIN IMMEDIATE'), /locked|busy/i);
      return {
        authorized: true,
        host_installation_id: input.host_installation_id,
        authenticated_account_id: input.authenticated_account_id,
        host_session_id: input.host_session_id,
        conversation_uuid: input.conversation_uuid,
        adapter_id: 'test-adapter',
        root_id: rootId,
        ...authority,
      };
    },
  });
  t.after(() => {
    try { journal.close(); } catch {}
    try { competing.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });
  journal.enrollRootInventory({ host_installation_id: installation, authenticated_account_id: account,
    root_id: rootId, event_id: 'root-lock-baseline', entries: rootEntries(digest('lock-baseline')) });
  authority.snapshot_fingerprint = journal.getAuthoritySnapshot({
    authority_id: authority.authority_id, generation: authority.generation, adapter_id: 'test-adapter',
    host_installation_id: installation, authenticated_account_id: account, root_id: rootId,
  }).snapshot_fingerprint;

  assert.equal(journal.append(event()).status, 'appended');
  competing.exec('BEGIN IMMEDIATE; ROLLBACK;');
});

test('append-only SQL triggers reject event update and deletion', (t) => {
  const { journal } = setupLifecycle(t);
  journal.append(event());
  assert.throws(() => journal.db.exec("UPDATE host_lifecycle_events SET event_type='VERSION_DELETED'"), /HOST_LIFECYCLE_JOURNAL_APPEND_ONLY/);
  assert.throws(() => journal.db.exec('DELETE FROM host_lifecycle_events'), /HOST_LIFECYCLE_JOURNAL_APPEND_ONLY/);
  assert.equal(journal.verifyChain(installation, account).valid, true);
});

test('event validation rejects mutable or incomplete Host version identities', (t) => {
  const { journal } = setupLifecycle(t);
  assert.throws(() => journal.append(event({ message_id: 'mutable-index-0' })), /stable message and version UUIDs/);
  assert.throws(() => journal.append(event({ parent_version_id: 'not-a-uuid' })), /immutable parent and payload digest/);
  assert.throws(() => journal.append(event({ payload_sha256: 'not-a-digest' })), /immutable parent and payload digest/);
});


test('Host authority generation is durable and cannot roll back without authority rotation', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-host-authority-generation-'));
  const path = join(directory, 'host-journal.sqlite');
  const coordinatorPath = join(directory, 'coordinator.sqlite');
  const makeJournal = () => new HostLifecycleJournal({
    path, coordinatorPath, resolveIdentity: () => ({ authorized: false }),
  });
  let journal = makeJournal();
  assert.equal(journal.setAuthorityGeneration('host-authority-a', 4).status, 'INITIALIZED');
  assert.equal(journal.setAuthorityGeneration('host-authority-a', 4).status, 'UNCHANGED');
  assert.equal(journal.setAuthorityGeneration('host-authority-a', 5).status, 'ADVANCED');
  assert.throws(() => journal.setAuthorityGeneration('host-authority-a', 3),
    /HOST_LIFECYCLE_AUTHORITY_GENERATION_ROLLBACK/);
  journal.close();

  journal = makeJournal();
  t.after(() => {
    try { journal.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });
  assert.throws(() => journal.setAuthorityGeneration('host-authority-a', 4),
    /HOST_LIFECYCLE_AUTHORITY_GENERATION_ROLLBACK/);
  assert.equal(journal.setAuthorityGeneration('host-authority-b', 1).status, 'ROTATED');
});

test('durable lifecycle journal survives close/reopen and replay remains idempotent', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-host-lifecycle-restart-'));
  const path = join(directory, 'host-journal.sqlite');
  const coordinatorPath = join(directory, 'coordinator.sqlite');
  const resolveIdentity = input => ({
    authorized: true,
    host_installation_id: input.host_installation_id,
    authenticated_account_id: input.authenticated_account_id,
    host_session_id: input.host_session_id,
    conversation_uuid: input.conversation_uuid,
    adapter_id: 'test-adapter',
    root_id: rootId,
    ...authority,
  });
  const resolveRootIdentity = input => ({
    authorized: true,
    host_installation_id: input.host_installation_id,
    authenticated_account_id: input.authenticated_account_id,
    root_id: input.root_id,
  });
  let first = new HostLifecycleJournal({ path, coordinatorPath, resolveIdentity, resolveRootIdentity, verifyMutationReceipt: () => true });
  first.enrollRootInventory({ host_installation_id: installation, authenticated_account_id: account,
    root_id: rootId, event_id: 'root-restart-baseline', entries: rootEntries(digest('restart-baseline')) });
  authority.snapshot_fingerprint = first.getAuthoritySnapshot({
    authority_id: authority.authority_id, generation: authority.generation, adapter_id: 'test-adapter',
    host_installation_id: installation, authenticated_account_id: account, root_id: rootId,
  }).snapshot_fingerprint;

  const appended = first.append(event());
  assert.equal(appended.status, 'appended');
  assert.equal(first.verifyChain(installation, account).valid, true);
  first.close();

  const reopened = new HostLifecycleJournal({ path, coordinatorPath, resolveIdentity, resolveRootIdentity, verifyMutationReceipt: () => true });
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
function setupLifecycle(t, authorize = () => true) {
  const context = setup(t, authorize, () => true);
  context.journal.enrollRootInventory({
    host_installation_id: installation,
    authenticated_account_id: account,
    root_id: rootId,
    event_id: 'root-authority-baseline',
    entries: rootEntries(digest('host-authority-root-baseline')),
  });
  const snapshot = context.journal.getAuthoritySnapshot({
    authority_id: authority.authority_id,
    generation: authority.generation,
    adapter_id: 'test-adapter',
    host_installation_id: installation,
    authenticated_account_id: account,
    root_id: rootId,
  });
  if (snapshot.status !== 'INTEGRITY_OK') throw Error('Test Host authority snapshot unavailable');
  authority.snapshot_fingerprint = snapshot.snapshot_fingerprint;
  return context;
}

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

  const changedAgain = rootInput({
    event_id: 'root-delta-2',
    entries: rootEntries(digest('edited-again')),
  });
  const secondObservation = journal.observeRootInventory(changedAgain);
  assert.equal(secondObservation.status, 'NON_READY');
  assert.equal(secondObservation.sequence, 3);
  assert.equal(secondObservation.delta.modified.length, 1);
  const replayEarlierEvent = journal.observeRootInventory(changed);
  assert.equal(replayEarlierEvent.status, 'NON_READY');
  assert.equal(replayEarlierEvent.duplicate, true);
  assert.equal(replayEarlierEvent.sequence, 2,
    'replaying an earlier event ID with identical content remains idempotent after later observations');

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
  assert.match(observed.manifest_sha256, /^[a-f0-9]{64}$/);
  assert.match(observed.delta_sha256, /^[a-f0-9]{64}$/);
  assert.equal(journal.verifyRootInventory(baseline).status, 'INTEGRITY_OK');
  const sameEventReplay = journal.observeRootInventory({ ...baseline, event_id: 'root-over-limit-delta', entries });
  assert.equal(sameEventReplay.duplicate, true);
  assert.equal(sameEventReplay.sequence, observed.sequence);
  assert.equal(sameEventReplay.manifest_sha256, observed.manifest_sha256);
  assert.equal(sameEventReplay.delta_sha256, observed.delta_sha256);
  const newEventReplay = journal.observeRootInventory({ ...baseline, event_id: 'root-over-limit-replay', entries });
  assert.equal(newEventReplay.duplicate, true);
  assert.equal(newEventReplay.sequence, observed.sequence);
  assert.equal(newEventReplay.manifest_sha256, observed.manifest_sha256);
  assert.equal(newEventReplay.delta_sha256, observed.delta_sha256);
  const restored = journal.observeRootInventory({
    ...baseline,
    event_id: 'root-over-limit-restored',
  });
  assert.equal(restored.status, 'NON_READY');
  assert.match(restored.reason, /previously observed root inventory delta remains unresolved/);
});


test('Host lifecycle authority fingerprint is invalidated by unresolved root inventory drift', (t) => {
  const { journal } = setupLifecycle(t);
  const trusted = {
    authority_id: authority.authority_id,
    generation: authority.generation,
    adapter_id: 'test-adapter',
    host_installation_id: installation,
    authenticated_account_id: account,
    root_id: rootId,
  };
  assert.equal(journal.getAuthoritySnapshot(trusted).status, 'INTEGRITY_OK');
  const drift = journal.observeRootInventory({
    host_installation_id: installation,
    authenticated_account_id: account,
    root_id: rootId,
    event_id: 'root-authority-drift',
    entries: rootEntries(digest('changed-root')),
  });
  assert.equal(drift.status, 'NON_READY');
  assert.equal(journal.getAuthoritySnapshot(trusted).status, 'NON_READY');
});

test('durable Core journal records prepared mutations, blocks overlap, and clears only on a matching commit', (t) => {
  const { journal } = setupLifecycle(t);
  const prepared = {
    event_id: '00000000-0000-4000-8000-000000000011',
    host_installation_id: installation,
    authenticated_account_id: account,
    host_session_id: hostSession,
    conversation_uuid: conversation,
    ...authority,
    occurred_at: '2026-10-31T00:00:00.000Z',
    event_type: 'MUTATION_PREPARED',
    mutation_id: '00000000-0000-4000-8000-000000000012',
    operation: 'edit-message',
    mutation_digest: digest('before-state'),
  };
  assert.equal(journal.append(prepared).status, 'appended');
  assert.equal(journal.append(prepared).status, 'duplicate', 'exact retry is checked before pending-state validation');
  assert.throws(() => journal.append({ ...prepared, mutation_digest: digest('altered') }), /HOST_LIFECYCLE_EVENT_ID_CONFLICT/);
  assert.equal(journal.getConversationStatus(installation, account, hostSession, conversation, { ...authority, adapter_id: 'test-adapter', root_id: rootId }).status, 'PENDING_MUTATION');
  assert.throws(() => journal.append({
    ...prepared,
    event_id: '00000000-0000-4000-8000-000000000013',
    mutation_id: '00000000-0000-4000-8000-000000000014',
  }), /HOST_LIFECYCLE_MUTATION_ALREADY_PENDING/);
  assert.throws(() => journal.append({
    ...prepared,
    event_id: '00000000-0000-4000-8000-000000000015',
    event_type: 'MUTATION_COMMITTED',
    mutation_id: '00000000-0000-4000-8000-000000000099',
    receipt_digest: digest('missing-prepare-receipt'),
    receipt_signature: digest('server-signature'),
  }), /HOST_LIFECYCLE_MUTATION_PREPARE_MISSING/);
  const committed = journal.append({
    ...prepared,
    event_id: '00000000-0000-4000-8000-000000000016',
    event_type: 'MUTATION_COMMITTED',
    mutation_digest: digest('before-state'),
    receipt_digest: digest('persisted-after-receipt'),
    receipt_signature: digest('server-signature'),
    occurred_at: '2026-10-31T00:00:01.000Z',
  });
  assert.equal(committed.status, 'appended');
  assert.equal(journal.getConversationStatus(installation, account, hostSession, conversation, { ...authority, adapter_id: 'test-adapter', root_id: rootId }).status, 'NO_PENDING_MUTATION');
  assert.equal(journal.verifyChain(installation, account).valid, true);
});

test('ABORTED is terminal and cannot be reversed to COMMITTED', (t) => {
  const { journal } = setupLifecycle(t);
  const prepared = {
    event_id: '00000000-0000-4000-8000-000000000041',
    host_installation_id: installation,
    authenticated_account_id: account,
    host_session_id: hostSession,
    conversation_uuid: conversation,
    ...authority,
    occurred_at: '2026-10-31T00:00:00.000Z',
    event_type: 'MUTATION_PREPARED',
    mutation_id: '00000000-0000-4000-8000-000000000042',
    operation: 'delete-message',
    mutation_digest: digest('abort-intent'),
  };
  journal.append(prepared);
  const aborted = {
    ...prepared,
    event_id: '00000000-0000-4000-8000-000000000043',
    event_type: 'MUTATION_ABORTED',
    receipt_digest: digest('verified-no-change-receipt'),
    receipt_signature: digest('server-signature'),
    occurred_at: '2026-10-31T00:00:01.000Z',
  };
  assert.equal(journal.append(aborted).status, 'appended');
  assert.equal(journal.getConversationStatus(installation, account, hostSession, conversation,
    { ...authority, adapter_id: 'test-adapter', root_id: rootId }).status, 'NO_PENDING_MUTATION');
  assert.throws(() => journal.append({
    ...aborted,
    event_id: '00000000-0000-4000-8000-000000000044',
    event_type: 'MUTATION_COMMITTED',
    receipt_digest: digest('commit-after-abort'),
    receipt_signature: digest('server-signature'),
    occurred_at: '2026-10-31T00:00:02.000Z',
  }), /HOST_LIFECYCLE_MUTATION_TERMINAL_CONFLICT/);
});

test('pending mutation isolation is per authenticated session, not account-wide', (t) => {
  const { journal } = setupLifecycle(t);
  const secondSession = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const first = {
    ...event(),
    event_type: 'MUTATION_PREPARED',
    mutation_id: '00000000-0000-4000-8000-000000000051',
    operation: 'edit-message',
    mutation_digest: digest('session-one-intent'),
  };
  const second = {
    ...first,
    event_id: '00000000-0000-4000-8000-000000000052',
    host_session_id: secondSession,
    mutation_id: '00000000-0000-4000-8000-000000000053',
    mutation_digest: digest('session-two-intent'),
  };
  assert.equal(journal.append(first).status, 'appended');
  assert.equal(journal.append(second).status, 'appended');
  const trusted = { ...authority, adapter_id: 'test-adapter', root_id: rootId };
  assert.equal(journal.getConversationStatus(installation, account, hostSession, conversation, trusted).status,
    'PENDING_MUTATION');
  assert.equal(journal.getConversationStatus(installation, account, secondSession, conversation, trusted).status,
    'PENDING_MUTATION');
});

test('terminal receipt is rejected by default and leaves the mutation pending', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-host-lifecycle-receipt-deny-'));
  const path = join(directory, 'host-journal.sqlite');
  const coordinatorPath = join(directory, 'coordinator.sqlite');
  const resolveIdentity = input => ({
    authorized: true,
    host_installation_id: input.host_installation_id,
    authenticated_account_id: input.authenticated_account_id,
    host_session_id: input.host_session_id,
    conversation_uuid: input.conversation_uuid,
    adapter_id: 'test-adapter',
    root_id: rootId,
    ...authority,
  });
  const resolveRootIdentity = input => ({
    authorized: true,
    host_installation_id: input.host_installation_id,
    authenticated_account_id: input.authenticated_account_id,
    root_id: input.root_id,
  });
  const journal = new HostLifecycleJournal({ path, coordinatorPath, resolveIdentity, resolveRootIdentity });
  journal.enrollRootInventory({ host_installation_id: installation, authenticated_account_id: account,
    root_id: rootId, event_id: 'root-receipt-deny-baseline', entries: rootEntries(digest('receipt-deny-baseline')) });
  authority.snapshot_fingerprint = journal.getAuthoritySnapshot({
    authority_id: authority.authority_id, generation: authority.generation, adapter_id: 'test-adapter',
    host_installation_id: installation, authenticated_account_id: account, root_id: rootId,
  }).snapshot_fingerprint;

  t.after(() => {
    try { journal.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });
  const prepared = {
    event_id: '00000000-0000-4000-8000-000000000031',
    host_installation_id: installation,
    authenticated_account_id: account,
    host_session_id: hostSession,
    conversation_uuid: conversation,
    ...authority,
    occurred_at: '2026-10-31T00:00:00.000Z',
    event_type: 'MUTATION_PREPARED',
    mutation_id: '00000000-0000-4000-8000-000000000032',
    operation: 'edit-message',
    mutation_digest: digest('intent'),
  };
  journal.append(prepared);
  assert.throws(() => journal.append({
    ...prepared,
    event_id: '00000000-0000-4000-8000-000000000033',
    event_type: 'MUTATION_COMMITTED',
    receipt_digest: digest('unverified-receipt'),
    receipt_signature: digest('server-signature'),
    occurred_at: '2026-10-31T00:00:01.000Z',
  }), /HOST_LIFECYCLE_RECEIPT_MISMATCH/);
  assert.equal(journal.getConversationStatus(installation, account, hostSession, conversation, { ...authority, adapter_id: 'test-adapter', root_id: rootId }).status, 'PENDING_MUTATION');
});

test('prepared Core mutation survives SQLite restart and can be completed by idempotent replay', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-host-lifecycle-pending-restart-'));
  const path = join(directory, 'host-journal.sqlite');
  const coordinatorPath = join(directory, 'coordinator.sqlite');
  const resolveIdentity = input => ({
    authorized: true,
    host_installation_id: input.host_installation_id,
    authenticated_account_id: input.authenticated_account_id,
    host_session_id: input.host_session_id,
    conversation_uuid: input.conversation_uuid,
    adapter_id: 'test-adapter',
    root_id: rootId,
    ...authority,
  });
  const prepared = {
    event_id: '00000000-0000-4000-8000-000000000021',
    host_installation_id: installation,
    authenticated_account_id: account,
    host_session_id: hostSession,
    conversation_uuid: conversation,
    ...authority,
    occurred_at: '2026-10-31T00:00:00.000Z',
    event_type: 'MUTATION_PREPARED',
    mutation_id: '00000000-0000-4000-8000-000000000022',
    operation: 'delete-message',
    mutation_digest: digest('before-delete'),
  };
  const resolveRootIdentity = input => ({
    authorized: true,
    host_installation_id: input.host_installation_id,
    authenticated_account_id: input.authenticated_account_id,
    root_id: input.root_id,
  });
  const first = new HostLifecycleJournal({ path, coordinatorPath, resolveIdentity, resolveRootIdentity, verifyMutationReceipt: () => true });
  first.enrollRootInventory({ host_installation_id: installation, authenticated_account_id: account,
    root_id: rootId, event_id: 'root-pending-restart-baseline', entries: rootEntries(digest('pending-restart-baseline')) });
  authority.snapshot_fingerprint = first.getAuthoritySnapshot({
    authority_id: authority.authority_id, generation: authority.generation, adapter_id: 'test-adapter',
    host_installation_id: installation, authenticated_account_id: account, root_id: rootId,
  }).snapshot_fingerprint;
  prepared.snapshot_fingerprint = authority.snapshot_fingerprint;

  first.append(prepared);
  first.close();
  const reopened = new HostLifecycleJournal({ path, coordinatorPath, resolveIdentity, verifyMutationReceipt: () => true });
  t.after(() => {
    try { reopened.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });
  const status = reopened.getConversationStatus(installation, account, hostSession, conversation, { ...authority, adapter_id: 'test-adapter', root_id: rootId });
  assert.equal(status.status, 'PENDING_MUTATION');
  assert.equal(status.pending.mutation_id, prepared.mutation_id);
  const commit = {
    ...prepared,
    event_id: '00000000-0000-4000-8000-000000000023',
    event_type: 'MUTATION_COMMITTED',
    mutation_digest: digest('before-delete'),
    receipt_digest: digest('persisted-delete-receipt'),
    receipt_signature: digest('server-signature'),
    occurred_at: '2026-10-31T00:00:01.000Z',
  };
  assert.equal(reopened.append(commit).status, 'appended');
  assert.equal(reopened.append(commit).status, 'duplicate');
  assert.equal(reopened.getConversationStatus(installation, account, hostSession, conversation, { ...authority, adapter_id: 'test-adapter', root_id: rootId }).status, 'NO_PENDING_MUTATION');
  assert.equal(reopened.verifyChain(installation, account).valid, true);
});
