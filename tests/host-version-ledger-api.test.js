import test from 'node:test';
import assert from 'node:assert/strict';
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
const headers = { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' };
const json = (body) => JSON.stringify(body);

async function setup(t, {
  withLedger = true,
  verifyInventorySnapshot = async () => false,
  sharedCoordinator = false,
  withRootJournal = false,
  authorizeRootIdentity = () => true,
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
    resolveIdentity: input => ({
      authorized: true,
      host_installation_id: input.host_installation_id,
      authenticated_account_id: input.authenticated_account_id,
      conversation_uuid: input.conversation_uuid,
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
