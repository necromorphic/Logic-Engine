import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, symlink, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HostIdentityStore } from '../st-host-identity-store.mjs';
import { createHostIdentityHandler } from '../st-host-inventory-handler.mjs';

async function temp(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'logic-host-identity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('installation and account identities persist across store instances without persisting account handles', async (t) => {
  const root = await temp(t);
  const first = await new HostIdentityStore({ directory: path.join(root, 'identity') })
    .resolveAuthenticatedAccount('alice');
  const second = await new HostIdentityStore({ directory: path.join(root, 'identity') })
    .resolveAuthenticatedAccount('alice');
  assert.equal(second.host_installation_id, first.host_installation_id);
  assert.equal(second.authenticated_account_id, first.authenticated_account_id);
  const files = await readdir(path.join(root, 'identity'));
  const content = (await Promise.all(files.map(name => readFile(path.join(root, 'identity', name), 'utf8')))).join('\n');
  assert.equal(content.includes('alice'), false);
});

test('accounts are isolated and account rename rotates the opaque account identity', async (t) => {
  const root = await temp(t);
  const store = new HostIdentityStore({ directory: path.join(root, 'identity') });
  const alice = await store.resolveAuthenticatedAccount('alice');
  const bob = await store.resolveAuthenticatedAccount('bob');
  const renamed = await store.resolveAuthenticatedAccount('alice-renamed');
  assert.equal(alice.host_installation_id, bob.host_installation_id);
  assert.equal(alice.authenticated_account_id === bob.authenticated_account_id, false);
  assert.equal(alice.authenticated_account_id === renamed.authenticated_account_id, false);
});

test('corrupt installation identity fails closed rather than silently re-enrolling', async (t) => {
  const root = await temp(t);
  const directory = path.join(root, 'identity');
  await mkdir(directory);
  await import('node:fs/promises').then(fs => fs.writeFile(path.join(directory, 'installation.json'), '{"schema_version":1,"installation_id":"tampered"}'));
  const store = new HostIdentityStore({ directory });
  await assert.rejects(() => store.resolveAuthenticatedAccount('alice'), /HOST_INSTALLATION_IDENTITY_CORRUPT/);
});

test('identity route rejects requests outside the authenticated signed session', async (t) => {
  let calls = 0;
  const handler = createHostIdentityHandler({
    identityStore: { resolveAuthenticatedAccount: async () => { calls += 1; return {}; } },
  });
  const response = { statusCode: null, body: null, headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    sendStatus(code) { this.statusCode = code; return this; },
  };
  await handler({ user: { profile: { handle: 'alice' } }, session: { handle: 'bob' } }, response);
  assert.equal(response.statusCode, 403);
  assert.equal(calls, 0);
});

test('identity route returns opaque persistent IDs only after session/account binding matches', async (t) => {
  const root = await temp(t);
  const store = new HostIdentityStore({ directory: path.join(root, 'identity') });
  const handler = createHostIdentityHandler({ identityStore: store });
  const response = { statusCode: null, body: null, headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    sendStatus(code) { this.statusCode = code; return this; },
  };
  const sessionId = '00000000-0000-4000-8000-000000000099';
  await handler({
    user: { profile: { handle: 'alice' } },
    session: { handle: 'alice', logicEngineSessionHandle: 'alice', logicEngineSessionId: sessionId },
  }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.host_session_id, sessionId);
  assert.match(response.body.host_installation_id, /^[0-9a-f-]{36}$/i);
  assert.match(response.body.authenticated_account_id, /^[0-9a-f-]{36}$/i);
});
