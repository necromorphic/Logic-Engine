/**
 * NPC-owned goal lifecycle transition helper.
 *
 * This helper validates a proposed transition supplied by the caller. It does
 * not decide whether a goal should be blocked/completed/abandoned, persist the
 * result, or authenticate the event that motivated the transition.
 */

const TERMINAL_STATUSES = new Set(["completed", "abandoned"]);

function isPlainDataObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === "string" && descriptor != null && Object.hasOwn(descriptor, "value");
  });
}

function invalidTransition() {
  return Object.freeze({ status: "non_ready", goal: null });
}

const TRANSITIONS = Object.freeze({
  block: Object.freeze({ from: ["active"], to: "blocked" }),
  unblock: Object.freeze({ from: ["blocked"], to: "active" }),
  complete: Object.freeze({ from: ["active", "blocked"], to: "completed" }),
  abandon: Object.freeze({ from: ["active", "blocked"], to: "abandoned" }),
});

/**
 * Apply a caller-proposed lifecycle event to an NPC-local goal value.
 *
 * Goal shape: { id: non-empty string, status: active|blocked|completed|abandoned }
 * Event: block | unblock | complete | abandon
 *
 * Terminal goals cannot be reopened or changed. The returned goal is a copy.
 */
export function transitionNpcGoal(goal, event) {
  if (
    !isPlainDataObject(goal)
    || typeof goal.id !== "string"
    || goal.id.trim().length === 0
    || !["active", "blocked", "completed", "abandoned"].includes(goal.status)
    || typeof event !== "string"
    || !Object.hasOwn(TRANSITIONS, event)
  ) return invalidTransition();

  if (TERMINAL_STATUSES.has(goal.status)) return invalidTransition();
  const transition = TRANSITIONS[event];
  if (!transition.from.includes(goal.status)) return invalidTransition();

  return Object.freeze({
    status: "transitioned",
    goal: Object.freeze({ ...goal, status: transition.to }),
  });
}
