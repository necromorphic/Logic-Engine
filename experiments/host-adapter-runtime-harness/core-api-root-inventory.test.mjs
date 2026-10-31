import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';

import { LogicEngine } from '../../src/application/engine.js';
import { HostLifecycleJournal } from '../../src/application/host-lifecycle-journal.js';
import { createApiServer } from '../../src/api/server.js';
import { SQLiteStore } from '../../src/storage/sqlite-store.js';
import { HostIdentityStore } from '../../host-adapter/prototype/st-host-identity-store.mjs';
import { createHostInventoryHandler } from '../../host-adapter/prototype/st-host-inventory-handler.mjs';
import { createHostRootInventoryPersistence } from '../../host-adapter/prototype/st-server-digest-proxy.mjs';

const PINNED_HOST_COMMIT = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';
const API_TOKEN = 'host-root-api-token-0123456789';
const ADAPTER_ID = 'st-1.19-core-api-harness';
const ADAPTER_TOKEN = 'host-root-adapter-token-0123456789';
const SESSION_ID = '99999999-9999-4999-8999-999999999999';
const CONVERSATION_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const digest = value => createHash('sha256').update(value, 'utf8').digest('hex');

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return 'http://127.0.0.1:' + server.address().port;
}

async function close(server) {
  if (server?.listening) await new Promise((resolveClose, reject) =>
    server.close(error => error ? reject(error) : resolveClose()));
}

function responseCapture() {
  return {
    statusCode: 200,
    headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    sendStatus(code) { this.statusCode = code; return this; },
  };
}

test('Host inventory route persists digest-only root baselines and deltas through the authenticated Core API across restart', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'logic-engine-host-root-api-'));
  const root = join(parent, 'st-data');
  const identityDirectory = join(parent, 'host-identity');
  const coreDirectory = join(parent, 'core-state');
  const coreDbPath = join(coreDirectory, 'host-root-inventory.sqlite');
  const coordinatorPath = join(coreDirectory, 'coordinator.sqlite');
  await Promise.all([
    mkdir(join(root, 'chats'), { recursive: true }),
    mkdir(identityDirectory, { recursive: true }),
    mkdir(coreDirectory, { recursive: true }),
  ]);
  t.after(async () => {
    await close(coreServer);
    try { coreJournal?.close(); } catch {}
    try { coreStore?.close(); } catch {}
    await rm(parent, { recursive: true, force: true });
  });

  const identityStore = new HostIdentityStore({ directory: identityDirectory });
  const identity = await identityStore.resolveAuthenticatedAccount('Harness User');
  const rootId = digest(resolve(root));
  const rootIdentity = {
    host_installation_id: identity.host_installation_id,
    authenticated_account_id: identity.authenticated_account_id,
    root_id: rootId,
  };

  let coreJournal = null;
  let coreStore = null;
  let coreServer = null;
  const resolveRootIdentity = input => ({
    authorized: input.adapterId === ADAPTER_ID
      && input.host_installation_id === identity.host_installation_id
      && input.authenticated_account_id === identity.authenticated_account_id
      && input.root_id === rootId,
    ...rootIdentity,
  });
  const startCore = async () => {
    coreStore = new SQLiteStore(':memory:');
    coreJournal = new HostLifecycleJournal({
      path: coreDbPath,
      coordinatorPath,
      resolveIdentity: input => ({
        authorized: input.host_installation_id === identity.host_installation_id
          && input.authenticated_account_id === identity.authenticated_account_id,
        ...rootIdentity,
        host_session_id: input.host_session_id,
        conversation_uuid: input.conversation_uuid,
        adapter_id: ADAPTER_ID,
        authority_id: 'host-root-api-harness-authority',
        generation: 1,
        snapshot_fingerprint: 'a'.repeat(64),
      }),
      resolveRootIdentity: input => ({
        authorized: input.host_installation_id === identity.host_installation_id
          && input.authenticated_account_id === identity.authenticated_account_id
          && input.root_id === rootId,
        ...rootIdentity,
      }),
      verifyMutationReceipt: () => true,
    });
    coreServer = createApiServer({
      engine: new LogicEngine(coreStore),
      token: API_TOKEN,
      adapterTokens: { [ADAPTER_ID]: ADAPTER_TOKEN },
      hostRootInventoryJournal: coreJournal,
      resolveHostRootIdentity: resolveRootIdentity,
    });
    return await listen(coreServer);
  };

  const env = {
    LOGIC_ENGINE_CORE_URL: '',
    LOGIC_ENGINE_API_TOKEN: API_TOKEN,
    LOGIC_ENGINE_ADAPTER_ID: ADAPTER_ID,
    LOGIC_ENGINE_ADAPTER_TOKEN: ADAPTER_TOKEN,
  };
  env.LOGIC_ENGINE_CORE_URL = await startCore();
  const persistRootInventory = createHostRootInventoryPersistence({ env, identityStore });
  const filePath = join(root, 'chats', 'conversation.jsonl');
  await writeFile(filePath, 'digest-only baseline sentinel', 'utf8');

  const enumerate = async () => {
    const info = await stat(filePath);
    const bytes = await readFile(filePath);
    return [{
      path: 'chats/conversation.jsonl',
      identity: {
        dev: String(info.dev),
        ino: String(info.ino),
        mode: info.mode,
        size: info.size,
        mtimeMs: info.mtimeMs,
        ctimeMs: info.ctimeMs,
      },
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }];
  };
  const handler = createHostInventoryHandler({
    enumerate: async () => ({
      filesystem: { status: 'complete', entries: await enumerate(), snapshot_sha256: 'b'.repeat(64), file_count: 1, total_bytes: (await stat(filePath)).size },
      source: { status: 'complete', files: [], blockers: [] },
      snapshot_alignment: 'SHARED_VSS_SNAPSHOT',
    }),
    pinnedHostCommit: PINNED_HOST_COMMIT,
    hostBuildClaim: PINNED_HOST_COMMIT,
    persistRootInventory,
  });
  const request = {
    user: { profile: { handle: 'Harness User' }, directories: { root, chats: join(root, 'chats'), groups: join(root, 'groups'), groupChats: join(root, 'group chats') } },
    session: { handle: 'Harness User', logicEngineSessionId: SESSION_ID, logicEngineSessionHandle: 'Harness User' },
    query: { conversation_uuid: CONVERSATION_UUID },
  };
  const callInventory = async () => {
    const response = responseCapture();
    await handler(request, response);
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    return response.body;
  };

  const baseline = await callInventory();
  assert.equal(baseline.root_inventory_reconciliation.status, 'BASELINED_REVIEW_ONLY');
  assert.equal(baseline.root_inventory_reconciliation.integrity_status, 'INTEGRITY_OK');
  assert.equal(coreJournal.verifyRootInventory(rootIdentity).status, 'INTEGRITY_OK');

  await writeFile(filePath, 'changed file payload; raw bytes must not enter Core journal', 'utf8');
  const changed = await callInventory();
  assert.equal(changed.root_inventory_reconciliation.status, 'NON_READY');
  assert.equal(changed.root_inventory_reconciliation.counts.modified, 1);
  assert.equal(changed.root_inventory_reconciliation.sequence, 2);
  assert.equal(coreJournal.verifyRootInventory(rootIdentity).status, 'INTEGRITY_OK');
  const journalRows = coreJournal.db.prepare(
    'SELECT canonical_event_json FROM host_root_inventory_events'
  ).all();
  assert.equal(JSON.stringify(journalRows).includes('changed file payload'), false);

  await close(coreServer);
  coreJournal.close();
  coreStore.close();
  coreJournal = null;
  coreStore = null;
  coreServer = null;
  env.LOGIC_ENGINE_CORE_URL = await startCore();

  const afterRestart = await callInventory();
  assert.equal(afterRestart.root_inventory_reconciliation.status, 'NON_READY');
  assert.equal(afterRestart.root_inventory_reconciliation.integrity_status, 'INTEGRITY_OK');
  assert.equal(afterRestart.root_inventory_reconciliation.sequence, 2);
  assert.match(afterRestart.root_inventory_reconciliation.reason ?? '',
    /previously observed root inventory delta remains unresolved/);
  assert.equal(coreJournal.verifyRootInventory(rootIdentity).status, 'INTEGRITY_OK');
});
