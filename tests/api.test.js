import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { createApiServer } from '../src/api/server.js';

const TOKEN = 'test-token-long-enough-123456';
const INTERNAL = 'internal-token-long-enough-123456';
const APPROVAL = 'approval-token-long-enough-123456';
const ADMIN = 'admin-token-long-enough-123456';
const ADAPTER_A = 'adapter-a-token-long-enough-123456';
const ADAPTER_B = 'adapter-b-token-long-enough-123456';
const headers = { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json', 'x-adapter-id': 'adapter-a', 'x-adapter-token': ADAPTER_A };
const json = (body) => JSON.stringify(body);

async function setup(t, options = {}) {
  const store = new SQLiteStore(':memory:');
  const server = createApiServer({ engine: new LogicEngine(store), token: TOKEN, adapterTokens: { 'adapter-a': ADAPTER_A, 'adapter-b': ADAPTER_B }, ...options });
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
  const base = await setup(t, { approvalToken: APPROVAL, internalToken: INTERNAL });
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
  const directWithInternal = await fetch(base + '/v1/worlds/api-world/events', { method: 'POST', headers: { ...headers, 'x-engine-internal-token': INTERNAL }, body: json({ idempotency_key: 'raw-direct', turn_id: 'raw', event_type: 'action.completed', effects: [] }) });
  assert.equal(directWithInternal.status, 400);
  assert.equal((await directWithInternal.json()).error.code, 'PROPOSAL_REQUIRED');

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
  const internalPending = await fetch(base + '/v1/worlds/api-world/events', { method: 'POST', headers: { ...headers, 'x-engine-internal-token': INTERNAL }, body: json({ proposal_id: proposal.proposal_id }) });
  assert.equal(internalPending.status, 409);
  assert.equal((await internalPending.json()).error.code, 'PROPOSAL_NOT_APPROVED');
  assert.equal(proposal.validation_result.status, 'needs_review');
  assert.equal(proposal.validation_result.requires_manual_semantic_review, true);
  assert.ok(proposal.validation_result.not_checked.includes('semantic_alignment_with_source_text'));
  assert.ok(proposal.proposal_id);
  assert.equal(proposal.event.effects[0].entity_id, 'npc');
  const fetchedProposal = await fetch(base + '/v1/worlds/api-world/proposals/' + proposal.proposal_id, { headers });
  assert.equal(fetchedProposal.status, 200);
  assert.equal((await fetchedProposal.json()).proposal.proposal_hash, proposal.proposal_hash);
  const otherAdapterProposalRead = await fetch(base + '/v1/worlds/api-world/proposals/' + proposal.proposal_id, {
    headers: { ...headers, 'x-adapter-id': 'adapter-b', 'x-adapter-token': ADAPTER_B },
  });
  assert.equal(otherAdapterProposalRead.status, 404);
  const inaccessibleProposalError = (await otherAdapterProposalRead.json()).error;
  assert.equal(inaccessibleProposalError.code, 'PROPOSAL_NOT_FOUND');
  const missingProposalRead = await fetch(base + '/v1/worlds/api-world/proposals/not-a-real-proposal', { headers });
  assert.equal(missingProposalRead.status, 404);
  assert.deepEqual((await missingProposalRead.json()).error, inaccessibleProposalError);
  assert.equal((await fetch(base + '/v1/worlds/api-world/state', { headers })).status, 403);
  const internalReadHeaders = { ...headers, 'x-engine-internal-token': INTERNAL };
  assert.equal((await (await fetch(base + '/v1/worlds/api-world/state', { headers: internalReadHeaders })).json()).state.world_revision, 0);

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

  const crossAdapterCommit = await fetch(base + '/v1/worlds/api-world/proposals/' + proposal.proposal_id + '/commit', {
    method: 'POST',
    headers: { ...headers, 'x-adapter-id': 'adapter-b', 'x-adapter-token': ADAPTER_B },
    body: '{}',
  });
  assert.equal(crossAdapterCommit.status, 404);
  const deniedError = (await crossAdapterCommit.json()).error;
  assert.equal(deniedError.code, 'PROPOSAL_NOT_FOUND');
  const missingProposalCommit = await fetch(base + '/v1/worlds/api-world/proposals/not-a-real-proposal/commit', { method: 'POST', headers, body: '{}' });
  assert.equal(missingProposalCommit.status, 404);
  assert.deepEqual((await missingProposalCommit.json()).error, deniedError);
  const noAdapterCommit = await fetch(base + '/v1/worlds/api-world/proposals/' + proposal.proposal_id + '/commit', {
    method: 'POST', headers: { authorization: headers.authorization, 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(noAdapterCommit.status, 403);
  assert.equal((await noAdapterCommit.json()).error.code, 'ADAPTER_REQUIRED');
  const stateAfterDeniedCommit = await fetch(base + '/v1/worlds/api-world/state', { headers: internalReadHeaders });
  assert.equal((await stateAfterDeniedCommit.json()).state.world_revision, 0);

  const committed = await fetch(base + '/v1/worlds/api-world/proposals/' + proposal.proposal_id + '/commit', { method: 'POST', headers, body: '{}' });
  assert.equal(committed.status, 200);
  const result = await committed.json();
  assert.equal(result.proposal.status, 'committed');
  assert.equal(result.commit_result.world_revision, 1);
  const state = await fetch(base + '/v1/worlds/api-world/state', { headers: internalReadHeaders });
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
  const interveningCreated = await fetch(base + '/v1/worlds/proposal-stale-world/proposals', { method: 'POST', headers, body: json({ idempotency_key: 'intervening', source_text: '', event: { turn_id: 'internal-turn', event_type: 'action.completed', effects: [] } }) });
  const interveningProposal = (await interveningCreated.json()).proposal;
  const interveningApproved = await fetch(base + '/v1/worlds/proposal-stale-world/proposals/' + interveningProposal.proposal_id + '/approve', { method: 'POST', headers: { ...headers, 'x-approval-token': APPROVAL }, body: '{}' });
  assert.equal(interveningApproved.status, 200);
  const intervening = await fetch(base + '/v1/worlds/proposal-stale-world/proposals/' + interveningProposal.proposal_id + '/commit', { method: 'POST', headers, body: '{}' });
  assert.equal(intervening.status, 200);
  const staleCommit = await fetch(base + '/v1/worlds/proposal-stale-world/proposals/' + proposal.proposal_id + '/commit', { method: 'POST', headers, body: '{}' });
  assert.equal(staleCommit.status, 409);
  assert.equal((await staleCommit.json()).error.code, 'STALE_PROPOSAL');
});

test('API registers a context manifest and commits against a matching generation label through the internal route', async (t) => {
  const base = await setup(t, { internalToken: INTERNAL, approvalToken: APPROVAL });
  assert.equal((await createWorld(base, 'manifest-api-world')).status, 201);
  const manifestBody = json({ generation_id: 'api-generation-1', base_commit_sequence: 0, base_world_revision: 0, items: [] });
  const untrustedRegistration = await fetch(base + '/v1/worlds/manifest-api-world/context-manifests', {
    method: 'POST', headers, body: manifestBody,
  });
  assert.equal(untrustedRegistration.status, 403);
  assert.equal((await untrustedRegistration.json()).error.code, 'INTERNAL_REQUIRED');
  const registered = await fetch(base + '/v1/worlds/manifest-api-world/context-manifests', {
    method: 'POST', headers: { ...headers, 'x-engine-internal-token': INTERNAL }, body: manifestBody,
  });
  assert.equal(registered.status, 201);
  const manifest = (await registered.json()).context_manifest;
  assert.ok(manifest.manifest_id);

  const proposed = await fetch(base + '/v1/worlds/manifest-api-world/proposals', { method: 'POST', headers, body: json({ idempotency_key: 'api-manifest-event', source_text: '', event: { turn_id: 'api-manifest-turn', event_type: 'action.completed', generation_id: 'api-generation-1', context_manifest_id: manifest.manifest_id, effects: [] } }) });
  const proposal = (await proposed.json()).proposal;
  const approved = await fetch(base + '/v1/worlds/manifest-api-world/proposals/' + proposal.proposal_id + '/approve', { method: 'POST', headers: { ...headers, 'x-approval-token': APPROVAL }, body: '{}' });
  assert.equal(approved.status, 200);
  const committed = await fetch(base + '/v1/worlds/manifest-api-world/events', {
    method: 'POST',
    headers: { ...headers, 'x-engine-internal-token': INTERNAL },
    body: json({ proposal_id: proposal.proposal_id }),
  });
  assert.equal(committed.status, 200);
  assert.equal((await committed.json()).commit_result.commit_sequence, 1);
});

test('API rejects a proposal whose generation label does not match the registered context manifest', async (t) => {
  const base = await setup(t, { internalToken: INTERNAL });
  assert.equal((await createWorld(base, 'manifest-mismatch-world')).status, 201);
  const registered = await fetch(base + '/v1/worlds/manifest-mismatch-world/context-manifests', {
    method: 'POST',
    headers: { ...headers, 'x-engine-internal-token': INTERNAL },
    body: json({ generation_id: 'trusted-generation-1', base_commit_sequence: 0, base_world_revision: 0, items: [] }),
  });
  assert.equal(registered.status, 201);
  const manifest = (await registered.json()).context_manifest;
  const proposed = await fetch(base + '/v1/worlds/manifest-mismatch-world/proposals', {
    method: 'POST', headers,
    body: json({ idempotency_key: 'manifest-generation-mismatch', source_text: '', event: {
      turn_id: 'mismatched-generation-turn', event_type: 'action.completed',
      generation_id: 'caller-chosen-other-generation', context_manifest_id: manifest.manifest_id, effects: [],
    } }),
  });
  assert.equal(proposed.status, 400);
  assert.equal((await proposed.json()).error.code, 'CONTEXT_GENERATION_MISMATCH');
  const state = await fetch(base + '/v1/worlds/manifest-mismatch-world/state', { headers: { ...headers, 'x-engine-internal-token': INTERNAL } });
  assert.equal((await state.json()).state.world_revision, 0);
});

test('API exposes authenticated immutable mechanics registry endpoints', async (t) => {
  const base = await setup(t, { adminToken: ADMIN });
  const empty = await fetch(base + '/v1/mechanic-templates', { headers });
  assert.equal(empty.status, 200);
  assert.deepEqual((await empty.json()).templates, []);

  const body = {
    template_id: 'api.mechanic', version: '1.0.0', schema_version: 'core-1',
    display_name: 'API mechanic contract', required_capabilities: [], applicability: [], actions: [],
    conflict_policy: { mode: 'manual' }, lifecycle_policy: { on_disable: 'pause_blocked' }, unknown_policy: 'mark_unknown',
  };
  const denied = await fetch(base + '/v1/mechanic-templates', { method: 'POST', headers, body: json(body) });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error.code, 'ADMIN_REQUIRED');
  const registered = await fetch(base + '/v1/mechanic-templates', { method: 'POST', headers: { ...headers, 'x-admin-token': ADMIN }, body: json(body) });
  assert.equal(registered.status, 201);
  assert.equal((await registered.json()).template.template_id, 'api.mechanic');
  const fetched = await fetch(base + '/v1/mechanic-templates/api.mechanic/1.0.0', { headers });
  assert.equal(fetched.status, 200);
  assert.equal((await fetched.json()).template.version, '1.0.0');
  assert.equal((await fetch(base + '/v1/rule-modules')).status, 401);
  const deniedModule = await fetch(base + '/v1/rule-modules', { method: 'POST', headers, body: json({ module_id: 'test.module', version: '1.0.0' }) });
  assert.equal(deniedModule.status, 403);
});

test('proposal server-owned fields are rejected and cancelled proposals cannot commit', async (t) => {
  const base = await setup(t, { approvalToken: APPROVAL });
  assert.equal((await createWorld(base, 'proposal-cancel-world')).status, 201);
  const invalid = await fetch(base + '/v1/worlds/proposal-cancel-world/proposals', {
    method: 'POST', headers,
    body: json({
      idempotency_key: 'invalid-proposal', source_text: 'text', base_world_revision: 999,
      event: { turn_id: 't1', event_type: 'action.completed', effects: [] },
    }),
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, 'UNSUPPORTED_PROPOSAL_FIELD');

  const created = await fetch(base + '/v1/worlds/proposal-cancel-world/proposals', {
    method: 'POST', headers,
    body: json({ idempotency_key: 'cancel-me', source_text: 'text', event: { turn_id: 't2', event_type: 'action.completed', effects: [] } }),
  });
  const proposal = (await created.json()).proposal;
  const wrongAdapterCancel = await fetch(base + '/v1/worlds/proposal-cancel-world/proposals/' + proposal.proposal_id + '/cancel', { method: 'POST', headers: { ...headers, 'x-adapter-id': 'adapter-b', 'x-adapter-token': ADAPTER_B }, body: json({ reason: 'generation_superseded' }) });
  assert.equal(wrongAdapterCancel.status, 403);
  const cancelled = await fetch(base + '/v1/worlds/proposal-cancel-world/proposals/' + proposal.proposal_id + '/cancel', {
    method: 'POST', headers, body: json({ reason: 'generation_superseded' }),
  });
  assert.equal(cancelled.status, 200);
  assert.equal((await cancelled.json()).proposal.status, 'cancelled');

  const approval = await fetch(base + '/v1/worlds/proposal-cancel-world/proposals/' + proposal.proposal_id + '/approve', {
    method: 'POST', headers: { ...headers, 'x-approval-token': APPROVAL }, body: '{}',
  });
  assert.equal(approval.status, 409);
  const commit = await fetch(base + '/v1/worlds/proposal-cancel-world/proposals/' + proposal.proposal_id + '/commit', {
    method: 'POST', headers, body: '{}',
  });
  assert.equal(commit.status, 409);
});

test('proposal creation performs deterministic validation without mutating canonical state', async (t) => {
  const base = await setup(t, { approvalToken: APPROVAL, adminToken: ADMIN });
  assert.equal((await createWorld(base, 'proposal-validation-world')).status, 201);
  const invalidBody = {
    idempotency_key: 'fixable-proposal',
    source_text: 'A test action.',
    event: { turn_id: 'validation-turn', event_type: 'action.completed', effects: [{ kind: 'unsupported.effect' }] },
  };
  const invalid = await fetch(base + '/v1/worlds/proposal-validation-world/proposals', { method: 'POST', headers, body: json(invalidBody) });
  assert.equal(invalid.status, 400);
  const state = await fetch(base + '/v1/worlds/proposal-validation-world/state', { headers: { ...headers, 'x-admin-token': ADMIN } });
  assert.equal((await state.json()).state.world_revision, 0);

  const corrected = await fetch(base + '/v1/worlds/proposal-validation-world/proposals', {
    method: 'POST', headers,
    body: json({ ...invalidBody, event: { ...invalidBody.event, effects: [] } }),
  });
  assert.equal(corrected.status, 201);
  assert.equal((await corrected.json()).proposal.validation_result.status, 'passed');
});


test('mechanic instance lifecycle API is admin-only, idempotent, and isolated from adapter proposals', async (t) => {
  const base = await setup(t, { adminToken: ADMIN });
  assert.equal((await createWorld(base, 'mechanic-api-world')).status, 201);
  const url = base + '/v1/worlds/mechanic-api-world/mechanic-instances';
  assert.equal((await fetch(url, { headers })).status, 403);
  const malformed = await fetch(url, { method: 'POST', headers: { ...headers, 'x-admin-token': ADMIN }, body: 'null' });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, 'INVALID_MECHANIC_INSTANCE_REQUEST');
  const denied = await fetch(url, { method: 'POST', headers, body: json({ instance_id: 'one', template_id: 'api.mechanic', template_version: '1.0.0', expected_revision: 0, idempotency_key: 'create-one' }) });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error.code, 'ADMIN_REQUIRED');
  const template = { template_id: 'api.mechanic', version: '1.0.0', schema_version: 'core-1', display_name: 'API lifecycle', required_capabilities: [], applicability: [], actions: [], conflict_policy: { mode: 'manual' }, lifecycle_policy: { on_disable: 'pause_blocked' }, unknown_policy: 'mark_unknown' };
  const adminHeaders = { ...headers, 'x-admin-token': ADMIN };
  const registered = await fetch(base + '/v1/mechanic-templates', { method: 'POST', headers: adminHeaders, body: json(template) });
  assert.equal(registered.status, 201);
  const created = await fetch(url, { method: 'POST', headers: adminHeaders, body: json({ instance_id: 'one', template_id: 'api.mechanic', template_version: '1.0.0', parameters: { speed: 2 }, state: {}, expected_revision: 0, idempotency_key: 'create-one' }) });
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.equal(createdBody.instance.status, 'disabled');
  assert.equal(typeof createdBody.instance.last_event_id, 'string');
  assert.equal(typeof createdBody.instance.disabled_at_revision, 'number');
  assert.equal(createdBody.instance.needs_review_reason, null);
  const createReplay = await fetch(url, { method: 'POST', headers: adminHeaders, body: json({ instance_id: 'one', template_id: 'api.mechanic', template_version: '1.0.0', parameters: { speed: 2 }, state: {}, expected_revision: 0, idempotency_key: 'create-one' }) });
  assert.equal(createReplay.status, 200);
  assert.equal((await createReplay.json()).commit_result.idempotent_replay, true);
  const enableUrl = url + '/one/enable';
  const enabled = await fetch(enableUrl, { method: 'POST', headers: adminHeaders, body: json({ expected_revision: 1, idempotency_key: 'enable-one' }) });
  assert.equal(enabled.status, 200);
  const enabledBody = await enabled.json();
  assert.equal(enabledBody.instance.status, 'enabled');
  assert.equal(enabledBody.instance.disabled_at_revision, null);
  const stale = await fetch(url + '/one/disable', { method: 'POST', headers: adminHeaders, body: json({ expected_revision: 1, idempotency_key: 'stale-disable' }) });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error.code, 'REVISION_CONFLICT');
  const enableReplay = await fetch(enableUrl, { method: 'POST', headers: adminHeaders, body: json({ expected_revision: 1, idempotency_key: 'enable-one' }) });
  assert.equal((await enableReplay.json()).commit_result.idempotent_replay, true);
  const proposal = await fetch(base + '/v1/worlds/mechanic-api-world/proposals', { method: 'POST', headers, body: json({ idempotency_key: 'adapter-mechanic', source_text: '', event: { turn_id: 'adapter-turn', event_type: 'action.completed', effects: [{ kind: 'mechanic.instance.disable', instance_id: 'one' }] } }) });
  assert.equal(proposal.status, 403);
  assert.equal((await proposal.json()).error.code, 'MECHANIC_CONFIGURATION_REQUIRES_ADMIN');
  const disabled = await fetch(url + '/one/disable', { method: 'POST', headers: adminHeaders, body: json({ expected_revision: 2, idempotency_key: 'disable-one' }) });
  const disabledBody = await disabled.json();
  assert.equal(disabledBody.instance.status, 'disabled');

  // Lifecycle rollback is also administrative; a normal API bearer alone must not bypass the gate.
  const rollbackEnableRequest = { root_event_id: enabledBody.commit_result.event_id, idempotency_key: 'rollback-mechanic-enable' };
  const deniedRollback = await fetch(base + '/v1/worlds/mechanic-api-world/rollback', {
    method: 'POST', headers, body: json(rollbackEnableRequest),
  });
  assert.equal(deniedRollback.status, 403);
  assert.equal((await deniedRollback.json()).error.code, 'ADMIN_REQUIRED');
  // Rolling back an enable invalidates its dependent disable and rebuilds the instance to its create state.
  const rollbackEnable = await fetch(base + '/v1/worlds/mechanic-api-world/rollback', {
    method: 'POST', headers: adminHeaders,
    body: json(rollbackEnableRequest),
  });
  assert.equal(rollbackEnable.status, 200);
  const rollbackEnableBody = await rollbackEnable.json();
  assert.ok(rollbackEnableBody.invalidated_event_ids.includes(enabledBody.commit_result.event_id));
  assert.ok(rollbackEnableBody.invalidated_event_ids.includes(disabledBody.commit_result.event_id));
  const afterEnableRollbackResponse = await fetch(url, { headers: adminHeaders });
  assert.equal(afterEnableRollbackResponse.status, 200);
  const afterEnableRollbackBody = await afterEnableRollbackResponse.json();
  assert.equal(afterEnableRollbackBody.instances[0].status, 'disabled');
  assert.equal(afterEnableRollbackBody.instances[0].last_event_id, createdBody.commit_result.event_id);

  // A replay reports the current projection, not a stale operation-time snapshot.
  const createReplayAfterEnable = await fetch(url, { method: 'POST', headers: adminHeaders, body: json({ instance_id: 'one', template_id: 'api.mechanic', template_version: '1.0.0', parameters: { speed: 2 }, state: {}, expected_revision: 0, idempotency_key: 'create-one' }) });
  const createReplayAfterEnableBody = await createReplayAfterEnable.json();
  assert.equal(createReplayAfterEnable.status, 200);
  assert.equal(createReplayAfterEnableBody.commit_result.idempotent_replay, true);
  assert.equal(createReplayAfterEnableBody.instance.status, 'disabled');

  const beforeRollback = await fetch(base + '/v1/worlds/mechanic-api-world/state', { headers: adminHeaders });
  const revisionBeforeRollback = (await beforeRollback.json()).state.world_revision;
  const rollback = await fetch(base + '/v1/worlds/mechanic-api-world/rollback', {
    method: 'POST', headers: adminHeaders,
    body: json({ root_event_id: createdBody.commit_result.event_id, idempotency_key: 'rollback-mechanic-create' }),
  });
  assert.equal(rollback.status, 200);
  const rollbackBody = await rollback.json();
  assert.ok(rollbackBody.invalidated_event_ids.includes(createdBody.commit_result.event_id));
  assert.equal(rollbackBody.world_revision, revisionBeforeRollback + 1);

  // A replay remains successful after rollback removed the instance projection.
  const createReplayAfterRollback = await fetch(url, { method: 'POST', headers: adminHeaders, body: json({ instance_id: 'one', template_id: 'api.mechanic', template_version: '1.0.0', parameters: { speed: 2 }, state: {}, expected_revision: 0, idempotency_key: 'create-one' }) });
  const createReplayAfterRollbackBody = await createReplayAfterRollback.json();
  assert.equal(createReplayAfterRollback.status, 200);
  assert.equal(createReplayAfterRollbackBody.commit_result.idempotent_replay, true);
  assert.equal(createReplayAfterRollbackBody.instance, null);
  assert.equal(createReplayAfterRollbackBody.instance_current, false);

  // Even lifecycle replays whose target was rolled back must not fail during preflight lookup.
  const enableReplayAfterRollback = await fetch(enableUrl, { method: 'POST', headers: adminHeaders, body: json({ expected_revision: 1, idempotency_key: 'enable-one' }) });
  const enableReplayAfterRollbackBody = await enableReplayAfterRollback.json();
  assert.equal(enableReplayAfterRollback.status, 200);
  assert.equal(enableReplayAfterRollbackBody.commit_result.idempotent_replay, true);
  assert.equal(enableReplayAfterRollbackBody.instance, null);
  assert.equal(enableReplayAfterRollbackBody.instance_current, false);

  const afterReplay = await fetch(base + '/v1/worlds/mechanic-api-world/state', { headers: adminHeaders });
  assert.equal((await afterReplay.json()).state.world_revision, rollbackBody.world_revision);
});


test('mechanic lifecycle rollback, replay after enable, and cross-world isolation', async (t) => {
  const base = await setup(t, { adminToken: ADMIN });
  const adminHeaders = { ...headers, 'x-admin-token': ADMIN };
  assert.equal((await createWorld(base, 'mechanic-lifecycle-world-a')).status, 201);
  assert.equal((await createWorld(base, 'mechanic-lifecycle-world-b')).status, 201);

  const template = {
    template_id: 'rollback.mechanic', version: '1.0.0', schema_version: 'core-1',
    display_name: 'Rollback lifecycle', required_capabilities: [], applicability: [], actions: [],
    conflict_policy: { mode: 'manual' }, lifecycle_policy: { on_disable: 'pause_blocked' }, unknown_policy: 'mark_unknown',
  };
  assert.equal((await fetch(base + '/v1/mechanic-templates', {
    method: 'POST', headers: adminHeaders, body: json(template),
  })).status, 201);

  const worldAInstances = base + '/v1/worlds/mechanic-lifecycle-world-a/mechanic-instances';
  const worldBInstances = base + '/v1/worlds/mechanic-lifecycle-world-b/mechanic-instances';
  const createBody = {
    instance_id: 'shared-name', template_id: 'rollback.mechanic', template_version: '1.0.0',
    parameters: {}, state: {}, expected_revision: 0, idempotency_key: 'create-shared-name',
  };
  const created = await fetch(worldAInstances, {
    method: 'POST', headers: adminHeaders, body: json(createBody),
  });
  assert.equal(created.status, 201);
  const createdBody = await created.json();

  // Instance IDs are scoped to a world, not globally visible.
  assert.deepEqual((await (await fetch(worldBInstances, { headers: adminHeaders })).json()).instances, []);
  const foreignDisable = await fetch(worldBInstances + '/shared-name/disable', {
    method: 'POST', headers: adminHeaders,
    body: json({ expected_revision: 0, idempotency_key: 'foreign-disable' }),
  });
  assert.equal(foreignDisable.status, 404);
  assert.equal((await foreignDisable.json()).error.code, 'MECHANIC_INSTANCE_NOT_FOUND');

  const enableUrl = worldAInstances + '/shared-name/enable';
  const enabled = await fetch(enableUrl, {
    method: 'POST', headers: adminHeaders,
    body: json({ expected_revision: 1, idempotency_key: 'enable-shared-name' }),
  });
  assert.equal(enabled.status, 200);
  const enabledBody = await enabled.json();
  assert.equal(enabledBody.instance.status, 'enabled');

  // Exact create replay must be resolved before checking the now-stale expected revision.
  const createReplayWhileEnabled = await fetch(worldAInstances, {
    method: 'POST', headers: adminHeaders, body: json(createBody),
  });
  assert.equal(createReplayWhileEnabled.status, 200);
  const createReplayBody = await createReplayWhileEnabled.json();
  assert.equal(createReplayBody.commit_result.idempotent_replay, true);
  assert.equal(createReplayBody.instance.status, 'enabled');
  assert.equal(createReplayBody.instance.last_event_id, enabledBody.commit_result.event_id);

  const disabled = await fetch(worldAInstances + '/shared-name/disable', {
    method: 'POST', headers: adminHeaders,
    body: json({ expected_revision: 2, idempotency_key: 'disable-shared-name' }),
  });
  assert.equal(disabled.status, 200);
  const disabledBody = await disabled.json();
  assert.equal(disabledBody.instance.status, 'disabled');

  const rollbackDisable = await fetch(base + '/v1/worlds/mechanic-lifecycle-world-a/rollback', {
    method: 'POST', headers: adminHeaders,
    body: json({ root_event_id: disabledBody.commit_result.event_id, idempotency_key: 'rollback-disable-shared-name' }),
  });
  assert.equal(rollbackDisable.status, 200);
  const rollbackBody = await rollbackDisable.json();
  assert.ok(rollbackBody.invalidated_event_ids.includes(disabledBody.commit_result.event_id));

  // Rebuilding from valid events restores the exact pre-disable projection.
  const listAfterRollback = await (await fetch(worldAInstances, { headers: adminHeaders })).json();
  assert.equal(listAfterRollback.instances.length, 1);
  assert.equal(listAfterRollback.instances[0].status, 'enabled');
  assert.equal(listAfterRollback.instances[0].last_event_id, enabledBody.commit_result.event_id);
  assert.equal(listAfterRollback.instances[0].disabled_at_revision, null);

  // The same instance ID remains absent from the other world.
  assert.deepEqual((await (await fetch(worldBInstances, { headers: adminHeaders })).json()).instances, []);
});


test('mechanic lifecycle idempotency conflicts and sequential rollback preserve canonical projection', async (t) => {
  const base = await setup(t, { adminToken: ADMIN });
  const adminHeaders = { ...headers, 'x-admin-token': ADMIN };
  const worldId = 'mechanic-sequential-rollback-world';
  assert.equal((await createWorld(base, worldId)).status, 201);

  const template = {
    template_id: 'sequential.mechanic', version: '1.0.0', schema_version: 'core-1',
    display_name: 'Sequential rollback', required_capabilities: [], applicability: [], actions: [],
    conflict_policy: { mode: 'manual' }, lifecycle_policy: { on_disable: 'pause_blocked' }, unknown_policy: 'mark_unknown',
  };
  assert.equal((await fetch(base + '/v1/mechanic-templates', {
    method: 'POST', headers: adminHeaders, body: json(template),
  })).status, 201);

  const instancesUrl = base + '/v1/worlds/' + worldId + '/mechanic-instances';
  const createBody = {
    instance_id: 'sequential-one', template_id: 'sequential.mechanic', template_version: '1.0.0',
    parameters: { mode: 'safe' }, state: {}, expected_revision: 0, idempotency_key: 'sequential-create',
  };
  const created = await fetch(instancesUrl, { method: 'POST', headers: adminHeaders, body: json(createBody) });
  assert.equal(created.status, 201);
  const createdBody = await created.json();

  const createConflict = await fetch(instancesUrl, {
    method: 'POST', headers: adminHeaders,
    body: json({ ...createBody, parameters: { mode: 'unsafe' } }),
  });
  assert.equal(createConflict.status, 409);
  assert.equal((await createConflict.json()).error.code, 'IDEMPOTENCY_KEY_CONFLICT');

  const enableUrl = instancesUrl + '/sequential-one/enable';
  const enableBody = { expected_revision: 1, idempotency_key: 'sequential-enable' };
  const enabled = await fetch(enableUrl, { method: 'POST', headers: adminHeaders, body: json(enableBody) });
  assert.equal(enabled.status, 200);
  const enabledBody = await enabled.json();
  assert.equal(enabledBody.instance.status, 'enabled');

  const enableConflict = await fetch(enableUrl, {
    method: 'POST', headers: adminHeaders,
    body: json({ ...enableBody, expected_revision: 99 }),
  });
  assert.equal(enableConflict.status, 409);
  assert.equal((await enableConflict.json()).error.code, 'IDEMPOTENCY_KEY_CONFLICT');

  const disableUrl = instancesUrl + '/sequential-one/disable';
  const disableBody = { expected_revision: 2, idempotency_key: 'sequential-disable' };
  const disabled = await fetch(disableUrl, { method: 'POST', headers: adminHeaders, body: json(disableBody) });
  assert.equal(disabled.status, 200);
  const disabledBody = await disabled.json();
  assert.equal(disabledBody.instance.status, 'disabled');

  const disableConflict = await fetch(disableUrl, {
    method: 'POST', headers: adminHeaders,
    body: json({ ...disableBody, expected_revision: 99 }),
  });
  assert.equal(disableConflict.status, 409);
  assert.equal((await disableConflict.json()).error.code, 'IDEMPOTENCY_KEY_CONFLICT');

  const rollbackUrl = base + '/v1/worlds/' + worldId + '/rollback';
  const rollbackDisableBody = {
    root_event_id: disabledBody.commit_result.event_id,
    idempotency_key: 'sequential-rollback-disable',
  };
  const rollbackDisable = await fetch(rollbackUrl, {
    method: 'POST', headers: adminHeaders, body: json(rollbackDisableBody),
  });
  assert.equal(rollbackDisable.status, 200);
  const rollbackDisableResult = await rollbackDisable.json();
  assert.equal(rollbackDisableResult.no_op, false);
  const revisionAfterRollbackDisable = rollbackDisableResult.world_revision;

  const rollbackDisableReplay = await fetch(rollbackUrl, {
    method: 'POST', headers: adminHeaders, body: json(rollbackDisableBody),
  });
  assert.equal(rollbackDisableReplay.status, 200);
  const rollbackDisableReplayResult = await rollbackDisableReplay.json();
  assert.equal(rollbackDisableReplayResult.idempotent_replay, true);
  assert.equal(rollbackDisableReplayResult.world_revision, revisionAfterRollbackDisable);
  const stateAfterRollbackReplay = await (await fetch(base + '/v1/worlds/' + worldId + '/state', { headers: adminHeaders })).json();
  assert.equal(stateAfterRollbackReplay.state.world_revision, revisionAfterRollbackDisable);

  const rollbackKeyConflict = await fetch(rollbackUrl, {
    method: 'POST', headers: adminHeaders,
    body: json({ root_event_id: enabledBody.commit_result.event_id, idempotency_key: 'sequential-rollback-disable' }),
  });
  assert.equal(rollbackKeyConflict.status, 409);
  assert.equal((await rollbackKeyConflict.json()).error.code, 'IDEMPOTENCY_KEY_CONFLICT');

  let listed = await (await fetch(instancesUrl, { headers: adminHeaders })).json();
  assert.equal(listed.instances[0].status, 'enabled');
  assert.equal(listed.instances[0].last_event_id, enabledBody.commit_result.event_id);
  assert.equal(listed.instances[0].disabled_at_revision, null);

  // Roll back enable after disable has already been retracted; the instance returns to create state.
  const rollbackEnable = await fetch(rollbackUrl, {
    method: 'POST', headers: adminHeaders,
    body: json({ root_event_id: enabledBody.commit_result.event_id, idempotency_key: 'sequential-rollback-enable' }),
  });
  assert.equal(rollbackEnable.status, 200);
  const rollbackEnableResult = await rollbackEnable.json();
  assert.ok(rollbackEnableResult.invalidated_event_ids.includes(enabledBody.commit_result.event_id));
  assert.equal(rollbackEnableResult.invalidated_event_ids.includes(disabledBody.commit_result.event_id), false);

  listed = await (await fetch(instancesUrl, { headers: adminHeaders })).json();
  assert.equal(listed.instances.length, 1);
  assert.equal(listed.instances[0].status, 'disabled');
  assert.equal(listed.instances[0].last_event_id, createdBody.commit_result.event_id);
  assert.equal(listed.instances[0].disabled_at_revision, createdBody.commit_result.world_revision);

  const rollbackCreate = await fetch(rollbackUrl, {
    method: 'POST', headers: adminHeaders,
    body: json({ root_event_id: createdBody.commit_result.event_id, idempotency_key: 'sequential-rollback-create' }),
  });
  assert.equal(rollbackCreate.status, 200);
  const rollbackCreateResult = await rollbackCreate.json();
  assert.ok(rollbackCreateResult.invalidated_event_ids.includes(createdBody.commit_result.event_id));
  listed = await (await fetch(instancesUrl, { headers: adminHeaders })).json();
  assert.deepEqual(listed.instances, []);
});


test('transaction failures leave commit and rollback state unchanged', (t) => {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  t.after(() => store.close());
  engine.createWorld({ world_id: 'atomic-world', world_pack_id: 'test.world', world_pack_version: '1.0.0', game_time: '2026-01-01T00:00:00.000Z' });
  const request = { idempotency_key: 'atomic-commit', turn_id: 'atomic-turn', event_type: 'action.completed', expected_revision: 0, effects: [{ kind: 'entity.upsert', entity_id: 'atomic-entity', entity_type: 'character', attributes: { name: 'Atomic' } }] };
  store.db.exec("CREATE TRIGGER fail_entity BEFORE INSERT ON entities WHEN NEW.entity_id='atomic-entity' BEGIN SELECT RAISE(ABORT,'test failure'); END");
  assert.throws(() => engine.commitEvent('atomic-world', request), /test failure/);
  assert.equal(store.world('atomic-world').world_revision, 0);
  assert.deepEqual(store.events('atomic-world', true), []);
  assert.deepEqual(store.state('atomic-world').entities, []);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM idempotency_keys WHERE idempotency_key='atomic-commit'").get().n, 0);
  store.db.exec('DROP TRIGGER fail_entity');
  const committed = engine.commitEvent('atomic-world', request);
  assert.equal(committed.world_revision, 1);
  store.db.exec("CREATE TRIGGER fail_rollback BEFORE INSERT ON audit_entries WHEN NEW.action='rollback.applied' BEGIN SELECT RAISE(ABORT,'test failure'); END");
  const rollbackRequest = { root_event_id: committed.event_id, idempotency_key: 'atomic-rollback' };
  assert.throws(() => engine.rollbackEvent('atomic-world', rollbackRequest), /test failure/);
  assert.equal(store.world('atomic-world').world_revision, 1);
  assert.equal(store.events('atomic-world')[0].validity, 'valid');
  assert.equal(store.state('atomic-world').entities.length, 1);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM rollbacks").get().n, 0);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM idempotency_keys WHERE idempotency_key='atomic-rollback'").get().n, 0);
  store.db.exec('DROP TRIGGER fail_rollback');
  const rolledBack = engine.rollbackEvent('atomic-world', rollbackRequest);
  assert.equal(rolledBack.world_revision, 2);
  assert.deepEqual(store.state('atomic-world').entities, []);
});


test('canonical rollback requires the separate admin credential for every event type', async (t) => {
  const base = await setup(t, { approvalToken: APPROVAL, adminToken: ADMIN });
  assert.equal((await createWorld(base, 'rollback-auth-world')).status, 201);
  const created = await fetch(base + '/v1/worlds/rollback-auth-world/proposals', {
    method: 'POST', headers,
    body: json({
      idempotency_key: 'rollback-auth-proposal',
      source_text: '',
      event: {
        turn_id: 'rollback-auth-turn',
        event_type: 'action.completed',
        effects: [{ kind: 'entity.create', entity_id: 'rollback-auth-entity', entity_type: 'character', attributes: { name: 'Rollback target' } }],
      },
    }),
  });
  assert.equal(created.status, 201);
  const proposal = (await created.json()).proposal;
  const approved = await fetch(base + '/v1/worlds/rollback-auth-world/proposals/' + proposal.proposal_id + '/approve', {
    method: 'POST', headers: { ...headers, 'x-approval-token': APPROVAL }, body: '{}',
  });
  assert.equal(approved.status, 200);
  const committed = await fetch(base + '/v1/worlds/rollback-auth-world/proposals/' + proposal.proposal_id + '/commit', {
    method: 'POST', headers, body: '{}',
  });
  assert.equal(committed.status, 200);
  const eventId = (await committed.json()).commit_result.event_id;
  const rollbackUrl = base + '/v1/worlds/rollback-auth-world/rollback';
  const request = { root_event_id: eventId, idempotency_key: 'rollback-auth-operation' };

  const denied = await fetch(rollbackUrl, { method: 'POST', headers, body: json(request) });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error.code, 'ADMIN_REQUIRED');
  const stillPresent = await fetch(base + '/v1/worlds/rollback-auth-world/state', {
    headers: { ...headers, 'x-admin-token': ADMIN },
  });
  assert.equal((await stillPresent.json()).state.entities.some((entity) => entity.entity_id === 'rollback-auth-entity'), true);

  const authorized = await fetch(rollbackUrl, {
    method: 'POST', headers: { ...headers, 'x-admin-token': ADMIN }, body: json(request),
  });
  assert.equal(authorized.status, 200);
  assert.ok((await authorized.json()).invalidated_event_ids.includes(eventId));
});

test('trusted context registration and proposal creator checks compose without unauthorized mutation', async (t) => {
  const base = await setup(t, { approvalToken: APPROVAL, internalToken: INTERNAL });
  assert.equal((await createWorld(base, 'cross-boundary-world')).status, 201);

  const manifestBody = json({ generation_id: 'cross-boundary-generation', base_commit_sequence: 0, base_world_revision: 0, items: [] });
  const deniedManifest = await fetch(base + '/v1/worlds/cross-boundary-world/context-manifests', {
    method: 'POST', headers, body: manifestBody,
  });
  assert.equal(deniedManifest.status, 403);
  assert.equal((await deniedManifest.json()).error.code, 'INTERNAL_REQUIRED');

  const registered = await fetch(base + '/v1/worlds/cross-boundary-world/context-manifests', {
    method: 'POST', headers: { ...headers, 'x-engine-internal-token': INTERNAL }, body: manifestBody,
  });
  assert.equal(registered.status, 201);
  const manifest = (await registered.json()).context_manifest;

  const created = await fetch(base + '/v1/worlds/cross-boundary-world/proposals', {
    method: 'POST', headers,
    body: json({
      idempotency_key: 'cross-boundary-proposal',
      source_text: 'A proposal bound to a trusted generation.',
      event: { turn_id: 'cross-boundary-turn', event_type: 'action.completed', generation_id: 'cross-boundary-generation', context_manifest_id: manifest.manifest_id, effects: [] },
    }),
  });
  assert.equal(created.status, 201);
  const proposal = (await created.json()).proposal;
  const approved = await fetch(base + '/v1/worlds/cross-boundary-world/proposals/' + proposal.proposal_id + '/approve', {
    method: 'POST', headers: { ...headers, 'x-approval-token': APPROVAL }, body: '{}',
  });
  assert.equal(approved.status, 200);

  const crossAdapterCommit = await fetch(base + '/v1/worlds/cross-boundary-world/proposals/' + proposal.proposal_id + '/commit', {
    method: 'POST', headers: { ...headers, 'x-adapter-id': 'adapter-b', 'x-adapter-token': ADAPTER_B }, body: '{}',
  });
  assert.equal(crossAdapterCommit.status, 404);
  assert.equal((await crossAdapterCommit.json()).error.code, 'PROPOSAL_NOT_FOUND');

  const beforeOwnerCommit = await fetch(base + '/v1/worlds/cross-boundary-world/state', {
    headers: { ...headers, 'x-engine-internal-token': INTERNAL },
  });
  assert.equal((await beforeOwnerCommit.json()).state.world_revision, 0);

  const ownerCommit = await fetch(base + '/v1/worlds/cross-boundary-world/proposals/' + proposal.proposal_id + '/commit', {
    method: 'POST', headers, body: '{}',
  });
  assert.equal(ownerCommit.status, 200);
  assert.equal((await ownerCommit.json()).proposal.status, 'committed');
});


test('approval endpoint rejects a JSON null body with a client error instead of an internal error', async (t) => {
  const base = await setup(t, { approvalToken: APPROVAL });
  assert.equal((await createWorld(base, 'null-approval-world')).status, 201);
  const created = await fetch(base + '/v1/worlds/null-approval-world/proposals', {
    method: 'POST', headers,
    body: json({
      idempotency_key: 'null-approval-proposal',
      source_text: 'A harmless proposed action.',
      event: { turn_id: 'null-approval-turn', event_type: 'action.completed', effects: [] },
    }),
  });
  assert.equal(created.status, 201);
  const proposal = (await created.json()).proposal;
  const response = await fetch(base + '/v1/worlds/null-approval-world/proposals/' + proposal.proposal_id + '/approve', {
    method: 'POST',
    headers: { ...headers, 'x-approval-token': APPROVAL },
    body: 'null',
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INVALID_APPROVAL_REQUEST');
  const afterMalformedApproval = await fetch(base + '/v1/worlds/null-approval-world/proposals/' + proposal.proposal_id, { headers });
  assert.equal(afterMalformedApproval.status, 200);
  assert.equal((await afterMalformedApproval.json()).proposal.status, 'pending');
});


test('credential checks reject malformed and length-mismatched request secrets', async (t) => {
  const base = await setup(t, { adminToken: ADMIN, internalToken: INTERNAL, approvalToken: APPROVAL });
  await createWorld(base, 'credential-check-world');

  const wrongBearer = await fetch(base + '/v1/worlds/credential-check-world/state', {
    headers: { ...headers, authorization: 'Bearer x' },
  });
  assert.equal(wrongBearer.status, 401);
  assert.equal((await wrongBearer.json()).error.code, 'UNAUTHORIZED');

  const wrongAdmin = await fetch(base + '/v1/worlds/credential-check-world/state', {
    headers: { ...headers, 'x-admin-token': 'x' },
  });
  assert.equal(wrongAdmin.status, 403);
  assert.equal((await wrongAdmin.json()).error.code, 'AUTHORIZED_READ_REQUIRED');

  const wrongInternal = await fetch(base + '/v1/worlds/credential-check-world/state', {
    headers: { ...headers, 'x-engine-internal-token': 'wrong-internal-secret' },
  });
  assert.equal(wrongInternal.status, 403);
  assert.equal((await wrongInternal.json()).error.code, 'AUTHORIZED_READ_REQUIRED');

  const validAdmin = await fetch(base + '/v1/worlds/credential-check-world/state', {
    headers: { ...headers, 'x-admin-token': ADMIN },
  });
  assert.equal(validAdmin.status, 200);

  const validInternal = await fetch(base + '/v1/worlds/credential-check-world/state', {
    headers: { ...headers, 'x-engine-internal-token': INTERNAL },
  });
  assert.equal(validInternal.status, 200);

  const wrongAdapter = await fetch(base + '/v1/worlds/credential-check-world/authorized-read', {
    method: 'POST',
    headers: { ...headers, 'x-adapter-token': 'x' },
    body: json({ actor_entity_id: 'npc', purpose: 'credential-check', fields: ['entity_id'] }),
  });
  assert.equal(wrongAdapter.status, 403);
  assert.equal((await wrongAdapter.json()).error.code, 'ADAPTER_REQUIRED');
});
