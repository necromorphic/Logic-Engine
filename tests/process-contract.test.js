import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveProcessProgress,
  deriveProcessState,
  normalizeProcessDefinition,
  ProcessContractError,
  validateProcessTransition,
} from '../src/process/contract.js';

const processDefinition = (overrides = {}) => ({
  process_id: 'process-1',
  world_id: 'world-a',
  definition_version: 'v1',
  milestones: [
    {
      milestone_id: 'arrival',
      trigger_id: 'trigger-arrival',
      due_coordinate: 100,
      prerequisites: [],
      read_set: ['entity:traveller'],
      write_set: ['entity:traveller'],
      event: { event_type: 'process.arrival', effects: [] },
    },
    {
      milestone_id: 'departure',
      trigger_id: 'trigger-departure',
      due_coordinate: 200,
      prerequisites: ['arrival'],
      read_set: ['entity:traveller'],
      write_set: ['entity:traveller'],
      event: { event_type: 'process.departure', effects: [] },
    },
  ],
  ...overrides,
});

test('normalizes world-scoped process identity and deterministic milestone order', () => {
  const normalized = normalizeProcessDefinition(processDefinition({ milestones: [
    { milestone_id: 'second', trigger_id: 't2', due_coordinate: 20, prerequisites: ['first'], event: {} },
    { milestone_id: 'first', trigger_id: 't1', due_coordinate: 10, prerequisites: [], event: {} },
  ] }));
  assert.equal(normalized.process_id, 'process-1');
  assert.equal(normalized.world_id, 'world-a');
  assert.deepEqual(normalized.milestones.map((item) => item.milestone_id), ['first', 'second']);
  assert.deepEqual(normalized.milestones[1].prerequisites, ['first']);
});

test('rejects duplicate identities and missing prerequisites before scheduling', () => {
  assert.throws(
    () => normalizeProcessDefinition(processDefinition({ milestones: [
      { milestone_id: 'same', trigger_id: 't1', due_coordinate: 10, event: {} },
      { milestone_id: 'same', trigger_id: 't2', due_coordinate: 20, event: {} },
    ] })),
    (error) => error instanceof ProcessContractError && error.code === 'DUPLICATE_PROCESS_MILESTONE_ID',
  );
  assert.throws(
    () => normalizeProcessDefinition(processDefinition({ milestones: [
      { milestone_id: 'child', trigger_id: 't1', due_coordinate: 10, prerequisites: ['missing'], event: {} },
    ] })),
    (error) => error.code === 'PROCESS_MILESTONE_PREREQUISITE_MISSING',
  );
});

test('rejects a prerequisite scheduled after the milestone that depends on it', () => {
  assert.throws(
    () => normalizeProcessDefinition(processDefinition({ milestones: [
      { milestone_id: 'child', trigger_id: 't-child', due_coordinate: 10, prerequisites: ['parent'], event: {} },
      { milestone_id: 'parent', trigger_id: 't-parent', due_coordinate: 20, prerequisites: [], event: {} },
    ] })),
    (error) => error.code === 'PROCESS_MILESTONE_CAUSAL_TIME_ORDER',
  );
});

test('rejects prerequisite cycles without choosing an order from timestamps', () => {
  assert.throws(
    () => normalizeProcessDefinition(processDefinition({ milestones: [
      { milestone_id: 'a', trigger_id: 'ta', due_coordinate: 10, prerequisites: ['b'], event: {} },
      { milestone_id: 'b', trigger_id: 'tb', due_coordinate: 10, prerequisites: ['a'], event: {} },
    ] })),
    (error) => error.code === 'PROCESS_MILESTONE_CYCLE',
  );
});

test('rejects unsupported fields and non-JSON payloads', () => {
  assert.throws(
    () => normalizeProcessDefinition({ ...processDefinition(), execute: 'arbitrary-code' }),
    (error) => error.code === 'UNSUPPORTED_PROCESS_DEFINITION_FIELD',
  );
  const circular = {};
  circular.self = circular;
  assert.throws(
    () => normalizeProcessDefinition(processDefinition({ metadata: circular })),
    (error) => error.code === 'INVALID_PROCESS_DEFINITION',
  );
});

test('lifecycle transitions are explicit; terminal states cannot resume', () => {
  assert.deepEqual(validateProcessTransition('scheduled', 'running'), {
    from: 'scheduled', to: 'running', idempotent: false,
  });
  assert.equal(validateProcessTransition('paused', 'paused').idempotent, true);
  assert.throws(
    () => validateProcessTransition('completed', 'running'),
    (error) => error.code === 'INVALID_PROCESS_TRANSITION',
  );
  assert.throws(
    () => validateProcessTransition('running', 'unknown'),
    (error) => error.code === 'INVALID_PROCESS_STATE',
  );
});

test('progress projection exposes only prerequisite-ready milestones and never infers knowledge or delivery', () => {
  const process = normalizeProcessDefinition(processDefinition());
  const firstPending = deriveProcessProgress(process, { arrival: 'pending', departure: 'pending' });
  assert.deepEqual(firstPending.ready_milestone_ids, ['arrival']);
  assert.equal(firstPending.completed, 0);

  const afterFirst = deriveProcessProgress(process, { arrival: 'completed', departure: 'pending' });
  assert.deepEqual(afterFirst.ready_milestone_ids, ['departure']);
  assert.equal(afterFirst.completed, 1);
  assert.equal(deriveProcessState('scheduled', afterFirst), 'running');

  const done = deriveProcessProgress(process, { arrival: 'completed', departure: 'completed' });
  assert.equal(done.all_completed, true);
  assert.equal(deriveProcessState('running', done), 'completed');
  assert.equal(Object.hasOwn(done, 'npc_knowledge'), false);
  assert.equal(Object.hasOwn(done, 'player_delivery'), false);
});

test('unknown, blocked, or needs-review milestone status cannot be treated as completed', () => {
  const process = normalizeProcessDefinition(processDefinition());
  const blocked = deriveProcessProgress(process, { arrival: 'needs_review', departure: 'pending' });
  assert.equal(blocked.completed, 0);
  assert.equal(blocked.blocked, 1);
  assert.equal(deriveProcessState('running', blocked), 'needs_review');
  assert.throws(
    () => deriveProcessProgress(process, { arrival: 'unknown-status' }),
    (error) => error.code === 'INVALID_PROCESS_MILESTONE_STATUS',
  );
  assert.throws(
    () => deriveProcessProgress(process, { undeclared: 'completed' }),
    (error) => error.code === 'UNKNOWN_PROCESS_MILESTONE_STATUS',
  );
});

test('paused, cancelled, failed, and needs-review base states are not overwritten by derived completion', () => {
  const process = normalizeProcessDefinition(processDefinition());
  const allDone = deriveProcessProgress(process, { arrival: 'completed', departure: 'completed' });
  assert.equal(deriveProcessState('paused', allDone), 'paused');
  assert.equal(deriveProcessState('cancelled', allDone), 'cancelled');
  assert.equal(deriveProcessState('failed', allDone), 'failed');
  assert.equal(deriveProcessState('needs_review', allDone), 'needs_review');
});
