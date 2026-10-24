import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { createApiServer } from '../src/api/server.js';

const API = 'capability-api-token-long-123456';
const INTERNAL = 'capability-internal-token-long-123456';
const APPROVAL = 'capability-approval-token-long-123456';
const ADMIN = 'capability-admin-token-long-123456';
const ADAPTER = 'capability-adapter-token-long-123456';
const JSON_HEADERS = { 'content-type': 'application/json' };
const bearer = { ...JSON_HEADERS, authorization: 'Bearer ' + API };
const adapter = { ...bearer, 'x-adapter-id': 'adapter-a', 'x-adapter-token': ADAPTER };
const json = (value) => JSON.stringify(value);

async function setup(t) {
  const store = new SQLiteStore(':memory:');
  const server = createApiServer({
    engine: new LogicEngine(store),
    token: API,
    internalToken: INTERNAL,
    approvalToken: APPROVAL,
    adminToken: ADMIN,
    adapterTokens: { 'adapter-a': ADAPTER },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); store.close(); });
  return 'http://127.0.0.1:' + server.address().port;
}

async function createWorld(base, id, headers = bearer) {
  return fetch(base + '/v1/worlds', {
    method: 'POST',
    headers,
    body: json({ world_id: id, world_pack_id: 'capability.test', world_pack_version: '1.0.0', game_time: '2026-01-01T00:00:00Z' }),
  });
}

test('current capability baseline: health is public; every non-health route requires the general bearer', async (t) => {
  const base = await setup(t);
  assert.equal((await fetch(base + '/health')).status, 200);

  const noBearerWorld = await createWorld(base, 'no-bearer-world', {
    ...JSON_HEADERS,
    'x-admin-token': ADMIN,
    'x-engine-internal-token': INTERNAL,
    'x-approval-token': APPROVAL,
    'x-adapter-id': 'adapter-a',
    'x-adapter-token': ADAPTER,
  });
  assert.equal(noBearerWorld.status, 401);
  assert.equal((await fetch(base + '/v1/mechanic-templates', {
    headers: { 'x-admin-token': ADMIN },
  })).status, 401);

  // These two assertions intentionally document the current policy gap,
  // not an endorsement: general bearer alone currently grants these actions.
  assert.equal((await createWorld(base, 'general-bearer-can-create-world')).status, 201);
  assert.equal((await fetch(base + '/v1/mechanics/audit', { headers: bearer })).status, 200);
  assert.equal((await fetch(base + '/v1/mechanic-templates', { headers: bearer })).status, 200);
  assert.equal((await fetch(base + '/v1/rule-modules', { headers: bearer })).status, 200);
});

test('registry writes require admin; general, adapter, internal and approval credentials do not substitute', async (t) => {
  const base = await setup(t);
  const route = base + '/v1/mechanic-templates';
  for (const headers of [bearer, adapter, { ...bearer, 'x-engine-internal-token': INTERNAL }, { ...bearer, 'x-approval-token': APPROVAL }]) {
    const denied = await fetch(route, { method: 'POST', headers, body: '{}' });
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).error.code, 'ADMIN_REQUIRED');
  }
  const acceptedCredential = await fetch(route, {
    method: 'POST',
    headers: { ...bearer, 'x-admin-token': ADMIN },
    body: '{}',
  });
  assert.notEqual(acceptedCredential.status, 403);
});

test('configured adapter identity is scoped to adapter routes; internal/admin credentials do not bypass it', async (t) => {
  const base = await setup(t);
  assert.equal((await createWorld(base, 'adapter-scope-world')).status, 201);

  const noAdapter = await fetch(base + '/v1/worlds/adapter-scope-world/authorized-read', {
    method: 'POST', headers: bearer,
    body: json({ actor_entity_id: 'actor-a', purpose: 'test', fields: ['entity_id'] }),
  });
  assert.equal(noAdapter.status, 403);
  assert.equal((await noAdapter.json()).error.code, 'ADAPTER_REQUIRED');

  const fakeAdapter = await fetch(base + '/v1/worlds/adapter-scope-world/authorized-read', {
    method: 'POST', headers: { ...bearer, 'x-adapter-id': 'unknown', 'x-adapter-token': ADAPTER },
    body: json({ actor_entity_id: 'actor-a', purpose: 'test', fields: ['entity_id'] }),
  });
  assert.equal(fakeAdapter.status, 403);
  assert.equal((await fakeAdapter.json()).error.code, 'ADAPTER_REQUIRED');

  const adapterWithoutBearer = await fetch(base + '/v1/worlds/adapter-scope-world/authorized-read', {
    method: 'POST', headers: { ...JSON_HEADERS, 'x-adapter-id': 'adapter-a', 'x-adapter-token': ADAPTER },
    body: json({ actor_entity_id: 'actor-a', purpose: 'test', fields: ['entity_id'] }),
  });
  assert.equal(adapterWithoutBearer.status, 401);
});

test('internal lifecycle, approval and admin capabilities remain separate and fail closed when absent', async (t) => {
  const base = await setup(t);
  assert.equal((await createWorld(base, 'credential-separation-world')).status, 201);

  const timeRoute = base + '/v1/worlds/credential-separation-world/time-advances';
  const request = json({ idempotency_key: 'capability-time-key', expected_revision: 0, to_coordinate: 1000, triggers: [] });
  const noInternal = await fetch(timeRoute, { method: 'POST', headers: bearer, body: request });
  assert.equal(noInternal.status, 403);
  assert.equal((await noInternal.json()).error.code, 'INTERNAL_REQUIRED');

  const adminCannotSubstituteInternal = await fetch(timeRoute, {
    method: 'POST', headers: { ...bearer, 'x-admin-token': ADMIN }, body: request,
  });
  assert.equal(adminCannotSubstituteInternal.status, 403);

  const proposalCreated = await fetch(base + '/v1/worlds/credential-separation-world/proposals', {
    method: 'POST', headers: adapter,
    body: json({ idempotency_key: 'capability-proposal', source_text: 'test', event: { turn_id: 'capability-turn', event_type: 'action.completed', effects: [] } }),
  });
  assert.equal(proposalCreated.status, 201);
  const proposalId = (await proposalCreated.json()).proposal.proposal_id;
  const approveUrl = base + '/v1/worlds/credential-separation-world/proposals/' + encodeURIComponent(proposalId) + '/approve';

  const noApproval = await fetch(approveUrl, { method: 'POST', headers: adapter, body: '{}' });
  assert.equal(noApproval.status, 403);
  assert.equal((await noApproval.json()).error.code, 'APPROVAL_REQUIRED');

  const adminCannotSubstituteApproval = await fetch(approveUrl, {
    method: 'POST', headers: { ...bearer, 'x-admin-token': ADMIN }, body: '{}',
  });
  assert.equal(adminCannotSubstituteApproval.status, 403);

  const approved = await fetch(approveUrl, {
    method: 'POST', headers: { ...bearer, 'x-approval-token': APPROVAL }, body: '{}',
  });
  assert.equal(approved.status, 200);
  assert.equal((await approved.json()).proposal.status, 'approved');
});
