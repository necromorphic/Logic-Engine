import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { HostVersionDigestLedger } from '../src/application/host-version-digest-ledger.js';
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
  const server = createApiServer({
    engine, token: TOKEN, adminToken: ADMIN,
    adapterTokens: { 'adapter-a': ADAPTER, 'adapter-b': OTHER_ADAPTER },
    hostVersionLedger: ledger,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    ledger?.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { base: 'http://127.0.0.1:' + server.address().port, ledger };
}

async function bind(base, adapterId = 'adapter-a') {
  return fetch(base + '/v1/host-conversation-bindings', {
    method: 'POST', headers: { ...headers, 'x-admin-token': ADMIN },
    body: json({ adapter_id: adapterId, conversation_id: 'stable-host-chat', world_id: 'host-ledger-api-world' }),
  });
}

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


test('incomplete API snapshot is rejected before verifier invocation or ledger mutation', async (t) => {
  let verifierCalls = 0;
  const { base, ledger } = await setup(t, {
    verifyInventorySnapshot: async () => { verifierCalls += 1; return true; },
  });
  assert.equal((await bind(base)).status, 201);
  const response = await fetch(base + '/v1/host-version-ledger/reconcile', {
    method: 'POST',
    headers: { ...headers, 'x-adapter-id': 'adapter-a', 'x-adapter-token': ADAPTER },
    body: json({ conversation_id: 'stable-host-chat', complete: false, versions: [] }),
  });
  assert.equal(response.status, 409);
  assert.deepEqual((await response.json()).reconciliation, {
    status: 'non_ready', code: 'HOST_INVENTORY_INCOMPLETE',
  });
  assert.equal(verifierCalls, 0);
  assert.equal(ledger.db.prepare('SELECT COUNT(*) AS n FROM host_version_digest_ledger').get().n, 0);
  assert.equal(ledger.getInventoryState('host-ledger-api-world', 'stable-host-chat'), null);
});
