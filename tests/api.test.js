import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { createApiServer } from '../src/api/server.js';
test('health, auth, and host-neutral API',async t=>{const store=new SQLiteStore(':memory:'),server=createApiServer({engine:new LogicEngine(store),token:'test-token-long-enough-123456'});server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port,headers={authorization:'Bearer test-token-long-enough-123456','content-type':'application/json'};t.after(()=>{server.close();store.close();});assert.equal((await fetch(base+'/health')).status,200);assert.equal((await fetch(base+'/v1/worlds')).status,401);const c=await fetch(base+'/v1/worlds',{method:'POST',headers,body:JSON.stringify({world_id:'api-world',world_pack_id:'test.world',world_pack_version:'1.0.0',game_time:'2026-01-01T00:00:00Z'})});assert.equal(c.status,201);const e=await fetch(base+'/v1/worlds/api-world/events',{method:'POST',headers,body:JSON.stringify({idempotency_key:'api-1',turn_id:'turn-1',event_type:'action.completed',expected_revision:0,effects:[{kind:'entity.upsert',entity_id:'npc',entity_type:'character',attributes:{name:'Mira'}}]})});assert.equal((await e.json()).world_revision,1);const s=await fetch(base+'/v1/worlds/api-world/state',{headers});assert.equal((await s.json()).state.entities[0].attributes.name,'Mira');});

test('API registers a generation-bound context manifest and commits against it', async (t) => {
  const store = new SQLiteStore(':memory:');
  const server = createApiServer({ engine: new LogicEngine(store), token: 'test-token-long-enough-123456' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const headers = { authorization: 'Bearer test-token-long-enough-123456', 'content-type': 'application/json' };
  t.after(() => { server.close(); store.close(); });

  const created = await fetch(base + '/v1/worlds', {
    method: 'POST', headers,
    body: JSON.stringify({ world_id: 'manifest-api-world', world_pack_id: 'test.world', world_pack_version: '1.0.0', game_time: '2026-01-01T00:00:00Z' }),
  });
  assert.equal(created.status, 201);

  const registered = await fetch(base + '/v1/worlds/manifest-api-world/context-manifests', {
    method: 'POST', headers,
    body: JSON.stringify({ generation_id: 'api-generation-1', base_commit_sequence: 0, base_world_revision: 0, items: [] }),
  });
  assert.equal(registered.status, 201);
  const manifest = (await registered.json()).context_manifest;
  assert.ok(manifest.manifest_id);

  const committed = await fetch(base + '/v1/worlds/manifest-api-world/events', {
    method: 'POST', headers,
    body: JSON.stringify({
      idempotency_key: 'api-manifest-event', turn_id: 'api-manifest-turn', event_type: 'action.completed',
      expected_revision: 0, generation_id: 'api-generation-1', context_manifest_id: manifest.manifest_id, effects: [],
    }),
  });
  assert.equal(committed.status, 200);
  assert.equal((await committed.json()).commit_sequence, 1);
});
