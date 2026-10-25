import test from 'node:test';
import assert from 'node:assert/strict';
import { planDueWork } from '../src/time/scheduler.js';

// Scheduler-only adapter, deliberately limited to the real boundary shape:
// Process Manager stores prerequisite milestone IDs; engine.js maps those IDs
// to each milestone's declared trigger_id before calling registerTimeTrigger.
// This helper performs only that mapping and then invokes the existing planner;
// it does not claim to exercise persistence, lifecycle, or the Core trigger path.
function processTriggers(processId, milestones) {
  const triggerIds = new Map(milestones.map((milestone) => [
    milestone.milestone_id,
    milestone.trigger_id ?? (processId + ':' + milestone.milestone_id),
  ]));
  return milestones.map((milestone) => ({
    trigger_id: triggerIds.get(milestone.milestone_id),
    world_id: 'world-a',
    due_coordinate: milestone.due_coordinate,
    status: milestone.status ?? 'pending',
    dependencies: (milestone.prerequisites ?? []).map((id) => triggerIds.get(id) ?? (processId + ':' + id)),
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
    triggers: processTriggers('build', [
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
    triggers: processTriggers('p', [
      { milestone_id: 'dependent', due_coordinate: 5, prerequisites: ['missing'] },
    ]),
  });
  assert.equal(missing.status, 'blocked');
  assert.deepEqual(missing.segments, []);
  assert.equal(missing.blocked[0].reason, 'missing_dependency');

  const cancelled = planDueWork({
    world_id: 'world-a', from_coordinate: 0, to_coordinate: 10,
    triggers: processTriggers('p', [
      { milestone_id: 'prerequisite', due_coordinate: 2, status: 'cancelled' },
      { milestone_id: 'dependent', due_coordinate: 5, prerequisites: ['prerequisite'] },
    ]),
  });
  assert.equal(cancelled.status, 'blocked');
  assert.deepEqual(cancelled.segments, []);
  assert.equal(cancelled.blocked[0].reason, 'dependency_cancelled');

  const notDue = planDueWork({
    world_id: 'world-a', from_coordinate: 7, to_coordinate: 10,
    triggers: processTriggers('p', [
      { milestone_id: 'prerequisite', due_coordinate: 6 },
      { milestone_id: 'dependent', due_coordinate: 8, prerequisites: ['prerequisite'] },
    ]),
  });
  assert.equal(notDue.status, 'blocked');
  assert.deepEqual(notDue.segments, []);
  assert.equal(notDue.blocked[0].reason, 'dependency_not_due_in_interval');

  assert.throws(() => planDueWork({
    world_id: 'world-a', from_coordinate: 0, to_coordinate: 10,
    triggers: processTriggers('p', [
      { milestone_id: 'one', due_coordinate: 5, prerequisites: ['two'] },
      { milestone_id: 'two', due_coordinate: 5, prerequisites: ['one'] },
    ]),
  }), (error) => error.code === 'TRIGGER_DEPENDENCY_CYCLE');
});

test('same-coordinate process read/write conflict without explicit causal order is rejected', () => {
  assert.throws(() => planDueWork({
    world_id: 'world-a', from_coordinate: 0, to_coordinate: 5,
    triggers: processTriggers('p', [
      { milestone_id: 'writer', due_coordinate: 5, write_set: ['entity:shared'] },
      { milestone_id: 'reader', due_coordinate: 5, read_set: ['entity:shared'] },
    ]),
  }), (error) => error.code === 'TRIGGER_CONFLICT_NEEDS_REVIEW');
});

test('interrupted process planning includes the whole stop coordinate and leaves later milestones for replanning', () => {
  const triggers = processTriggers('build', [
    { milestone_id: 'foundation', due_coordinate: 5, interrupt_after_coordinate: true },
    { milestone_id: 'wall', due_coordinate: 5 },
    { milestone_id: 'roof', due_coordinate: 10 },
  ]);
  const first = planDueWork({
    world_id: 'world-a', from_coordinate: 0, to_coordinate: 10, triggers,
  });

  assert.equal(first.status, 'interrupted');
  assert.equal(first.stop_coordinate, 5);
  assert.equal(first.planned_until_coordinate, 5);
  assert.deepEqual(first.segments.map((segment) => segment.trigger_ids), [
    ['build:foundation', 'build:wall'],
  ]);
  assert.deepEqual(first.remaining_trigger_ids, ['build:roof']);

  // This second call checks the pure planner's contract when given a simulated
  // last-confirmed coordinate and completed-trigger snapshot. Durable persistence,
  // restart, and trigger re-registration are tested on #248's real engine path.
  const second = planDueWork({
    world_id: 'world-a',
    from_coordinate: 5,
    to_coordinate: 10,
    triggers: triggers.map((trigger) => trigger.due_coordinate === 5
      ? { ...trigger, status: 'completed' }
      : trigger),
    completed_trigger_ids: ['build:foundation', 'build:wall'],
  });
  assert.equal(second.status, 'planned');
  assert.deepEqual(second.segments.map((segment) => segment.trigger_ids), [['build:roof']]);
});
