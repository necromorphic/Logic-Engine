import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createHostDigestProxyHandler } from '../host-adapter/prototype/st-server-digest-proxy.mjs';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { HostVersionDigestLedger } from '../src/application/host-version-digest-ledger.js';
import { createApiServer } from '../src/api/server.js';
import { ActorBindingService } from '../src/application/actor-bindings.js';
import { AuthorizedReadService } from '../src/application/authorized-read-service.js';
import { MemoryNpcConsumer } from '../src/application/memory-npc-consumer.js';
import { createCanonicalEntitySourceVersionValidator } from '../src/application/canonical-entity-source-version.js';
import { SQLiteMemoryProvider } from '../src/application/sqlite-memory-provider.js';

const TOKEN = 'e2e-api-token-long-enough-123456';
const ADMIN = 'e2e-admin-token-long-enough-123456';
const ADAPTER = 'e2e-adapter-token-long-enough-123456';
const WORLD = 'host-provider-core-npc-e2e-world';
const CONVERSATION = 'host-provider-core-npc-e2e-chat';
const ACTOR = 'host-provider-core-npc-e2e-actor';
const headers = { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' };
const json = (body) => JSON.stringify(body);

function responseRecorder() {
  return {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

test('Host digest proxy → real Core HTTP ledger → Provider/NPC fails closed without approved inventory or raw capture', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-host-provider-core-npc-e2e-'));
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  engine.createWorld({
    world_id: WORLD,
    world_pack_id: 'test.host-provider-core-npc-e2e',
    world_pack_version: '1',
    game_time: '2026-01-01T00:00:00Z',
  });
  engine.commitEvent(WORLD, {
    event_id: 'e2e-seed',
    idempotency_key: 'e2e-seed',
    turn_id: 'e2e-seed',
    event_type: 'action.completed',
    expected_revision: 0,
    effects: [{
      kind: 'entity.create',
      entity_id: ACTOR,
      entity_type: 'character',
      attributes: { name: 'E2E NPC' },
    }],
  });

  const ledger = new HostVersionDigestLedger({
    path: join(directory, 'host-ledger.sqlite'),
    coordinatorPath: join(directory, 'coordinator.sqlite'),
    // Mirrors the current runtime: no trusted complete-inventory adapter is wired.
    verifyInventorySnapshot: async () => false,
  });
  const server = createApiServer({
    engine,
    token: TOKEN,
    adminToken: ADMIN,
    adapterTokens: { 'e2e-adapter': ADAPTER },
    hostVersionLedger: ledger,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;

  let provider;
  t.after(async () => {
    try { provider?.close(); } catch {}
    await new Promise((resolve) => server.close(resolve));
    ledger.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  // Bind the Host conversation to the canonical world through the real Core HTTP API.
  const binding = await fetch(base + '/v1/host-conversation-bindings', {
    method: 'POST',
    headers: { ...headers, 'x-admin-token': ADMIN },
    body: json({
      adapter_id: 'e2e-adapter',
      conversation_id: CONVERSATION,
      world_id: WORLD,
    }),
  });
  assert.equal(binding.status, 201);

  // The actual Host proxy performs a real HTTP request to the Core server.
  const proxy = createHostDigestProxyHandler({
    env: {
      LOGIC_ENGINE_CORE_URL: base,
      LOGIC_ENGINE_API_TOKEN: TOKEN,
      LOGIC_ENGINE_ADAPTER_ID: 'e2e-adapter',
      LOGIC_ENGINE_ADAPTER_TOKEN: ADAPTER,
    },
  });
  const proxyResponse = responseRecorder();
  await proxy({
    body: {
      conversation_id: CONVERSATION,
      message_id: 'host-message-1',
      version_id: 'host-version-1',
      content_sha256: 'a'.repeat(64),
      active: true,
      deleted: false,
    },
  }, proxyResponse);

  assert.equal(proxyResponse.statusCode, 201);
  assert.deepEqual(proxyResponse.payload, { ok: true, inventory_status: 'NON_READY' });
  const stored = ledger.db.prepare(
    'SELECT world_id,conversation_id,message_id,version_id,content_sha256 FROM host_version_digest_ledger',
  ).all().map((row) => ({ ...row }));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].world_id, WORLD);
  assert.equal(stored[0].conversation_id, CONVERSATION);
  assert.equal(stored[0].message_id, 'host-message-1');
  assert.equal(stored[0].version_id, 'host-version-1');
  assert.equal(stored[0].content_sha256, 'a'.repeat(64));

  // A claimed complete inventory is still denied by the runtime's deny-only verifier.
  const inventory = await ledger.reconcileConversation({
    world_id: WORLD,
    conversation_id: CONVERSATION,
    complete: true,
    versions: [{
      world_id: WORLD,
      conversation_id: CONVERSATION,
      message_id: 'host-message-1',
      version_id: 'host-version-1',
      content_sha256: 'a'.repeat(64),
      active: true,
      deleted: false,
    }],
  });
  assert.deepEqual(inventory, { status: 'non_ready', code: 'HOST_INVENTORY_NOT_AUTHORIZED' });

  const bindings = new ActorBindingService(engine);
  bindings.bind(WORLD, 'e2e-adapter', ACTOR);
  const scope = { world_id: WORLD, subject_id: ACTOR, purpose: 'npc_decision' };
  const canonicalValidator = createCanonicalEntitySourceVersionValidator(engine);
  provider = new SQLiteMemoryProvider({
    path: ':memory:',
    coordinatorPath: null,
    getSnapshot: async (worldId) => {
      const snapshot = engine.getSnapshot(worldId);
      return { world_revision: snapshot.world_revision, commit_sequence: snapshot.commit_sequence };
    },
    validateSourceVersion: async (record) => canonicalValidator(record),
    // Current Provider contract requires this callback; production inventory proof is unavailable.
    validateInventory: async () => false,
  });
  provider.grantQuery(scope, true);

  // The semantic/raw Host-to-Memory ingestion entry point is intentionally closed today.
  assert.throws(() => provider.captureRawMessage({
    world_id: WORLD,
    conversation_id: CONVERSATION,
    message_id: 'host-message-1',
    version_id: 'host-version-1',
    role: 'user',
    content: 'must not be retained by the current production path',
  }), /MEMORY_RAW_CAPTURE_NOT_APPROVED/);

  await provider.rebuildIndex(WORLD);
  const reconciliation = await provider.reconcile(WORLD);
  assert.notEqual(reconciliation.status, 'ready');

  const authorizedRead = new AuthorizedReadService(engine, bindings, (_context, _entity, field) => field === 'entity_id');
  const consumer = new MemoryNpcConsumer({
    authorizedReadService: authorizedRead,
    actorBindingService: bindings,
    memoryProvider: provider,
    contentFields: ['attributes.public_note'],
  });
  const npcResult = await consumer.retrieveForNpc({
    worldId: WORLD,
    adapterId: 'e2e-adapter',
    actorEntityId: ACTOR,
  });
  assert.equal(npcResult.status, 'non_ready');
  assert.deepEqual(npcResult.admitted, []);
});
