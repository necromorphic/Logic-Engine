/**
 * Pure trigger evaluator for reconsidering a prior NPC decision.
 *
 * It does not authenticate evidence, revise beliefs, choose a new action,
 * persist history, call a model, execute an action, or mutate canonical state.
 */
const MAX_REFS = 100;
const MAX_CHANGES = 100;
const CHANGE_KINDS = new Set([
  "assumption_changed",
  "new_evidence",
  "feasibility_changed",
  "constraint_changed",
  "goal_changed",
  "conflict_resolution_changed",
  "outcome_observed",
]);
const RELEVANCE = new Set(["relevant", "irrelevant", "unknown"]);
const ARRAY_ITERATOR = Array.prototype[Symbol.iterator];

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainDataObject(value) {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    for (const key of Reflect.ownKeys(value)) {
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
  return Object.freeze({ status: "non_ready", review_required: false });
}

function uniqueRefs(value) {
  if (!isDenseDataArray(value, MAX_REFS)) return null;
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

function evaluateUnsafe(input) {
  if (!isPlainDataObject(input)
    || !Object.hasOwn(input, "prior_decision")
    || !Object.hasOwn(input, "current_context")
    || !isPlainDataObject(input.prior_decision)
    || !isPlainDataObject(input.current_context)) return nonReady();

  const prior = input.prior_decision;
  const current = input.current_context;
  if (!nonEmptyString(prior.id)
    || !nonEmptyString(prior.option_id)
    || !nonEmptyString(prior.context_ref)
    || !Object.hasOwn(prior, "reason_refs")
    || !Object.hasOwn(prior, "conflict_refs")
    || !nonEmptyString(current.snapshot_ref)
    || !Object.hasOwn(current, "assessment_complete")
    || typeof current.assessment_complete !== "boolean"
    || !Object.hasOwn(current, "changes")) return nonReady();

  const reasonRefs = uniqueRefs(prior.reason_refs);
  const conflictRefs = uniqueRefs(prior.conflict_refs);
  if (!reasonRefs || !conflictRefs
    || !isDenseDataArray(current.changes, MAX_CHANGES)) return nonReady();

  const seenChangeIds = new Set();
  const relevant = [];
  const unknown = [];
  const irrelevant = [];

  for (let i = 0; i < current.changes.length; i += 1) {
    const change = current.changes[i];
    if (!isPlainDataObject(change)
      || !nonEmptyString(change.id)
      || seenChangeIds.has(change.id)
      || !CHANGE_KINDS.has(change.kind)
      || !RELEVANCE.has(change.relevance)
      || !nonEmptyString(change.source_ref)) return nonReady();

    seenChangeIds.add(change.id);
    const normalized = Object.freeze({
      id: change.id,
      kind: change.kind,
      source_ref: change.source_ref,
    });
    if (change.relevance === "relevant") relevant.push(normalized);
    else if (change.relevance === "unknown") unknown.push(normalized);
    else irrelevant.push(normalized);
  }

  const preservedPriorBasis = Object.freeze({
    decision_id: prior.id,
    option_id: prior.option_id,
    context_ref: prior.context_ref,
    reason_refs: Object.freeze(reasonRefs),
    conflict_refs: Object.freeze(conflictRefs),
  });

  let status;
  let reason;
  let reviewRequired;
  if (relevant.length > 0) {
    status = "reconsideration_required";
    reason = "material_change_detected";
    reviewRequired = true;
  } else if (unknown.length > 0 || !current.assessment_complete) {
    status = "needs_review";
    reason = unknown.length > 0
      ? "change_relevance_unknown"
      : "current_assessment_incomplete";
    reviewRequired = true;
  } else {
    status = "no_material_change";
    reason = "no_relevant_change_detected";
    reviewRequired = false;
  }

  const result = {
    status,
    reason,
    review_required: reviewRequired,
    preserved_prior_basis: preservedPriorBasis,
    current_context_ref: current.snapshot_ref,
    change_refs: Object.freeze({
      relevant: Object.freeze(relevant),
      unknown: Object.freeze(unknown),
      irrelevant: Object.freeze(irrelevant),
    }),
  };

  if (reviewRequired) {
    result.history_event_proposal = Object.freeze({
      event_type: "npc_decision_review_requested",
      prior_decision_id: prior.id,
      prior_context_ref: prior.context_ref,
      current_context_ref: current.snapshot_ref,
      reason,
      trigger_change_ids: Object.freeze(
        relevant.concat(unknown).map((change) => change.id),
      ),
      preserved_reason_refs: Object.freeze(reasonRefs),
      preserved_conflict_refs: Object.freeze(conflictRefs),
    });
  }

  return Object.freeze(result);
}

export function evaluateNpcDecisionReconsideration(input) {
  try {
    return evaluateUnsafe(input);
  } catch {
    return nonReady();
  }
}
