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

async function setup(t, { withLedger = true, verifyInventorySnapshot = async () => false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'logic-host-ledger-api-'));
  const coordinatorPath = join(directory, 'coordinator.sqlite');
  const previousCoordinatorPath = process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH;
  process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH = coordinatorPath;
  let currentVerifier = verifyInventorySnapshot;
  const store = new SQLiteStore(join(directory, 'core.sqlite'));
  const engine = new LogicEngine(store);
  engine.createWorld({
    world_id: 'host-ledger-api-world', world_pack_id: 'test.host-ledger', world_pack_version: '1',
    game_time: '2026-01-01T00:00:00Z',
  });
  const ledger = withLedger ? new HostVersionDigestLedger({
    path: join(directory, 'ledger.sqlite'),
    coordinatorPath,
    verifyInventorySnapshot: (...args) => currentVerifier(...args),
  }) : null;
  const server = createApiServer({
    engine, token: TOKEN, adminToken: ADMIN,
    adapterTokens: { 'adapter-a': ADAPTER, 'adapter-b': OTHER_ADAPTER },
    hostVersionLedger: ledger,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    ledger?.close();
    store.close();
    if (previousCoordinatorPath === undefined) delete process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH;
    else process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH = previousCoordinatorPath;
    rmSync(directory, { recursive: true, force: true });
  });
  return { base, ledger, setVerifier: (verifier) => { currentVerifier = verifier; } };
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


test('snapshot reconciliation requires configured ledger, authenticated adapter and canonical Core binding', async (t) => {
  const unavailable = await setup(t, { withLedger: false });
  const unavailableResponse = await fetch(unavailable.base + '/v1/host-version-ledger/reconcile', {
    method: 'POST',
    headers: { ...headers, 'x-adapter-id': 'adapter-a', 'x-adapter-token': ADAPTER },
    body: json({ conversation_id: 'stable-host-chat', complete: true, versions: [] }),
  });
  assert.equal(unavailableResponse.status, 503);
  assert.equal((await unavailableResponse.json()).error.code, 'HOST_VERSION_LEDGER_UNAVAILABLE');

  const { base } = await setup(t);
  const body = { conversation_id: 'stable-host-chat', complete: true, versions: [] };
  const noAdapter = await fetch(base + '/v1/host-version-ledger/reconcile', {
    method: 'POST', headers, body: json(body),
  });
  assert.equal(noAdapter.status, 403);
  assert.equal((await noAdapter.json()).error.code, 'ADAPTER_REQUIRED');

  const unbound = await fetch(base + '/v1/host-version-ledger/reconcile', {
    method: 'POST',
    headers: { ...headers, 'x-adapter-id': 'adapter-a', 'x-adapter-token': ADAPTER },
    body: json(body),
  });
  assert.equal(unbound.status, 403);
  assert.equal((await unbound.json()).error.code, 'HOST_CONVERSATION_NOT_AUTHORIZED');

  assert.equal((await bind(base)).status, 201);
  const wrongAdapter = await fetch(base + '/v1/host-version-ledger/reconcile', {
    method: 'POST',
    headers: { ...headers, 'x-adapter-id': 'adapter-b', 'x-adapter-token': OTHER_ADAPTER },
    body: json(body),
  });
  assert.equal(wrongAdapter.status, 403);
  assert.equal((await wrongAdapter.json()).error.code, 'HOST_CONVERSATION_NOT_AUTHORIZED');
});

test('snapshot reconciliation derives world from Core binding and remains fail-closed when inventory verifier denies', async (t) => {
  const { base, ledger } = await setup(t);
  assert.equal((await bind(base)).status, 201);
  const adapterHeaders = { ...headers, 'x-adapter-id': 'adapter-a', 'x-adapter-token': ADAPTER };
  const snapshot = {
    conversation_id: 'stable-host-chat',
    complete: true,
    versions: [{
      message_id: 'message-1', version_id: 'version-1', parent_version_id: null,
      content_sha256: 'a'.repeat(64), active: true, deleted: false,
    }],
  };
  const denied = await fetch(base + '/v1/host-version-ledger/reconcile', {
    method: 'POST', headers: adapterHeaders, body: json(snapshot),
  });
  assert.equal(denied.status, 409);
  const deniedBody = await denied.json();
  assert.equal(deniedBody.inventory_status, 'NON_READY');
  assert.deepEqual(deniedBody.inventory, { status: 'non_ready', code: 'HOST_INVENTORY_NOT_AUTHORIZED' });
  assert.equal(ledger.db.prepare('SELECT COUNT(*) AS n FROM host_version_digest_ledger').get().n, 0);
  assert.equal(ledger.getInventoryState('host-ledger-api-world', 'stable-host-chat'), null);

  const callerWorld = await fetch(base + '/v1/host-version-ledger/reconcile', {
    method: 'POST', headers: adapterHeaders, body: json({ ...snapshot, world_id: 'attacker-world' }),
  });
  assert.equal(callerWorld.status, 400);
  assert.equal((await callerWorld.json()).error.code, 'INVALID_HOST_VERSION_SNAPSHOT');

  const rawText = await fetch(base + '/v1/host-version-ledger/reconcile', {
    method: 'POST', headers: adapterHeaders,
    body: json({ ...snapshot, versions: [{ ...snapshot.versions[0], content: 'raw Host text' }] }),
  });
  assert.equal(rawText.status, 400);
  assert.equal((await rawText.json()).error.code, 'INVALID_HOST_VERSION_SNAPSHOT');
});

test('trusted complete Host snapshot is reconciled through the existing ledger contract', async (t) => {
  const { base, ledger } = await setup(t, {
    verifyInventorySnapshot: async (snapshot) => snapshot.complete === true
      && snapshot.world_id === 'host-ledger-api-world'
      && snapshot.conversation_id === 'stable-host-chat',
  });
  assert.equal((await bind(base)).status, 201);
  const response = await fetch(base + '/v1/host-version-ledger/reconcile', {
    method: 'POST',
    headers: { ...headers, 'x-adapter-id': 'adapter-a', 'x-adapter-token': ADAPTER },
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
  const result = await response.json();
  assert.equal(result.inventory_status, 'READY');
  assert.equal(result.inventory.status, 'ready');
  assert.equal(ledger.getInventoryState('host-ledger-api-world', 'stable-host-chat').status, 'READY');
  const stored = ledger.db.prepare('SELECT world_id, conversation_id, message_id, version_id, parent_version_id, content_sha256 FROM host_version_digest_ledger').get();
  assert.deepEqual({ ...stored }, {
    world_id: 'host-ledger-api-world',
    conversation_id: 'stable-host-chat',
    message_id: 'message-1',
    version_id: 'version-1',
    parent_version_id: null,
    content_sha256: 'a'.repeat(64),
  });
});

test('incomplete Host snapshot is rejected before inventory verification or mutation', async (t) => {
  let verifierCalls = 0;
  const { base, ledger } = await setup(t, { verifyInventorySnapshot: async () => { verifierCalls += 1; return true; } });
  assert.equal((await bind(base)).status, 201);
  const response = await fetch(base + '/v1/host-version-ledger/reconcile', {
    method: 'POST',
    headers: { ...headers, 'x-adapter-id': 'adapter-a', 'x-adapter-token': ADAPTER },
    body: json({ conversation_id: 'stable-host-chat', complete: false, versions: [] }),
  });
  assert.equal(response.status, 409);
  assert.deepEqual((await response.json()).inventory, { status: 'non_ready', code: 'HOST_INVENTORY_INCOMPLETE' });
  assert.equal(verifierCalls, 0);
  assert.equal(ledger.db.prepare('SELECT COUNT(*) AS n FROM host_version_digest_ledger').get().n, 0);
});


test('snapshot reconciliation enforces the bounded version-row count before ledger mutation', async (t) => {
  const { base, ledger } = await setup(t);
  assert.equal((await bind(base)).status, 201);
  const response = await fetch(base + '/v1/host-version-ledger/reconcile', {
    method: 'POST',
    headers: { ...headers, 'x-adapter-id': 'adapter-a', 'x-adapter-token': ADAPTER },
    body: json({
      conversation_id: 'stable-host-chat',
      complete: true,
      versions: Array.from({ length: 25001 }, () => null),
    }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INVALID_HOST_VERSION_SNAPSHOT');
  assert.equal(ledger.db.prepare('SELECT COUNT(*) AS n FROM host_version_digest_ledger').get().n, 0);
});


test('snapshot reconciliation rejects adapter revocation during async inventory verification before ledger mutation', async (t) => {
  const { base, ledger, setVerifier } = await setup(t, { verifyInventorySnapshot: async () => true });
  assert.equal((await bind(base)).status, 201);
  const adapterHeaders = { ...headers, 'x-adapter-id': 'adapter-a', 'x-adapter-token': ADAPTER };
  let revoked = false;
  setVerifier(async () => {
    const response = await fetch(base + '/v1/host-conversation-bindings/adapter-a/stable-host-chat', {
      method: 'DELETE',
      headers: { ...headers, 'x-admin-token': ADMIN },
      body: json({ reason: 'revoke during snapshot verification race test' }),
    });
    assert.equal(response.status, 200);
    revoked = true;
    return true;
  });
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
  assert.equal(revoked, true);
  assert.equal(response.status, 409);
  const result = await response.json();
  assert.equal(result.inventory_status, 'NON_READY');
  assert.deepEqual(result.inventory, { status: 'non_ready', code: 'HOST_CONVERSATION_NOT_AUTHORIZED' });
  assert.equal(ledger.db.prepare('SELECT COUNT(*) AS n FROM host_version_digest_ledger').get().n, 0);
  assert.equal(ledger.getInventoryState('host-ledger-api-world', 'stable-host-chat'), null);
});
