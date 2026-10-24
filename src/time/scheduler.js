/**
 * Pure due-work planner for Logic-Engine T4.
 *
 * This module plans work over canonical coordinates only. It does not read or
 * write storage, advance time, execute effects, or grant NPC knowledge.
 */

import { TemporalModelError } from './model.js';

function fail(code, message, details = undefined) {
  const error = new TemporalModelError(code, message);
  if (details !== undefined) error.details = details;
  throw error;
}

function safeInteger(value, name) {
  if (!Number.isSafeInteger(value)) fail('INVALID_INTEGER', name + ' must be a safe integer.');
  return value;
}

function nonEmptyString(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 200) {
    fail('INVALID_STRING', name + ' must be a non-empty string of at most 200 characters.');
  }
  return value.trim();
}

function stringSet(value, name, max = 1000) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) fail('INVALID_REFERENCE_LIST', name + ' must be an array with at most ' + max + ' entries.');
  const normalized = value.map((item, index) => nonEmptyString(item, name + '[' + index + ']'));
  if (new Set(normalized).size !== normalized.length) fail('DUPLICATE_REFERENCE', name + ' cannot contain duplicate entries.');
  return normalized.sort();
}

function intersects(left, right) {
  for (const value of left) if (right.has(value)) return value;
  return null;
}

function pathExists(from, to, dependencies) {
  const pending = [...(dependencies.get(from) || [])];
  const visited = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (current === to) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(dependencies.get(current) || []));
  }
  return false;
}

function normalizeTrigger(input, worldId) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_TRIGGER', 'Every trigger must be an object.');
  const trigger = {
    trigger_id: nonEmptyString(input.trigger_id, 'trigger_id'),
    world_id: nonEmptyString(input.world_id, 'world_id'),
    due_coordinate: safeInteger(input.due_coordinate, 'due_coordinate'),
    status: input.status ?? 'pending',
    dependencies: stringSet(input.dependencies, 'dependencies'),
    read_set: stringSet(input.read_set, 'read_set'),
    write_set: stringSet(input.write_set, 'write_set'),
    processing_mode: input.processing_mode ?? 'exact',
    interrupt_after_coordinate: input.interrupt_after_coordinate ?? false,
    payload: input.payload ?? null,
  };
  if (trigger.world_id !== worldId) fail('CROSS_WORLD_TRIGGER', 'A due-work plan cannot mix triggers from different worlds.', { trigger_id: trigger.trigger_id });
  if (!['pending', 'completed', 'cancelled'].includes(trigger.status)) fail('INVALID_TRIGGER_STATUS', 'Trigger status must be pending, completed, or cancelled.');
  if (!['exact', 'batch'].includes(trigger.processing_mode)) fail('INVALID_PROCESSING_MODE', 'processing_mode must be exact or batch.');
  if (typeof trigger.interrupt_after_coordinate !== 'boolean') fail('INVALID_INTERRUPT_POLICY', 'interrupt_after_coordinate must be boolean.');
  return trigger;
}

function buildDependencyOrder(due, allById, completedIds) {
  const dueIds = new Set(due.map((trigger) => trigger.trigger_id));
  const dependencies = new Map();
  const dependents = new Map();
  const blocked = [];

  for (const trigger of due) {
    const required = [];
    for (const dependencyId of trigger.dependencies) {
      if (completedIds.has(dependencyId)) continue;
      const dependency = allById.get(dependencyId);
      if (!dependency) {
        blocked.push({ trigger_id: trigger.trigger_id, dependency_id: dependencyId, reason: 'missing_dependency' });
        continue;
      }
      if (dependency.status === 'completed') continue;
      if (dependency.status === 'cancelled') {
        blocked.push({ trigger_id: trigger.trigger_id, dependency_id: dependencyId, reason: 'dependency_cancelled' });
        continue;
      }
      if (!dueIds.has(dependencyId)) {
        blocked.push({ trigger_id: trigger.trigger_id, dependency_id: dependencyId, reason: 'dependency_not_due_in_interval' });
        continue;
      }
      if (dependency.due_coordinate > trigger.due_coordinate) {
        fail('CAUSAL_TIME_ORDER_CONFLICT', 'A trigger cannot depend on work scheduled later in game time.', {
          trigger_id: trigger.trigger_id, dependency_id: dependencyId,
        });
      }
      required.push(dependencyId);
      const children = dependents.get(dependencyId) || [];
      children.push(trigger.trigger_id);
      dependents.set(dependencyId, children);
    }
    dependencies.set(trigger.trigger_id, required);
  }
  if (blocked.length) return { blocked, ordered: [], dependencies };

  const degree = new Map([...dependencies].map(([id, refs]) => [id, refs.length]));
  const ready = due.filter((trigger) => degree.get(trigger.trigger_id) === 0);
  const ordered = [];
  const compare = (a, b) => a.due_coordinate < b.due_coordinate ? -1
    : a.due_coordinate > b.due_coordinate ? 1
      : a.trigger_id < b.trigger_id ? -1 : a.trigger_id > b.trigger_id ? 1 : 0;
  ready.sort(compare);

  while (ready.length) {
    const next = ready.shift();
    ordered.push(next);
    for (const childId of dependents.get(next.trigger_id) || []) {
      degree.set(childId, degree.get(childId) - 1);
      if (degree.get(childId) === 0) {
        ready.push(allById.get(childId));
        ready.sort(compare);
      }
    }
  }
  if (ordered.length !== due.length) fail('TRIGGER_DEPENDENCY_CYCLE', 'Due trigger dependencies contain a cycle.');
  return { blocked: [], ordered, dependencies };
}

function segmentAtCoordinate(triggers, dependencies) {
  const segments = [];
  let current = [];

  const close = () => {
    if (current.length) {
      segments.push({
        due_coordinate: current[0].due_coordinate,
        trigger_ids: current.map((trigger) => trigger.trigger_id),
        triggers: current.map((trigger) => ({
          trigger_id: trigger.trigger_id,
          processing_mode: trigger.processing_mode,
          payload: trigger.payload,
          interrupt_after_coordinate: trigger.interrupt_after_coordinate,
        })),
      });
      current = [];
    }
  };

  for (const trigger of triggers) {
    let mustSplit = false;
    for (const existing of current) {
      if (dependencies.get(trigger.trigger_id)?.includes(existing.trigger_id)
        || dependencies.get(existing.trigger_id)?.includes(trigger.trigger_id)) {
        mustSplit = true;
        break;
      }
      const access = intersects(new Set(trigger.write_set), new Set(existing.write_set))
        || intersects(new Set(trigger.write_set), new Set(existing.read_set))
        || intersects(new Set(existing.write_set), new Set(trigger.read_set));
      if (access) {
        const orderedByDependency = pathExists(trigger.trigger_id, existing.trigger_id, dependencies)
          || pathExists(existing.trigger_id, trigger.trigger_id, dependencies);
        if (!orderedByDependency) {
          fail('TRIGGER_CONFLICT_NEEDS_REVIEW', 'Triggers at the same coordinate conflict without an explicit dependency order.', {
            trigger_ids: [existing.trigger_id, trigger.trigger_id], reference: access,
          });
        }
        mustSplit = true;
        break;
      }
    }
    if (mustSplit) close();
    current.push(trigger);
  }
  close();
  return segments;
}

/**
 * Plan due triggers on (from_coordinate, to_coordinate]. This is planning only:
 * returned segments are proposals and must be committed through Core.
 */
export function planDueWork(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_DUE_WORK_REQUEST', 'Due-work request must be an object.');
  const worldId = nonEmptyString(input.world_id, 'world_id');
  const from = safeInteger(input.from_coordinate, 'from_coordinate');
  const to = safeInteger(input.to_coordinate, 'to_coordinate');
  if (to < from) fail('REVERSED_INTERVAL', 'Due-work interval end must not precede its start.');
  if (!Array.isArray(input.triggers) || input.triggers.length > 10000) fail('INVALID_TRIGGER_LIST', 'triggers must be an array of at most 10000 entries.');
  const completedIds = new Set(stringSet(input.completed_trigger_ids, 'completed_trigger_ids', 10000));
  const triggers = input.triggers.map((trigger) => normalizeTrigger(trigger, worldId));
  const allById = new Map();
  for (const trigger of triggers) {
    if (allById.has(trigger.trigger_id)) fail('DUPLICATE_TRIGGER_ID', 'Trigger IDs must be unique.');
    allById.set(trigger.trigger_id, trigger);
  }

  const due = triggers.filter((trigger) => trigger.status === 'pending'
    && trigger.due_coordinate > from && trigger.due_coordinate <= to);
  const dependencyPlan = buildDependencyOrder(due, allById, completedIds);
  if (dependencyPlan.blocked.length) {
    return {
      status: 'blocked',
      world_id: worldId,
      from_coordinate: from,
      to_coordinate: to,
      segments: [],
      blocked: dependencyPlan.blocked,
      planned_until_coordinate: from,
      stop_coordinate: null,
    };
  }

  const byCoordinate = new Map();
  for (const trigger of dependencyPlan.ordered) {
    const items = byCoordinate.get(trigger.due_coordinate) || [];
    items.push(trigger);
    byCoordinate.set(trigger.due_coordinate, items);
  }

  const segments = [];
  const coordinates = [...byCoordinate.keys()].sort((a, b) => a - b);
  let stopCoordinate = null;
  for (const coordinate of coordinates) {
    const atCoordinate = byCoordinate.get(coordinate);
    segments.push(...segmentAtCoordinate(atCoordinate, dependencyPlan.dependencies));
    if (atCoordinate.some((trigger) => trigger.interrupt_after_coordinate)) {
      stopCoordinate = coordinate;
      break;
    }
  }

  const plannedUntil = stopCoordinate ?? to;
  const plannedIds = new Set(segments.flatMap((segment) => segment.trigger_ids));
  const remainingTriggerIds = due
    .filter((trigger) => !plannedIds.has(trigger.trigger_id))
    .map((trigger) => trigger.trigger_id)
    .sort();

  return {
    status: stopCoordinate === null ? 'planned' : 'interrupted',
    world_id: worldId,
    from_coordinate: from,
    to_coordinate: to,
    segments,
    blocked: [],
    planned_until_coordinate: plannedUntil,
    stop_coordinate: stopCoordinate,
    remaining_trigger_ids: remainingTriggerIds,
  };
}
