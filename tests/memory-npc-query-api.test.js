import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { createApiServer } from '../src/api/server.js';

const TOKEN = 'api-token-for-memory-npc-query-tests-00000000000000000000000000000001';
const ADAPTER = 'adapter-token-for-memory-npc-query-tests-00000000000000000000000000000002';
const headers = {
  authorization: 'Bearer ' + TOKEN,
  'content-type': 'application/json',
  'x-adapter-id': 'adapter-a',
  'x-adapter-token': ADAPTER,
};
const json = (body) => JSON.stringify(body);

async function setup(t, consumer) {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  const server = createApiServer({
    engine,
    token: TOKEN,
    adapterTokens: { 'adapter-a': ADAPTER },
    memoryNpcConsumer: consumer,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); store.close(); });
  return 'http://127.0.0.1:' + server.address().port;
}

test('Memory/NPC query requires both API and authenticated adapter credentials and accepts no caller world/purpose', async (t) => {
  const consumer = {
    async retrieveForNpc(request) {
      assert.deepEqual(request, {
        adapterId: 'adapter-a',
        conversationId: 'conversation-a',
        actorEntityId: 'actor-a',
      });
      return {
        status: 'ready',
        snapshot: { world_revision: 4, commit_sequence: 9 },
        candidates: [{
          record_ref: 'record-a',
          record_version: 'version-a',
          source_entity_id: 'entity-a',
          source_version: 'core-entity-v1:2',
          content: { 'attributes.name': 'Server-side canonical content' },
        }],
      };
    },
  };
  const base = await setup(t, consumer);
  const anonymousAdapter = await fetch(base + '/v1/memory/npc/query', {
    method: 'POST',
    headers: { authorization: headers.authorization, 'content-type': 'application/json' },
    body: json({ conversation_id: 'conversation-a', actor_entity_id: 'actor-a' }),
  });
  assert.equal(anonymousAdapter.status, 403);

  const spoofedScope = await fetch(base + '/v1/memory/npc/query', {
    method: 'POST',
    headers,
    body: json({ conversation_id: 'conversation-a', actor_entity_id: 'actor-a', world_id: 'world-spoofed' }),
  });
  assert.equal(spoofedScope.status, 400);

  const response = await fetch(base + '/v1/memory/npc/query', {
    method: 'POST',
    headers,
    body: json({ conversation_id: 'conversation-a', actor_entity_id: 'actor-a' }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'ready');
  assert.deepEqual(body.snapshot, { world_revision: 4, commit_sequence: 9 });
  assert.equal(body.candidates[0].content['attributes.name'], 'Server-side canonical content');
});

test('Memory/NPC query fails closed when consumer is unconfigured or non-ready', async (t) => {
  const base = await setup(t, null);
  const unavailable = await fetch(base + '/v1/memory/npc/query', {
    method: 'POST',
    headers,
    body: json({ conversation_id: 'conversation-a', actor_entity_id: 'actor-a' }),
  });
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).error.code, 'MEMORY_NPC_NOT_READY');

  const nonReadyBase = await setup(t, {
    async retrieveForNpc() { return { status: 'non_ready', reason: 'private-internal-reason' }; },
  });
  const nonReady = await fetch(nonReadyBase + '/v1/memory/npc/query', {
    method: 'POST',
    headers,
    body: json({ conversation_id: 'conversation-a', actor_entity_id: 'actor-a' }),
  });
  assert.equal(nonReady.status, 503);
  const body = await nonReady.json();
  assert.equal(body.error.code, 'MEMORY_NPC_NOT_READY');
  assert.equal(JSON.stringify(body).includes('private-internal-reason'), false);
});
