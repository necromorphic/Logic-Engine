/**
 * Pure NPC internal-motive conflict evaluator.
 * It classifies supplied options; it does not discover motives, authenticate
 * evidence, choose a winner, persist state, call a model, execute actions, or
 * mutate canonical world state.
 */
const MAX_MOTIVES = 100;
const MAX_OPTIONS = 100;
const MAX_CONSTRAINTS = 100;
const MAX_RESOLUTIONS = 500;
const ARRAY_ITERATOR = Array.prototype[Symbol.iterator];
const MOTIVE_KINDS = new Set(["goal", "obligation", "value", "need", "fear", "commitment"]);
const FEASIBILITY = new Set(["feasible", "infeasible", "unknown"]);
const CONSTRAINT_STATUS = new Set(["clear", "violated", "unknown"]);

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainDataObject(value) {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const keys = Reflect.ownKeys(value);
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      if (typeof key !== "string") return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isDenseDataArray(value, maxLength) {
  try {
    if (!Array.isArray(value) || value.length > maxLength) return false;
    const iterator = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
    if (!iterator || !Object.hasOwn(iterator, "value") || iterator.value !== ARRAY_ITERATOR) return false;
    for (let i = 0; i < value.length; i += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      if (!descriptor || !Object.hasOwn(descriptor, "value")) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function nonReady() {
  return Object.freeze({ status: "non_ready", options: Object.freeze([]) });
}

function pairKey(a, b) {
  return JSON.stringify(a < b ? [a, b] : [b, a]);
}

function uniqueStringArray(value, maxLength) {
  if (!isDenseDataArray(value, maxLength)) return null;
  const seen = new Set();
  const result = [];
  for (let i = 0; i < value.length; i += 1) {
    const item = value[i];
    if (!nonEmptyString(item) || seen.has(item)) return null;
    seen.add(item);
    result.push(item);
  }
  return result;
}

/**
 * Input:
 * motives: active [{ id, kind }]
 * options: [{ id, supports, frustrates, feasibility, hard_constraints }]
 * resolutions: [{ motive_a_id, motive_b_id, preferred_motive_id, rule_ref }]
 *
 * The caller must supply trusted, current assessments. A resolution explicitly
 * prefers one motive for an unordered pair and cites its author/World Pack rule.
 */
function evaluateUnsafe(input) {
  if (!isPlainDataObject(input)
    || !Object.hasOwn(input, "motives")
    || !Object.hasOwn(input, "options")
    || !Object.hasOwn(input, "resolutions")
    || !isDenseDataArray(input.motives, MAX_MOTIVES)
    || input.motives.length === 0
    || !isDenseDataArray(input.options, MAX_OPTIONS)
    || input.options.length === 0
    || !isDenseDataArray(input.resolutions, MAX_RESOLUTIONS)) return nonReady();

  const motives = new Map();
  for (let i = 0; i < input.motives.length; i += 1) {
    const motive = input.motives[i];
    if (!isPlainDataObject(motive)
      || !Object.hasOwn(motive, "id")
      || !Object.hasOwn(motive, "kind")
      || !nonEmptyString(motive.id)
      || !MOTIVE_KINDS.has(motive.kind)
      || motives.has(motive.id)) return nonReady();
    motives.set(motive.id, motive.kind);
  }

  const resolutions = new Map();
  for (let i = 0; i < input.resolutions.length; i += 1) {
    const item = input.resolutions[i];
    if (!isPlainDataObject(item)
      || !nonEmptyString(item.motive_a_id)
      || !nonEmptyString(item.motive_b_id)
      || item.motive_a_id === item.motive_b_id
      || !nonEmptyString(item.preferred_motive_id)
      || !nonEmptyString(item.rule_ref)) return nonReady();
    const a = item.motive_a_id;
    const b = item.motive_b_id;
    if (!motives.has(a) || !motives.has(b)
      || (item.preferred_motive_id !== a && item.preferred_motive_id !== b)) return nonReady();
    const key = pairKey(a, b);
    if (resolutions.has(key)) return nonReady();
    resolutions.set(key, Object.freeze({
      preferred_motive_id: item.preferred_motive_id,
      rule_ref: item.rule_ref,
    }));
  }

  const optionIds = new Set();
  const results = [];
  for (let i = 0; i < input.options.length; i += 1) {
    const option = input.options[i];
    if (!isPlainDataObject(option)
      || !nonEmptyString(option.id)
      || optionIds.has(option.id)
      || !Object.hasOwn(option, "supports")
      || !Object.hasOwn(option, "frustrates")
      || !Object.hasOwn(option, "feasibility")
      || !Object.hasOwn(option, "hard_constraints")
      || !FEASIBILITY.has(option.feasibility)) return nonReady();
    optionIds.add(option.id);

    const supports = uniqueStringArray(option.supports, MAX_MOTIVES);
    const frustrates = uniqueStringArray(option.frustrates, MAX_MOTIVES);
    if (!supports || supports.length === 0 || !frustrates
      || !isDenseDataArray(option.hard_constraints, MAX_CONSTRAINTS)) return nonReady();

    const supported = new Set(supports);
    const frustrated = new Set(frustrates);
    for (let j = 0; j < supports.length; j += 1) {
      if (!motives.has(supports[j]) || frustrated.has(supports[j])) return nonReady();
    }
    for (let j = 0; j < frustrates.length; j += 1) {
      if (!motives.has(frustrates[j])) return nonReady();
    }

    const constraintIds = new Set();
    let violated = false;
    let unknown = false;
    for (let j = 0; j < option.hard_constraints.length; j += 1) {
      const constraint = option.hard_constraints[j];
      if (!isPlainDataObject(constraint)
        || !nonEmptyString(constraint.id)
        || constraintIds.has(constraint.id)
        || !CONSTRAINT_STATUS.has(constraint.status)) return nonReady();
      constraintIds.add(constraint.id);
      if (constraint.status === "violated") violated = true;
      if (constraint.status === "unknown") unknown = true;
    }

    const conflicts = [];
    for (let j = 0; j < supports.length; j += 1) {
      const supportedId = supports[j];
      for (let k = 0; k < frustrates.length; k += 1) {
        const frustratedId = frustrates[k];
        const resolution = resolutions.get(pairKey(supportedId, frustratedId));
        if (!resolution) {
          conflicts.push(Object.freeze({
            motive_a_id: supportedId,
            motive_b_id: frustratedId,
            status: "unresolved",
          }));
        } else {
          conflicts.push(Object.freeze({
            motive_a_id: supportedId,
            motive_b_id: frustratedId,
            status: resolution.preferred_motive_id === supportedId
              ? "resolved_for_option" : "resolved_against_option",
            rule_ref: resolution.rule_ref,
          }));
        }
      }
    }

    let status = "eligible";
    let reason = "no_unresolved_conflict";
    if (violated || option.feasibility === "infeasible") {
      status = "ineligible";
      reason = violated ? "hard_constraint_violated" : "infeasible";
    } else if (unknown || option.feasibility === "unknown") {
      status = "needs_review";
      reason = unknown ? "hard_constraint_unknown" : "feasibility_unknown";
    } else {
      let opposed = false;
      let unresolved = false;
      for (let j = 0; j < conflicts.length; j += 1) {
        if (conflicts[j].status === "resolved_against_option") opposed = true;
        if (conflicts[j].status === "unresolved") unresolved = true;
      }
      if (opposed) {
        status = "ineligible";
        reason = "explicit_resolution_opposes_option";
      } else if (unresolved) {
        status = "needs_review";
        reason = "unresolved_motive_conflict";
      }
    }

    results.push(Object.freeze({
      id: option.id,
      status,
      reason,
      conflict_pairs: Object.freeze(conflicts),
    }));
  }

  const eligible = [];
  const review = [];
  const ineligible = [];
  for (let i = 0; i < results.length; i += 1) {
    const item = results[i];
    if (item.status === "eligible") eligible.push(item.id);
    else if (item.status === "needs_review") review.push(item.id);
    else ineligible.push(item.id);
  }
  const decision = eligible.length > 0
    ? (review.length > 0 ? "eligible_with_review_options" : "ready_for_selection")
    : (review.length > 0 ? "needs_review" : "no_eligible_option");

  return Object.freeze({
    status: "evaluated",
    decision,
    eligible_option_ids: Object.freeze(eligible),
    review_option_ids: Object.freeze(review),
    ineligible_option_ids: Object.freeze(ineligible),
    options: Object.freeze(results),
  });
}

export function evaluateNpcInternalConflict(input) {
  try {
    return evaluateUnsafe(input);
  } catch {
    return nonReady();
  }
}
