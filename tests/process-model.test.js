import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProcessDefinition } from '../src/process/model.js';

const milestone = (id, due, overrides = {}) => ({
  milestone_id: id,
  due_coordinate: due,
  dependencies: [],
  read_set: [],
  write_set: [],
  event: { event_type: 'action.completed', effects: [] },
  ...overrides,
});

test('normalizes a bounded process with future milestones and local dependencies', () => {
  const process = normalizeProcessDefinition({
    process_id: 'construction',
    idempotency_key: 'create-construction',
    expected_revision: 0,
    source_event_ids: ['foundation-approved'],
    milestones: [
      milestone('foundation', 10),
      milestone('walls', 20, { dependencies: ['foundation'], interrupt_after_coordinate: true }),
    ],
  }, 'world-a', 0);
  assert.equal(process.status, 'scheduled');
  assert.deepEqual(process.milestones.map((item) => item.milestone_id), ['foundation', 'walls']);
  assert.equal(process.milestones[1].dependencies[0], 'foundation');
  assert.equal(process.milestones[1].status, 'pending');
});

test('rejects duplicate, past, unknown, cyclic, or causally reversed milestones', () => {
  assert.throws(() => normalizeProcessDefinition({
    process_id: 'p', idempotency_key: 'k', expected_revision: 0, milestones: [milestone('a', 1), milestone('a', 2)],
  }, 'world-a', 0), (error) => error.code === 'DUPLICATE_PROCESS_MILESTONE');

  assert.throws(() => normalizeProcessDefinition({
    process_id: 'p', idempotency_key: 'k', milestones: [milestone('a', 0)],
  }, 'world-a', 0), (error) => error.code === 'PROCESS_MILESTONE_NOT_FUTURE');

  assert.throws(() => normalizeProcessDefinition({
    process_id: 'p', idempotency_key: 'k', milestones: [milestone('a', 1, { dependencies: ['missing'] })],
  }, 'world-a', 0), (error) => error.code === 'PROCESS_DEPENDENCY_NOT_FOUND');

  assert.throws(() => normalizeProcessDefinition({
    process_id: 'p', idempotency_key: 'k', milestones: [
      milestone('a', 1, { dependencies: ['b'] }), milestone('b', 1, { dependencies: ['a'] }),
    ],
  }, 'world-a', 0), (error) => error.code === 'PROCESS_DEPENDENCY_CYCLE');

  assert.throws(() => normalizeProcessDefinition({
    process_id: 'p', idempotency_key: 'k', milestones: [
      milestone('later', 10), milestone('earlier', 5, { dependencies: ['later'] }),
    ],
  }, 'world-a', 0), (error) => error.code === 'PROCESS_CAUSAL_TIME_ORDER_CONFLICT');
});

test('rejects unknown fields and invalid source references', () => {
  assert.throws(() => normalizeProcessDefinition({
    process_id: 'p', idempotency_key: 'k', expected_revision: 0, extra: true, milestones: [milestone('a', 1)],
  }, 'world-a', 0), (error) => error.code === 'UNSUPPORTED_PROCESS_FIELD');
  assert.throws(() => normalizeProcessDefinition({
    process_id: 'p', idempotency_key: 'k', expected_revision: 0, source_event_ids: ['x', 'x'], milestones: [milestone('a', 1)],
  }, 'world-a', 0), (error) => error.code === 'INVALID_PROCESS');
});
