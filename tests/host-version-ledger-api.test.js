import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { HostVersionDigestLedger } from '../src/application/host-version-digest-ledger.js';
import { HostLifecycleJournal } from '../src/application/host-lifecycle-journal.js';
import { createApiServer } from '../src/api/server.js';

const TOKEN = 'test-token-long-enough-123456';
const ADMIN = 'admin-token-long-enough-123456';
const ADAPTER = 'adapter-a-token-long-enough-123456';
const OTHER_ADAPTER = 'adapter-b-token-long-enough-123456';
const HOST_SESSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const HOST_AUTHORITY = { authority_id: 'api-test-host-authority', generation: 3, snapshot_fingerprint: 'c'.repeat(64) };
const headers = { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' };
const json = (body) => JSON.stringify(body);
const canonical = value => Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);
function lifecycleReceiptSignature(event, adapterId = 'adapter-a') {
  const proof = {
    protocol_version: 1,
    adapter_id: adapterId,
    host_installation_id: event.host_installation_id,
    authenticated_account_id: event.authenticated_account_id,
    host_session_id: event.host_session_id,
    conversation_uuid: event.conversation_uuid,
    event_id: event.event_id,
    event_type: event.event_type,
    mutation_id: event.mutation_id,
    operation: event.operation,
    mutation_digest: event.mutation_digest,
    receipt_digest: event.receipt_digest,
    occurred_at: event.occurred_at,
  };
  return createHmac('sha256', ADAPTER).update(canonical(proof), 'utf8').digest('hex');
}

async function setup(t, {
  withLedger = true,
  verifyInventorySnapshot = async () => false,
  sharedCoordinator = false,
  withRootJournal = false,
  authorizeRootIdentity = () => true,
  authorizeLifecycleIdentity = () => true,
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'logic-host-ledger-api-'));
  const coordinatorPath = join(directory, 'coordinator.sqlite');
  const previousCoordinatorPath = process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH;
  if (sharedCoordinator) process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH = coordinatorPath;
  let store;
  try {
    store = new SQLiteStore(sharedCoordinator ? join(directory, 'core.sqlite') : ':memory:');
  } finally {
    if (previousCoordinatorPath === undefined) delete process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH;
    else process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH = previousCoordinatorPath;
  }
  const engine = new LogicEngine(store);
  engine.createWorld({
    world_id: 'host-ledger-api-world', world_pack_id: 'test.host-ledger', world_pack_version: '1',
    game_time: '2026-01-01T00:00:00Z',
  });
  const ledger = withLedger ? new HostVersionDigestLedger({
    path: join(directory, 'ledger.sqlite'),
    coordinatorPath,
    verifyInventorySnapshot,
  }) : null;
  const rootJournal = withRootJournal ? new HostLifecycleJournal({
    path: join(directory, 'host-root-inventory.sqlite'),
    coordinatorPath,
    verifyMutationReceipt: ({ event, identity }) => event.receipt_signature === lifecycleReceiptSignature(event, identity.adapter_id),
    resolveIdentity: input => ({
      authorized: true,
      host_installation_id: input.host_installation_id,
      authenticated_account_id: input.authenticated_account_id,
      host_session_id: input.host_session_id,
      conversation_uuid: input.conversation_uuid,
      adapter_id: 'adapter-a',
      root_id: createHash('sha256').update('canonical-host-data-root').digest('hex'),
      ...HOST_AUTHORITY,
    }),
    resolveRootIdentity: input => ({
      authorized: authorizeRootIdentity(input) === true,
      host_installation_id: input.host_installation_id,
      authenticated_account_id: input.authenticated_account_id,
      root_id: input.root_id,
    }),
  }) : null;
  const server = createApiServer({
    engine, token: TOKEN, adminToken: ADMIN,
    adapterTokens: { 'adapter-a': ADAPTER, 'adapter-b': OTHER_ADAPTER },
    hostVersionLedger: ledger,
    hostRootInventoryJournal: rootJournal,
    resolveHostRootIdentity: withRootJournal ? input => ({
      authorized: input.adapterId === 'adapter-a' && authorizeRootIdentity(input) === true,
      host_installation_id: input.host_installation_id,
      authenticated_account_id: input.authenticated_account_id,
      root_id: input.root_id,
    }) : null,
    hostLifecycleJournal: rootJournal,
    resolveHostLifecycleIdentity: withRootJournal ? input => ({
      authorized: input.adapterId === 'adapter-a' && authorizeLifecycleIdentity(input) === true,
      host_installation_id: input.host_installation_id,
      authenticated_account_id: input.authenticated_account_id,
      host_session_id: input.host_session_id,
      conversation_uuid: input.conversation_uuid,
      adapter_id: input.adapterId,
      root_id: createHash('sha256').update('canonical-host-data-root').digest('hex'),
      ...HOST_AUTHORITY,
    }) : null,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    ledger?.close();
    rootJournal?.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { base: 'http://127.0.0.1:' + server.address().port, ledger, rootJournal };
}

async function bind(base, adapterId = 'adapter-a') {
  return fetch(base + '/v1/host-conversation-bindings', {
    method: 'POST', headers: { ...headers, 'x-admin-token': ADMIN },
    body: json({ adapter_id: adapterId, conversation_id: 'stable-host-chat', world_id: 'host-ledger-api-world' }),
  });
}

const rootInventoryBody = (overrides = {}) => ({
  host_installation_id: '11111111-1111-4111-8111-111111111111',
  authenticated_account_id: '22222222-2222-4222-8222-222222222222',
  root_id: createHash('sha256').update('canonical-host-data-root').digest('hex'),
  event_id: 'root-baseline-event',
  entries: [{
    path: 'chats/main.jsonl',
    identity: { dev: '1', ino: '2', mode: 33188, size: 64, mtimeMs: 1, ctimeMs: 1 },
    sha256: createHash('sha256').update('baseline').digest('hex'),
  }],
  ...overrides,
});

test('root inventory API persists adapter-bound baselines and file deltas as review-only evidence', async (t) => {
  const unavailable = await setup(t);
  const unavailableResponse = await fetch(unavailable.base + '/v1/host-root-inventory/baseline', {
    method: 'POST', headers, body: json(rootInventoryBody()),
  });
  assert.equal(unavailableResponse.status, 503);
  assert.equal((await unavailableResponse.json()).error.code, 'HOST_ROOT_INVENTORY_UNAVAILABLE');

  const unauthorized = await setup(t, { withRootJournal: true, authorizeRootIdentity: () => false });
  const unauthorizedResponse = await fetch(unauthorized.base + '/v1/host-root-inventory/baseline', {
    method: 'POST',
    headers: { ...headers, 'x-adapter-id': 'adapter-a', 'x-adapter-token': ADAPTER },
    body: json(rootInventoryBody()),
  });
  assert.equal(unauthorizedResponse.status, 403);
  assert.equal((await unauthorizedResponse.json()).error.code, 'HOST_ROOT_INVENTORY_NOT_AUTHORIZED');

  const { base, rootJournal } = await setup(t, { withRootJournal: true });
  const adapterHeaders = { ...headers, 'x-adapter-id': 'adapter-a', 'x-adapter-token': ADAPTER };
  const noAdapter = await fetch(base + '/v1/host-root-inventory/baseline', {
    method: 'POST', headers, body: json(rootInventoryBody()),
  });
  assert.equal(noAdapter.status, 403);
  assert.equal((await noAdapter.json()).error.code, 'ADAPTER_REQUIRED');

  const baselineInput = rootInventoryBody();
  const baseline = await fetch(base + '/v1/host-root-inventory/baseline', {
    method: 'POST', headers: adapterHeaders, body: json(baselineInput),
  });
  assert.equal(baseline.status, 200);
  const baselineResult = await baseline.json();
  assert.equal(baselineResult.inventory_status, 'REVIEW_ONLY');
  assert.equal(baselineResult.reconciliation.status, 'BASELINED_REVIEW_ONLY');
  assert.equal(baselineResult.reconciliation.integrity_status, 'INTEGRITY_OK');
  assert.equal(rootJournal.verifyRootInventory(baselineInput).status, 'INTEGRITY_OK');

  const changedInput = rootInventoryBody({
    event_id: 'root-delta-event',
    entries: [{
      path: 'chats/main.jsonl',
      identity: { dev: '1', ino: '2', mode: 33188, size: 64, mtimeMs: 2, ctimeMs: 2 },
      sha256: createHash('sha256').update('edited').digest('hex'),
    }],
  });
  const changed = await fetch(base + '/v1/host-root-inventory/observe', {
    method: 'POST', headers: adapterHeaders, body: json(changedInput),
  });
  assert.equal(changed.status, 409);
  const changedResult = await changed.json();
  assert.equal(changedResult.inventory_status, 'NON_READY');
  assert.equal(changedResult.reconciliation.integrity_status, 'INTEGRITY_OK');
  assert.deepEqual(changedResult.reconciliation.counts, {
    added: 0, removed: 0, modified: 1, metadata_changed: 0, replaced: 0, moved: 0,
  });
  assert.equal(rootJournal.verifyRootInventory(changedInput).status, 'INTEGRITY_OK');

  const replay = await fetch(base + '/v1/host-root-inventory/observe', {
    method: 'POST', headers: adapterHeaders, body: json(changedInput),
  });
  assert.equal(replay.status, 409);
  assert.equal((await replay.json()).reconciliation.duplicate, true);

  const conflict = await fetch(base + '/v1/host-root-inventory/observe', {
    method: 'POST', headers: adapterHeaders,
    body: json({ ...changedInput, entries: [{ ...changedInput.entries[0], sha256: 'f'.repeat(64) }] }),
  });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, 'HOST_ROOT_INVENTORY_EVENT_ID_CONFLICT');

  const rawContent = await fetch(base + '/v1/host-root-inventory/observe', {
    method: 'POST', headers: adapterHeaders,
    body: json({ ...changedInput, content: 'raw chat text' }),
  });
  assert.equal(rawContent.status, 400);
  assert.equal((await rawContent.json()).error.code, 'INVALID_HOST_ROOT_INVENTORY');
});

test('digest-only Host capture requires configured ledger, authenticated adapter and canonical Core binding', async (t) => {
  const unavailable = await setup(t, { withLedger: false });
  const unavailableResponse = await fetch(unavailable.base + '/v1/host-version-ledger/capture', {
    method: 'POST', headers: { ...headers, 'x-adapter-id': 'adapter-a', 'x-adapter-token': ADAPTER },
    body: json({ conversation_id: 'stable-host-chat', message_id: 'message-1', version_id: 'version-1', parent_version_id: null, content_sha256: 'a'.repeat(64), active: true, deleted: false }),
  });
  assert.equal(unavailableResponse.status, 503);
  assert.equal((await unavailableResponse.json()).error.code, 'HOST_VERSION_LEDGER_UNAVAILABLE');

  const { base } = await setup(t);
  const noAdapter = await fetch(base + '/v1/host-version-ledger/capture', {
    method: 'POST', headers, body: json({ conversation_id: 'stable-host-chat', message_id: 'message-1', version_id: 'version-1', parent_version_id: null, content_sha256: 'a'.repeat(64), active: true, deleted: false }),
  });
  assert.equal(noAdapter.status, 403);
  assert.equal((await noAdapter.json()).error.code, 'ADAPTER_REQUIRED');

  const unbound = await fetch(base + '/v1/host-version-ledger/capture', {
    method: 'POST', headers: { ...headers, 'x-adapter-id': 'adapter-a', 'x-adapter-token': ADAPTER },
    body: json({ conversation_id: 'stable-host-chat', message_id: 'message-1', version_id: 'version-1', parent_version_id: null, content_sha256: 'a'.repeat(64), active: true, deleted: false }),
  });
  assert.equal(unbound.status, 403);
  assert.equal((await unbound.json()).error.code, 'HOST_CONVERSATION_NOT_AUTHORIZED');

  assert.equal((await bind(base)).status, 201);
  const wrongAdapter = await fetch(base + '/v1/host-version-ledger/capture', {
    method: 'POST', headers: { ...headers, 'x-adapter-id': 'adapter-b', 'x-adapter-token': OTHER_ADAPTER },
    body: json({ conversation_id: 'stable-host-chat', message_id: 'message-1', version_id: 'version-1', parent_version_id: null, content_sha256: 'a'.repeat(64), active: true, deleted: false }),
  });
  assert.equal(wrongAdapter.status, 403);
  assert.equal((await wrongAdapter.json()).error.code, 'HOST_CONVERSATION_NOT_AUTHORIZED');
});

test('digest-only Host capture forbids caller world and raw text, then records only a bound digest', async (t) => {
  const { base, ledger } = await setup(t);
  assert.equal((await bind(base)).status, 201);
  const adapterHeaders = { ...headers, 'x-adapter-id': 'adapter-a', 'x-adapter-token': ADAPTER };
  const forbidden = await fetch(base + '/v1/host-version-ledger/capture', {
    method: 'POST', headers: adapterHeaders,
    body: json({ world_id: 'attacker-world', conversation_id: 'stable-host-chat', message_id: 'message-1', version_id: 'version-1', parent_version_id: null, content_sha256: 'a'.repeat(64), content: 'raw Host text', active: true, deleted: false }),
  });
  assert.equal(forbidden.status, 400);
  assert.equal((await forbidden.json()).error.code, 'INVALID_HOST_VERSION_CAPTURE');

  const captured = await fetch(base + '/v1/host-version-ledger/capture', {
    method: 'POST', headers: adapterHeaders,
    body: json({ conversation_id: 'stable-host-chat', message_id: 'message-1', version_id: 'version-1', parent_version_id: null, content_sha256: 'a'.repeat(64), active: true, deleted: false }),
  });
  assert.equal(captured.status, 201);
  assert.equal((await captured.json()).capture.status, 'captured');
  const stored = ledger.db.prepare('SELECT world_id,conversation_id,message_id,version_id,parent_version_id,content_sha256 FROM host_version_digest_ledger').all()
    .map((row) => ({ ...row }));
  assert.equal(stored.length, 1);
  assert.deepEqual({ ...stored[0] }, {
    world_id: 'host-ledger-api-world', conversation_id: 'stable-host-chat', message_id: 'message-1',
    version_id: 'version-1', parent_version_id: null, content_sha256: 'a'.repeat(64),
  });
  assert.equal(ledger.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='raw_host_text'").get(), undefined);
});

test('digest conflict is surfaced as 409 and cannot be hidden by the HTTP layer', async (t) => {
  const { base, ledger } = await setup(t);
  assert.equal((await bind(base)).status, 201);
  const adapterHeaders = { ...headers, 'x-adapter-id': 'adapter-a', 'x-adapter-token': ADAPTER };
  const capture = (sha) => fetch(base + '/v1/host-version-ledger/capture', {
    method: 'POST', headers: adapterHeaders,
    body: json({ conversation_id: 'stable-host-chat', message_id: 'message-1', version_id: 'version-1', parent_version_id: null, content_sha256: sha, active: true, deleted: false }),
  });
  assert.equal((await capture('a'.repeat(64))).status, 201);
  const conflict = await capture('b'.repeat(64));
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).inventory_status, 'NON_READY');
  assert.equal(ledger.getInventoryState('host-ledger-api-world', 'stable-host-chat').status, 'NON_READY');
  assert.equal(ledger.db.prepare('SELECT version_id FROM host_version_active_pointer').get().version_id, 'version-1');
});


test('complete Host inventory reconciliation is adapter-bound and never accepts caller world scope or raw text', async (t) => {
  const unavailable = await setup(t, { withLedger: false });
  const unavailableResponse = await fetch(unavailable.base + '/v1/host-version-ledger/reconcile', {
    method: 'POST',
    headers: { ...headers, 'x-adapter-id': 'adapter-a', 'x-adapter-token': ADAPTER },
    body: json({ conversation_id: 'stable-host-chat', complete: true, versions: [] }),
  });
  assert.equal(unavailableResponse.status, 503);
  assert.equal((await unavailableResponse.json()).error.code, 'HOST_VERSION_LEDGER_UNAVAILABLE');

  const { base, ledger } = await setup(t);
  const adapterHeaders = { ...headers, 'x-adapter-id': 'adapter-a', 'x-adapter-token': ADAPTER };
  const noAdapter = await fetch(base + '/v1/host-version-ledger/reconcile', {
    method: 'POST', headers, body: json({ conversation_id: 'stable-host-chat', complete: true, versions: [] }),
  });
  assert.equal(noAdapter.status, 403);
  assert.equal((await noAdapter.json()).error.code, 'ADAPTER_REQUIRED');

  const unbound = await fetch(base + '/v1/host-version-ledger/reconcile', {
    method: 'POST', headers: adapterHeaders,
    body: json({ conversation_id: 'stable-host-chat', complete: true, versions: [] }),
  });
  assert.equal(unbound.status, 403);
  assert.equal((await unbound.json()).error.code, 'HOST_CONVERSATION_NOT_AUTHORIZED');

  assert.equal((await bind(base)).status, 201);
  const callerWorld = await fetch(base + '/v1/host-version-ledger/reconcile', {
    method: 'POST', headers: adapterHeaders,
    body: json({ world_id: 'attacker-world', conversation_id: 'stable-host-chat', complete: true, versions: [] }),
  });
  assert.equal(callerWorld.status, 400);
  assert.equal((await callerWorld.json()).error.code, 'INVALID_HOST_INVENTORY_RECONCILIATION');

  const rawText = await fetch(base + '/v1/host-version-ledger/reconcile', {
    method: 'POST', headers: adapterHeaders,
    body: json({
      conversation_id: 'stable-host-chat', complete: true,
      versions: [{
        message_id: 'message-1', version_id: 'version-1', parent_version_id: null,
        content_sha256: 'a'.repeat(64), active: true, deleted: false, content: 'raw message text',
      }],
    }),
  });
  assert.equal(rawText.status, 400);
  assert.equal((await rawText.json()).error.code, 'INVALID_HOST_INVENTORY_RECONCILIATION');

  const denied = await fetch(base + '/v1/host-version-ledger/reconcile', {
    method: 'POST', headers: adapterHeaders,
    body: json({ conversation_id: 'stable-host-chat', complete: true, versions: [] }),
  });
  assert.equal(denied.status, 409);
  assert.deepEqual((await denied.json()).reconciliation, {
    status: 'non_ready', code: 'HOST_INVENTORY_NOT_AUTHORIZED',
  });
  assert.equal(ledger.getInventoryState('host-ledger-api-world', 'stable-host-chat'), null);
});

test('complete Host inventory reconciliation publishes READY only with a trusted verifier and a still-active Core binding', async (t) => {
  const { base, ledger } = await setup(t, { verifyInventorySnapshot: async () => true });
  assert.equal((await bind(base)).status, 201);
  const adapterHeaders = { ...headers, 'x-adapter-id': 'adapter-a', 'x-adapter-token': ADAPTER };
  const response = await fetch(base + '/v1/host-version-ledger/reconcile', {
    method: 'POST',
    headers: adapterHeaders,
    body: json({
      conversation_id: 'stable-host-chat',
      complete: true,
      versions: [{
        message_id: 'message-1', version_id: 'version-1', parent_version_id: null,
        content_sha256: 'a'.repeat(64), active: true, deleted: false,
      }],
    }),
  });
  assert.equal(response.status, 200);
  const reconciliation = (await response.json()).reconciliation;
  assert.equal(reconciliation.status, 'ready');
  assert.equal(reconciliation.version_count, 1);
  assert.match(reconciliation.snapshot_sha256, /^[a-f0-9]{64}$/);
  const readyState = ledger.getInventoryState('host-ledger-api-world', 'stable-host-chat');
  assert.equal(readyState.status, 'READY');
  assert.equal(readyState.snapshot_digest, reconciliation.snapshot_sha256);

  const revoked = await fetch(base + '/v1/host-conversation-bindings/adapter-a/stable-host-chat', {
    method: 'DELETE',
    headers: { ...headers, 'x-admin-token': ADMIN },
    body: json({ reason: 'Revoke reconciled Host inventory test' }),
  });
  assert.equal(revoked.status, 200);
  const invalidated = ledger.getInventoryState('host-ledger-api-world', 'stable-host-chat');
  assert.equal(invalidated.status, 'NON_READY');
  assert.equal(invalidated.failure_code, 'HOST_CONVERSATION_REVOKED');

  const resolveAfterRevoke = await fetch(base + '/v1/host-conversation-bindings/resolve', {
    method: 'POST',
    headers: { ...headers, 'x-adapter-id': 'adapter-a', 'x-adapter-token': ADAPTER },
    body: json({ conversation_id: 'stable-host-chat' }),
  });
  assert.equal(resolveAfterRevoke.status, 403);
});
 
test('binding revocation that wins during async inventory verification blocks READY publication', async (t) => {
  let signalEntered;
  let releaseVerification;
  const entered = new Promise((resolve) => { signalEntered = resolve; });
  const verificationGate = new Promise((resolve) => { releaseVerification = resolve; });
  const { base, ledger } = await setup(t, {
    sharedCoordinator: true,
    verifyInventorySnapshot: async () => {
      signalEntered();
      await verificationGate;
      return true;
    },
  });
  assert.equal((await bind(base)).status, 201);
  const adapterHeaders = { ...headers, 'x-adapter-id': 'adapter-a', 'x-adapter-token': ADAPTER };
  const reconciliationPromise = fetch(base + '/v1/host-version-ledger/reconcile', {
    method: 'POST',
    headers: adapterHeaders,
    body: json({
      conversation_id: 'stable-host-chat',
      complete: true,
      versions: [{
        message_id: 'message-1', version_id: 'version-1', parent_version_id: null,
        content_sha256: 'a'.repeat(64), active: true, deleted: false,
      }],
    }),
  });
  await entered;

  const revoked = await fetch(base + '/v1/host-conversation-bindings/adapter-a/stable-host-chat', {
    method: 'DELETE',
    headers: { ...headers, 'x-admin-token': ADMIN },
    body: json({ reason: 'Host inventory reconciliation race test' }),
  });
  assert.equal(revoked.status, 200);
  releaseVerification();

  const response = await reconciliationPromise;
  assert.equal(response.status, 409);
  assert.deepEqual((await response.json()).reconciliation, {
    status: 'non_ready', code: 'HOST_CONVERSATION_NOT_AUTHORIZED',
  });
  assert.equal(ledger.getInventoryState('host-ledger-api-world', 'stable-host-chat').status, 'NON_READY');
});


test('complete Host inventory reconciliation enforces request-byte and version-count bounds', async (t) => {
  const { base } = await setup(t);
  assert.equal((await bind(base)).status, 201);
  const adapterHeaders = { ...headers, 'x-adapter-id': 'adapter-a', 'x-adapter-token': ADAPTER };

  const tooManyVersions = Array.from({ length: 25001 }, (_, index) => ({
    message_id: 'message-' + index,
    version_id: 'version-' + index,
    parent_version_id: null,
    content_sha256: 'a'.repeat(64),
    active: false,
    deleted: true,
  }));
  const countResponse = await fetch(base + '/v1/host-version-ledger/reconcile', {
    method: 'POST',
    headers: adapterHeaders,
    body: json({ conversation_id: 'stable-host-chat', complete: true, versions: tooManyVersions }),
  });
  assert.equal(countResponse.status, 413);
  assert.equal((await countResponse.json()).error.code, 'HOST_INVENTORY_TOO_LARGE');

  const oversizedBody = JSON.stringify({
    conversation_id: 'stable-host-chat',
    complete: true,
    versions: [],
    padding: 'x'.repeat(8 * 1024 * 1024),
  });
  const byteResponse = await fetch(base + '/v1/host-version-ledger/reconcile', {
    method: 'POST',
    headers: adapterHeaders,
    body: oversizedBody,
  });
  assert.equal(byteResponse.status, 413);
  assert.equal((await byteResponse.json()).error.code, 'BODY_TOO_LARGE');
});


test('bound incomplete API snapshot invalidates prior READY before verifier invocation', async (t) => {
  let verifierCalls = 0;
  const { base, ledger } = await setup(t, {
    verifyInventorySnapshot: async () => { verifierCalls += 1; return true; },
  });
  assert.equal((await bind(base)).status, 201);
  const adapterHeaders = { ...headers, 'x-adapter-id': 'adapter-a', 'x-adapter-token': ADAPTER };
  const complete = await fetch(base + '/v1/host-version-ledger/reconcile', {
    method: 'POST',
    headers: adapterHeaders,
    body: json({
      conversation_id: 'stable-host-chat',
      complete: true,
      versions: [{
        message_id: 'message-1', version_id: 'version-1', parent_version_id: null,
        content_sha256: 'a'.repeat(64), active: true, deleted: false,
      }],
    }),
  });
  assert.equal(complete.status, 200);
  assert.equal(verifierCalls, 1);
  const readyBefore = ledger.getInventoryState('host-ledger-api-world', 'stable-host-chat');
  assert.equal(readyBefore.status, 'READY');

  const incomplete = await fetch(base + '/v1/host-version-ledger/reconcile', {
    method: 'POST',
    headers: adapterHeaders,
    body: json({ conversation_id: 'stable-host-chat', complete: false, versions: [] }),
  });
  assert.equal(incomplete.status, 409);
  assert.deepEqual((await incomplete.json()).reconciliation, {
    status: 'non_ready', code: 'HOST_INVENTORY_INCOMPLETE',
  });
  assert.equal(verifierCalls, 1, 'incomplete inventory must never reach the trusted verifier');
  const afterIncomplete = ledger.getInventoryState('host-ledger-api-world', 'stable-host-chat');
  assert.equal(afterIncomplete.status, 'NON_READY');
  assert.equal(afterIncomplete.failure_code, 'HOST_INVENTORY_INCOMPLETE');
  assert.notEqual(afterIncomplete.updated_at, readyBefore.updated_at);
});


test('Core lifecycle API durably accepts authenticated prepare/commit receipts and exposes restart-safe pending state', async (t) => {
  const { base, rootJournal } = await setup(t, { withRootJournal: true });
  rootJournal.enrollRootInventory({ ...rootInventoryBody(), event_id: 'api-lifecycle-root-baseline' });
  HOST_AUTHORITY.snapshot_fingerprint = rootJournal.getAuthoritySnapshot({
    authority_id: HOST_AUTHORITY.authority_id,
    generation: HOST_AUTHORITY.generation,
    adapter_id: 'adapter-a',
    host_installation_id: rootInventoryBody().host_installation_id,
    authenticated_account_id: rootInventoryBody().authenticated_account_id,
    root_id: rootInventoryBody().root_id,
  }).snapshot_fingerprint;
  const adapterHeaders = { ...headers, 'x-adapter-id': 'adapter-a', 'x-adapter-token': ADAPTER };
  const installation = '11111111-1111-4111-8111-111111111111';
  const account = '22222222-2222-4222-8222-222222222222';
  const conversation = '33333333-3333-4333-8333-333333333333';
  const mutation = '44444444-4444-4444-8444-444444444444';
  const prepared = {
    host_installation_id: installation,
    authenticated_account_id: account,
    host_session_id: HOST_SESSION,
    conversation_uuid: conversation,
    occurred_at: '2026-10-31T00:00:00.000Z',
    event_id: '55555555-5555-4555-8555-555555555555',
    event_type: 'MUTATION_PREPARED',
    mutation_id: mutation,
    operation: 'edit-message',
    mutation_digest: 'a'.repeat(64),
  };
  const noAdapter = await fetch(base + '/v1/host-lifecycle/events', {
    method: 'POST', headers, body: json(prepared),
  });
  assert.equal(noAdapter.status, 403);
  assert.equal((await noAdapter.json()).error.code, 'ADAPTER_REQUIRED');

  const accepted = await fetch(base + '/v1/host-lifecycle/events', {
    method: 'POST', headers: adapterHeaders, body: json(prepared),
  });
  assert.equal(accepted.status, 201);
  assert.equal((await accepted.json()).lifecycle.status, 'appended');

  const statusUrl = base + '/v1/host-lifecycle/status?' + new URLSearchParams({
    host_installation_id: installation,
    authenticated_account_id: account,
    host_session_id: HOST_SESSION,
    conversation_uuid: conversation,
  });
  const pending = await fetch(statusUrl, { headers: adapterHeaders });
  assert.equal(pending.status, 200);
  const pendingPayload = (await pending.json()).lifecycle;
  assert.equal(pendingPayload.status, 'PENDING_MUTATION');
  assert.equal(pendingPayload.identity.host_session_id, HOST_SESSION);
  assert.equal(pendingPayload.authority.authority_id, HOST_AUTHORITY.authority_id);
  assert.equal(pendingPayload.authority.generation, HOST_AUTHORITY.generation);
  assert.equal(pendingPayload.authority.snapshot_fingerprint, HOST_AUTHORITY.snapshot_fingerprint);
  assert.equal(pendingPayload.journal.integrity, 'VALID');
  assert.equal(pendingPayload.pending.mutation_id, mutation);
  assert.equal(pendingPayload.reason, null);

  const overlap = await fetch(base + '/v1/host-lifecycle/events', {
    method: 'POST', headers: adapterHeaders,
    body: json({ ...prepared, event_id: '66666666-6666-4666-8666-666666666666',
      mutation_id: '77777777-7777-4777-8777-777777777777' }),
  });
  assert.equal(overlap.status, 409);
  assert.equal((await overlap.json()).error.code, 'HOST_LIFECYCLE_MUTATION_ALREADY_PENDING');

  const commitEvent = {
    ...prepared,
    event_id: '88888888-8888-4888-8888-888888888888',
    event_type: 'MUTATION_COMMITTED',
    mutation_digest: prepared.mutation_digest,
    receipt_digest: 'd'.repeat(64),
    occurred_at: '2026-10-31T00:00:01.000Z',
  };
  commitEvent.receipt_signature = lifecycleReceiptSignature(commitEvent);
  const committed = await fetch(base + '/v1/host-lifecycle/events', {
    method: 'POST', headers: adapterHeaders, body: json(commitEvent),
  });
  assert.equal(committed.status, 201);
  assert.equal((await committed.json()).lifecycle.status, 'appended');

  const clear = await fetch(statusUrl, { headers: adapterHeaders });
  assert.equal(clear.status, 200);
  assert.equal((await clear.json()).lifecycle.status, 'NO_PENDING_MUTATION');
  assert.equal(rootJournal.verifyChain(installation, account).valid, true);

  const raw = await fetch(base + '/v1/host-lifecycle/events', {
    method: 'POST', headers: adapterHeaders,
    body: json({ ...prepared, content: 'raw chat text' }),
  });
  assert.equal(raw.status, 400);
  assert.equal((await raw.json()).error.code, 'INVALID_HOST_LIFECYCLE_EVENT');
});
