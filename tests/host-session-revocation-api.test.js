import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { createApiServer } from '../src/api/server.js';
import { HostAssertionNonceStore } from '../src/application/host-assertion-nonce-store.js';

const API_TOKEN = 'host-session-revocation-api-token';
const ADAPTER_TOKEN = 'host-session-revocation-adapter-token';
const ADAPTER_ID = 'st-host-adapter';
const INSTALLATION = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const NONCE = '44444444-4444-4444-8444-444444444444';

function signature(body) {
  const proof = JSON.stringify([
    body.protocol_version, ADAPTER_ID, body.host_installation_id,
    body.authenticated_account_id, body.host_session_id, body.issued_at,
    body.nonce, body.reason,
  ]);
  return createHmac('sha256', ADAPTER_TOKEN).update(proof, 'utf8').digest('hex');
}

test('Core accepts signed session revocation once and makes it durable for assertion checks', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'host-session-revocation-api-'));
  const store = new SQLiteStore(join(directory, 'core.sqlite'));
  const engine = new LogicEngine(store);
  const coordinatorPath = resolve(join(directory, 'coordinator.sqlite'));
  const nonceStore = new HostAssertionNonceStore({
    path: join(directory, 'host-assertion-nonces.sqlite'),
    coreDatabasePath: store.db.prepare('PRAGMA database_list').all().find(row => row.name === 'main')?.file,
    coordinatorPath,
  });
  const server = createApiServer({
    engine,
    token: API_TOKEN,
    adapterTokens: { [ADAPTER_ID]: ADAPTER_TOKEN },
    hostAssertionNonceStore: nonceStore,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise(resolveClose => server.close(resolveClose));
    nonceStore.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const url = 'http://127.0.0.1:' + server.address().port + '/v1/host/session/revoke';
  const identity = {
    host_installation_id: INSTALLATION,
    authenticated_account_id: ACCOUNT,
    host_session_id: SESSION,
  };
  const now = Math.floor(Date.now() / 1000);
  const event = {
    protocol_version: 1,
    ...identity,
    issued_at: now,
    nonce: NONCE,
    reason: 'logout',
  };
  const post = body => fetch(url, {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + API_TOKEN,
      'x-adapter-id': ADAPTER_ID,
      'x-adapter-token': ADAPTER_TOKEN,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const invalid = await post({ ...event, signature: '0'.repeat(64) });
  assert.equal(invalid.status, 401);
  assert.equal(nonceStore.isSessionRevoked(ADAPTER_ID, identity), false);

  const accepted = await post({ ...event, signature: signature(event) });
  assert.equal(accepted.status, 204);
  assert.equal(nonceStore.isSessionRevoked(ADAPTER_ID, identity), true);

  const replay = await post({ ...event, signature: signature(event) });
  assert.equal(replay.status, 409);
  assert.equal((await replay.json()).error.code, 'HOST_SESSION_REVOCATION_REPLAYED');

  const expiredEvent = {
    ...event,
    host_session_id: '55555555-5555-4555-8555-555555555555',
    nonce: '66666666-6666-4666-8666-666666666666',
    issued_at: now - 31,
  };
  const expired = await post({ ...expiredEvent, signature: signature(expiredEvent) });
  assert.equal(expired.status, 401);
  assert.equal((await expired.json()).error.code, 'HOST_SESSION_REVOCATION_EXPIRED');
});
