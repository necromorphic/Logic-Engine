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

async function setup(t, { withLedger = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'logic-host-ledger-api-'));
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  engine.createWorld({
    world_id: 'host-ledger-api-world', world_pack_id: 'test.host-ledger', world_pack_version: '1',
    game_time: '2026-01-01T00:00:00Z',
  });
  const ledger = withLedger ? new HostVersionDigestLedger({
    path: join(directory, 'ledger.sqlite'),
    coordinatorPath: join(directory, 'coordinator.sqlite'),
    verifyInventorySnapshot: async () => false,
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
    body: json({ conversation_id: 'stable-host-chat', message_id: 'message-1', version_id: 'version-1', content_sha256: 'a'.repeat(64), active: true, deleted: false }),
  });
  assert.equal(unavailableResponse.status, 503);
  assert.equal((await unavailableResponse.json()).error.code, 'HOST_VERSION_LEDGER_UNAVAILABLE');

  const { base } = await setup(t);
  const noAdapter = await fetch(base + '/v1/host-version-ledger/capture', {
    method: 'POST', headers, body: json({ conversation_id: 'stable-host-chat', message_id: 'message-1', version_id: 'version-1', content_sha256: 'a'.repeat(64), active: true, deleted: false }),
  });
  assert.equal(noAdapter.status, 403);
  assert.equal((await noAdapter.json()).error.code, 'ADAPTER_REQUIRED');

  const unbound = await fetch(base + '/v1/host-version-ledger/capture', {
    method: 'POST', headers: { ...headers, 'x-adapter-id': 'adapter-a', 'x-adapter-token': ADAPTER },
    body: json({ conversation_id: 'stable-host-chat', message_id: 'message-1', version_id: 'version-1', content_sha256: 'a'.repeat(64), active: true, deleted: false }),
  });
  assert.equal(unbound.status, 403);
  assert.equal((await unbound.json()).error.code, 'HOST_CONVERSATION_NOT_AUTHORIZED');

  assert.equal((await bind(base)).status, 201);
  const wrongAdapter = await fetch(base + '/v1/host-version-ledger/capture', {
    method: 'POST', headers: { ...headers, 'x-adapter-id': 'adapter-b', 'x-adapter-token': OTHER_ADAPTER },
    body: json({ conversation_id: 'stable-host-chat', message_id: 'message-1', version_id: 'version-1', content_sha256: 'a'.repeat(64), active: true, deleted: false }),
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
    body: json({ world_id: 'attacker-world', conversation_id: 'stable-host-chat', message_id: 'message-1', version_id: 'version-1', content_sha256: 'a'.repeat(64), content: 'raw Host text', active: true, deleted: false }),
  });
  assert.equal(forbidden.status, 400);
  assert.equal((await forbidden.json()).error.code, 'INVALID_HOST_VERSION_CAPTURE');

  const captured = await fetch(base + '/v1/host-version-ledger/capture', {
    method: 'POST', headers: adapterHeaders,
    body: json({ conversation_id: 'stable-host-chat', message_id: 'message-1', version_id: 'version-1', content_sha256: 'a'.repeat(64), active: true, deleted: false }),
  });
  assert.equal(captured.status, 201);
  assert.equal((await captured.json()).capture.status, 'captured');
  const stored = ledger.db.prepare('SELECT world_id,conversation_id,message_id,version_id,content_sha256 FROM host_version_digest_ledger').all()
    .map((row) => ({ ...row }));
  assert.deepEqual(stored, [{
    world_id: 'host-ledger-api-world', conversation_id: 'stable-host-chat', message_id: 'message-1',
    version_id: 'version-1', content_sha256: 'a'.repeat(64),
  }]);
  assert.equal(ledger.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='raw_host_text'").get(), undefined);
});

test('digest conflict is surfaced as 409 and cannot be hidden by the HTTP layer', async (t) => {
  const { base, ledger } = await setup(t);
  assert.equal((await bind(base)).status, 201);
  const adapterHeaders = { ...headers, 'x-adapter-id': 'adapter-a', 'x-adapter-token': ADAPTER };
  const capture = (sha) => fetch(base + '/v1/host-version-ledger/capture', {
    method: 'POST', headers: adapterHeaders,
    body: json({ conversation_id: 'stable-host-chat', message_id: 'message-1', version_id: 'version-1', content_sha256: sha, active: true, deleted: false }),
  });
  assert.equal((await capture('a'.repeat(64))).status, 201);
  const conflict = await capture('b'.repeat(64));
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).inventory_status, 'NON_READY');
  assert.equal(ledger.getInventoryState('host-ledger-api-world', 'stable-host-chat').status, 'NON_READY');
  assert.equal(ledger.db.prepare('SELECT version_id FROM host_version_active_pointer').get().version_id, 'version-1');
});
