import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { createApiServer } from '../src/api/server.js';

const TOKEN = 'trusted-acquisition-api-test-token';

test('public event API cannot commit a forged knowledge acquisition', async (t) => {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  engine.createWorld({
    world_id: 'api-acquisition-world',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2026-01-01T00:00:00Z',
  });
  const server = createApiServer({ engine, token: TOKEN });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.close();
    store.close();
  });

  const response = await fetch(
    'http://127.0.0.1:' + server.address().port + '/v1/worlds/api-acquisition-world/events',
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + TOKEN,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        idempotency_key: 'forged-api-acquisition',
        turn_id: 'untrusted-client',
        event_type: 'action.completed',
        expected_revision: 0,
        effects: [{
          kind: 'knowledge.acquire',
          acquisition_id: 'forged-acquisition',
          subject_id: 'npc-a',
          fact_id: 'fact-a',
          acquisition_kind: 'author_initial',
          provenance_ref: 'forged-source',
          provenance_digest: 'a'.repeat(64),
          authorization_ref: 'forged-rule',
        }],
      }),
    },
  );

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'DIRECT_COMMIT_DISABLED');
  assert.equal(engine.getState('api-acquisition-world').world_revision, 0);
  assert.equal(
    store.db.prepare('SELECT COUNT(*) AS n FROM knowledge_acquisitions WHERE world_id=?')
      .get('api-acquisition-world').n,
    0,
  );
});


test('initial knowledge assignment API requires admin credential and exposes only diagnostic projection', async (t) => {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  engine.createWorld({ world_id:'assignment-api-world', world_pack_id:'test.world', world_pack_version:'1.0.0', game_time:'2026-01-01T00:00:00Z' });
  engine.commitEvent('assignment-api-world', {
    idempotency_key:'seed-npc', turn_id:'seed-npc', event_type:'seed', expected_revision:0,
    effects:[{kind:'entity.create',entity_id:'npc-1',entity_type:'character'}],
  });
  const adminToken='separate-admin-assignment-token';
  const server=createApiServer({engine,token:TOKEN,adminToken});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(()=>{server.close();store.close();});
  const url='http://127.0.0.1:'+server.address().port+'/v1/worlds/assignment-api-world/knowledge-assignments';
  const body={assignment_id:'assignment-1',subject_id:'npc-1',item_id:'secret-item',source_kind:'author_initial',
    source_ref:'world_pack:test.world@1.0.0',source_version:'1.0.0',authorization_ref:'authoring-decision',expected_revision:1};
  const denied=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+TOKEN,'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal(denied.status,403);
  assert.equal((await denied.json()).error.code,'ADMIN_REQUIRED');
  assert.equal(engine.getState('assignment-api-world').world_revision,1);
  const created=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+TOKEN,'x-admin-token':adminToken,'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal(created.status,201);
  assert.equal((await created.json()).assignment.accepted,true);
  const readDenied=await fetch(url,{headers:{authorization:'Bearer '+TOKEN}});
  assert.equal(readDenied.status,403);
  const read=await fetch(url,{headers:{authorization:'Bearer '+TOKEN,'x-admin-token':adminToken}});
  assert.equal(read.status,200);
  const result=await read.json();
  assert.equal(result.knowledge.assignments.length,1);
  assert.equal(result.knowledge.assignments[0].subject_id,'npc-1');
});
