/**
 * NPC-owned, pure plan-viability assessment.
 *
 * This evaluates explicit caller-supplied checks; it does not inspect the world,
 * authenticate evidence, revise a plan, execute an action, or persist state.
 */

import { types as utilTypes } from "node:util";

const PLAN_STATUSES = new Set(["active", "blocked", "completed", "abandoned"]);
const TERMINAL_STATUSES = new Set(["completed", "abandoned"]);
const ASSUMPTION_OUTCOMES = new Set(["holds", "contradicted", "unknown"]);
const BLOCKER_OUTCOMES = new Set(["clear", "active", "unknown"]);
const DEADLINE_OUTCOMES = new Set(["not_due", "due", "unknown"]);

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
  if (value === null || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Reflect.ownKeys(value).every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return typeof key === "string" && descriptor != null && Object.hasOwn(descriptor, "value");
    });
  } catch {
    return false;
  }
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isDenseArray(value) {
  if (!hasSafeArrayIterator() || !Array.isArray(value) || utilTypes.isProxy(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor == null || !Object.hasOwn(descriptor, "value")) return false;
  }
  return true;
}

function validIdList(value) {
  if (!isDenseArray(value)) return false;
  const seen = new Set();
  for (const item of value) {
    if (!isPlainDataObject(item) || !nonEmptyString(item.id) || seen.has(item.id)) return false;
    seen.add(item.id);
  }
  return true;
}

function validAssessmentList(value, allowedOutcomes) {
  if (!isDenseArray(value)) return false;
  const seen = new Set();
  for (const item of value) {
    if (
      !isPlainDataObject(item)
      || !nonEmptyString(item.id)
      || !allowedOutcomes.has(item.outcome)
      || seen.has(item.id)
    ) return false;
    seen.add(item.id);
  }
  return true;
}

function nonReady() {
  return Object.freeze({ status: "non_ready", disposition: null, reasons: Object.freeze([]) });
}

function compareAssessmentCoverage(expected, supplied) {
  const expectedIds = new Set(expected.map((item) => item.id));
  const suppliedIds = new Set(supplied.map((item) => item.id));
  for (const id of suppliedIds) {
    if (!expectedIds.has(id)) return "invalid";
  }
  for (const id of expectedIds) {
    if (!suppliedIds.has(id)) return "incomplete";
  }
  return "complete";
}

/**
 * Evaluate whether an existing NPC plan should continue, pause, or be reconsidered.
 *
 * Plan input: { id, status, assumptions: [{ id }], blockers: [{ id }] }
 * Assessment input:
 *   { assumptions: [{ id, outcome: holds|contradicted|unknown }],
 *     blockers: [{ id, outcome: clear|active|unknown }],
 *     deadline: not_due|due|unknown }
 *
 * Unknown is a valid result but never treated as a positive check. Missing or
 * mismatched assessment coverage returns needs_review or non_ready; it does not
 * silently imply that an assumption holds or a blocker is clear.
 */
export function assessNpcPlanViability(input) {
  if (!isPlainDataObject(input) || !isPlainDataObject(input.plan) || !isPlainDataObject(input.assessment)) {
    return nonReady();
  }

  const { plan, assessment } = input;
  if (
    !nonEmptyString(plan.id)
    || !PLAN_STATUSES.has(plan.status)
    || !validIdList(plan.assumptions)
    || !validIdList(plan.blockers)
  ) return nonReady();

  if (TERMINAL_STATUSES.has(plan.status)) {
    return Object.freeze({ status: "not_applicable", disposition: null, reasons: Object.freeze([]) });
  }

  if (
    !validAssessmentList(assessment.assumptions, ASSUMPTION_OUTCOMES)
    || !validAssessmentList(assessment.blockers, BLOCKER_OUTCOMES)
    || !DEADLINE_OUTCOMES.has(assessment.deadline)
  ) return nonReady();

  const assumptionCoverage = compareAssessmentCoverage(plan.assumptions, assessment.assumptions);
  const blockerCoverage = compareAssessmentCoverage(plan.blockers, assessment.blockers);
  if (assumptionCoverage === "invalid" || blockerCoverage === "invalid") return nonReady();

  const reasons = [];
  if (assumptionCoverage === "incomplete") reasons.push("assumption_assessment_missing");
  if (blockerCoverage === "incomplete") reasons.push("blocker_assessment_missing");

  if (assessment.assumptions.some((item) => item.outcome === "contradicted")) {
    reasons.push("assumption_contradicted");
  }
  if (assessment.deadline === "due") reasons.push("deadline_passed");
  if (assessment.blockers.some((item) => item.outcome === "active")) reasons.push("blocker_active");
  if (assessment.assumptions.some((item) => item.outcome === "unknown")) reasons.push("assumption_unknown");
  if (assessment.blockers.some((item) => item.outcome === "unknown")) reasons.push("blocker_unknown");
  if (assessment.deadline === "unknown") reasons.push("deadline_unknown");

  let disposition;
  if (reasons.includes("assumption_contradicted") || reasons.includes("deadline_passed")) {
    disposition = "reconsider";
  } else if (reasons.includes("blocker_active")) {
    disposition = "blocked";
  } else if (reasons.length > 0) {
    disposition = "needs_review";
  } else {
    disposition = plan.status === "blocked" ? "resume_candidate" : "continue";
  }

  return Object.freeze({
    status: "evaluated",
    disposition,
    reasons: Object.freeze(reasons),
  });
}
