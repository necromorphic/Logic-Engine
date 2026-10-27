/**
 * Pure domain assessment of NPC-supplied interpretations of one social interaction.
 *
 * This helper aggregates already-interpreted evidence; it does not classify raw
 * language or behavior, infer a character's intent, read Core state, authorize
 * evidence references, apply relationship deltas, persist data, or commit events.
 * Its input/output are internal domain-module shapes, not a Core API or wire schema.
 *
 * Conservative policy: any withheld, unsupported, conflicting, or insufficient
 * assessment prevents a single interpretation from being promoted to supported.
 * Multiple distinct supported interpretations are a conflict, not a vote.
 */

import { isProxy } from "node:util/types";

const STATUSES = new Set([
  "supported",
  "withheld",
  "insufficient",
  "conflict",
  "unsupported",
]);

const own = (object, key) =>
  Object.prototype.hasOwnProperty.call(object, key);

const isRecord = (value) => {
  if (value === null || typeof value !== "object" || Array.isArray(value) || isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === "string"
      && descriptor !== undefined
      && descriptor.enumerable
      && own(descriptor, "value");
  });
};

const isDataArray = (value) => {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => {
    if (key === "length") return false;
    if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key)) return true;
    const index = Number(key);
    return !Number.isSafeInteger(index) || index < 0 || index >= value.length
      || String(index) !== key;
  })) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!own(value, String(index))) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !own(descriptor, "value")) return false;
  }
  return true;
};

const nonEmptyString = (value) =>
  typeof value === "string" && value.trim().length > 0;

const result = (status, details = {}) =>
  Object.freeze({ status, ...details });

function validateAssessment(item) {
  if (!isRecord(item)
      || !Object.keys(item).every((key) => ["interpretation", "status", "refs"].includes(key))
      || !own(item, "interpretation")
      || !own(item, "status")
      || !STATUSES.has(item.status)
      || !nonEmptyString(item.interpretation)) {
    return { valid: false };
  }

  if (item.status !== "supported") {
    if (own(item, "refs") && (!isDataArray(item.refs)
        || !item.refs.every(nonEmptyString))) return { valid: false };
    return { valid: true, status: item.status };
  }

  if (!own(item, "refs") || !isDataArray(item.refs) || item.refs.length === 0
      || !item.refs.every(nonEmptyString)
      || new Set(item.refs).size !== item.refs.length) {
    return { valid: false };
  }

  return { valid: true, status: item.status };
}

/**
 * Assess whether the supplied NPC interpretations support one unambiguous
 * interaction reading. A supported result is not itself a relationship change.
 *
 * @param {{assessments: Array<{interpretation: string, status: string, refs?: string[]}>}} input
 */
export function assessInteractionInterpretations(input) {
  if (!isRecord(input)
      || !Object.keys(input).every((key) => key === "assessments")
      || !own(input, "assessments")
      || !isDataArray(input.assessments)
      || input.assessments.length === 0) {
    return result("invalid_input", { reason: "assessments_required" });
  }

  const assessments = [];
  for (const item of input.assessments) {
    const checked = validateAssessment(item);
    if (!checked.valid) {
      return result("invalid_input", { reason: "assessment_shape_invalid" });
    }
    assessments.push({ item, checked });
  }

  // Access restrictions dominate semantic output to avoid leaking a partial
  // interpretation when any contributing assessment is withheld.
  if (assessments.some(({ checked }) => checked.status === "withheld")) {
    return result("withheld", { reason: "interaction_assessment_withheld" });
  }
  if (assessments.some(({ checked }) => checked.status === "unsupported")) {
    return result("unsupported", { reason: "interaction_assessment_unsupported" });
  }
  if (assessments.some(({ checked }) => checked.status === "conflict")) {
    return result("conflict_review_required", { reason: "interaction_assessment_conflict" });
  }
  if (assessments.some(({ checked }) => checked.status === "insufficient")) {
    return result("insufficient_evidence", { reason: "interaction_assessment_insufficient" });
  }

  const interpretations = [...new Set(assessments.map(({ item }) => item.interpretation.trim()))];
  if (interpretations.length !== 1) {
    return result("conflict_review_required", {
      reason: "multiple_supported_interpretations",
    });
  }

  // Reusing one source reference across assessments is not extra evidence.
  const refs = [...new Set(assessments.flatMap(({ item }) => item.refs))].sort();

  return result("supported", {
    interpretation: interpretations[0],
    evidenceRefs: Object.freeze(refs),
  });
}
