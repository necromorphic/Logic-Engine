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
