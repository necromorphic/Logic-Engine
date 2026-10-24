/**
 * Pure, standalone validation of a relationship transition candidate.
 *
 * This module does not resolve identities, authorize evidence, read Core state,
 * persist data, create events, or commit canonical changes. Its inputs are
 * supplied by a caller; its output is a candidate only.
 *
 * The shape used here is an internal domain-module contract, not a Core API,
 * storage schema, or wire format.
 */

const EVIDENCE_STATUSES = new Set([
  "supported",
  "withheld",
  "insufficient",
  "conflict",
  "unsupported",
]);

const own = (object, key) =>
  Object.prototype.hasOwnProperty.call(object, key);

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isNonEmptyString = (value) =>
  typeof value === "string" && value.trim().length > 0;

function result(status, details = {}) {
  return Object.freeze({ status, ...details });
}

function transitionAllowed(rule, from, to, operation) {
  return Array.isArray(rule.transitions) && rule.transitions.some((transition) =>
    isRecord(transition)
    && transition.operation === operation
    && transition.from === from
    && transition.to === to
  );
}

/**
 * Evaluate a proposed partial patch against explicit World Pack rules.
 *
 * Required input:
 * - subjectId / targetId: opaque references already resolved by the caller.
 * - currentValues: effective values for this directed pair; absent keys are
 *   unset. An explicit neutral is represented as an ordinary domain value.
 * - patch: dimension -> domain value, or { operation: "clear" }.
 * - dimensionRules: dimension -> { values, allowClear, allowSelfRelation?,
 *   transitions: [{ operation: "set"|"clear", from: value|null, to: value|null }] }.
 * - evidence: { status, refs }; authorization and truth of those refs are
 *   upstream responsibilities. This function only checks declared status.
 * - ruleVersion: non-empty identifier for the pinned domain rules.
 *
 * No numeric scale, dimension list, default neutral, or implicit transition is
 * assumed. Any invalid dimension rejects the entire candidate.
 */
export function evaluateRelationshipCandidate(input) {
  if (!isRecord(input)) {
    return result("invalid_candidate", { reason: "input_must_be_object" });
  }

  const {
    subjectId,
    targetId,
    currentValues,
    patch,
    dimensionRules,
    evidence,
    ruleVersion,
  } = input;

  if (!isNonEmptyString(subjectId) || !isNonEmptyString(targetId)) {
    return result("invalid_candidate", { reason: "participant_reference_required" });
  }
  if (!isNonEmptyString(ruleVersion)) {
    return result("unsupported", { reason: "rule_version_required" });
  }
  if (!isRecord(currentValues) || !isRecord(patch) || !isRecord(dimensionRules)) {
    return result("invalid_candidate", { reason: "state_patch_and_rules_must_be_objects" });
  }
  if (Object.keys(patch).length === 0) {
    return result("no_change", { reason: "empty_patch" });
  }
  if (!isRecord(evidence) || !EVIDENCE_STATUSES.has(evidence.status)) {
    return result("unsupported", { reason: "evidence_assessment_unavailable" });
  }
  if (evidence.status === "withheld") {
    return result("withheld", { reason: "evidence_withheld" });
  }
  if (evidence.status === "insufficient") {
    return result("insufficient_evidence");
  }
  if (evidence.status === "conflict") {
    return result("conflict_review_required");
  }
  if (evidence.status === "unsupported") {
    return result("unsupported", { reason: "evidence_contract_unsupported" });
  }
  if (!Array.isArray(evidence.refs) || evidence.refs.length === 0
      || !evidence.refs.every(isNonEmptyString)) {
    return result("insufficient_evidence", { reason: "supported_evidence_refs_required" });
  }

  const candidatePatch = {};
  const changes = [];

  for (const [dimension, requested] of Object.entries(patch)) {
    if (!isNonEmptyString(dimension) || !own(dimensionRules, dimension)) {
      return result("invalid_candidate", {
        reason: "unsupported_dimension",
        dimension,
      });
    }

    const rule = dimensionRules[dimension];
    if (!isRecord(rule) || !Array.isArray(rule.values)
        || !rule.values.every((value) => typeof value === "string")) {
      return result("unsupported", {
        reason: "dimension_rule_incomplete",
        dimension,
      });
    }

    if (subjectId === targetId && rule.allowSelfRelation !== true) {
      return result("invalid_candidate", {
        reason: "self_relation_not_enabled",
        dimension,
      });
    }

    const currentExists = own(currentValues, dimension);
    const from = currentExists ? currentValues[dimension] : null;
    const clearing = isRecord(requested) && requested.operation === "clear";
    const operation = clearing ? "clear" : "set";
    const to = clearing ? null : requested;

    if (clearing && rule.allowClear !== true) {
      return result("invalid_candidate", {
        reason: "clear_not_allowed",
        dimension,
      });
    }
    if (!clearing && (typeof to !== "string" || !rule.values.includes(to))) {
      return result("invalid_candidate", {
        reason: "unsupported_value",
        dimension,
      });
    }

    if (clearing && !currentExists) {
      continue;
    }
    if (!clearing && currentExists && from === to) {
      continue;
    }

    if (!transitionAllowed(rule, from, to, operation)) {
      return result("invalid_candidate", {
        reason: "transition_not_allowed",
        dimension,
      });
    }

    if (clearing) {
      candidatePatch[dimension] = Object.freeze({ operation: "clear" });
    } else {
      candidatePatch[dimension] = to;
    }
    changes.push(dimension);
  }

  if (changes.length === 0) {
    return result("no_change", { reason: "patch_matches_current_state" });
  }

  return result("candidate", {
    subjectId,
    targetId,
    ruleVersion,
    evidenceRefs: Object.freeze([...evidence.refs]),
    patch: Object.freeze(candidatePatch),
    changedDimensions: Object.freeze(changes),
  });
}
