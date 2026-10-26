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

function denseArrayValues(value, name, max, errorCode) {
  if (!Array.isArray(value) || value.length > max) {
    fail(errorCode, name + ' must be an array with at most ' + max + ' entries.');
  }
  const values = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      fail(errorCode, name + ' cannot contain sparse array entries.', { index });
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      fail(errorCode, name + ' entries must be own enumerable data properties.', { index });
    }
    values.push(descriptor.value);
  }
  const allowedKeys = new Set(['length', ...values.map((_, index) => String(index))]);
  if (Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !allowedKeys.has(key))) {
    fail(errorCode, name + ' cannot contain extra array properties.');
  }
  return values;
}

function stringSet(value, name, max = 1000) {
  if (value === undefined) return [];
  const entries = denseArrayValues(value, name, max, 'INVALID_REFERENCE_LIST');
  const normalized = entries.map((item, index) => nonEmptyString(item, name + '[' + index + ']'));
  if (new Set(normalized).size !== normalized.length) fail('DUPLICATE_REFERENCE', name + ' cannot contain duplicate entries.');
  return normalized.sort();
}

function assertDueWorkRequest(input) {
  const allowed = new Set([
    'world_id', 'from_coordinate', 'to_coordinate', 'triggers', 'completed_trigger_ids',
  ]);
  const invalid = () => fail('INVALID_DUE_WORK_REQUEST', 'Due-work request fields must be own enumerable data properties on a plain object.');
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || !allowed.has(key)) {
      fail('INVALID_DUE_WORK_FIELD', 'Due-work request contains an unsupported field.', {
        field: typeof key === 'string' ? key : String(key),
      });
    }
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
  }
}

function assertTriggerRecord(input) {
  // The durable registry returns lifecycle metadata alongside the immutable
  // trigger definition. These fields are accepted only as known registry
  // metadata; the pure planner does not use them to determine scheduling.
  const allowed = new Set([
    'trigger_id', 'world_id', 'due_coordinate', 'status', 'dependencies',
    'read_set', 'write_set', 'processing_mode', 'interrupt_after_coordinate', 'payload',
    'content_hash', 'claimed_by_operation_id', 'completed_operation_id',
    'cancellation_reason', 'created_revision', 'created_at', 'updated_at',
  ]);
  const invalid = () => fail('INVALID_TRIGGER', 'Trigger fields must be own enumerable data properties on a plain object.');
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || !allowed.has(key)) {
      fail('INVALID_TRIGGER_FIELD', 'Trigger contains an unsupported field.', {
        field: typeof key === 'string' ? key : String(key),
      });
    }
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
  }
}

function cloneJson(value, name) {
  const ancestors = new Set();
  const invalid = () => fail('INVALID_TRIGGER_PAYLOAD', name + ' must contain only finite JSON values without accessors, cycles, or custom prototypes.');

  const clone = (item) => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) invalid();
      return Object.is(item, -0) ? 0 : item;
    }
    if (typeof item !== 'object') invalid();
    if (ancestors.has(item)) invalid();

    const prototype = Object.getPrototypeOf(item);
    if (Array.isArray(item)) {
      if (prototype !== Array.prototype) invalid();
      ancestors.add(item);
      const keys = Reflect.ownKeys(item);
      if (keys.some((key) => {
        if (key === 'length') return false;
        if (typeof key !== 'string') return true;
        const index = Number(key);
        return !Number.isSafeInteger(index) || index < 0 || String(index) !== key;
      })) invalid();
      const result = [];
      for (let index = 0; index < item.length; index += 1) {
        if (!Object.hasOwn(item, index)) invalid();
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
        result.push(clone(descriptor.value));
      }
      if (keys.length !== item.length + 1) invalid();
      ancestors.delete(item);
      return result;
    }

    if (prototype !== Object.prototype && prototype !== null) invalid();
    ancestors.add(item);
    const keys = Reflect.ownKeys(item);
    const result = {};
    for (const key of keys) {
      if (typeof key !== 'string') invalid();
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
      Object.defineProperty(result, key, {
        value: clone(descriptor.value), enumerable: true, configurable: true, writable: true,
      });
    }
    ancestors.delete(item);
    return result;
  };

  return clone(value);
}

function validateReferenceKinds(values, name, allowMechanic) {
  const supported = allowMechanic
    ? ['entity:', 'fact:', 'relationship:', 'mechanic:']
    : ['entity:', 'fact:', 'relationship:'];
  for (const value of values) {
    if (!supported.some((prefix) => value.startsWith(prefix) && value.length > prefix.length)) {
      fail('INVALID_TRIGGER_REFERENCE', name + ' contains an unsupported projection reference: ' + value);
    }
  }
  return values;
}

function intersects(left, right) {
  for (const value of left) if (right.has(value)) return value;
  return null;
}

function compareTriggers(a, b) {
  return a.due_coordinate < b.due_coordinate ? -1
    : a.due_coordinate > b.due_coordinate ? 1
      : a.trigger_id < b.trigger_id ? -1 : a.trigger_id > b.trigger_id ? 1 : 0;
}

function heapPush(heap, value) {
  let index = heap.length;
  heap.push(value);
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (compareTriggers(heap[parent], value) <= 0) break;
    heap[index] = heap[parent];
    index = parent;
  }
  heap[index] = value;
}

function heapPop(heap) {
  const root = heap[0];
  const last = heap.pop();
  if (heap.length && last !== undefined) {
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= heap.length) break;
      let child = left;
      if (right < heap.length && compareTriggers(heap[right], heap[left]) < 0) child = right;
      if (compareTriggers(last, heap[child]) <= 0) break;
      heap[index] = heap[child];
      index = child;
    }
    heap[index] = last;
  }
  return root;
}

export function optionalTriggerValue(input, field, defaultValue) {
  if (!Object.hasOwn(input, field)) return defaultValue;
  const value = input[field];
  if (value === undefined) {
    fail('INVALID_TRIGGER_FIELD_VALUE', field + ' must not be explicitly undefined.');
  }
  return value;
}

function normalizeTimeTrigger(input, worldId) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_TRIGGER', 'Every trigger must be an object.');
  assertTriggerRecord(input);
  const trigger = {
    trigger_id: nonEmptyString(input.trigger_id, 'trigger_id'),
    world_id: nonEmptyString(input.world_id, 'world_id'),
    due_coordinate: safeInteger(input.due_coordinate, 'due_coordinate'),
    status: optionalTriggerValue(input, 'status', 'pending'),
    dependencies: stringSet(optionalTriggerValue(input, 'dependencies', []), 'dependencies'),
    read_set: validateReferenceKinds(stringSet(optionalTriggerValue(input, 'read_set', []), 'read_set'), 'read_set', false),
    write_set: validateReferenceKinds(stringSet(optionalTriggerValue(input, 'write_set', []), 'write_set'), 'write_set', true),
    processing_mode: optionalTriggerValue(input, 'processing_mode', 'exact'),
    interrupt_after_coordinate: optionalTriggerValue(input, 'interrupt_after_coordinate', false),
    payload: cloneJson(optionalTriggerValue(input, 'payload', null), 'payload'),
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
      const dependency = allById.get(dependencyId);
      // A recorded completion is only a valid prerequisite if its scheduled
      // coordinate does not lie after the dependent trigger's coordinate.
      // Check this before the historical completed-ID shortcut as well.
      if (dependency?.status === 'completed' && dependency.due_coordinate > trigger.due_coordinate) {
        fail('CAUSAL_TIME_ORDER_CONFLICT', 'A completed prerequisite cannot be scheduled later in game time than its dependent trigger.', {
          trigger_id: trigger.trigger_id, dependency_id: dependencyId,
        });
      }
      if (completedIds.has(dependencyId)) continue;
      if (!dependency) {
        blocked.push({ trigger_id: trigger.trigger_id, dependency_id: dependencyId, reason: 'missing_dependency' });
        continue;
      }
      if (dependency.status === 'completed') continue;
      if (dependency.status === 'cancelled') {
        blocked.push({ trigger_id: trigger.trigger_id, dependency_id: dependencyId, reason: 'dependency_cancelled' });
        continue;
      }
      if (dependency.due_coordinate > trigger.due_coordinate) {
        fail('CAUSAL_TIME_ORDER_CONFLICT', 'A trigger cannot depend on work scheduled later in game time.', {
          trigger_id: trigger.trigger_id, dependency_id: dependencyId,
        });
      }
      if (!dueIds.has(dependencyId)) {
        blocked.push({ trigger_id: trigger.trigger_id, dependency_id: dependencyId, reason: 'dependency_not_due_in_interval' });
        continue;
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
  const ready = [];
  for (const trigger of due) if (degree.get(trigger.trigger_id) === 0) heapPush(ready, trigger);
  const ordered = [];

  while (ready.length) {
    const next = heapPop(ready);
    ordered.push(next);
    for (const childId of dependents.get(next.trigger_id) || []) {
      degree.set(childId, degree.get(childId) - 1);
      if (degree.get(childId) === 0) heapPush(ready, allById.get(childId));
    }
  }
  if (ordered.length !== due.length) fail('TRIGGER_DEPENDENCY_CYCLE', 'Due trigger dependencies contain a cycle.');
  return { blocked: [], ordered, dependencies };
}

function segmentAtCoordinate(triggers, dependencies) {
  const segments = [];
  let current = [];
  let currentIds = new Set();
  let currentReads = new Set();
  let currentWrites = new Set();
  const priorWriters = new Map();
  const priorReaders = new Map();

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
    }
    current = [];
    currentIds = new Set();
    currentReads = new Set();
    currentWrites = new Set();
  };

  const directlyOrdered = (leftId, rightId) => (dependencies.get(leftId) || []).includes(rightId)
    || (dependencies.get(rightId) || []).includes(leftId);
  const assertNoUnorderedConflict = (trigger, reference, existingId) => {
    if (!directlyOrdered(trigger.trigger_id, existingId)) {
      fail('TRIGGER_CONFLICT_NEEDS_REVIEW', 'Same-coordinate triggers conflict without an explicit direct dependency order.', {
        trigger_ids: [existingId, trigger.trigger_id], reference,
      });
    }
  };

  for (const trigger of triggers) {
    for (const ref of trigger.write_set) {
      for (const existingId of priorWriters.get(ref) || []) assertNoUnorderedConflict(trigger, ref, existingId);
      for (const existingId of priorReaders.get(ref) || []) assertNoUnorderedConflict(trigger, ref, existingId);
    }
    for (const ref of trigger.read_set) {
      for (const existingId of priorWriters.get(ref) || []) assertNoUnorderedConflict(trigger, ref, existingId);
    }

    const dependsOnCurrent = (dependencies.get(trigger.trigger_id) || []).some((dependencyId) => currentIds.has(dependencyId));
    if (dependsOnCurrent) close();

    const conflict = intersects(trigger.write_set, currentWrites)
      || intersects(trigger.write_set, currentReads)
      || intersects(trigger.read_set, currentWrites);
    if (conflict) {
      fail('TRIGGER_CONFLICT_NEEDS_REVIEW', 'Triggers at the same coordinate conflict without a declared dependency boundary.', {
        trigger_ids: [...current.map((item) => item.trigger_id), trigger.trigger_id],
        reference: conflict,
      });
    }

    current.push(trigger);
    currentIds.add(trigger.trigger_id);
    for (const ref of trigger.read_set) {
      currentReads.add(ref);
      const readers = priorReaders.get(ref) || [];
      readers.push(trigger.trigger_id);
      priorReaders.set(ref, readers);
    }
    for (const ref of trigger.write_set) {
      currentWrites.add(ref);
      const writers = priorWriters.get(ref) || [];
      writers.push(trigger.trigger_id);
      priorWriters.set(ref, writers);
    }
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
  assertDueWorkRequest(input);
  const worldId = nonEmptyString(input.world_id, 'world_id');
  const from = safeInteger(input.from_coordinate, 'from_coordinate');
  const to = safeInteger(input.to_coordinate, 'to_coordinate');
  if (to < from) fail('REVERSED_INTERVAL', 'Due-work interval end must not precede its start.');
  const triggerEntries = denseArrayValues(input.triggers, 'triggers', 10000, 'INVALID_TRIGGER_LIST');
  const completedIds = new Set(stringSet(input.completed_trigger_ids, 'completed_trigger_ids', 10000));
  const triggers = triggerEntries.map((trigger) => normalizeTimeTrigger(trigger, worldId));
  const allById = new Map();
  for (const trigger of triggers) {
    if (allById.has(trigger.trigger_id)) fail('DUPLICATE_TRIGGER_ID', 'Trigger IDs must be unique.');
    allById.set(trigger.trigger_id, trigger);
    if (completedIds.has(trigger.trigger_id) && trigger.status !== 'completed') {
      fail('CONFLICTING_TRIGGER_STATUS', 'A trigger cannot be listed as completed and also have a non-completed status.', { trigger_id: trigger.trigger_id, status: trigger.status });
    }
  }

  const allDue = triggers.filter((trigger) => trigger.status === 'pending'
    && trigger.due_coordinate > from && trigger.due_coordinate <= to);
  const interruptCoordinates = allDue.filter((trigger) => trigger.interrupt_after_coordinate).map((trigger) => trigger.due_coordinate);
  const firstInterruptCoordinate = interruptCoordinates.length ? Math.min(...interruptCoordinates) : null;
  const due = firstInterruptCoordinate === null
    ? allDue
    : allDue.filter((trigger) => trigger.due_coordinate <= firstInterruptCoordinate);
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
  const remainingTriggerIds = allDue
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
