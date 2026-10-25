import test from 'node:test';
import assert from 'node:assert/strict';
import { planDueWork } from '../src/time/scheduler.js';

// Scheduler-only adapter, deliberately limited to the real boundary shape:
// Process Manager stores prerequisite milestone IDs; engine.js maps those IDs
// to each milestone's declared trigger_id before calling registerTimeTrigger.
// This helper performs only that mapping and then invokes the existing planner;
// it does not claim to exercise persistence, lifecycle, or the Core trigger path.
function processTriggers(milestones) {
  const triggerIds = new Map(milestones.map((milestone) => {
    assert.equal(typeof milestone.trigger_id, 'string', 'every process-shaped milestone must declare trigger_id');
    assert.ok(milestone.trigger_id.length > 0, 'trigger_id must not be empty');
    return [milestone.milestone_id, milestone.trigger_id];
  }));
  return milestones.map((milestone) => ({
    trigger_id: triggerIds.get(milestone.milestone_id),
    world_id: 'world-a',
    due_coordinate: milestone.due_coordinate,
    status: milestone.status ?? 'pending',
    dependencies: (milestone.prerequisites ?? []).map((id) => triggerIds.get(id) ?? ('unresolved-prerequisite:' + id)),
    read_set: milestone.read_set ?? [],
    write_set: milestone.write_set ?? [],
    processing_mode: 'exact',
    interrupt_after_coordinate: milestone.interrupt_after_coordinate ?? false,
  }));
}

test('process milestones preserve deterministic due order and explicit same-coordinate prerequisites', () => {
  const plan = planDueWork({
    world_id: 'world-a',
    from_coordinate: 0,
    to_coordinate: 10,
    triggers: processTriggers([
      { milestone_id: 'wall', trigger_id: 'build-wall', due_coordinate: 10, prerequisites: ['foundation'] },
      { milestone_id: 'independent', trigger_id: 'build-independent', due_coordinate: 5 },
      { milestone_id: 'foundation', trigger_id: 'build-foundation', due_coordinate: 10 },
    ]),
  });

  assert.equal(plan.status, 'planned');
  assert.deepEqual(plan.segments.map((segment) => segment.trigger_ids), [
    ['build-independent'],
    ['build-foundation'],
    ['build-wall'],
  ]);
});

test('process milestone missing, cancelled, not-yet-due, and cyclic prerequisites fail closed', () => {
  const missing = planDueWork({
    world_id: 'world-a', from_coordinate: 0, to_coordinate: 10,
    triggers: processTriggers([
      { milestone_id: 'dependent', trigger_id: 'time-test-dependent', due_coordinate: 5, prerequisites: ['missing'] },
    ]),
  });
  assert.equal(missing.status, 'blocked');
  assert.deepEqual(missing.segments, []);
  assert.equal(missing.blocked[0].reason, 'missing_dependency');

  const cancelled = planDueWork({
    world_id: 'world-a', from_coordinate: 0, to_coordinate: 10,
    triggers: processTriggers([
      { milestone_id: 'prerequisite', trigger_id: 'time-test-prerequisite', due_coordinate: 2, status: 'cancelled' },
      { milestone_id: 'dependent', trigger_id: 'time-test-dependent', due_coordinate: 5, prerequisites: ['prerequisite'] },
    ]),
  });
  assert.equal(cancelled.status, 'blocked');
  assert.deepEqual(cancelled.segments, []);
  assert.equal(cancelled.blocked[0].reason, 'dependency_cancelled');

  const notDue = planDueWork({
    world_id: 'world-a', from_coordinate: 7, to_coordinate: 10,
    triggers: processTriggers([
      { milestone_id: 'prerequisite', trigger_id: 'time-test-prerequisite', due_coordinate: 6 },
      { milestone_id: 'dependent', trigger_id: 'time-test-dependent', due_coordinate: 8, prerequisites: ['prerequisite'] },
    ]),
  });
  assert.equal(notDue.status, 'blocked');
  assert.deepEqual(notDue.segments, []);
  assert.equal(notDue.blocked[0].reason, 'dependency_not_due_in_interval');

  assert.throws(() => planDueWork({
    world_id: 'world-a', from_coordinate: 0, to_coordinate: 10,
    triggers: processTriggers([
      { milestone_id: 'one', trigger_id: 'time-test-one', due_coordinate: 5, prerequisites: ['two'] },
      { milestone_id: 'two', trigger_id: 'time-test-two', due_coordinate: 5, prerequisites: ['one'] },
    ]),
  }), (error) => error.code === 'TRIGGER_DEPENDENCY_CYCLE');
});

test('same-coordinate process read/write conflict without explicit causal order is rejected', () => {
  assert.throws(() => planDueWork({
    world_id: 'world-a', from_coordinate: 0, to_coordinate: 5,
    triggers: processTriggers([
      { milestone_id: 'writer', trigger_id: 'time-test-writer', due_coordinate: 5, write_set: ['entity:shared'] },
      { milestone_id: 'reader', trigger_id: 'time-test-reader', due_coordinate: 5, read_set: ['entity:shared'] },
    ]),
  }), (error) => error.code === 'TRIGGER_CONFLICT_NEEDS_REVIEW');
});

test('interrupted process planning includes the whole stop coordinate and leaves later milestones for replanning', () => {
  const triggers = processTriggers([
    { milestone_id: 'foundation', trigger_id: 'time-test-foundation', due_coordinate: 5, interrupt_after_coordinate: true },
    { milestone_id: 'wall', trigger_id: 'time-test-wall', due_coordinate: 5 },
    { milestone_id: 'roof', trigger_id: 'time-test-roof', due_coordinate: 10 },
  ]);
  const first = planDueWork({
    world_id: 'world-a', from_coordinate: 0, to_coordinate: 10, triggers,
  });

  assert.equal(first.status, 'interrupted');
  assert.equal(first.stop_coordinate, 5);
  assert.equal(first.planned_until_coordinate, 5);
  assert.deepEqual(first.segments.map((segment) => segment.trigger_ids), [
    ['time-test-foundation', 'time-test-wall'],
  ]);
  assert.deepEqual(first.remaining_trigger_ids, ['time-test-roof']);

  // This second call checks the pure planner's contract when given a simulated
  // last-confirmed coordinate and completed-trigger snapshot. Durable persistence,
  // restart, and trigger re-registration are tested on the merged #281 real engine path.
  const second = planDueWork({
    world_id: 'world-a',
    from_coordinate: 5,
    to_coordinate: 10,
    triggers: triggers.map((trigger) => trigger.due_coordinate === 5
      ? { ...trigger, status: 'completed' }
      : trigger),
    completed_trigger_ids: ['time-test-foundation', 'time-test-wall'],
  });
  assert.equal(second.status, 'planned');
  assert.deepEqual(second.segments.map((segment) => segment.trigger_ids), [['time-test-roof']]);
});
