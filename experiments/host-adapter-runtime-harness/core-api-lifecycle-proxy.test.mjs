import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';

import { createApiServer } from '../../src/api/server.js';
import { LogicEngine } from '../../src/application/engine.js';
import { HostLifecycleJournal } from '../../src/application/host-lifecycle-journal.js';
import { SQLiteStore } from '../../src/storage/sqlite-store.js';
import { HostIdentityStore } from '../../host-adapter/prototype/st-host-identity-store.mjs';
import { HostLifecycleReceiptStore } from '../../host-adapter/prototype/st-host-lifecycle-receipt-store.mjs';
import { createHostInventoryHandler } from '../../host-adapter/prototype/st-host-inventory-handler.mjs';
import { createHostLifecycleJournalProxy, createHostRootInventoryPersistence } from '../../host-adapter/prototype/st-server-digest-proxy.mjs';

const PINNED_HOST_COMMIT = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';
const API_TOKEN = 'host-lifecycle-api-token-0123456789';
const ADAPTER_ID = 'st-1.19-lifecycle-api-harness';
const ADAPTER_TOKEN = 'host-lifecycle-adapter-token-0123456789';
const SESSION_ID = '99999999-9999-4999-8999-999999999999';
const CONVERSATION_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const AUTHORITY_ID = 'st-1.19-lifecycle-api-harness-authority';
const digest = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);

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
function message(mes, messageId, versionId) {
  return {
    name: 'Harness User',
    is_user: true,
    mes,
    send_date: '2026-10-31T00:00:00.000Z',
    _logicEngineLifecycle: {
      messageId,
      versions: [{
        versionId,
        versionIndex: 0,
        payloadDigest: digest(mes),
        parentVersionId: null,
      }],
      activeVersionIndex: 0,
    },
  };
}

test('SillyTavern lifecycle proxy authenticates PREPARED/COMMITTED receipts and recovers pending mutations through Core API after restart', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'logic-engine-host-lifecycle-api-'));
  const root = join(parent, 'st-data');
  const chats = join(root, 'chats');
  const groups = join(root, 'groups');
  const groupChats = join(root, 'group chats');
  const identityDirectory = join(parent, 'host-identity');
  const coreDirectory = join(parent, 'core-state');
  const coreDbPath = join(coreDirectory, 'host-lifecycle.sqlite');
  const coordinatorPath = join(coreDirectory, 'coordinator.sqlite');
  const filePath = join(chats, 'conversation.jsonl');
  await Promise.all([
    mkdir(chats, { recursive: true }),
    mkdir(groups, { recursive: true }),
    mkdir(groupChats, { recursive: true }),
    mkdir(identityDirectory, { recursive: true }),
    mkdir(coreDirectory, { recursive: true }),
  ]);

  let coreJournal = null;
  let coreStore = null;
  let coreServer = null;
  t.after(async () => {
    await close(coreServer);
    try { coreJournal?.close(); } catch {}
    try { coreStore?.close(); } catch {}
    await rm(parent, { recursive: true, force: true });
  });

  let identityStore = new HostIdentityStore({ directory: identityDirectory });
  const identity = await identityStore.resolveAuthenticatedAccount('Harness User');
  const rootId = digest(resolve(root));
  const rootIdentity = {
    host_installation_id: identity.host_installation_id,
    authenticated_account_id: identity.authenticated_account_id,
    root_id: rootId,
  };
  const directories = { root, chats, groups, groupChats };

  const enumerate = async () => {
    const bytes = await readFile(filePath);
    const records = bytes.toString('utf8').trim().split('\n').map(line => JSON.parse(line));
    const info = await stat(filePath);
    const contentSha = createHash('sha256').update(bytes).digest('hex');
    const lifecycleMessages = records.slice(1).map(record => {
      const lifecycle = record._logicEngineLifecycle;
      return {
        message_id: lifecycle.messageId,
        active_version_index: lifecycle.activeVersionIndex,
        versions: lifecycle.versions.map(version => ({
          version_id: version.versionId,
          version_index: version.versionIndex,
          parent_version_id: version.parentVersionId ?? null,
          content_sha256: version.payloadDigest,
          active: version.versionIndex === lifecycle.activeVersionIndex,
        })),
      };
    });
    const entry = {
      path: 'chats/conversation.jsonl',
      identity: {
        dev: String(info.dev),
        ino: String(info.ino),
        mode: info.mode,
        size: info.size,
        mtimeMs: info.mtimeMs,
        ctimeMs: info.ctimeMs,
      },
      sha256: contentSha,
    };
    const target = {
      kind: 'root-chat',
      locator: 'conversation.jsonl',
      file_identity: String(info.dev) + ':' + String(info.ino),
      content_sha256: contentSha,
      logical_identity: {
        conversation_uuid: CONVERSATION_UUID,
        identity_status: 'CURRENT_IDENTITIES_VERIFIED',
        missing_message_identity_count: 0,
        messages: lifecycleMessages,
      },
    };
    return {
      filesystem: {
        status: 'complete',
        entries: [entry],
        snapshot_sha256: digest(JSON.stringify(entry)),
        file_count: 1,
        total_bytes: info.size,
      },
      source: {
        status: 'DOUBLE_SCAN_CANDIDATE',
        host_commit: PINNED_HOST_COMMIT,
        files: [target],
        blockers: [],
        inventory_sha256: digest(contentSha),
      },
      snapshot_alignment: 'SHARED_VSS_SNAPSHOT',
    };
  };

  const env = {
    LOGIC_ENGINE_CORE_URL: '',
    LOGIC_ENGINE_API_TOKEN: API_TOKEN,
    LOGIC_ENGINE_ADAPTER_ID: ADAPTER_ID,
    LOGIC_ENGINE_ADAPTER_TOKEN: ADAPTER_TOKEN,
  };
  const resolveRootIdentity = input => ({
    authorized: input.adapterId === ADAPTER_ID
      && input.host_installation_id === identity.host_installation_id
      && input.authenticated_account_id === identity.authenticated_account_id
      && input.root_id === rootId,
    ...rootIdentity,
  });

  const resolveTrustedLifecycleIdentity = input => {
    const authorized = input.adapterId === ADAPTER_ID
      && input.host_installation_id === identity.host_installation_id
      && input.authenticated_account_id === identity.authenticated_account_id
      && input.host_session_id === SESSION_ID
      && input.conversation_uuid === CONVERSATION_UUID;
    if (!authorized) return { authorized: false };
    const trusted = {
      authorized: true,
      adapter_id: ADAPTER_ID,
      ...rootIdentity,
      host_session_id: SESSION_ID,
      conversation_uuid: CONVERSATION_UUID,
      authority_id: AUTHORITY_ID,
      generation: 1,
    };
    const snapshot = coreJournal.getAuthoritySnapshot(trusted);
    if (snapshot.status !== 'INTEGRITY_OK') return { authorized: false };
    return { ...trusted, snapshot_fingerprint: snapshot.snapshot_fingerprint };
  };

  const verifyReceipt = ({ event, identity: trusted }) => {
    if (typeof event.receipt_signature !== 'string' || !/^[a-f0-9]{64}$/.test(event.receipt_signature)) return false;
    const proof = {
      protocol_version: 1,
      adapter_id: trusted.adapter_id,
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
    const expected = createHmac('sha256', ADAPTER_TOKEN).update(canonical(proof), 'utf8').digest();
    const supplied = Buffer.from(event.receipt_signature, 'hex');
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  };

  const startCore = async () => {
    coreStore = new SQLiteStore(':memory:');
    coreJournal = new HostLifecycleJournal({
      path: coreDbPath,
      coordinatorPath,
      resolveIdentity: input => resolveTrustedLifecycleIdentity({ ...input, adapterId: ADAPTER_ID }),
      resolveRootIdentity: input => ({
        authorized: input.host_installation_id === identity.host_installation_id
          && input.authenticated_account_id === identity.authenticated_account_id
          && input.root_id === rootId,
        ...rootIdentity,
      }),
      verifyMutationReceipt: verifyReceipt,
    });
    if (!authorityGenerationInitialized) {
      coreJournal.setAuthorityGeneration(AUTHORITY_ID, 1);
      authorityGenerationInitialized = true;
    }
    coreServer = createApiServer({
      engine: new LogicEngine(coreStore),
      token: API_TOKEN,
      adapterTokens: { [ADAPTER_ID]: ADAPTER_TOKEN },
      hostRootInventoryJournal: coreJournal,
      resolveHostRootIdentity: resolveRootIdentity,
      hostLifecycleJournal: coreJournal,
      resolveHostLifecycleIdentity: resolveTrustedLifecycleIdentity,
    });
    return await listen(coreServer);
  };
  let authorityGenerationInitialized = false;
  env.LOGIC_ENGINE_CORE_URL = await startCore();

  const persistRootInventory = createHostRootInventoryPersistence({ env, identityStore });
  const inventoryHandler = createHostInventoryHandler({
    enumerate,
    pinnedHostCommit: PINNED_HOST_COMMIT,
    hostBuildClaim: PINNED_HOST_COMMIT,
    persistRootInventory,
  });
  const hostRequest = {
    user: { profile: { handle: 'Harness User' }, directories },
    session: {
      handle: 'Harness User',
      logicEngineSessionId: SESSION_ID,
      logicEngineSessionHandle: 'Harness User',
    },
    query: { conversation_uuid: CONVERSATION_UUID },
  };
  const inventoryResponse = responseCapture();
  const initialHeader = {
    user_name: 'Harness User',
    name: 'Harness Character',
    chat_metadata: { logic_engine_conversation_id: CONVERSATION_UUID },
  };
  await writeFile(filePath, JSON.stringify(initialHeader) + '\n' + JSON.stringify(
    message('before', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
  ) + '\n');
  await inventoryHandler(hostRequest, inventoryResponse);
  assert.equal(inventoryResponse.statusCode, 200, JSON.stringify(inventoryResponse.body));
  assert.equal(inventoryResponse.body.root_inventory_reconciliation.status, 'BASELINED_REVIEW_ONLY');
  assert.equal(coreJournal.verifyRootInventory(rootIdentity).status, 'INTEGRITY_OK');

  const receiptStore = new HostLifecycleReceiptStore({
    directory: join(identityDirectory, 'lifecycle-receipts'),
    enumerate,
    hostCommit: PINNED_HOST_COMMIT,
  });
  let lifecycleProxy = createHostLifecycleJournalProxy({ env, identityStore, receiptStore });
  const conversationId = SESSION_ID + ':' + identity.host_installation_id + ':' + CONVERSATION_UUID;
  const lifecycleRequest = event => ({
    user: { profile: { handle: 'Harness User' }, directories },
    session: {
      handle: 'Harness User',
      logicEngineSessionId: SESSION_ID,
      logicEngineSessionHandle: 'Harness User',
    },
    body: { conversation_id: conversationId, ...event },
    query: { conversation_id: conversationId },
  });
  const append = async event => {
    const response = responseCapture();
    await lifecycleProxy.append(lifecycleRequest(event), response);
    return response;
  };
  const status = async () => {
    const response = responseCapture();
    await lifecycleProxy.status(lifecycleRequest({}), response);
    return response;
  };

  const firstMutationId = randomUUID();
  const firstMutationDigest = digest('create-message:conversation:message-2');
  const preparedEvent = {
    event_id: randomUUID(),
    event_type: 'MUTATION_PREPARED',
    mutation_id: firstMutationId,
    operation: 'create-message',
    mutation_digest: firstMutationDigest,
    occurred_at: new Date().toISOString(),
  };
  const prepared = await append(preparedEvent);
  assert.equal(prepared.statusCode, 201, JSON.stringify(prepared.body));
  assert.equal(prepared.body.lifecycle.status, 'appended');
  const preparedReplay = await append(preparedEvent);
  assert.equal(preparedReplay.statusCode, 200, JSON.stringify(preparedReplay.body));
  assert.equal(preparedReplay.body.lifecycle.status, 'duplicate');

  const secondMessage = message(
    'created by the prepared mutation',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'ffffffff-ffff-4fff-8fff-ffffffffffff'
  );
  await writeFile(filePath, (await readFile(filePath, 'utf8')) + JSON.stringify(secondMessage) + '\n');
  const committed = await append({
    event_id: randomUUID(),
    event_type: 'MUTATION_COMMITTED',
    mutation_id: firstMutationId,
    operation: 'create-message',
    mutation_digest: firstMutationDigest,
    occurred_at: new Date().toISOString(),
  });
  assert.equal(committed.statusCode, 201, JSON.stringify(committed.body));
  assert.equal(committed.body.lifecycle.status, 'appended');
  const committedStatus = await status();
  assert.equal(committedStatus.statusCode, 200, JSON.stringify(committedStatus.body));
  assert.equal(committedStatus.body.lifecycle.status, 'NO_PENDING_MUTATION');

  const pendingMutationId = randomUUID();
  const pendingMutationDigest = digest('create-message:crash-before-file-write');
  const pendingPreparedEvent = {
    event_id: randomUUID(),
    event_type: 'MUTATION_PREPARED',
    mutation_id: pendingMutationId,
    operation: 'create-message',
    mutation_digest: pendingMutationDigest,
    occurred_at: new Date().toISOString(),
  };
  const pendingPrepared = await append(pendingPreparedEvent);
  assert.equal(pendingPrepared.statusCode, 201, JSON.stringify(pendingPrepared.body));
  assert.equal(pendingPrepared.body.lifecycle.status, 'appended');

  await close(coreServer);
  coreJournal.close();
  coreStore.close();
  coreServer = null;
  coreJournal = null;
  coreStore = null;
  identityStore = new HostIdentityStore({ directory: identityDirectory });
  const restartedIdentity = await identityStore.resolveAuthenticatedAccount('Harness User');
  assert.equal(restartedIdentity.host_installation_id, identity.host_installation_id);
  assert.equal(restartedIdentity.authenticated_account_id, identity.authenticated_account_id);
  env.LOGIC_ENGINE_CORE_URL = await startCore();
  const restartedReceiptStore = new HostLifecycleReceiptStore({
    directory: join(identityDirectory, 'lifecycle-receipts'),
    enumerate,
    hostCommit: PINNED_HOST_COMMIT,
  });
  lifecycleProxy = createHostLifecycleJournalProxy({ env, identityStore, receiptStore: restartedReceiptStore });

  const recoveredStatus = await status();
  assert.equal(recoveredStatus.statusCode, 200, JSON.stringify(recoveredStatus.body));
  assert.equal(recoveredStatus.body.lifecycle.status, 'NO_PENDING_MUTATION');
  assert.equal(coreJournal.verifyChain(identity.host_installation_id, identity.authenticated_account_id).valid, true);
  const rows = coreJournal.db.prepare(
    'SELECT canonical_event_json FROM host_lifecycle_events ORDER BY sequence'
  ).all();
  const serialized = JSON.stringify(rows);
  assert.equal(serialized.includes('created by the prepared mutation'), false,
    'Core lifecycle journal must persist digests and receipts, never message text');
  assert.equal(rows.length, 4, 'prepare/commit plus crash-recovery prepare/abort must be durable');
});
