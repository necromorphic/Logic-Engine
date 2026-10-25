import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { ProposalService } from '../src/application/proposals.js';
import { createApiServer, createActiveMechanicPolicyValidator } from '../src/api/server.js';

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
  const server = createApiServer({ engine: new LogicEngine(store), token: TOKEN, adminToken: ADMIN, adapterTokens: { 'adapter-a': ADAPTER_A, 'adapter-b': ADAPTER_B }, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); store.close(); });
  return 'http://127.0.0.1:' + server.address().port;
}
async function createWorld(base, worldId, extraHeaders = { ...headers, 'x-admin-token': ADMIN }) {
  return fetch(base + '/v1/worlds', {
    method: 'POST', headers: extraHeaders,
    body: json({ world_id: worldId, world_pack_id: 'test.world', world_pack_version: '1.0.0', game_time: '2026-01-01T00:00:00Z' }),
  });
}

test('time-advance API is internal-only and exposes durable start/status/replay', async (t) => {
  const base = await setup(t, { internalToken: INTERNAL });
  assert.equal((await createWorld(base, 'api-time-world')).status, 201);
  const request = {
    idempotency_key: 'api-time-advance-key',
    expected_revision: 0,
    to_coordinate: 60000,
    triggers: [],
  };
  const denied = await fetch(base + '/v1/worlds/api-time-world/time-advances', {
    method: 'POST', headers, body: json(request),
  });
  assert.equal(denied.status, 403);

  const internalHeaders = { ...headers, 'x-engine-internal-token': INTERNAL };
  const started = await fetch(base + '/v1/worlds/api-time-world/time-advances', {
    method: 'POST', headers: internalHeaders, body: json(request),
  });
  assert.equal(started.status, 200);
  const first = (await started.json()).operation;
  assert.equal(first.status, 'completed');
  assert.equal(first.confirmed_coordinate, 60000);

  const status = await fetch(base + '/v1/worlds/api-time-world/time-advances/' + encodeURIComponent(first.operation_id), {
    headers: internalHeaders,
  });
  assert.equal(status.status, 200);
  assert.equal((await status.json()).operation.operation_id, first.operation_id);

  const replay = await fetch(base + '/v1/worlds/api-time-world/time-advances', {
    method: 'POST', headers: internalHeaders, body: json(request),
  });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).operation.operation_id, first.operation_id);
  assert.equal((await fetch(base + '/v1/worlds/api-time-world/events', { headers: { ...headers, 'x-engine-internal-token': INTERNAL } })).status, 200);
});

test('time-trigger lifecycle is internal-only and registered triggers drive durable advances', async (t) => {
  const base = await setup(t, { internalToken: INTERNAL });
  assert.equal((await createWorld(base, 'api-time-trigger-world')).status, 201);
  const trigger = {
    trigger_id: 'api-trigger',
    due_coordinate: 10000,
    dependencies: [],
    read_set: [],
    write_set: ['entity:api-trigger-entity'],
    processing_mode: 'exact',
    interrupt_after_coordinate: false,
    payload: {
      event: {
        event_type: 'time.trigger',
        effects: [{
          kind: 'entity.upsert',
          entity_id: 'api-trigger-entity',
          entity_type: 'object',
          attributes: { source: 'registered-trigger' },
        }],
      },
    },
  };
  const denied = await fetch(base + '/v1/worlds/api-time-trigger-world/time-triggers', {
    method: 'POST', headers, body: json(trigger),
  });
  assert.equal(denied.status, 403);

  const internalHeaders = { ...headers, 'x-engine-internal-token': INTERNAL };
  const registered = await fetch(base + '/v1/worlds/api-time-trigger-world/time-triggers', {
    method: 'POST', headers: internalHeaders, body: json(trigger),
  });
  assert.equal(registered.status, 201);
  assert.equal((await registered.json()).trigger.status, 'pending');

  const listed = await fetch(base + '/v1/worlds/api-time-trigger-world/time-triggers', { headers: internalHeaders });
  assert.equal(listed.status, 200);
  const listedBody = await listed.json();
  assert.equal(listedBody.triggers.length, 1);
  assert.equal(Object.hasOwn(listedBody.triggers[0], 'payload'), false);

  const started = await fetch(base + '/v1/worlds/api-time-trigger-world/time-advances', {
    method: 'POST',
    headers: internalHeaders,
    body: json({ idempotency_key: 'api-registered-advance', expected_revision: 1, to_coordinate: 10000 }),
  });
  assert.equal(started.status, 200);
  assert.equal((await started.json()).operation.status, 'completed');

  const fetched = await fetch(base + '/v1/worlds/api-time-trigger-world/time-triggers/api-trigger', { headers: internalHeaders });
  assert.equal(fetched.status, 200);
  assert.equal((await fetched.json()).trigger.status, 'completed');

  const futureTrigger = {
    ...trigger,
    trigger_id: 'api-trigger-to-cancel',
    due_coordinate: 20000,
    write_set: ['entity:api-cancelled-entity'],
    payload: {
      event: {
        event_type: 'time.trigger',
        effects: [{
          kind: 'entity.upsert',
          entity_id: 'api-cancelled-entity',
          entity_type: 'object',
          attributes: { source: 'cancelled' },
        }],
      },
    },
  };
  const futureRegistered = await fetch(base + '/v1/worlds/api-time-trigger-world/time-triggers', {
    method: 'POST', headers: internalHeaders, body: json(futureTrigger),
  });
  assert.equal(futureRegistered.status, 201);
  const cancelled = await fetch(base + '/v1/worlds/api-time-trigger-world/time-triggers/api-trigger-to-cancel/cancel', {
    method: 'POST', headers: internalHeaders, body: json({ reason: 'test_cancel' }),
  });
  assert.equal(cancelled.status, 200);
  assert.equal((await cancelled.json()).trigger.status, 'cancelled');
});

test('timed-action API requires the internal capability and returns the durable action result', async (t) => {
  const base = await setup(t, { internalToken: INTERNAL, adminToken: ADMIN });
  assert.equal((await createWorld(base, 'api-timed-action-world')).status, 201);
  const calendar_definition = {
    calendar_id: 'api-timed-action.calendar',
    version: '1.0.0',
    day_length_ms: 86400000,
    weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    year_cycle: [{ id: 'standard', name: 'Standard', months: [{ id: 'jan', name: 'January', days: 31 }] }],
    epoch: { coordinate: 0, year_number: 2026, year_cycle_index: 0, month_id: 'jan', day_of_month: 1, weekday_index: 0, time_of_day_ms: 0 },
    holidays: [],
  };
  const configuration = {
    version: 'api-timed-action-policy',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    calendar_definition,
    time_policy: {
      policy_id: 'api-timed-action.policy',
      version: '1.0.0',
      max_action_duration_ms: 43200000,
      max_skip_duration_ms: 604800000,
      duration_rules: [{ event_type: 'travel.completed', rule: { kind: 'fixed', duration_ms: 30000 } }],
    },
  };
  const adminHeaders = { ...headers, 'x-admin-token': ADMIN };
  assert.equal((await fetch(base + '/v1/worlds/api-timed-action-world/time-configurations', {
    method: 'POST', headers: adminHeaders, body: json(configuration),
  })).status, 200);

  const triggerRequest = {
    trigger_id: 'api-timed-action-trigger',
    due_coordinate: 10000,
    dependencies: [],
    read_set: [],
    write_set: ['entity:api-intermediate'],
    processing_mode: 'exact',
    interrupt_after_coordinate: false,
    payload: { event: {
      turn_id: 'api-timed-trigger-turn',
      event_type: 'time.trigger',
      effects: [{ kind: 'entity.upsert', entity_id: 'api-intermediate', entity_type: 'object', attributes: { reached: true } }],
    } },
  };
  const internalHeaders = { ...headers, 'x-engine-internal-token': INTERNAL };
  const registered = await fetch(base + '/v1/worlds/api-timed-action-world/time-triggers', {
    method: 'POST', headers: internalHeaders, body: json(triggerRequest),
  });
  assert.equal(registered.status, 201);

  const denied = await fetch(base + '/v1/worlds/api-timed-action-world/time-actions', {
    method: 'POST', headers, body: json({
      idempotency_key: 'api-timed-action-key', expected_revision: 2,
      event: { turn_id: 'api-timed-action-turn', event_type: 'travel.completed', effects: [] },
    }),
  });
  assert.equal(denied.status, 403);

  const started = await fetch(base + '/v1/worlds/api-timed-action-world/time-actions', {
    method: 'POST', headers: internalHeaders, body: json({
      idempotency_key: 'api-timed-action-key',
      expected_revision: 2,
      event: {
        turn_id: 'api-timed-action-turn',
        event_type: 'travel.completed',
        effects: [{ kind: 'entity.upsert', entity_id: 'api-traveller', entity_type: 'character', attributes: { arrived: true } }],
      },
    }),
  });
  assert.equal(started.status, 200);
  const operation = (await started.json()).operation;
  assert.equal(operation.status, 'completed');
  assert.equal(operation.result.final_action_status, 'committed');
  assert.deepEqual(operation.result.completed_trigger_ids, ['api-timed-action-trigger']);

  const status = await fetch(base + '/v1/worlds/api-timed-action-world/time-actions/' + encodeURIComponent(operation.operation_id), {
    headers: internalHeaders,
  });
  assert.equal(status.status, 200);
  assert.equal((await status.json()).operation.operation_id, operation.operation_id);
});

test('time configuration authoring requires admin and calendar projection requires a trusted reader', async (t) => {
  const base = await setup(t, { adminToken: ADMIN });
  assert.equal((await createWorld(base, 'api-time-config-world')).status, 201);
  const configuration = {
    version: 'config-1',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    calendar_definition: {
      calendar_id: 'api.calendar',
      version: '1.0.0',
      day_length_ms: 86400000,
      weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      year_cycle: [{ id: 'standard', name: 'Standard', months: [{ id: 'jan', name: 'January', days: 31 }] }],
      epoch: { coordinate: 0, year_number: 2000, year_cycle_index: 0, month_id: 'jan', day_of_month: 1, weekday_index: 0, time_of_day_ms: 0 },
      holidays: [],
    },
    time_policy: {
      policy_id: 'api.policy',
      version: '1.0.0',
      max_action_duration_ms: 43200000,
      max_skip_duration_ms: 604800000,
      duration_rules: [{ event_type: 'travel.completed', rule: { kind: 'fixed', duration_ms: 60000 } }],
    },
  };
  const denied = await fetch(base + '/v1/worlds/api-time-config-world/time-configurations', {
    method: 'POST', headers, body: json(configuration),
  });
  assert.equal(denied.status, 403);

  const adminHeaders = { ...headers, 'x-admin-token': ADMIN };
  const registered = await fetch(base + '/v1/worlds/api-time-config-world/time-configurations', {
    method: 'POST', headers: adminHeaders, body: json(configuration),
  });
  assert.equal(registered.status, 200);
  assert.equal((await registered.json()).configuration.active, true);

  const current = await fetch(base + '/v1/worlds/api-time-config-world/time-configurations/current', {
    headers: adminHeaders,
  });
  assert.equal(current.status, 200);
  assert.equal((await current.json()).configuration.version, 'config-1');

  const projected = await fetch(base + '/v1/worlds/api-time-config-world/time', { headers: adminHeaders });
  assert.equal(projected.status, 200);
  assert.equal((await projected.json()).time.calendar.year_number, 2000);
});

test('author-range duration can be approved only through the proposal approval boundary', async (t) => {
  const base = await setup(t, { adminToken: ADMIN, approvalToken: APPROVAL });
  assert.equal((await createWorld(base, 'author-duration-world')).status, 201);
  const configuration = {
    version: 'author-duration-config',
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    calendar_definition: {
      calendar_id: 'author.calendar',
      version: '1.0.0',
      day_length_ms: 86400000,
      weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      year_cycle: [{ id: 'standard', name: 'Standard', months: [{ id: 'jan', name: 'January', days: 31 }] }],
      epoch: { coordinate: 0, year_number: 2000, year_cycle_index: 0, month_id: 'jan', day_of_month: 1, weekday_index: 0, time_of_day_ms: 0 },
      holidays: [],
    },
    time_policy: {
      policy_id: 'author.duration',
      version: '1.0.0',
      max_action_duration_ms: 43200000,
      max_skip_duration_ms: 604800000,
      duration_rules: [{ event_type: 'rest.completed', rule: { kind: 'range', min_duration_ms: 3600000, max_duration_ms: 28800000, resolution: 'author' } }],
    },
  };
  const adminHeaders = { ...headers, 'x-admin-token': ADMIN };
  const configured = await fetch(base + '/v1/worlds/author-duration-world/time-configurations', {
    method: 'POST', headers: adminHeaders, body: json(configuration),
  });
  assert.equal(configured.status, 200);

  const createProposal = async (key, durationProposal) => {
    const event = { turn_id: key, event_type: 'rest.completed', effects: [] };
    if (durationProposal !== undefined) event.duration_proposal = durationProposal;
    const response = await fetch(base + '/v1/worlds/author-duration-world/proposals', {
      method: 'POST', headers,
      body: json({ idempotency_key: key, source_text: '', event }),
    });
    assert.equal(response.status, 201);
    return (await response.json()).proposal;
  };

  const missingCandidate = await createProposal('rest-missing-duration', undefined);
  assert.equal(missingCandidate.validation_result.time_policy.status, 'needs_author');
  const refused = await fetch(base + '/v1/worlds/author-duration-world/proposals/' + missingCandidate.proposal_id + '/approve', {
    method: 'POST', headers: { ...headers, 'x-approval-token': APPROVAL }, body: '{}',
  });
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).error.code, 'DURATION_NEEDS_AUTHOR');

  const candidate = await createProposal('rest-approved-duration', { duration_ms: 3600000 });
  const approved = await fetch(base + '/v1/worlds/author-duration-world/proposals/' + candidate.proposal_id + '/approve', {
    method: 'POST', headers: { ...headers, 'x-approval-token': APPROVAL }, body: '{}',
  });
  assert.equal(approved.status, 200);
  const approvalBody = await approved.json();
  assert.equal(approvalBody.proposal.status, 'approved');

  const audit = await fetch(base + '/v1/worlds/author-duration-world/audit', { headers: adminHeaders });
  assert.equal(audit.status, 200);
  const auditBody = await audit.json();
  const approvalAudit = auditBody.audit.find((entry) => entry.action === 'proposal.approved' && entry.target_id === candidate.proposal_id);
  assert.equal(approvalAudit.payload.duration_decision.source, 'author_approved_range');
  assert.equal(approvalAudit.payload.duration_decision.duration_ms, 3600000);

  const committed = await fetch(base + '/v1/worlds/author-duration-world/proposals/' + candidate.proposal_id + '/commit', {
    method: 'POST', headers, body: '{}',
  });
  assert.equal(committed.status, 200);
  const committedBody = await committed.json();
  assert.equal(committedBody.commit_result.game_time_coordinate, 3600000);
  const committedAuditResponse = await fetch(base + '/v1/worlds/author-duration-world/audit', { headers: adminHeaders });
  const committedAudit = (await committedAuditResponse.json()).audit.find((entry) =>
    entry.action === 'event.committed' && entry.target_id === committedBody.commit_result.event_id);
  assert.equal(committedAudit.payload.duration_decision.source, 'author_approved_range');
  assert.equal(committedAudit.payload.duration_decision.duration_ms, 3600000);
});
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
  const empty = await fetch(base + '/v1/mechanic-templates', { headers: { ...headers, 'x-admin-token': ADMIN } });
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
  const fetched = await fetch(base + '/v1/mechanic-templates/api.mechanic/1.0.0', { headers: { ...headers, 'x-admin-token': ADMIN } });
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


test('authorized-read HTTP route requires a configured adapter and keeps the default policy self-identity-only', async (t) => {
  const base = await setup(t, { approvalToken: APPROVAL, adminToken: ADMIN });
  assert.equal((await createWorld(base, 'authorized-read-api-world')).status, 201);

  const created = await fetch(base + '/v1/worlds/authorized-read-api-world/proposals', {
    method: 'POST', headers,
    body: json({
      idempotency_key: 'authorized-read-api-seed',
      source_text: '',
      event: {
        turn_id: 'authorized-read-api-seed-turn',
        event_type: 'action.completed',
        effects: [
          { kind: 'entity.create', entity_id: 'bound-actor', entity_type: 'character', attributes: { name: 'Visible-to-self', secret: 'never-default-disclose' } },
          { kind: 'entity.create', entity_id: 'other-character', entity_type: 'character', attributes: { name: 'Other', secret: 'other-private' } },
        ],
      },
    }),
  });
  assert.equal(created.status, 201);
  const proposal = (await created.json()).proposal;
  const approved = await fetch(base + '/v1/worlds/authorized-read-api-world/proposals/' + proposal.proposal_id + '/approve', {
    method: 'POST', headers: { ...headers, 'x-approval-token': APPROVAL }, body: '{}',
  });
  assert.equal(approved.status, 200);
  const committed = await fetch(base + '/v1/worlds/authorized-read-api-world/proposals/' + proposal.proposal_id + '/commit', {
    method: 'POST', headers, body: '{}',
  });
  assert.equal(committed.status, 200);

  const bind = await fetch(base + '/v1/worlds/authorized-read-api-world/actor-bindings', {
    method: 'POST',
    headers: { ...headers, 'x-admin-token': ADMIN },
    body: json({ adapter_id: 'adapter-a', entity_id: 'bound-actor' }),
  });
  assert.equal(bind.status, 201);

  const readUrl = base + '/v1/worlds/authorized-read-api-world/authorized-read';
  const readBody = {
    actor_entity_id: 'bound-actor',
    purpose: 'npc_decision',
    entity_ids: ['bound-actor'],
    fields: ['entity_id', 'entity_type', 'status', 'attributes.name', 'attributes.secret'],
  };
  const noAdapter = await fetch(readUrl, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
    body: json(readBody),
  });
  assert.equal(noAdapter.status, 403);
  assert.equal((await noAdapter.json()).error.code, 'ADAPTER_REQUIRED');

  const selfRead = await fetch(readUrl, { method: 'POST', headers, body: json(readBody) });
  assert.equal(selfRead.status, 200);
  const selfPayload = await selfRead.json();
  assert.deepEqual(selfPayload.read.entities, [{
    entity_id: 'bound-actor',
    entity_type: 'character',
    status: 'active',
  }]);
  assert.equal(JSON.stringify(selfPayload).includes('Visible-to-self'), false);
  assert.equal(JSON.stringify(selfPayload).includes('never-default-disclose'), false);

  const crossActorRead = await fetch(readUrl, {
    method: 'POST', headers,
    body: json({ ...readBody, entity_ids: ['other-character'] }),
  });
  assert.equal(crossActorRead.status, 404);
  const crossActorError = (await crossActorRead.json()).error;
  assert.equal(crossActorError.code, 'READ_NOT_AVAILABLE');
  assert.equal(JSON.stringify(crossActorError).includes('other-private'), false);

  const missingRead = await fetch(readUrl, {
    method: 'POST', headers,
    body: json({ ...readBody, entity_ids: ['not-present'] }),
  });
  assert.equal(missingRead.status, 404);
  assert.deepEqual((await missingRead.json()).error, crossActorError);
});


test('authorized-read HTTP route rejects caller-supplied policy and identity overrides', async (t) => {
  const base = await setup(t);
  assert.equal((await createWorld(base, 'authorized-read-no-policy-injection')).status, 201);
  const url = base + '/v1/worlds/authorized-read-no-policy-injection/authorized-read';
  const baseBody = {
    actor_entity_id: 'actor-a',
    purpose: 'npc_decision',
    entity_ids: ['actor-a'],
    fields: ['entity_id'],
  };

  for (const extra of [
    { field_policy: { allow_all: true } },
    { authenticated_adapter_id: 'adapter-b' },
    { recipient: 'admin' },
    { authorization: true },
  ]) {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: json({ ...baseBody, ...extra }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_AUTHORIZED_READ');
  }
});

test('API registers a generation-bound context manifest and commits against it through the internal route', async (t) => {
  const base = await setup(t, { internalToken: INTERNAL, approvalToken: APPROVAL });
  const internalHeaders = { ...headers, 'x-engine-internal-token': INTERNAL };
  assert.equal((await createWorld(base, 'manifest-api-world')).status, 201);
  const registered = await fetch(base + '/v1/worlds/manifest-api-world/context-manifests', {
    method: 'POST', headers: internalHeaders,
    body: json({ generation_id: 'api-generation-1', base_commit_sequence: 0, base_world_revision: 0, items: [] }),
  });
  assert.equal(registered.status, 201);
  const manifest = (await registered.json()).context_manifest;
  assert.ok(manifest.manifest_id);

  const proposed = await fetch(base + '/v1/worlds/manifest-api-world/proposals', { method: 'POST', headers, body: json({ idempotency_key: 'api-manifest-event', source_text: '', event: { turn_id: 'api-manifest-turn', event_type: 'action.completed', generation_id: 'api-generation-1', context_manifest_id: manifest.manifest_id, effects: [] } }) });
  const proposal = (await proposed.json()).proposal;
  const approved = await fetch(base + '/v1/worlds/manifest-api-world/proposals/' + proposal.proposal_id + '/approve', { method: 'POST', headers: { ...headers, 'x-approval-token': APPROVAL }, body: '{}' });
  assert.equal(approved.status, 200);
  const committed = await fetch(base + '/v1/worlds/manifest-api-world/proposals/' + proposal.proposal_id + '/commit', { method: 'POST', headers, body: '{}' });
  assert.equal(committed.status, 200);
  assert.equal((await committed.json()).commit_result.commit_sequence, 1);
});

test('mechanic effect intents translate into canonical effects inside the proposal lifecycle', async (t) => {
  const base = await setup(t, { internalToken: INTERNAL, approvalToken: APPROVAL });
  const internalHeaders = { ...headers, 'x-engine-internal-token': INTERNAL };
  assert.equal((await createWorld(base, 'intent-world')).status, 201);
  const body = {
    idempotency_key: 'intent-proposal-1',
    source_text: 'Create Mira as a character.',
    event: {
      turn_id: 'intent-turn-1',
      event_type: 'action.completed',
      effect_intents: [{
        effect_id: 'effect-1',
        kind: 'create_entity',
        target_ref: 'mira',
        payload: { entity_type: 'character', attributes: { name: 'Mira' } },
      }],
    },
  };
  const createUrl = base + '/v1/worlds/intent-world/proposals';
  const response = await fetch(createUrl, { method: 'POST', headers, body: json(body) });
  assert.equal(response.status, 201);
  const proposal = (await response.json()).proposal;
  assert.equal(proposal.status, 'pending');
  assert.deepEqual(proposal.event.effects, [{
    kind: 'entity.create',
    entity_id: 'mira',
    entity_type: 'character',
    attributes: { name: 'Mira' },
  }]);
  assert.equal(Object.hasOwn(proposal.event, 'effect_intents'), false);
  assert.equal((await (await fetch(base + '/v1/worlds/intent-world/state', { headers: internalHeaders })).json()).state.world_revision, 0);
  assert.equal((await (await fetch(base + '/v1/worlds/intent-world/events', { headers: internalHeaders })).json()).events.length, 0);

  const replay = await fetch(createUrl, { method: 'POST', headers, body: json(body) });
  assert.equal(replay.status, 201);
  assert.equal((await replay.json()).proposal.proposal_id, proposal.proposal_id);
  const changedIntent = structuredClone(body);
  changedIntent.event.effect_intents[0].payload.attributes.name = 'Different';
  const conflict = await fetch(createUrl, { method: 'POST', headers, body: json(changedIntent) });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, 'IDEMPOTENCY_KEY_CONFLICT');

  const invalidChangedIntent = structuredClone(body);
  invalidChangedIntent.event.effect_intents[0].kind = 'create_relation';
  const invalidConflict = await fetch(createUrl, { method: 'POST', headers, body: json(invalidChangedIntent) });
  assert.equal(invalidConflict.status, 409);
  assert.equal((await invalidConflict.json()).error.code, 'IDEMPOTENCY_KEY_CONFLICT');

  const approvalUrl = base + '/v1/worlds/intent-world/proposals/' + proposal.proposal_id + '/approve';
  const approved = await fetch(approvalUrl, {
    method: 'POST', headers: { ...headers, 'x-approval-token': APPROVAL }, body: '{}',
  });
  assert.equal(approved.status, 200);
  assert.equal((await approved.json()).proposal.status, 'approved');
  const committed = await fetch(base + '/v1/worlds/intent-world/proposals/' + proposal.proposal_id + '/commit', {
    method: 'POST', headers, body: '{}',
  });
  assert.equal(committed.status, 200);
  const result = await committed.json();
  assert.equal(result.proposal.status, 'committed');
  assert.equal(result.commit_result.world_revision, 1);
  const state = (await (await fetch(base + '/v1/worlds/intent-world/state', { headers: internalHeaders })).json()).state;
  assert.equal(state.entities.find((entity) => entity.entity_id === 'mira').attributes.name, 'Mira');
});

test('mechanic intent translation rejects ambiguous or invalid batches without creating proposal or audit side effects', async (t) => {
  const base = await setup(t, { internalToken: INTERNAL });
  const internalHeaders = { ...headers, 'x-engine-internal-token': INTERNAL };
  assert.equal((await createWorld(base, 'intent-reject-world')).status, 201);
  const common = {
    idempotency_key: 'intent-reject-1',
    source_text: 'Attempt a change.',
    event: { turn_id: 'intent-reject-turn', event_type: 'action.completed' },
  };
  const post = (event) => fetch(base + '/v1/worlds/intent-reject-world/proposals', {
    method: 'POST', headers, body: json({ ...common, event: { ...common.event, ...event } }),
  });
  const both = await post({
    effects: [],
    effect_intents: [{ effect_id: 'x', kind: 'create_entity', target_ref: 'x', payload: { entity_type: 'character' } }],
  });
  assert.equal(both.status, 400);
  assert.equal((await both.json()).error.code, 'MUTUALLY_EXCLUSIVE_EFFECT_FIELDS');

  const unsupported = await post({
    effect_intents: [{ effect_id: 'x', kind: 'create_relation', target_ref: 'x', payload: {} }],
  });
  assert.equal(unsupported.status, 400);
  assert.equal((await unsupported.json()).error.code, 'UNSUPPORTED_MECHANIC_EFFECT_INTENT');

  const provenance = await post({
    effect_intents: [{ effect_id: 'x', kind: 'create_entity', target_ref: 'x', source_refs: ['source-1'], payload: { entity_type: 'character' } }],
  });
  assert.equal(provenance.status, 400);
  assert.equal((await provenance.json()).error.code, 'TRANSLATION_REQUIRES_PROVENANCE_MAPPING');

  const partial = await post({
    effect_intents: [
      { effect_id: 'good', kind: 'create_entity', target_ref: 'x', payload: { entity_type: 'character' } },
      { effect_id: 'bad', kind: 'update_attribute', target_ref: 'x', payload: {} },
    ],
  });
  assert.equal(partial.status, 400);
  assert.equal((await partial.json()).error.code, 'INVALID_MECHANIC_EFFECT_INTENT');

  const state = (await (await fetch(base + '/v1/worlds/intent-reject-world/state', { headers: internalHeaders })).json()).state;
  const events = (await (await fetch(base + '/v1/worlds/intent-reject-world/events', { headers: internalHeaders })).json()).events;
  const audit = (await (await fetch(base + '/v1/worlds/intent-reject-world/audit', { headers: internalHeaders })).json()).audit;
  assert.equal(state.world_revision, 0);
  assert.deepEqual(state.entities, []);
  assert.deepEqual(events, []);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, 'world.created');

  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  t.after(() => store.close());
  engine.createWorld({ world_id: 'intent-db-world', world_pack_id: 'test.world', world_pack_version: '1.0.0', game_time: '2026-01-01T00:00:00Z' });
  const proposals = new ProposalService(engine);
  const beforeProposals = store.db.prepare('SELECT COUNT(*) AS n FROM event_proposals').get().n;
  const beforeAudit = store.db.prepare('SELECT COUNT(*) AS n FROM audit_entries').get().n;
  assert.throws(() => proposals.create('intent-db-world', {
    ...common,
    event: {
      turn_id: 'intent-db-turn',
      event_type: 'action.completed',
      effect_intents: [
        { effect_id: 'good', kind: 'create_entity', target_ref: 'x', payload: { entity_type: 'character' } },
        { effect_id: 'bad', kind: 'create_relation', target_ref: 'x', payload: {} },
      ],
    },
  }, 'adapter-a'), (error) => error.code === 'UNSUPPORTED_MECHANIC_EFFECT_INTENT');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM event_proposals').get().n, beforeProposals);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM audit_entries').get().n, beforeAudit);
  assert.equal(store.world('intent-db-world').world_revision, 0);
  assert.deepEqual(store.events('intent-db-world', true), []);
});

test('translated fact intents use the same canonical fact-identity guard as direct effects', async (t) => {
  const base = await setup(t, { internalToken: INTERNAL, approvalToken: APPROVAL });
  const internalHeaders = { ...headers, 'x-engine-internal-token': INTERNAL };
  assert.equal((await createWorld(base, 'intent-fact-identity-world')).status, 201);

  const createProposal = await fetch(base + '/v1/worlds/intent-fact-identity-world/proposals', {
    method: 'POST', headers,
    body: json({
      idempotency_key: 'canonical-fact-seed',
      source_text: 'Mira is alive.',
      event: {
        turn_id: 'canonical-fact-seed-turn',
        event_type: 'action.completed',
        effects: [{ kind: 'fact.set', fact_id: 'mira-status', predicate: 'status', subject_ref: 'mira', value: 'alive' }],
      },
    }),
  });
  assert.equal(createProposal.status, 201);
  const canonical = (await createProposal.json()).proposal;
  const approved = await fetch(base + '/v1/worlds/intent-fact-identity-world/proposals/' + canonical.proposal_id + '/approve', {
    method: 'POST', headers: { ...headers, 'x-approval-token': APPROVAL }, body: '{}',
  });
  assert.equal(approved.status, 200);
  assert.equal((await fetch(base + '/v1/worlds/intent-fact-identity-world/proposals/' + canonical.proposal_id + '/commit', {
    method: 'POST', headers, body: '{}',
  })).status, 200);

  const auditBefore = (await (await fetch(base + '/v1/worlds/intent-fact-identity-world/audit', { headers: internalHeaders })).json()).audit;
  const eventsBefore = (await (await fetch(base + '/v1/worlds/intent-fact-identity-world/events', { headers: internalHeaders })).json()).events;
  const rejected = await fetch(base + '/v1/worlds/intent-fact-identity-world/proposals', {
    method: 'POST', headers,
    body: json({
      idempotency_key: 'translated-fact-identity-mismatch',
      source_text: 'Mira lives in Kamurocho.',
      event: {
        turn_id: 'translated-fact-identity-turn',
        event_type: 'action.completed',
        effect_intents: [{
          effect_id: 'assert-location',
          kind: 'assert_fact',
          target_ref: 'mira-status',
          payload: { predicate: 'location', subject_ref: 'mira', value: 'Kamurocho' },
        }],
      },
    }),
  });
  assert.equal(rejected.status, 409);
  assert.equal((await rejected.json()).error.code, 'FACT_IDENTITY_MISMATCH');

  const state = (await (await fetch(base + '/v1/worlds/intent-fact-identity-world/state', { headers: internalHeaders })).json()).state;
  const eventsAfter = (await (await fetch(base + '/v1/worlds/intent-fact-identity-world/events', { headers: internalHeaders })).json()).events;
  const auditAfter = (await (await fetch(base + '/v1/worlds/intent-fact-identity-world/audit', { headers: internalHeaders })).json()).audit;
  assert.equal(state.world_revision, 1);
  assert.deepEqual(eventsAfter, eventsBefore);
  assert.equal(auditAfter.length, auditBefore.length);

  const retry = await fetch(base + '/v1/worlds/intent-fact-identity-world/proposals', {
    method: 'POST', headers,
    body: json({
      idempotency_key: 'translated-fact-identity-mismatch',
      source_text: 'Mira lives in Kamurocho.',
      event: {
        turn_id: 'translated-fact-identity-retry-turn',
        event_type: 'action.completed',
        effect_intents: [{
          effect_id: 'assert-location-valid',
          kind: 'assert_fact',
          target_ref: 'mira-location',
          payload: { predicate: 'location', subject_ref: 'mira', value: 'Kamurocho' },
        }],
      },
    }),
  });
  assert.equal(retry.status, 201);
  assert.equal((await retry.json()).proposal.status, 'pending');
  assert.equal((await (await fetch(base + '/v1/worlds/intent-fact-identity-world/state', { headers: internalHeaders })).json()).state.world_revision, 1);
});

test('translated duplicate fact IDs fail before proposal or event writes', async (t) => {
  const base = await setup(t, { internalToken: INTERNAL, approvalToken: APPROVAL });
  const internalHeaders = { ...headers, 'x-engine-internal-token': INTERNAL };
  assert.equal((await createWorld(base, 'translated-duplicate-facts-world')).status, 201);

  const stateBefore = (await (await fetch(base + '/v1/worlds/translated-duplicate-facts-world/state', { headers: internalHeaders })).json()).state;
  const eventsBefore = (await (await fetch(base + '/v1/worlds/translated-duplicate-facts-world/events', { headers: internalHeaders })).json()).events;
  const auditBefore = (await (await fetch(base + '/v1/worlds/translated-duplicate-facts-world/audit', { headers: internalHeaders })).json()).audit;
  const rejected = await fetch(base + '/v1/worlds/translated-duplicate-facts-world/proposals', {
    method: 'POST', headers,
    body: json({
      idempotency_key: 'translated-duplicate-facts-proposal',
      source_text: 'The same fact is asserted twice.',
      event: {
        turn_id: 'translated-duplicate-facts-turn',
        event_type: 'action.completed',
        effect_intents: [
          {
            effect_id: 'first-claim',
            kind: 'assert_fact',
            target_ref: 'same-fact',
            payload: { predicate: 'status', subject_ref: 'mira', value: 'alive' },
          },
          {
            effect_id: 'second-claim',
            kind: 'assert_fact',
            target_ref: 'same-fact',
            payload: { predicate: 'status', subject_ref: 'mira', value: 'missing' },
          },
        ],
      },
    }),
  });
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error.code, 'DUPLICATE_FACT_EFFECT');

  const stateAfter = (await (await fetch(base + '/v1/worlds/translated-duplicate-facts-world/state', { headers: internalHeaders })).json()).state;
  const eventsAfter = (await (await fetch(base + '/v1/worlds/translated-duplicate-facts-world/events', { headers: internalHeaders })).json()).events;
  const auditAfter = (await (await fetch(base + '/v1/worlds/translated-duplicate-facts-world/audit', { headers: internalHeaders })).json()).audit;
  assert.equal(stateAfter.world_revision, stateBefore.world_revision);
  assert.deepEqual(stateAfter.facts, stateBefore.facts);
  assert.deepEqual(eventsAfter, eventsBefore);
  assert.equal(auditAfter.length, auditBefore.length);

  const retry = await fetch(base + '/v1/worlds/translated-duplicate-facts-world/proposals', {
    method: 'POST', headers,
    body: json({
      idempotency_key: 'translated-duplicate-facts-proposal',
      source_text: 'The fact is asserted once.',
      event: {
        turn_id: 'translated-duplicate-facts-retry-turn',
        event_type: 'action.completed',
        effect_intents: [{
          effect_id: 'single-claim',
          kind: 'assert_fact',
          target_ref: 'single-fact',
          payload: { predicate: 'status', subject_ref: 'mira', value: 'alive' },
        }],
      },
    }),
  });
  assert.equal(retry.status, 201);
  assert.equal((await retry.json()).proposal.status, 'pending');
  assert.equal((await (await fetch(base + '/v1/worlds/translated-duplicate-facts-world/state', { headers: internalHeaders })).json()).state.world_revision, 0);
});

test('translated update intents require an explicit existence precondition and never synthesize one', async (t) => {
  const base = await setup(t, { internalToken: INTERNAL, approvalToken: APPROVAL });
  assert.equal((await createWorld(base, 'translated-update-precondition-world')).status, 201);

  const seed = await fetch(base + '/v1/worlds/translated-update-precondition-world/proposals', {
    method: 'POST', headers,
    body: json({
      idempotency_key: 'translated-update-seed',
      source_text: 'Create the guard entity.',
      event: {
        turn_id: 'translated-update-seed-turn',
        event_type: 'action.completed',
        effects: [{ kind: 'entity.create', entity_id: 'guard', entity_type: 'character', attributes: { role: 'rookie' } }],
      },
    }),
  });
  assert.equal(seed.status, 201);
  const seedProposal = (await seed.json()).proposal;
  assert.equal((await fetch(base + '/v1/worlds/translated-update-precondition-world/proposals/' + seedProposal.proposal_id + '/approve', {
    method: 'POST', headers: { ...headers, 'x-approval-token': APPROVAL }, body: '{}',
  })).status, 200);
  assert.equal((await fetch(base + '/v1/worlds/translated-update-precondition-world/proposals/' + seedProposal.proposal_id + '/commit', {
    method: 'POST', headers, body: '{}',
  })).status, 200);

  const beforeEvents = (await (await fetch(base + '/v1/worlds/translated-update-precondition-world/events', { headers: { ...headers, 'x-engine-internal-token': INTERNAL } })).json()).events;
  const beforeAudit = (await (await fetch(base + '/v1/worlds/translated-update-precondition-world/audit', { headers: { ...headers, 'x-engine-internal-token': INTERNAL } })).json()).audit;
  const rejected = await fetch(base + '/v1/worlds/translated-update-precondition-world/proposals', {
    method: 'POST', headers,
    body: json({
      idempotency_key: 'translated-update-no-precondition',
      source_text: 'Update the guard.',
      event: {
        turn_id: 'translated-update-no-precondition-turn',
        event_type: 'action.completed',
        effect_intents: [{
          effect_id: 'update-guard',
          kind: 'update_attribute',
          target_ref: 'guard',
          payload: { attributes: { role: 'captain' } },
        }],
      },
    }),
  });
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error.code, 'ENTITY_UPDATE_PRECONDITION_REQUIRED');

  const accepted = await fetch(base + '/v1/worlds/translated-update-precondition-world/proposals', {
    method: 'POST', headers,
    body: json({
      idempotency_key: 'translated-update-with-precondition',
      source_text: 'Update the guard.',
      event: {
        turn_id: 'translated-update-with-precondition-turn',
        event_type: 'action.completed',
        causal_links: [{ relation: 'REQUIRES', predicate: { kind: 'entity_exists', entity_id: 'guard' } }],
        effect_intents: [{
          effect_id: 'update-guard-valid',
          kind: 'update_attribute',
          target_ref: 'guard',
          payload: { attributes: { role: 'captain' } },
        }],
      },
    }),
  });
  assert.equal(accepted.status, 201);
  const acceptedProposal = (await accepted.json()).proposal;
  assert.deepEqual(acceptedProposal.event.effects, [{
    kind: 'entity.update',
    entity_id: 'guard',
    attributes: { role: 'captain' },
  }]);
  assert.deepEqual(acceptedProposal.event.causal_links, [{ relation: 'REQUIRES', predicate: { kind: 'entity_exists', entity_id: 'guard' } }]);

  const eventsAfter = (await (await fetch(base + '/v1/worlds/translated-update-precondition-world/events', { headers: { ...headers, 'x-engine-internal-token': INTERNAL } })).json()).events;
  const auditAfter = (await (await fetch(base + '/v1/worlds/translated-update-precondition-world/audit', { headers: { ...headers, 'x-engine-internal-token': INTERNAL } })).json()).audit;
  assert.deepEqual(eventsAfter, beforeEvents);
  assert.equal(auditAfter.length, beforeAudit.length + 1);
  assert.equal(auditAfter.at(-1).action, 'proposal.created');
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



test('event_type cannot bypass the internal credential boundary', async (t) => {
  const base = await setup(t, { internalToken: INTERNAL });
  await createWorld(base, 'event-taxonomy-world');
  const response = await fetch(base + '/v1/worlds/event-taxonomy-world/events', {
    method: 'POST',
    headers,
    body: json({
      idempotency_key: 'event-type-auth-check',
      turn_id: 'event-type-auth-check',
      event_type: 'domain.custom.action',
      expected_revision: 0,
      effects: [],
    }),
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'DIRECT_COMMIT_DISABLED');
});

test('proposal API deduplicates concurrent same-key create requests', async (t) => {
  const base = await setup(t, { approvalToken: APPROVAL, internalToken: INTERNAL });
  assert.equal((await createWorld(base, 'proposal-concurrent-create-world')).status, 201);
  const url = base + '/v1/worlds/proposal-concurrent-create-world/proposals';
  const body = {
    idempotency_key: 'concurrent-same-key',
    source_text: 'Create the same proposal once.',
    event: { turn_id: 'concurrent-turn', event_type: 'action.completed', effects: [] },
  };
  const responses = await Promise.all([
    fetch(url, { method: 'POST', headers, body: json(body) }),
    fetch(url, { method: 'POST', headers, body: json(body) }),
  ]);
  assert.deepEqual(responses.map((response) => response.status), [201, 201]);
  const results = await Promise.all(responses.map((response) => response.json()));
  assert.equal(results[0].proposal.proposal_id, results[1].proposal.proposal_id);
  assert.equal(results.filter((result) => result.proposal.idempotent_replay).length, 1);

  const internalHeaders = { ...headers, 'x-engine-internal-token': INTERNAL };
  const stateResponse = await fetch(base + '/v1/worlds/proposal-concurrent-create-world/state', { headers: internalHeaders });
  assert.equal(stateResponse.status, 200);
  assert.equal((await stateResponse.json()).state.world_revision, 0);
  const proposals = await fetch(base + '/v1/worlds/proposal-concurrent-create-world/proposals/' + results[0].proposal.proposal_id, { headers });
  assert.equal(proposals.status, 200);
});

test('approval rejects a pending proposal after an intervening canonical commit', async (t) => {
  const base = await setup(t, { approvalToken: APPROVAL });
  assert.equal((await createWorld(base, 'proposal-stale-approval-world')).status, 201);
  const makeProposal = async (key, turn) => {
    const response = await fetch(base + '/v1/worlds/proposal-stale-approval-world/proposals', {
      method: 'POST', headers,
      body: json({ idempotency_key: key, source_text: '', event: { turn_id: turn, event_type: 'action.completed', effects: [] } }),
    });
    assert.equal(response.status, 201);
    return (await response.json()).proposal;
  };
  const stale = await makeProposal('stale-at-approval', 'stale-turn');
  const intervening = await makeProposal('advance-before-approval', 'advance-turn');
  const approve = (proposalId) => fetch(base + '/v1/worlds/proposal-stale-approval-world/proposals/' + proposalId + '/approve', {
    method: 'POST', headers: { ...headers, 'x-approval-token': APPROVAL }, body: '{}',
  });
  assert.equal((await (await approve(intervening.proposal_id)).json()).proposal.status, 'approved');
  const committed = await fetch(base + '/v1/worlds/proposal-stale-approval-world/proposals/' + intervening.proposal_id + '/commit', { method: 'POST', headers, body: '{}' });
  assert.equal(committed.status, 200);

  const staleApproval = await approve(stale.proposal_id);
  assert.equal(staleApproval.status, 409);
  assert.equal((await staleApproval.json()).error.code, 'STALE_PROPOSAL');
  const stillPending = await fetch(base + '/v1/worlds/proposal-stale-approval-world/proposals/' + stale.proposal_id, { headers });
  assert.equal((await stillPending.json()).proposal.status, 'pending');
});

test('active mechanic policy validator resolves the current owner on every check and fails closed', () => {
  let activeProvider = {
    validateMechanicPolicy(identity) {
      return identity.policyVersion === 'v1' && identity.authorizationScope === 'scope-a';
    },
  };
  const validate = createActiveMechanicPolicyValidator(() => activeProvider);
  const pinnedV1 = { policyVersion: 'v1', authorizationScope: 'scope-a' };
  assert.equal(validate(pinnedV1), true);

  // Rotating the deployment-owned provider must affect the next boundary check.
  activeProvider = {
    validateMechanicPolicy(identity) {
      return identity.policyVersion === 'v2' && identity.authorizationScope === 'scope-b';
    },
  };
  assert.equal(validate(pinnedV1), false);
  assert.equal(validate({ policyVersion: 'v2', authorizationScope: 'scope-b' }), true);

  assert.equal(createActiveMechanicPolicyValidator(() => null)(pinnedV1), false);
  assert.equal(createActiveMechanicPolicyValidator(() => { throw new Error('owner unavailable'); })(pinnedV1), false);
  assert.equal(createActiveMechanicPolicyValidator(() => ({ validateMechanicPolicy() { throw new Error('policy failure'); } }))(pinnedV1), false);
  assert.throws(() => createActiveMechanicPolicyValidator(null), /trusted application callback/);

  const store = new SQLiteStore(':memory:');
  try {
    assert.throws(() => createApiServer({ engine: new LogicEngine(store), token: TOKEN, getActiveMechanicContextProvider: null }), /trusted application callback/);
  } finally {
    store.close();
  }
});


test('proposal policy boundary rejects a proposal pinned to a rotated active provider', () => {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  let activeProvider = {
    validateMechanicPolicy(identity) {
      return identity.policyVersion === 'policy-v1' && identity.authorizationScope === 'npc:alice';
    },
  };
  const proposals = new ProposalService(engine, {
    validateMechanicPolicy: createActiveMechanicPolicyValidator(() => activeProvider),
  });
  const row = {
    world_id: 'policy-rotation-world',
    mechanic_execution_json: JSON.stringify({
      context_policy_version: 'policy-v1',
      authorization_scope: 'npc:alice',
      snapshot_identity: { world_id: 'policy-rotation-world' },
    }),
  };
  try {
    assert.doesNotThrow(() => proposals.assertMechanicPolicyCurrent(row, 'approval'));
    activeProvider = {
      validateMechanicPolicy(identity) {
        return identity.policyVersion === 'policy-v2' && identity.authorizationScope === 'npc:alice';
      },
    };
    assert.throws(
      () => proposals.assertMechanicPolicyCurrent(row, 'commit'),
      (error) => error.code === 'STALE_MECHANIC_POLICY' && error.details?.stage === 'commit',
    );
  } finally {
    store.close();
  }
});


test('mechanic proposal policy boundary stays closed without a trusted validator or valid pinned identity', () => {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  const unconfigured = new ProposalService(engine);
  const row = {
    world_id: 'policy-fail-closed-world',
    mechanic_execution_json: JSON.stringify({
      context_policy_version: 'policy-v1',
      authorization_scope: 'npc:alice',
      snapshot_identity: { world_id: 'policy-fail-closed-world' },
    }),
  };
  try {
    assert.throws(
      () => unconfigured.assertMechanicPolicyCurrent(row, 'approval'),
      (error) => error.code === 'MECHANIC_POLICY_REVALIDATION_REQUIRED',
    );

    const configured = new ProposalService(engine, {
      validateMechanicPolicy: () => true,
    });
    const malformed = {
      ...row,
      mechanic_execution_json: JSON.stringify({ context_policy_version: '', authorization_scope: 'npc:alice' }),
    };
    assert.throws(
      () => configured.assertMechanicPolicyCurrent(malformed, 'commit'),
      (error) => error.code === 'STALE_MECHANIC_POLICY' && error.details?.stage === 'commit',
    );
  } finally {
    store.close();
  }
});
