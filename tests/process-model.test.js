import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProcessDefinition, proposeProcessTransition } from '../src/process/model.js';

const milestone = (id, due, overrides = {}) => ({
  milestone_id: id,
  due_coordinate: due,
  dependencies: [],
  read_set: [],
  write_set: [],
  event: { event_type: 'action.completed', effects: [] },
  ...overrides,
});

const definition = (milestones = [milestone('a', 10)]) => normalizeProcessDefinition({
  process_id: 'construction',
  idempotency_key: 'create-construction',
  expected_revision: 0,
  source_event_ids: ['foundation-approved'],
  milestones,
}, 'world-a', 0);

test('normalizes a bounded process with world identity and local milestone dependencies', () => {
  const process = definition([
    milestone('foundation', 10),
    milestone('walls', 20, { dependencies: ['foundation'], interrupt_after_coordinate: true }),
  ]);
  assert.equal(process.world_id, 'world-a');
  assert.equal(process.status, 'scheduled');
  assert.deepEqual(process.milestones.map((item) => item.milestone_id), ['foundation', 'walls']);
  assert.equal(process.milestones[1].dependencies[0], 'foundation');
  assert.equal(process.milestones[1].status, 'pending');
});

test('rejects duplicate, past, unknown, cyclic, or causally reversed milestones', () => {
  assert.throws(() => definition([milestone('a', 1), milestone('a', 2)]), (error) => error.code === 'DUPLICATE_PROCESS_MILESTONE');
  assert.throws(() => definition([milestone('a', 0)]), (error) => error.code === 'PROCESS_MILESTONE_NOT_FUTURE');
  assert.throws(() => definition([milestone('a', 1, { dependencies: ['missing'] })]), (error) => error.code === 'PROCESS_DEPENDENCY_NOT_FOUND');
  assert.throws(() => definition([
    milestone('a', 1, { dependencies: ['b'] }),
    milestone('b', 1, { dependencies: ['a'] }),
  ]), (error) => error.code === 'PROCESS_DEPENDENCY_CYCLE');
  assert.throws(() => definition([
    milestone('later', 10),
    milestone('earlier', 5, { dependencies: ['later'] }),
  ]), (error) => error.code === 'PROCESS_CAUSAL_TIME_ORDER_CONFLICT');
});

test('rejects unknown fields and duplicate source references', () => {
  assert.throws(() => normalizeProcessDefinition({
    process_id: 'p', idempotency_key: 'k', expected_revision: 0, extra: true, milestones: [milestone('a', 1)],
  }, 'world-a', 0), (error) => error.code === 'UNSUPPORTED_PROCESS_FIELD');
  assert.throws(() => normalizeProcessDefinition({
    process_id: 'p', idempotency_key: 'k', expected_revision: 0, source_event_ids: ['x', 'x'], milestones: [milestone('a', 1)],
  }, 'world-a', 0), (error) => error.code === 'INVALID_PROCESS');
});

test('transition proposals reject invalid completion, claimed cancellation, and unvalidated resume', () => {
  const pending = { ...definition(), milestones: [{ milestone_id: 'a', status: 'pending' }] };
  assert.throws(() => proposeProcessTransition(pending, 'complete'), (error) => error.code === 'PROCESS_NOT_COMPLETE');
  assert.throws(() => proposeProcessTransition(pending, 'cancel', { has_in_flight_claim: true }), (error) => error.code === 'PROCESS_MILESTONE_CLAIMED');
  assert.throws(() => proposeProcessTransition({ ...pending, status: 'paused' }, 'resume'), (error) => error.code === 'PROCESS_RESUME_REQUIRES_RESCHEDULE');
});

test('transition proposals require failure reason and explicit review revalidation', () => {
  const process = definition();
  assert.throws(() => proposeProcessTransition(process, 'fail'), (error) => error.code === 'PROCESS_FAILURE_REASON_REQUIRED');
  const review = { ...process, status: 'needs_review' };
  assert.throws(() => proposeProcessTransition(review, 'resolve_review', { all_pending_future: true }), (error) => error.code === 'PROCESS_REVIEW_REQUIRES_REVALIDATION');
  const resolved = proposeProcessTransition(review, 'resolve_review', { all_pending_future: true, revalidated: true });
  assert.equal(resolved.status, 'scheduled');
});

test('transition proposals are pure and return a proposed status only', () => {
  const process = { ...definition(), status: 'running', milestones: [{ milestone_id: 'a', status: 'completed' }] };
  const result = proposeProcessTransition(process, 'complete');
  assert.equal(result.status, 'completed');
  assert.equal(process.status, 'running');
  assert.equal(process.milestones[0].status, 'completed');
});
