/**
 * NPC-owned, pure plan-progress reducer.
 *
 * It applies an explicit caller-reported step outcome to a supplied plan
 * value. It does not execute actions, authenticate outcomes, persist state,
 * schedule future work, or mutate the world.
 */

const PLAN_STATUSES = ["active", "blocked", "completed", "abandoned"];
const STEP_STATUSES = ["pending", "active", "blocked", "completed"];
const TERMINAL_PLANS = new Set(["completed", "abandoned"]);

const INTRINSIC_OBJECT_PROTOTYPE_KEYS = new Set([
  "constructor", "__defineGetter__", "__defineSetter__", "hasOwnProperty",
  "__lookupGetter__", "__lookupSetter__", "isPrototypeOf", "propertyIsEnumerable",
  "toString", "valueOf", "__proto__", "toLocaleString",
]);
const INTRINSIC_ARRAY_ITERATOR = Array.prototype[Symbol.iterator];

function hasSafeObjectPrototype() {
  try {
    const keys = Reflect.ownKeys(Object.prototype);
    for (const key of keys) {
      if (typeof key !== "string" || !INTRINSIC_OBJECT_PROTOTYPE_KEYS.has(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, key);
      if (!descriptor) return false;
      if (key === "__proto__") {
        if (!Object.hasOwn(descriptor, "get") || !Object.hasOwn(descriptor, "set")) return false;
      } else if (!Object.hasOwn(descriptor, "value")) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function hasSafeArrayIterator() {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
    return descriptor != null
      && Object.hasOwn(descriptor, "value")
      && descriptor.value === INTRINSIC_ARRAY_ITERATOR;
  } catch {
    return false;
  }
}

function isPlainDataObject(value) {
  if (!hasSafeObjectPrototype()) return false;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === "string" && descriptor != null && Object.hasOwn(descriptor, "value");
  });
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function denseArray(value) {
  if (!hasSafeArrayIterator() || !Array.isArray(value)) return false;
  for (let i = 0; i < value.length; i += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (descriptor == null || !Object.hasOwn(descriptor, "value")) return false;
  }
  return true;
}

function nonReady() {
  return Object.freeze({ status: "non_ready", plan: null });
}

function validatePlan(plan) {
  if (
    !isPlainDataObject(plan)
    || !nonEmptyString(plan.id)
    || !PLAN_STATUSES.includes(plan.status)
    || !denseArray(plan.steps)
    || plan.steps.length === 0
  ) return false;

  const ids = new Set();
  let activeCount = 0;
  let blockedCount = 0;
  let pendingCount = 0;
  let completedCount = 0;

  for (const step of plan.steps) {
    if (
      !isPlainDataObject(step)
      || !nonEmptyString(step.id)
      || !nonEmptyString(step.action_id)
      || !STEP_STATUSES.includes(step.status)
      || ids.has(step.id)
    ) return false;
    ids.add(step.id);
    if (step.status === "active") activeCount += 1;
    if (step.status === "blocked") blockedCount += 1;
    if (step.status === "pending") pendingCount += 1;
    if (step.status === "completed") completedCount += 1;
  }

  if (plan.status === "active") {
    if (activeCount !== 1 || blockedCount !== 0) return false;
    let sawActive = false;
    for (const step of plan.steps) {
      if (step.status === "active") sawActive = true;
      else if (sawActive && step.status !== "pending") return false;
      else if (!sawActive && step.status !== "completed") return false;
    }
  } else if (plan.status === "blocked" || plan.status === "abandoned") {
    const hasBlockedStep = blockedCount === 1 && activeCount === 0;
    const hasActiveStep = activeCount === 1 && blockedCount === 0;
    if (plan.status === "blocked" && !hasBlockedStep) return false;
    if (plan.status === "abandoned" && !hasBlockedStep && !hasActiveStep) return false;

    const currentStatus = hasBlockedStep ? "blocked" : "active";
    let sawCurrent = false;
    for (const step of plan.steps) {
      if (step.status === currentStatus) {
        sawCurrent = true;
      } else if (sawCurrent && step.status !== "pending") {
        return false;
      } else if (!sawCurrent && step.status !== "completed") {
        return false;
      }
    }
  } else if (plan.status === "completed") {
    if (completedCount !== plan.steps.length) return false;
  }
  return true;
}

/**
 * Events:
 * - { type: "step_succeeded", step_id }
 * - { type: "step_blocked", step_id }
 * - { type: "step_unblocked", step_id }
 * - { type: "abandon" }
 */
function advanceNpcPlanUnsafe(plan, event) {
  if (!validatePlan(plan) || !isPlainDataObject(event) || !nonEmptyString(event.type)) {
    return nonReady();
  }
  if (TERMINAL_PLANS.has(plan.status)) return nonReady();

  const steps = plan.steps.map((step) => ({ ...step }));
  let status = plan.status;

  if (event.type === "abandon") {
    status = "abandoned";
  } else if (event.type === "step_succeeded" || event.type === "step_blocked") {
    if (!nonEmptyString(event.step_id) || status !== "active") return nonReady();
    const index = steps.findIndex((step) => step.id === event.step_id);
    if (index < 0 || steps[index].status !== "active") return nonReady();

    if (event.type === "step_blocked") {
      steps[index].status = "blocked";
      status = "blocked";
    } else {
      steps[index].status = "completed";
      const next = steps.find((step) => step.status === "pending");
      if (next) next.status = "active";
      else status = "completed";
    }
  } else if (event.type === "step_unblocked") {
    if (!nonEmptyString(event.step_id) || status !== "blocked") return nonReady();
    const blocked = steps.find((step) => step.id === event.step_id);
    if (!blocked || blocked.status !== "blocked") return nonReady();
    blocked.status = "active";
    status = "active";
  } else {
    return nonReady();
  }

  const nextPlan = { ...plan, status, steps };
  if (!validatePlan(nextPlan)) return nonReady();
  return Object.freeze({
    status: "advanced",
    plan: Object.freeze({
      ...nextPlan,
      steps: Object.freeze(nextPlan.steps.map((step) => Object.freeze(step))),
    }),
  });
}


/** Reflection traps from malformed objects must not escape the NPC boundary. */
export function advanceNpcPlan(plan, event) {
  try {
    return advanceNpcPlanUnsafe(plan, event);
  } catch {
    return nonReady();
  }
}
