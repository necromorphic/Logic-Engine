import { TemporalModelError } from '../time/model.js';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message, details) => {
  const error = new TemporalModelError(code, message);
  if (details !== undefined) error.details = details;
  throw error;
};
const text = (value, name) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 200) {
    fail('INVALID_PROCESS', name + ' must be a non-empty string of at most 200 characters.');
  }
  return value.trim();
};
const safeInteger = (value, name) => {
  if (!Number.isSafeInteger(value)) fail('INVALID_PROCESS', name + ' must be a safe integer.');
  return value;
};
const strings = (value, name, max = 100) => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) fail('INVALID_PROCESS', name + ' must be an array with at most ' + max + ' entries.');
  const result = value.map((item) => text(item, name + ' entry'));
  if (new Set(result).size !== result.length) fail('INVALID_PROCESS', name + ' cannot contain duplicates.');
  return result;
};

/**
 * Pure proposal validator for a deliberately narrow process definition.
 * This module has no I/O and never writes canonical state.
 */
export function normalizeProcessDefinition(input, worldId, currentCoordinate) {
  if (!object(input)) fail('INVALID_PROCESS', 'Process request must be an object.');
  const allowed = ['process_id', 'idempotency_key', 'expected_revision', 'source_event_ids', 'milestones'];
  if (Object.keys(input).some((key) => !allowed.includes(key))) {
    fail('UNSUPPORTED_PROCESS_FIELD', 'Process request contains an unsupported field.');
  }
  const processId = text(input.process_id, 'process_id');
  const idempotencyKey = text(input.idempotency_key, 'idempotency_key');
  const world = text(worldId, 'world_id');
  const expectedRevision = safeInteger(input.expected_revision, 'expected_revision');
  if (expectedRevision < 0) fail('INVALID_PROCESS', 'expected_revision must be non-negative.');
  safeInteger(currentCoordinate, 'current_coordinate');
  const sourceEventIds = strings(input.source_event_ids, 'source_event_ids');
  if (!Array.isArray(input.milestones) || input.milestones.length < 1 || input.milestones.length > 100) {
    fail('INVALID_PROCESS', 'A process must contain between 1 and 100 milestones.');
  }
  const seen = new Set();
  const milestones = input.milestones.map((raw) => {
    if (!object(raw)) fail('INVALID_PROCESS_MILESTONE', 'Each milestone must be an object.');
    const keys = ['milestone_id', 'due_coordinate', 'dependencies', 'read_set', 'write_set', 'source_event_ids', 'processing_mode', 'interrupt_after_coordinate', 'event'];
    if (Object.keys(raw).some((key) => !keys.includes(key))) fail('UNSUPPORTED_PROCESS_MILESTONE_FIELD', 'A milestone contains an unsupported field.');
    const milestoneId = text(raw.milestone_id, 'milestone_id');
    if (seen.has(milestoneId)) fail('DUPLICATE_PROCESS_MILESTONE', 'Milestone IDs must be unique within a process.');
    seen.add(milestoneId);
    const due = safeInteger(raw.due_coordinate, 'due_coordinate');
    if (due <= currentCoordinate) fail('PROCESS_MILESTONE_NOT_FUTURE', 'A new process milestone must be strictly after the current world coordinate.', { milestone_id: milestoneId, current_coordinate: currentCoordinate, due_coordinate: due });
    if (!object(raw.event)) fail('INVALID_PROCESS_MILESTONE_EVENT', 'Each milestone requires a Core event proposal.');
    return {
      milestone_id: milestoneId,
      due_coordinate: due,
      dependencies: strings(raw.dependencies, 'dependencies'),
      read_set: strings(raw.read_set, 'read_set'),
      write_set: strings(raw.write_set, 'write_set'),
      source_event_ids: [...new Set([
        ...strings(raw.source_event_ids ?? input.source_event_ids, 'source_event_ids'),
        ...strings(raw.event.caused_by, 'event.caused_by'),
        ...strings(raw.event.depends_on, 'event.depends_on'),
      ])],
      processing_mode: raw.processing_mode ?? 'exact',
      interrupt_after_coordinate: raw.interrupt_after_coordinate ?? false,
      event: structuredClone(raw.event),
      status: 'pending',
    };
  });
  const byId = new Map(milestones.map((milestone) => [milestone.milestone_id, milestone]));
  for (const milestone of milestones) {
    for (const dependency of milestone.dependencies) {
      const required = byId.get(dependency);
      if (!required) fail('PROCESS_DEPENDENCY_NOT_FOUND', 'A milestone dependency must reference a milestone in the same process.', { milestone_id: milestone.milestone_id, dependency_id: dependency });
      if (required.milestone_id === milestone.milestone_id) fail('PROCESS_DEPENDENCY_CYCLE', 'A milestone cannot depend on itself.');
      if (required.due_coordinate > milestone.due_coordinate) fail('PROCESS_CAUSAL_TIME_ORDER_CONFLICT', 'A milestone cannot depend on a later milestone.', { milestone_id: milestone.milestone_id, dependency_id: dependency });
    }
  }
  const color = new Map();
  const visit = (id) => {
    if (color.get(id) === 1) fail('PROCESS_DEPENDENCY_CYCLE', 'Process milestone dependencies contain a cycle.');
    if (color.get(id) === 2) return;
    color.set(id, 1);
    for (const dependency of byId.get(id).dependencies) visit(dependency);
    color.set(id, 2);
  };
  for (const milestone of milestones) visit(milestone.milestone_id);
  return {
    world_id: world,
    process_id: processId,
    idempotency_key: idempotencyKey,
    expected_revision: expectedRevision,
    source_event_ids: sourceEventIds,
    status: 'scheduled',
    milestones,
  };
}

/**
 * Proposes one lifecycle transition. Callers must still revalidate this
 * proposal against the current Core snapshot before any canonical mutation.
 */
export function proposeProcessTransition(process, action, context = {}) {
  if (!object(process)) fail('INVALID_PROCESS', 'Process snapshot must be an object.');
  const status = text(process.status, 'process.status');
  const allowedActions = ['start', 'pause', 'resume', 'cancel', 'complete', 'fail', 'needs_review', 'resolve_review'];
  if (!allowedActions.includes(action)) fail('INVALID_PROCESS_TRANSITION', 'Unknown process transition action.');
  const milestones = Array.isArray(process.milestones) ? process.milestones : [];
  const allCompleted = milestones.length > 0 && milestones.every((item) => item.status === 'completed');
  const allPendingFuture = context.all_pending_future === true;
  const inFlight = context.has_in_flight_claim === true;
  const reason = typeof context.reason === 'string' ? context.reason.trim() : '';
  const transitions = {
    start: { from: ['scheduled'], to: 'running' },
    pause: { from: ['scheduled', 'running'], to: 'paused' },
    resume: { from: ['paused'], to: 'scheduled' },
    cancel: { from: ['scheduled', 'running', 'paused', 'failed', 'needs_review'], to: 'cancelled' },
    complete: { from: ['running'], to: 'completed' },
    fail: { from: ['scheduled', 'running', 'paused'], to: 'failed' },
    needs_review: { from: ['scheduled', 'running', 'paused', 'failed'], to: 'needs_review' },
    resolve_review: { from: ['needs_review'], to: 'scheduled' },
  };
  const transition = transitions[action];
  if (!transition.from.includes(status)) {
    fail('INVALID_PROCESS_TRANSITION', 'The process cannot take this transition from its current state.', { status, action });
  }
  if (['pause', 'cancel'].includes(action) && inFlight) {
    fail('PROCESS_MILESTONE_CLAIMED', 'A process with a milestone claimed by an active operation cannot be paused or cancelled.');
  }
  if (action === 'resume' && !allPendingFuture) {
    fail('PROCESS_RESUME_REQUIRES_RESCHEDULE', 'Resume requires every pending milestone to be explicitly scheduled in the future.');
  }
  if (action === 'complete' && !allCompleted) {
    fail('PROCESS_NOT_COMPLETE', 'A process cannot complete until every milestone is committed.');
  }
  if (action === 'fail' && !reason) {
    fail('PROCESS_FAILURE_REASON_REQUIRED', 'A terminal failure requires a non-empty reason.');
  }
  if (action === 'resolve_review' && (!context.revalidated || !allPendingFuture)) {
    fail('PROCESS_REVIEW_REQUIRES_REVALIDATION', 'Resolving review requires explicit revalidation and future scheduling of pending milestones.');
  }
  return {
    ...structuredClone(process),
    status: transition.to,
    transition: { action, from: status, to: transition.to, reason: reason || null },
  };
}
