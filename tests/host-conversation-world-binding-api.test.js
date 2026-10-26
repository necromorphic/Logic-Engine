import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { createApiServer } from '../src/api/server.js';
import { HostVersionDigestLedger } from '../src/application/host-version-digest-ledger.js';

const TOKEN = 'test-token-long-enough-123456';
const ADMIN = 'admin-token-long-enough-123456';
const ADAPTER_A = 'adapter-a-token-long-enough-123456';
const ADAPTER_B = 'adapter-b-token-long-enough-123456';
const headers = { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' };
const json = (body) => JSON.stringify(body);

async function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'host-binding-api-'));
  const coordinatorPath = join(directory, 'coordinator.sqlite');
  const hostVersionLedger = new HostVersionDigestLedger({
    path: join(directory, 'host-versions.sqlite'),
    coordinatorPath,
    verifyInventorySnapshot: async () => false,
  });
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  engine.createWorld({
    world_id: 'host-binding-world-a', world_pack_id: 'test.host-binding', world_pack_version: '1',
    game_time: '2026-01-01T00:00:00Z',
  });
  engine.createWorld({
    world_id: 'host-binding-world-b', world_pack_id: 'test.host-binding', world_pack_version: '1',
    game_time: '2026-01-01T00:00:00Z',
  });
  const server = createApiServer({
    engine, token: TOKEN, adminToken: ADMIN,
    adapterTokens: { 'adapter-a': ADAPTER_A, 'adapter-b': ADAPTER_B },
    hostVersionLedger,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.close();
    store.close();
    hostVersionLedger.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return 'http://127.0.0.1:' + server.address().port;
}

test('Core binding API requires admin to assign and authenticated adapter to resolve', async (t) => {
  const base = await setup(t);
  const path = base + '/v1/host-conversation-bindings';
  const assignment = { adapter_id: 'adapter-a', conversation_id: 'stable-chat-id', world_id: 'host-binding-world-a' };

  const denied = await fetch(path, { method: 'POST', headers, body: json(assignment) });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error.code, 'ADMIN_REQUIRED');

  const created = await fetch(path, {
    method: 'POST', headers: { ...headers, 'x-admin-token': ADMIN }, body: json(assignment),
  });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).binding.world_id, 'host-binding-world-a');

  const resolved = await fetch(path + '/resolve', {
    method: 'POST',
    headers: { ...headers, 'x-adapter-id': 'adapter-a', 'x-adapter-token': ADAPTER_A },
    body: json({ conversation_id: 'stable-chat-id' }),
  });
  assert.equal(resolved.status, 200);
  assert.equal((await resolved.json()).binding.world_id, 'host-binding-world-a');

  const wrongAdapter = await fetch(path + '/resolve', {
    method: 'POST',
    headers: { ...headers, 'x-adapter-id': 'adapter-b', 'x-adapter-token': ADAPTER_B },
    body: json({ conversation_id: 'stable-chat-id' }),
  });
  assert.equal(wrongAdapter.status, 403);
  assert.equal((await wrongAdapter.json()).error.code, 'HOST_CONVERSATION_NOT_AUTHORIZED');

  const callerWorld = await fetch(path + '/resolve', {
    method: 'POST',
    headers: { ...headers, 'x-adapter-id': 'adapter-a', 'x-adapter-token': ADAPTER_A },
    body: json({ conversation_id: 'stable-chat-id', world_id: 'host-binding-world-b' }),
  });
  assert.equal(callerWorld.status, 400);
  assert.equal((await callerWorld.json()).error.code, 'INVALID_HOST_CONVERSATION_RESOLUTION');
});

test('Core binding API refuses implicit reassignment and revocation prevents resolution', async (t) => {
  const base = await setup(t);
  const path = base + '/v1/host-conversation-bindings';
  const adminHeaders = { ...headers, 'x-admin-token': ADMIN };
  const adapterHeaders = { ...headers, 'x-adapter-id': 'adapter-a', 'x-adapter-token': ADAPTER_A };
  await fetch(path, {
    method: 'POST', headers: adminHeaders,
    body: json({ adapter_id: 'adapter-a', conversation_id: 'stable-chat-id', world_id: 'host-binding-world-a' }),
  });

  const conflict = await fetch(path, {
    method: 'POST', headers: adminHeaders,
    body: json({ adapter_id: 'adapter-a', conversation_id: 'stable-chat-id', world_id: 'host-binding-world-b' }),
  });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, 'HOST_CONVERSATION_WORLD_CONFLICT');

  const revoked = await fetch(path + '/adapter-a/stable-chat-id', {
    method: 'DELETE', headers: adminHeaders, body: json({ reason: 'Host chat removed by administrator' }),
  });
  assert.equal(revoked.status, 200);
  assert.equal((await revoked.json()).binding.changed, true);

  const resolveAfterRevoke = await fetch(path + '/resolve', {
    method: 'POST', headers: adapterHeaders, body: json({ conversation_id: 'stable-chat-id' }),
  });
  assert.equal(resolveAfterRevoke.status, 403);
  assert.equal((await resolveAfterRevoke.json()).error.code, 'HOST_CONVERSATION_NOT_AUTHORIZED');
});


test('Host digest capture requires Core binding and accepts no raw text or caller world_id', async (t) => {
  const base = await setup(t);
  const path = base + '/v1/host-version-ledger/capture';
  const adapterHeaders = { ...headers, 'x-adapter-id': 'adapter-a', 'x-adapter-token': ADAPTER_A };
  const capture = {
    conversation_id: 'stable-chat-id', message_id: 'message-1', version_id: 'version-1',
    content_sha256: 'a'.repeat(64), active: true, deleted: false,
  };

  const unbound = await fetch(path, { method: 'POST', headers: adapterHeaders, body: json(capture) });
  assert.equal(unbound.status, 403);
  assert.equal((await unbound.json()).error.code, 'HOST_CONVERSATION_NOT_AUTHORIZED');

  await fetch(base + '/v1/host-conversation-bindings', {
    method: 'POST', headers: { ...headers, 'x-admin-token': ADMIN },
    body: json({ adapter_id: 'adapter-a', conversation_id: 'stable-chat-id', world_id: 'host-binding-world-a' }),
  });

  const rawText = await fetch(path, {
    method: 'POST', headers: adapterHeaders, body: json({ ...capture, content_text: 'must not be accepted' }),
  });
  assert.equal(rawText.status, 400);
  assert.equal((await rawText.json()).error.code, 'INVALID_HOST_VERSION_CAPTURE');

  const callerWorld = await fetch(path, {
    method: 'POST', headers: adapterHeaders, body: json({ ...capture, world_id: 'host-binding-world-b' }),
  });
  assert.equal(callerWorld.status, 400);
  assert.equal((await callerWorld.json()).error.code, 'INVALID_HOST_VERSION_CAPTURE');

  const badDigest = await fetch(path, {
    method: 'POST', headers: adapterHeaders, body: json({ ...capture, content_sha256: 'not-a-sha256' }),
  });
  assert.equal(badDigest.status, 400);
  assert.equal((await badDigest.json()).error.code, 'INVALID_HOST_VERSION_CAPTURE');

  const saved = await fetch(path, { method: 'POST', headers: adapterHeaders, body: json(capture) });
  assert.equal(saved.status, 201);
  assert.deepEqual((await saved.json()).capture, { status: 'captured' });

  const duplicate = await fetch(path, { method: 'POST', headers: adapterHeaders, body: json(capture) });
  assert.equal(duplicate.status, 200);
  assert.deepEqual((await duplicate.json()).capture, { status: 'duplicate' });

  const conflict = await fetch(path, {
    method: 'POST', headers: adapterHeaders,
    body: json({ ...capture, content_sha256: 'b'.repeat(64) }),
  });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).inventory_status, 'NON_READY');
});
