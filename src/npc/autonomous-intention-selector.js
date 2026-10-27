/**
 * NPC-side autonomous intention selector.
 *
 * This is an isolated, deterministic proposal helper. It does not schedule
 * itself, execute actions, mutate world state, persist goals, or establish
 * that its inputs are authoritative. A caller must supply already-approved
 * NPC-local goals and action candidates. Host/Core execution remains outside
 * this module.
 */

const MAX_PRIORITY = 100;
const MAX_COST = 100;

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainDataObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === "string" && descriptor != null && Object.hasOwn(descriptor, "value");
  });
}

function validBoundedNumber(value, max) {
  return Number.isFinite(value) && value >= 0 && value <= max;
}

function isDenseArray(value) {
  if (!Array.isArray(value)) return false;
  for (let i = 0; i < value.length; i += 1) {
    if (!Object.hasOwn(value, i)) return false;
  }
  return true;
}

function invalidDecision() {
  return Object.freeze({ status: "non_ready", intention: null });
}

/**
 * Select the next eligible intention from caller-supplied NPC goals/actions.
 *
 * Required goal fields: { id, status, priority }
 * Required action fields: { id, goal_id, allowed, preconditions_met, cost }
 * Optional current_intention: { goal_id, action_id } or null.
 *
 * Only goals with status "active" participate. Actions must explicitly be
 * allowed and have satisfied preconditions. A still-eligible current intention
 * is retained unless an eligible action belongs to a strictly higher-priority
 * goal. Otherwise higher goal priority wins; then lower cost; then lexical IDs.
 */
export function selectNpcIntention(input) {
  if (!isPlainDataObject(input)) return invalidDecision();
  const { goals, actions } = input;
  if (!isDenseArray(goals) || !isDenseArray(actions)) return invalidDecision();
  const current = input.current_intention;
  if (current !== undefined && current !== null && (
    !isPlainDataObject(current)
    || !nonEmptyString(current.goal_id)
    || !nonEmptyString(current.action_id)
  )) return invalidDecision();

  const goalById = new Map();
  for (const goal of goals) {
    if (
      !isPlainDataObject(goal)
      || !nonEmptyString(goal.id)
      || !["active", "blocked", "completed"].includes(goal.status)
      || !validBoundedNumber(goal.priority, MAX_PRIORITY)
      || goalById.has(goal.id)
    ) return invalidDecision();
    goalById.set(goal.id, goal);
  }

  const seenActionIds = new Set();
  const eligible = [];
  for (const action of actions) {
    if (
      !isPlainDataObject(action)
      || !nonEmptyString(action.id)
      || !nonEmptyString(action.goal_id)
      || typeof action.allowed !== "boolean"
      || typeof action.preconditions_met !== "boolean"
      || !validBoundedNumber(action.cost, MAX_COST)
      || seenActionIds.has(action.id)
    ) return invalidDecision();

    seenActionIds.add(action.id);
    const goal = goalById.get(action.goal_id);
    // A dangling goal reference is malformed input, not a valid reason to idle.
    if (!goal) return invalidDecision();
    if (
      goal.status !== "active"
      || action.allowed !== true
      || action.preconditions_met !== true
    ) continue;

    eligible.push({
      goal_id: goal.id,
      goal_priority: goal.priority,
      action_id: action.id,
      action_cost: action.cost,
    });
  }

  if (eligible.length === 0) {
    return Object.freeze({ status: "no_eligible_action", intention: null });
  }

  eligible.sort((a, b) =>
    b.goal_priority - a.goal_priority
    || a.action_cost - b.action_cost
    || a.goal_id.localeCompare(b.goal_id)
    || a.action_id.localeCompare(b.action_id));

  const highestPriority = eligible[0].goal_priority;
  const retained = current == null ? undefined : eligible.find((candidate) =>
    candidate.goal_id === current.goal_id && candidate.action_id === current.action_id
  );
  const winner = retained && retained.goal_priority >= highestPriority
    ? retained
    : eligible[0];
  return Object.freeze({
    status: "selected",
    intention: Object.freeze({
      goal_id: winner.goal_id,
      action_id: winner.action_id,
    }),
  });
}
