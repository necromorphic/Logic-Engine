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

test('identity registry refuses to live inside the SillyTavern data root', async (t) => {
  const root = await temp(t);
  const dataRoot = path.join(root, 'st-data');
  const identityDirectory = path.join(dataRoot, 'logic-engine-identity');
  await mkdir(dataRoot);
  const store = new HostIdentityStore({ directory: identityDirectory });
  await assert.rejects(
    () => store.assertOutsideRoot(dataRoot),
    /HOST_IDENTITY_DIRECTORY_INSIDE_DATA_ROOT/,
  );
});

test('identity registry accepts a separate deployment-owned directory', async (t) => {
  const root = await temp(t);
  const dataRoot = path.join(root, 'st-data');
  const identityDirectory = path.join(root, 'deployment-state', 'identity');
  await mkdir(dataRoot);
  const store = new HostIdentityStore({ directory: identityDirectory });
  assert.equal(await store.assertOutsideRoot(dataRoot), true);
  const identity = await store.resolveAuthenticatedAccount('alice');
  assert.match(identity.host_installation_id, /^[0-9a-f-]{36}$/i);
});

test('identity registry resolves symlinked parents before checking data-root containment', async (t) => {
  const root = await temp(t);
  const dataRoot = path.join(root, 'st-data');
  const alias = path.join(root, 'deployment-alias');
  await mkdir(dataRoot);
  await symlink(dataRoot, alias, 'dir');
  const store = new HostIdentityStore({ directory: path.join(alias, 'identity') });
  await assert.rejects(
    () => store.assertOutsideRoot(dataRoot),
    /HOST_IDENTITY_DIRECTORY_INSIDE_DATA_ROOT/,
  );
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
    identityStore: {
      assertOutsideRoot: async () => true,
      resolveAuthenticatedAccount: async () => { calls += 1; return {}; },
    },
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

test('identity route resolves ST relative DATA_ROOT against the server working directory', async (t) => {
  const previousDataRoot = globalThis.DATA_ROOT;
  t.after(() => {
    if (previousDataRoot === undefined) delete globalThis.DATA_ROOT;
    else globalThis.DATA_ROOT = previousDataRoot;
  });
  globalThis.DATA_ROOT = './data';
  let observedRoot = null;
  const handler = createHostIdentityHandler({
    identityStore: {
      assertOutsideRoot: async root => { observedRoot = root; },
      resolveAuthenticatedAccount: async () => ({
        host_installation_id: '11111111-1111-4111-8111-111111111111',
        authenticated_account_id: '22222222-2222-4222-8222-222222222222',
      }),
    },
  });
  const response = { statusCode: null, body: null, headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    sendStatus(code) { this.statusCode = code; return this; },
  };
  await handler({
    user: { profile: { handle: 'alice' } },
    session: {
      handle: 'alice',
      logicEngineSessionHandle: 'alice',
      logicEngineSessionId: '00000000-0000-4000-8000-000000000097',
    },
  }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(observedRoot, path.resolve('./data'));
});

test('identity route fails closed when its persistent registry is inside the ST data root', async (t) => {
  const root = await temp(t);
  const dataRoot = path.join(root, 'st-data');
  await mkdir(dataRoot);
  const store = new HostIdentityStore({ directory: path.join(dataRoot, 'identity') });
  const handler = createHostIdentityHandler({ identityStore: store, getDataRoot: () => dataRoot });
  const response = { statusCode: null, body: null, headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    sendStatus(code) { this.statusCode = code; return this; },
  };
  const sessionId = '00000000-0000-4000-8000-000000000098';
  await handler({
    user: { profile: { handle: 'alice' }, directories: { root: dataRoot } },
    session: { handle: 'alice', logicEngineSessionHandle: 'alice', logicEngineSessionId: sessionId },
  }, response);
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.code, 'HOST_IDENTITY_UNAVAILABLE');
  assert.deepEqual(await readdir(dataRoot), []);
});

test('identity route returns opaque persistent IDs only after session/account binding matches', async (t) => {
  const root = await temp(t);
  const store = new HostIdentityStore({ directory: path.join(root, 'identity') });
  const dataRoot = path.join(root, 'st-data');
  await mkdir(dataRoot);
  const handler = createHostIdentityHandler({ identityStore: store, getDataRoot: () => dataRoot });
  const response = { statusCode: null, body: null, headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    sendStatus(code) { this.statusCode = code; return this; },
  };
  const sessionId = '00000000-0000-4000-8000-000000000099';
  await handler({
    user: { profile: { handle: 'alice' }, directories: { root: path.join(root, 'st-data') } },
    session: { handle: 'alice', logicEngineSessionHandle: 'alice', logicEngineSessionId: sessionId },
  }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.host_session_id, sessionId);
  assert.match(response.body.host_installation_id, /^[0-9a-f-]{36}$/i);
  assert.match(response.body.authenticated_account_id, /^[0-9a-f-]{36}$/i);
});
