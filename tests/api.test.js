import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { createApiServer } from '../src/api/server.js';

const TOKEN = 'test-token-long-enough-123456';
const INTERNAL = 'internal-token-long-enough-123456';
const APPROVAL = 'approval-token-long-enough-123456';
const headers = { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' };
const json = (body) => JSON.stringify(body);

async function setup(t, options = {}) {
  const store = new SQLiteStore(':memory:');
  const server = createApiServer({ engine: new LogicEngine(store), token: TOKEN, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); store.close(); });
  return 'http://127.0.0.1:' + server.address().port;
}
async function createWorld(base, worldId, extraHeaders = headers) {
  return fetch(base + '/v1/worlds', {
    method: 'POST', headers: extraHeaders,
    body: json({ world_id: worldId, world_pack_id: 'test.world', world_pack_version: '1.0.0', game_time: '2026-01-01T00:00:00Z' }),
  });
}

test('health, auth, proposal approval, and canonical commit boundary', async (t) => {
  const base = await setup(t, { approvalToken: APPROVAL });
  assert.equal((await fetch(base + '/health')).status, 200);
  assert.equal((await fetch(base + '/v1/worlds')).status, 401);
  assert.equal((await createWorld(base, 'api-world')).status, 201);

  const direct = await fetch(base + '/v1/worlds/api-world/events', {
    method: 'POST', headers, body: json({
      idempotency_key: 'direct-1', turn_id: 'turn-1', event_type: 'action.completed', expected_revision: 0,
      effects: [{ kind: 'entity.upsert', entity_id: 'npc', entity_type: 'character', attributes: { name: 'Mira' } }],
    }),
  });
  assert.equal(direct.status, 403);
  assert.equal((await direct.json()).error.code, 'DIRECT_COMMIT_DISABLED');

  const proposalBody = {
    idempotency_key: 'proposal-key-1',
    source_text: 'Mira enters the room.',
    event: {
      turn_id: 'turn-1', event_type: 'action.completed',
      effects: [{ kind: 'entity.upsert', entity_id: 'npc', entity_type: 'character', attributes: { name: 'Mira' } }],
    },
  };
  const created = await fetch(base + '/v1/worlds/api-world/proposals', { method: 'POST', headers, body: json(proposalBody) });
  assert.equal(created.status, 201);
  const proposal = (await created.json()).proposal;
  assert.equal(proposal.status, 'pending');
  assert.ok(proposal.proposal_id);
  assert.equal((await (await fetch(base + '/v1/worlds/api-world/state', { headers })).json()).state.world_revision, 0);

  const duplicate = await fetch(base + '/v1/worlds/api-world/proposals', { method: 'POST', headers, body: json(proposalBody) });
  assert.equal(duplicate.status, 201);
  assert.equal((await duplicate.json()).proposal.proposal_id, proposal.proposal_id);
  assert.equal((await fetch(base + '/v1/worlds/api-world/proposals', {
    method: 'POST', headers, body: json({ ...proposalBody, source_text: 'Different source text.' }),
  })).status, 409);

  const approvalUrl = base + '/v1/worlds/api-world/proposals/' + proposal.proposal_id + '/approve';
  assert.equal((await fetch(approvalUrl, { method: 'POST', headers, body: '{}' })).status, 403);
  const approved = await fetch(approvalUrl, {
    method: 'POST', headers: { ...headers, 'x-approval-token': APPROVAL }, body: '{}',
  });
  assert.equal(approved.status, 200);
  assert.equal((await approved.json()).proposal.status, 'approved');

  const committed = await fetch(base + '/v1/worlds/api-world/proposals/' + proposal.proposal_id + '/commit', { method: 'POST', headers, body: '{}' });
  assert.equal(committed.status, 200);
  const result = await committed.json();
  assert.equal(result.proposal.status, 'committed');
  assert.equal(result.commit_result.world_revision, 1);
  const state = await fetch(base + '/v1/worlds/api-world/state', { headers });
  assert.equal((await state.json()).state.entities[0].attributes.name, 'Mira');

  const replay = await fetch(base + '/v1/worlds/api-world/proposals/' + proposal.proposal_id + '/commit', { method: 'POST', headers, body: '{}' });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).commit_result.idempotent_replay, true);
});

test('proposal must be approved and cannot commit against a stale snapshot', async (t) => {
  const base = await setup(t, { approvalToken: APPROVAL, internalToken: INTERNAL });
  assert.equal((await createWorld(base, 'proposal-stale-world')).status, 201);
  const created = await fetch(base + '/v1/worlds/proposal-stale-world/proposals', {
    method: 'POST', headers,
    body: json({ idempotency_key: 'stale-proposal', source_text: 'An action.', event: { turn_id: 't1', event_type: 'action.completed', effects: [] } }),
  });
  const proposal = (await created.json()).proposal;
  assert.equal((await fetch(base + '/v1/worlds/proposal-stale-world/proposals/' + proposal.proposal_id + '/commit', { method: 'POST', headers, body: '{}' })).status, 409);

  const approved = await fetch(base + '/v1/worlds/proposal-stale-world/proposals/' + proposal.proposal_id + '/approve', {
    method: 'POST', headers: { ...headers, 'x-approval-token': APPROVAL }, body: '{}',
  });
  assert.equal(approved.status, 200);

  const directHeaders = { ...headers, 'x-engine-internal-token': INTERNAL };
  const intervening = await fetch(base + '/v1/worlds/proposal-stale-world/events', {
    method: 'POST', headers: directHeaders,
    body: json({ idempotency_key: 'internal-1', turn_id: 'internal-turn', event_type: 'action.completed', expected_revision: 0, effects: [] }),
  });
  assert.equal(intervening.status, 200);
  const staleCommit = await fetch(base + '/v1/worlds/proposal-stale-world/proposals/' + proposal.proposal_id + '/commit', { method: 'POST', headers, body: '{}' });
  assert.equal(staleCommit.status, 409);
  assert.equal((await staleCommit.json()).error.code, 'STALE_PROPOSAL');
});

test('API registers a generation-bound context manifest and commits against it through the internal route', async (t) => {
  const base = await setup(t, { internalToken: INTERNAL });
  assert.equal((await createWorld(base, 'manifest-api-world')).status, 201);
  const registered = await fetch(base + '/v1/worlds/manifest-api-world/context-manifests', {
    method: 'POST', headers,
    body: json({ generation_id: 'api-generation-1', base_commit_sequence: 0, base_world_revision: 0, items: [] }),
  });
  assert.equal(registered.status, 201);
  const manifest = (await registered.json()).context_manifest;
  assert.ok(manifest.manifest_id);

  const committed = await fetch(base + '/v1/worlds/manifest-api-world/events', {
    method: 'POST', headers: { ...headers, 'x-engine-internal-token': INTERNAL },
    body: json({
      idempotency_key: 'api-manifest-event', turn_id: 'api-manifest-turn', event_type: 'action.completed',
      expected_revision: 0, generation_id: 'api-generation-1', context_manifest_id: manifest.manifest_id, effects: [],
    }),
  });
  assert.equal(committed.status, 200);
  assert.equal((await committed.json()).commit_sequence, 1);
});

test('API exposes authenticated immutable mechanics registry endpoints', async (t) => {
  const base = await setup(t);
  const empty = await fetch(base + '/v1/mechanic-templates', { headers });
  assert.equal(empty.status, 200);
  assert.deepEqual((await empty.json()).templates, []);

  const body = {
    template_id: 'api.mechanic', version: '1.0.0', schema_version: 'core-1',
    display_name: 'API mechanic contract', required_capabilities: [], applicability: [], actions: [],
    conflict_policy: { mode: 'manual' }, lifecycle_policy: { on_disable: 'pause_blocked' }, unknown_policy: 'mark_unknown',
  };
  const registered = await fetch(base + '/v1/mechanic-templates', { method: 'POST', headers, body: json(body) });
  assert.equal(registered.status, 201);
  assert.equal((await registered.json()).template.template_id, 'api.mechanic');
  const fetched = await fetch(base + '/v1/mechanic-templates/api.mechanic/1.0.0', { headers });
  assert.equal(fetched.status, 200);
  assert.equal((await fetched.json()).template.version, '1.0.0');
  assert.equal((await fetch(base + '/v1/rule-modules')).status, 401);
});
