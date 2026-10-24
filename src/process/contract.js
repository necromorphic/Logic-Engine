/**
 * Pure Process Manager contract primitives.
 *
 * This module validates process identity, milestone dependencies, and lifecycle
 * transitions. It deliberately has no storage, scheduling, canonical-write,
 * NPC-knowledge, or delivery side effects. Runtime persistence must compose
 * these primitives with Core's existing segment transaction.
 */

const STATES = new Set([
  'scheduled', 'running', 'paused', 'completed', 'cancelled', 'failed', 'needs_review',
]);

const TERMINAL = new Set(['completed', 'cancelled', 'failed']);
const ALLOWED_TRANSITIONS = Object.freeze({
  scheduled: new Set(['running', 'paused', 'cancelled', 'failed', 'needs_review']),
  running: new Set(['paused', 'completed', 'cancelled', 'failed', 'needs_review']),
  paused: new Set(['scheduled', 'running', 'cancelled', 'failed', 'needs_review']),
  needs_review: new Set(['scheduled', 'running', 'paused', 'cancelled', 'failed']),
  completed: new Set(),
  cancelled: new Set(),
  failed: new Set(),
});

export class ProcessContractError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ProcessContractError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details) {
  throw new ProcessContractError(code, message, details);
}

function identifier(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 200) {
    fail('INVALID_PROCESS_IDENTIFIER', name + ' must be a non-empty string of at most 200 characters.');
  }
  return value.trim();
}

function safeCoordinate(value, name) {
  if (!Number.isSafeInteger(value)) fail('INVALID_PROCESS_COORDINATE', name + ' must be a safe integer.');
  return value;
}

function uniqueStringList(value, name, max = 500) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) fail('INVALID_PROCESS_REFERENCE_LIST', name + ' must be an array with at most ' + max + ' entries.');
  const result = value.map((item, index) => identifier(item, name + '[' + index + ']'));
  if (new Set(result).size !== result.length) fail('DUPLICATE_PROCESS_REFERENCE', name + ' cannot contain duplicate entries.');
  return result.sort();
}

function jsonValue(value, name) {
  let encoded;
  try { encoded = JSON.stringify(value); } catch {}
  if (encoded === undefined) fail('INVALID_PROCESS_DEFINITION', name + ' must be JSON-serializable.');
  try { return JSON.parse(encoded); } catch { fail('INVALID_PROCESS_DEFINITION', name + ' must be JSON-serializable.'); }
}

function checkAcyclic(milestones) {
  const byId = new Map(milestones.map((item) => [item.milestone_id, item]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (id, path = []) => {
    if (visiting.has(id)) {
      fail('PROCESS_MILESTONE_CYCLE', 'Milestone prerequisites contain a cycle.', { cycle: [...path, id] });
    }
    if (visited.has(id)) return;
    const milestone = byId.get(id);
    if (!milestone) return;
    visiting.add(id);
    for (const dependencyId of milestone.prerequisites) visit(dependencyId, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const item of milestones) visit(item.milestone_id);
}

/**
 * Normalize a world-scoped process definition. Milestone IDs and trigger IDs
 * are distinct: a trigger is a scheduling record, not the process itself.
 */
export function normalizeProcessDefinition(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('INVALID_PROCESS_DEFINITION', 'Process definition must be an object.');
  }
  const allowed = new Set([
    'process_id', 'world_id', 'definition_version', 'title', 'metadata', 'milestones',
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    fail('UNSUPPORTED_PROCESS_DEFINITION_FIELD', 'Process definition contains an unsupported field.');
  }

  const process = {
    process_id: identifier(input.process_id, 'process_id'),
    world_id: identifier(input.world_id, 'world_id'),
    definition_version: identifier(input.definition_version, 'definition_version'),
    title: input.title === undefined ? null : identifier(input.title, 'title'),
    metadata: jsonValue(input.metadata ?? {}, 'metadata'),
    milestones: [],
  };
  if (!Array.isArray(input.milestones) || input.milestones.length < 1 || input.milestones.length > 500) {
    fail('INVALID_PROCESS_MILESTONES', 'milestones must contain between 1 and 500 entries.');
  }

  const milestoneIds = new Set();
  const triggerIds = new Set();
  process.milestones = input.milestones.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      fail('INVALID_PROCESS_MILESTONE', 'Each milestone must be an object.', { index });
    }
    const milestoneAllowed = new Set([
      'milestone_id', 'trigger_id', 'due_coordinate', 'prerequisites',
      'read_set', 'write_set', 'event', 'interrupt_after_coordinate',
    ]);
    if (Object.keys(raw).some((key) => !milestoneAllowed.has(key))) {
      fail('UNSUPPORTED_PROCESS_MILESTONE_FIELD', 'Milestone contains an unsupported field.', { index });
    }
    const item = {
      milestone_id: identifier(raw.milestone_id, 'milestone_id'),
      trigger_id: identifier(raw.trigger_id, 'trigger_id'),
      due_coordinate: safeCoordinate(raw.due_coordinate, 'due_coordinate'),
      prerequisites: uniqueStringList(raw.prerequisites, 'prerequisites'),
      read_set: uniqueStringList(raw.read_set, 'read_set'),
      write_set: uniqueStringList(raw.write_set, 'write_set'),
      event: jsonValue(raw.event, 'event'),
      interrupt_after_coordinate: raw.interrupt_after_coordinate ?? false,
    };
    if (milestoneIds.has(item.milestone_id)) fail('DUPLICATE_PROCESS_MILESTONE_ID', 'Milestone IDs must be unique.', { milestone_id: item.milestone_id });
    if (triggerIds.has(item.trigger_id)) fail('DUPLICATE_PROCESS_TRIGGER_ID', 'A trigger can schedule at most one process milestone.', { trigger_id: item.trigger_id });
    if (typeof item.interrupt_after_coordinate !== 'boolean') fail('INVALID_PROCESS_INTERRUPT_POLICY', 'interrupt_after_coordinate must be boolean.');
    if (!item.event || typeof item.event !== 'object' || Array.isArray(item.event)) {
      fail('INVALID_PROCESS_MILESTONE_EVENT', 'Each milestone must contain a JSON object event proposal.', { milestone_id: item.milestone_id });
    }
    milestoneIds.add(item.milestone_id);
    triggerIds.add(item.trigger_id);
    return item;
  });

  for (const milestone of process.milestones) {
    if (milestone.prerequisites.includes(milestone.milestone_id)) {
      fail('PROCESS_MILESTONE_CYCLE', 'A milestone cannot depend on itself.', { milestone_id: milestone.milestone_id });
    }
    const missing = milestone.prerequisites.filter((id) => !milestoneIds.has(id));
    if (missing.length) {
      fail('PROCESS_MILESTONE_PREREQUISITE_MISSING', 'Every prerequisite must reference a milestone in the same process.', {
        milestone_id: milestone.milestone_id, missing_milestone_ids: missing,
      });
    }
  }
  checkAcyclic(process.milestones);
  process.milestones.sort((a, b) => a.due_coordinate - b.due_coordinate || a.milestone_id.localeCompare(b.milestone_id));
  return process;
}

export function validateProcessTransition(currentState, requestedState) {
  if (!STATES.has(currentState)) fail('INVALID_PROCESS_STATE', 'Current process state is unknown.', { current_state: currentState });
  if (!STATES.has(requestedState)) fail('INVALID_PROCESS_STATE', 'Requested process state is unknown.', { requested_state: requestedState });
  if (currentState === requestedState) return { from: currentState, to: requestedState, idempotent: true };
  if (!ALLOWED_TRANSITIONS[currentState].has(requestedState)) {
    fail('INVALID_PROCESS_TRANSITION', 'Process lifecycle transition is not allowed.', { from: currentState, to: requestedState });
  }
  return { from: currentState, to: requestedState, idempotent: false };
}

/**
 * Calculate a progress projection from durable milestone statuses. This is a
 * pure helper: the caller must read process + trigger statuses from one
 * consistent storage snapshot and must not infer causation from timestamps.
 */
export function deriveProcessProgress(process, milestoneStatuses) {
  if (!process || typeof process !== 'object' || !Array.isArray(process.milestones)) {
    fail('INVALID_PROCESS_DEFINITION', 'A normalized process definition is required.');
  }
  if (!milestoneStatuses || typeof milestoneStatuses !== 'object' || Array.isArray(milestoneStatuses)) {
    fail('INVALID_PROCESS_PROGRESS', 'milestoneStatuses must be an object keyed by milestone ID.');
  }
  const known = new Set(process.milestones.map((milestone) => milestone.milestone_id));
  if (Object.keys(milestoneStatuses).some((id) => !known.has(id))) {
    fail('UNKNOWN_PROCESS_MILESTONE_STATUS', 'Progress contains a milestone not declared by this process.');
  }
  const completed = [];
  const pending = [];
  const cancelled = [];
  const blocked = [];
  for (const milestone of process.milestones) {
    const status = milestoneStatuses[milestone.milestone_id] ?? 'pending';
    if (!['pending', 'completed', 'cancelled', 'blocked', 'needs_review'].includes(status)) {
      fail('INVALID_PROCESS_MILESTONE_STATUS', 'Milestone status is unknown.', { milestone_id: milestone.milestone_id, status });
    }
    if (status === 'completed') completed.push(milestone.milestone_id);
    else if (status === 'cancelled') cancelled.push(milestone.milestone_id);
    else if (status === 'blocked') blocked.push(milestone.milestone_id);
    else if (status === 'needs_review') blocked.push(milestone.milestone_id);
    else pending.push(milestone.milestone_id);
  }
  const prerequisitesSatisfied = (milestone) => milestone.prerequisites.every((id) => completed.includes(id));
  const ready = process.milestones
    .filter((milestone) => pending.includes(milestone.milestone_id) && prerequisitesSatisfied(milestone))
    .map((milestone) => milestone.milestone_id);
  return {
    total: process.milestones.length,
    completed: completed.length,
    pending: pending.length,
    cancelled: cancelled.length,
    blocked: blocked.length,
    completed_milestone_ids: completed,
    pending_milestone_ids: pending,
    cancelled_milestone_ids: cancelled,
    blocked_milestone_ids: blocked,
    ready_milestone_ids: ready,
    all_completed: completed.length === process.milestones.length,
  };
}

export function deriveProcessState(baseState, progress) {
  if (!STATES.has(baseState)) fail('INVALID_PROCESS_STATE', 'Base process state is unknown.', { state: baseState });
  if (!progress || typeof progress !== 'object') fail('INVALID_PROCESS_PROGRESS', 'Progress projection is required.');
  if (TERMINAL.has(baseState) || baseState === 'paused' || baseState === 'needs_review') return baseState;
  if (progress.blocked > 0) return 'needs_review';
  if (progress.all_completed) return 'completed';
  if (progress.completed > 0) return 'running';
  return 'scheduled';
}

export const PROCESS_STATES = Object.freeze([...STATES]);
