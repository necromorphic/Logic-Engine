import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { HostLifecycleReceiptStore } from '../server-plugin/st-host-lifecycle-receipt-store.mjs';
import { createHostMutationRuntimeAcceptanceVerifier } from '../server-plugin/st-host-mutation-runtime-acceptance.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);
const HOST_COMMIT = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';
const INSTALL = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const CONVERSATION = '44444444-4444-4444-8444-444444444444';
const OPERATIONS = [
  'create-message', 'message-send', 'message-receive', 'create-swipe',
  'select-swipe', 'delete-swipe', 'delete-message', 'edit-message', 'rename-chat',
];
const uuid = index => `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`;
const rootId = root => sha(Buffer.from(path.resolve(root), 'utf8'));

async function writeEvidence(directory, { omitOperation = null, omitRecovery = false, corrupt = false } = {}) {
  const currentProcessStartedAtMs = Math.max(0, Math.floor(Date.now() - process.uptime() * 1000));
  const priorProcessStartedAtMs = currentProcessStartedAtMs - 60000;
  for (const [index, operation] of OPERATIONS.entries()) {
    if (operation === omitOperation) continue;
    const scope = {
      host_installation_id: INSTALL,
      authenticated_account_id: ACCOUNT,
      host_session_id: SESSION,
      conversation_uuid: CONVERSATION,
      mutation_id: uuid(index + 1),
    };
    const key = sha(Buffer.from(canonical(scope), 'utf8'));
    const beforeProof = {
      host_commit: HOST_COMMIT, snapshot_id: uuid(index + 20),
      snapshot_sha256: sha('before-' + operation), source_snapshot_id: uuid(index + 20),
      source_inventory_sha256: sha('source-before-' + operation), snapshot_alignment: 'SHARED_VSS_SNAPSHOT',
    };
    const afterProof = {
      host_commit: HOST_COMMIT, snapshot_id: uuid(index + 40),
      snapshot_sha256: sha('after-' + operation), source_snapshot_id: uuid(index + 40),
      source_inventory_sha256: sha('source-after-' + operation), snapshot_alignment: 'SHARED_VSS_SNAPSHOT',
    };
    const prepared = {
      schema_version: 1, evidence_schema_version: 2, process_started_at_ms: priorProcessStartedAtMs, ...scope,
      event_id: uuid(index + 60), operation, mutation_digest: sha('mutation-' + operation),
      before: { snapshot_proof: beforeProof },
    };
    const receipt = {
      protocol_version: 2, host_commit: HOST_COMMIT,
      before_snapshot_proof: beforeProof, after_snapshot_proof: afterProof,
      recovery_verified: !omitRecovery && index === 0, ...scope,
      event_id: uuid(index + 80), operation, mutation_digest: prepared.mutation_digest,
    };
    const terminal = {
      schema_version: 1, evidence_schema_version: 2, event_type: 'MUTATION_COMMITTED',
      event_id: receipt.event_id, receipt, receipt_digest: sha(Buffer.from(canonical(receipt), 'utf8')),
    };
    if (corrupt && index === 0) terminal.receipt_digest = '0'.repeat(64);
    await writeFile(path.join(directory, key + '.prepared.json'), canonical(prepared));
    await writeFile(path.join(directory, key + '.terminal.json'), canonical(terminal));
  }
}

function makeInputs(root) {
  const entries = [{ path: 'chats/chat.json', sha256: sha('chat') }];
  return {
    pinnedHostCommit: HOST_COMMIT, rootPath: root, rootId: rootId(root), entries,
    snapshotAlignment: 'SHARED_VSS_SNAPSHOT',
    snapshotId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    snapshotSha256: sha(Buffer.from(JSON.stringify(entries), 'utf8')),
    hostInstallationId: INSTALL, authenticatedAccountId: ACCOUNT,
    sourceIdentity: { status: 'CURRENT_IDENTITIES_VERIFIED', manifest_sha256: sha('source-manifest') },
    mutationCoverage: {
      status: 'VERIFIED', source_commit: HOST_COMMIT,
      coverage_manifest_sha256: sha('coverage'), source_files_sha256: sha('source-files'), route_count: 92,
    },
  };
}

async function fixture(t, options) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'host-runtime-acceptance-'));
  const directory = path.join(root, 'receipts');
  await mkdir(directory);
  await writeEvidence(directory, options);
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, store: new HostLifecycleReceiptStore({ directory, hostCommit: HOST_COMMIT }) };
}

test('runtime verifier accepts a complete schema-v2 receipt ledger fixture', async t => {
  const { root, store } = await fixture(t, {});
  const result = await createHostMutationRuntimeAcceptanceVerifier({ receiptStore: store })(makeInputs(root));
  assert.equal(result.status, 'VERIFIED');
  assert.equal(result.source_commit, HOST_COMMIT);
  assert.equal(result.snapshot_id, makeInputs(root).snapshotId);
  assert.match(result.evidence_sha256, /^[a-f0-9]{64}$/);
});

test('runtime verifier rejects receipts created by the current server process', async t => {
  const { root, store } = await fixture(t, {});
  const inputs = makeInputs(root);
  const currentProcessStartedAtMs = Math.max(0, Math.floor(Date.now() - process.uptime() * 1000)) - 60000;
  const result = await store.verifyRuntimeAcceptance({
    pinnedHostCommit: inputs.pinnedHostCommit,
    rootPath: inputs.rootPath,
    rootId: inputs.rootId,
    entries: inputs.entries,
    snapshotAlignment: inputs.snapshotAlignment,
    snapshotId: inputs.snapshotId,
    snapshotSha256: inputs.snapshotSha256,
    sourceIdentity: inputs.sourceIdentity,
    mutationCoverage: inputs.mutationCoverage,
    hostInstallationId: inputs.hostInstallationId,
    authenticatedAccountId: inputs.authenticatedAccountId,
    currentProcessStartedAtMs,
  });
  assert.equal(result.status, 'NON_READY');
  assert.equal(result.reason, 'HOST_MUTATION_RUNTIME_ACCEPTANCE_PREPARED_EVIDENCE_INVALID');
});

test('runtime verifier reports missing native lifecycle operation coverage', async t => {
  const { root, store } = await fixture(t, { omitOperation: 'delete-swipe' });
  const result = await createHostMutationRuntimeAcceptanceVerifier({ receiptStore: store })(makeInputs(root));
  assert.equal(result.status, 'NON_READY');
  assert.equal(result.reason, 'HOST_MUTATION_RUNTIME_ACCEPTANCE_OPERATION_COVERAGE_INCOMPLETE');
  assert.deepEqual(result.missing_operations, ['delete-swipe']);
});

test('runtime verifier rejects corrupt terminal receipt digest', async t => {
  const { root, store } = await fixture(t, { corrupt: true });
  const result = await createHostMutationRuntimeAcceptanceVerifier({ receiptStore: store })(makeInputs(root));
  assert.equal(result.status, 'NON_READY');
  assert.equal(result.reason, 'HOST_MUTATION_RUNTIME_ACCEPTANCE_TERMINAL_INVALID');
});

test('runtime verifier rejects a ledger without a recovery marker', async t => {
  const { root, store } = await fixture(t, { omitRecovery: true });
  const result = await createHostMutationRuntimeAcceptanceVerifier({ receiptStore: store })(makeInputs(root));
  assert.equal(result.status, 'NON_READY');
  assert.equal(result.reason, 'HOST_MUTATION_RUNTIME_ACCEPTANCE_RESTART_RECOVERY_UNPROVEN');
});

test('runtime verifier rejects double-scan candidates and unpinned source identity', async t => {
  const { root, store } = await fixture(t, {});
  const verifier = createHostMutationRuntimeAcceptanceVerifier({ receiptStore: store });
  const badSnapshot = await verifier({ ...makeInputs(root), snapshotAlignment: 'INDEPENDENT_DOUBLE_SCAN' });
  assert.equal(badSnapshot.status, 'NON_READY');
  assert.equal(badSnapshot.reason, 'HOST_MUTATION_RUNTIME_ACCEPTANCE_INPUT_INVALID');
  const badSource = await verifier({
    ...makeInputs(root),
    mutationCoverage: { ...makeInputs(root).mutationCoverage, source_commit: 'f'.repeat(40) },
  });
  assert.equal(badSource.status, 'NON_READY');
  assert.equal(badSource.reason, 'HOST_MUTATION_RUNTIME_ACCEPTANCE_INPUT_INVALID');
});

test('receipt store records real before/after files and a recover()-completed mutation', async t => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'host-runtime-store-'));
  const root = path.join(base, 'st-data');
  const chats = path.join(root, 'chats');
  const groups = path.join(root, 'groups');
  const groupChats = path.join(root, 'groupChats');
  const receiptDirectory = path.join(base, 'host-receipts');
  await Promise.all([mkdir(chats, { recursive: true }), mkdir(groups), mkdir(groupChats)]);
  await mkdir(receiptDirectory);
  const chatPath = path.join(chats, 'conversation.json');
  let messages = [];
  let snapshotCounter = 100;
  const writeChat = () => writeFile(chatPath, JSON.stringify({ messages }));
  await writeChat();
  const directories = { root, chats, groups, groupChats };
  const enumerate = async () => {
    const bytes = await readFile(chatPath);
    const info = await stat(chatPath);
    const fileIdentity = String(info.dev) + ':' + String(info.ino);
    const snapshotId = uuid(snapshotCounter++);
    const entries = [{
      path: 'chats/conversation.json',
      identity: { dev: String(info.dev), ino: String(info.ino) },
      sha256: sha(bytes),
    }];
    const logicalIdentity = {
      conversation_uuid: CONVERSATION,
      identity_status: 'CURRENT_IDENTITIES_VERIFIED',
      missing_message_identity_count: 0,
      messages,
    };
    const sourceFiles = [{
      kind: 'root-chat',
      locator: 'conversation.json',
      content_sha256: sha(bytes),
      file_identity: fileIdentity,
      logical_identity: logicalIdentity,
    }];
    return {
      filesystem: {
        status: 'complete',
        entries,
        snapshot_id: snapshotId,
        snapshot_sha256: sha(Buffer.from(JSON.stringify(entries), 'utf8')),
      },
      source: {
        status: 'DOUBLE_SCAN_CANDIDATE',
        host_commit: HOST_COMMIT,
        snapshot_id: snapshotId,
        inventory_sha256: sha(Buffer.from(canonical(sourceFiles), 'utf8')),
        files: sourceFiles,
      },
      snapshot_alignment: 'SHARED_VSS_SNAPSHOT',
    };
  };
  const store = new HostLifecycleReceiptStore({
    directory: receiptDirectory,
    enumerate,
    hostCommit: HOST_COMMIT,
  });
  const firstScope = {
    host_installation_id: INSTALL,
    authenticated_account_id: ACCOUNT,
    host_session_id: SESSION,
    conversation_uuid: CONVERSATION,
    mutation_id: uuid(101),
    event_id: uuid(102),
    operation: 'create-message',
    mutation_digest: sha('create-message-real-file'),
    occurred_at: new Date().toISOString(),
  };
  await store.prepare(firstScope, directories);
  messages = [{
    message_id: uuid(103),
    active_version_index: 0,
    versions: [{
      version_id: uuid(104), version_index: 0, parent_version_id: null,
      content_sha256: sha('first message'), active: true,
    }],
  }];
  await writeChat();
  await store.commit({ ...firstScope, event_id: uuid(105) }, directories);

  const recoveryScope = {
    ...firstScope,
    mutation_id: uuid(106),
    event_id: uuid(107),
    operation: 'message-send',
    mutation_digest: sha('message-send-recovered'),
    occurred_at: new Date().toISOString(),
  };
  await store.prepare(recoveryScope, directories);
  messages = [...messages, {
    message_id: uuid(108),
    active_version_index: 0,
    versions: [{
      version_id: uuid(109), version_index: 0, parent_version_id: null,
      content_sha256: sha('second message'), active: true,
    }],
  }];
  await writeChat();
  const recovered = await store.recover({
    ...recoveryScope,
    prepared_event_id: recoveryScope.event_id,
    event_id: uuid(110),
    occurred_at: new Date().toISOString(),
  }, directories);
  assert.equal(recovered.status, 'COMMITTED');

  const keyFor = scope => sha(Buffer.from(canonical({
    host_installation_id: scope.host_installation_id,
    authenticated_account_id: scope.authenticated_account_id,
    host_session_id: scope.host_session_id,
    conversation_uuid: scope.conversation_uuid,
    mutation_id: scope.mutation_id,
  }), 'utf8'));
  const firstTerminal = JSON.parse(await readFile(path.join(receiptDirectory, keyFor(firstScope) + '.terminal.json'), 'utf8'));
  const recoveredTerminal = JSON.parse(await readFile(path.join(receiptDirectory, keyFor(recoveryScope) + '.terminal.json'), 'utf8'));
  assert.equal(firstTerminal.evidence_schema_version, 2);
  assert.equal(firstTerminal.receipt.protocol_version, 2);
  assert.equal(firstTerminal.receipt.before_snapshot_proof.snapshot_alignment, 'SHARED_VSS_SNAPSHOT');
  assert.equal(firstTerminal.receipt.after_snapshot_proof.snapshot_alignment, 'SHARED_VSS_SNAPSHOT');
  assert.notEqual(firstTerminal.receipt.before_snapshot_proof.snapshot_id, firstTerminal.receipt.after_snapshot_proof.snapshot_id);
  assert.equal(recoveredTerminal.receipt.recovery_verified, true);
  assert.match(recoveredTerminal.receipt_digest, /^[a-f0-9]{64}$/);
  t.after(() => rm(base, { recursive: true, force: true }));
});
