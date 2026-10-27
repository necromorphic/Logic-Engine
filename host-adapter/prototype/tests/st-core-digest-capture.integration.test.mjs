import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '../../../src/storage/sqlite-store.js';
import { LogicEngine } from '../../../src/application/engine.js';
import { HostVersionDigestLedger } from '../../../src/application/host-version-digest-ledger.js';
import { SQLiteMemoryProvider } from '../../../src/application/sqlite-memory-provider.js';
import { createApiServer } from '../../../src/api/server.js';
import { createHostDigestProxyHandler } from '../st-server-digest-proxy.mjs';
import { getHostConversationInventory, recordHostCaptureAcknowledgement, recordHostCaptureConflict, registerHostConversation } from '../server-lifecycle-mutation-journal.mjs';

const API_TOKEN = 'integration-api-token-long-enough';
const ADMIN_TOKEN = 'integration-admin-token-long-enough';
const ADAPTER_TOKEN = 'integration-adapter-token-long-enough';
const digest = value => createHash('sha256').update(JSON.stringify(String(value))).digest('hex');
const json = (value) => JSON.stringify(value);

test('real Host → Core → Provider path preserves digest-only capture and fails closed on non-ready inventory', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'st-core-digest-capture-'));
  const hostDirectories = {
    chats: join(directory, 'chats'),
    groups: join(directory, 'groups'),
    groupChats: join(directory, 'group_chats'),
    backups: join(directory, 'backups'),
  };
  for (const root of Object.values(hostDirectories)) mkdirSync(root, { recursive: true });
  const conversationUuid = randomUUID();
  const installationUuid = randomUUID();
  const conversationId = installationUuid + ':' + conversationUuid;
  const messageId = randomUUID();
  const versionId = randomUUID();
  const persistedText = 'a';
  const hostRequest = { user: { profile: { handle: 'host-proxy-integration' }, directories: hostDirectories } };
  const processEnvKeys = ['LOGIC_ENGINE_CORE_URL', 'LOGIC_ENGINE_API_TOKEN', 'LOGIC_ENGINE_ADAPTER_ID', 'LOGIC_ENGINE_ADAPTER_TOKEN'];
  const priorProcessEnv = Object.fromEntries(processEnvKeys.map(key => [key, process.env[key]]));
  writeFileSync(join(hostDirectories.chats, 'chat-a.jsonl'), [
    JSON.stringify({ chat_metadata: { logic_engine_conversation_id: conversationUuid } }),
    JSON.stringify({
      mes: persistedText,
      swipes: [persistedText],
      swipe_id: 0,
      _logicEngineLifecycle: {
        messageId,
        activeVersionIndex: 0,
        versions: [{ versionId, payloadDigest: digest(persistedText), parentVersionId: null }],
      },
    }),
  ].join('\n') + '\n');
  await registerHostConversation(hostRequest, {
    conversationId, sourceLocator: 'chat-a', sourcePath: 'chat-a.jsonl', domain: 'chats',
  });
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  engine.createWorld({
    world_id: 'host-proxy-integration-world',
    world_pack_id: 'test.host-proxy-integration',
    world_pack_version: '1',
    game_time: '2026-01-01T00:00:00Z',
  });
  const ledger = new HostVersionDigestLedger({
    path: join(directory, 'host-versions.sqlite'),
    coordinatorPath: join(directory, 'coordinator.sqlite'),
    // Intentionally deny inventory readiness: this test proves transport and
    // canonical binding only, not complete inventory or production readiness.
    verifyInventorySnapshot: async () => false,
  });
  const server = createApiServer({
    engine,
    token: API_TOKEN,
    adminToken: ADMIN_TOKEN,
    adapterTokens: { 'st-desktop': ADAPTER_TOKEN },
    hostVersionLedger: ledger,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const coreUrl = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => {
    for (const key of processEnvKeys) {
      if (priorProcessEnv[key] === undefined) delete process.env[key];
      else process.env[key] = priorProcessEnv[key];
    }
    await new Promise((resolve) => server.close(resolve));
    ledger.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const binding = await fetch(coreUrl + '/v1/host-conversation-bindings', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + API_TOKEN,
      'x-admin-token': ADMIN_TOKEN,
      'content-type': 'application/json',
    },
    body: json({
      adapter_id: 'st-desktop',
      conversation_id: conversationId,
      world_id: 'host-proxy-integration-world',
    }),
  });
  assert.equal(binding.status, 201);

  const env = {
    LOGIC_ENGINE_CORE_URL: coreUrl,
    LOGIC_ENGINE_API_TOKEN: API_TOKEN,
    LOGIC_ENGINE_ADAPTER_ID: 'st-desktop',
    LOGIC_ENGINE_ADAPTER_TOKEN: ADAPTER_TOKEN,
  };
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  const acceptedCaptures = [];
  const rejectedCaptures = [];
  const handler = createHostDigestProxyHandler({
    env,
    onAcceptedCapture: async (request, capture) => {
      await recordHostCaptureAcknowledgement(request, capture);
      acceptedCaptures.push(capture);
    },
    onRejectedCapture: async (request, capture, status) => {
      await recordHostCaptureConflict(request, capture, status);
      rejectedCaptures.push(capture);
    },
  });
  const invoke = async (body) => {
    const response = {
      statusCode: null,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(value) { this.body = value; return this; },
    };
    await handler({ ...hostRequest, body }, response);
    return response;
  };

  const capture = await invoke({
    conversation_id: conversationId,
    message_id: messageId,
    version_id: versionId,
    content_sha256: digest(persistedText),
    active: true,
    deleted: false,
  });
  assert.equal(capture.statusCode, 201);
  assert.deepEqual(capture.body, { ok: true, inventory_status: 'NON_READY' });
  assert.equal(acceptedCaptures.length, 1, 'local journal acknowledgement follows accepted Core capture');
  assert.equal(acceptedCaptures[0].message_id, messageId);
  assert.equal(acceptedCaptures[0].deleted, false);
  const currentInventory = await getHostConversationInventory(hostRequest, { requireCoreInventory: true });
  assert.equal(currentInventory.complete, false);
  assert.equal(currentInventory.status, 'INVENTORY_INCOMPLETE');
  assert.ok(currentInventory.errors.includes('CORE_HOST_INVENTORY_NOT_READY'));
  assert.equal(currentInventory.inventories.length, 0);
  assert.equal(currentInventory.versionCount, 1);

  const stored = ledger.db.prepare(
    'SELECT world_id, conversation_id, message_id, version_id, content_sha256, lifecycle FROM host_version_digest_ledger',
  ).all();
  assert.deepEqual(stored.map((row) => ({ ...row })), [{
    world_id: 'host-proxy-integration-world',
    conversation_id: conversationId,
    message_id: messageId,
    version_id: versionId,
    content_sha256: digest(persistedText),
    lifecycle: 'present',
  }]);

  const conflict = await invoke({
    conversation_id: conversationId,
    message_id: messageId,
    version_id: versionId,
    content_sha256: digest('b'),
    active: true,
    deleted: false,
  });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.body.error.code, 'LOGIC_ENGINE_CAPTURE_REJECTED');
  assert.equal(acceptedCaptures.length, 1, 'conflicting capture must not be journaled as accepted');
  assert.equal(rejectedCaptures.length, 1, 'Core conflict must be recorded as a durable blocker');
  const conflictedInventory = await getHostConversationInventory(hostRequest);
  assert.equal(conflictedInventory.complete, false);
  assert.ok(conflictedInventory.errors.includes('CORE_CAPTURE_CONFLICT_RECORDED'));
  assert.equal(ledger.getInventoryState('host-proxy-integration-world', conversationId).status, 'NON_READY');

  // Exercise the actual SQLite Memory Provider against the Core-owned Host
  // inventory state. A captured digest/conflict is not sufficient to publish a
  // current Provider index; the trusted inventory gate must remain closed.
  const memoryProvider = new SQLiteMemoryProvider({
    getSnapshot: async () => ({ world_revision: 1, commit_sequence: 1 }),
    validateSourceVersion: async () => true,
    validateInventory: async (worldId) =>
      ledger.getInventoryState(worldId, conversationId)?.status === 'READY',
  });
  t.after(() => memoryProvider.close());
  const scope = {
    world_id: 'host-proxy-integration-world',
    subject_id: 'npc-host-proxy-integration',
    purpose: 'npc_decision',
  };
  const record = {
    ...scope,
    record_ref: 'memory:host-boundary-record',
    record_version: 'v1',
    source_kind: 'canonical_entity',
    source_entity_id: 'canonical-source',
    source_version: 'source-v1',
    content_kind: 'claim',
    epistemic_kind: 'acquired_report',
    producer_kind: 'memory-index',
    content_disposition: 'usable',
    evidence_assessment: 'unassessed',
    lineage: [{ source_kind: 'canonical_entity', entity_id: 'canonical-source', source_version: 'source-v1' }],
  };
  memoryProvider.grantQuery(scope, true);
  memoryProvider.putRecord(record);
  memoryProvider.grantRecord(scope, record.record_ref, record.record_version, true);
  await memoryProvider.rebuildIndex(scope.world_id);
  assert.equal((await memoryProvider.reconcile(scope.world_id)).status, 'stale');
  await assert.rejects(
    () => memoryProvider.retrieveCandidates(scope),
    /MEMORY_INDEX_NOT_READY/,
  );
  assert.equal(JSON.stringify(capture.body).includes(messageId), false);
  assert.equal(JSON.stringify(conflict.body).includes('integration-api-token'), false);
});
