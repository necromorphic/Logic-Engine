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

// Accept ordinary data records only. Accessor-backed fields could execute
// caller code during evaluation, which would violate the evaluator's purity
// boundary. Inputs are trusted in-process data, not hostile Proxy objects.
const isRecord = (value) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
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
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    return false;
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => key !== "length"
      && (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key)))) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!own(value, String(index))) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !own(descriptor, "value")) return false;
  }
  return true;
};

const isNonEmptyString = (value) =>
  typeof value === "string" && value.trim().length > 0;

function result(status, details = {}) {
  return Object.freeze({ status, ...details });
}

function setOwn(target, key, value) {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function transitionFromMatches(expected, current) {
  if (isRecord(expected) && isRecord(current)) {
    return expected.status === current.status
      && (expected.status !== "value" || expected.value === current.value);
  }
  return expected === current;
}

function validTransitionFrom(value) {
  if (value === null || typeof value === "string") return true;
  // Only cleared is a transitionable tagged state. Unset is represented by
  // null; withheld/conflict/insufficient/unsupported states stop evaluation.
  return isRecord(value)
    && own(value, "status")
    && value.status === "cleared"
    && Object.keys(value).length === 1;
}

function transitionAllowed(rule, from, to, operation) {
  return rule.transitions.some((transition) =>
    transition.operation === operation
    && transitionFromMatches(transition.from, from)
    && transition.to === to
  );
}

const NON_VALUE_STATES = new Map([
  ["withheld", { status: "withheld", result: "withheld", reason: "relationship_value_withheld" }],
  ["conflict", { status: "conflict_review_required", reason: "relationship_state_conflict" }],
  ["insufficient_support", { status: "insufficient_evidence", reason: "relationship_state_insufficiently_supported" }],
  ["unsupported", { status: "unsupported", reason: "relationship_state_unsupported" }],
  ["incomplete", { status: "unsupported", reason: "relationship_state_incomplete" }],
]);

function currentState(currentValues, dimension) {
  if (!own(currentValues, dimension)) return { status: "unset" };
  const raw = currentValues[dimension];
  if (isRecord(raw) && own(raw, "status") && own(raw, "value")
      && raw.status === "value"
      && typeof raw.value === "string"
      && Object.keys(raw).length === 2
      && own(raw, "value")) {
    return { status: "value", value: raw.value };
  }
  // Unset is represented only by an absent key; transition rules use null.
  // Reject a tagged unset instead of accepting a shape that cannot match rules.
  if (isRecord(raw) && own(raw, "status") && raw.status === "cleared"
      && Object.keys(raw).length === 1) {
    return { status: raw.status };
  }
  if (isRecord(raw) && own(raw, "status") && NON_VALUE_STATES.has(raw.status)
      && Object.keys(raw).length === 1) {
    return { status: raw.status };
  }
  if (typeof raw === "string") return { status: "value", value: raw };
  return { status: "unsupported", reason: "relationship_state_shape_unsupported" };
}

function transitionFromToken(state) {
  if (state.status === "unset") return null;
  if (state.status === "value") return state.value;
  return { status: state.status };
}

/**
 * Evaluate a proposed partial patch against explicit World Pack rules.
 *
 * Input-shape precondition: records are ordinary objects (or null-prototype
 * records) with enumerable own string data properties; arrays are dense standard
 * arrays with data elements and no custom properties. Accessor-backed,
 * non-enumerable, symbol-keyed, and subclassed inputs are rejected. Proxy objects
 * are outside this in-process domain contract and must not be supplied.
 *
 * Required input:
 * - subjectId / targetId: opaque references already resolved by the caller.
 * - currentValues: effective values for this directed pair; absent keys are
 *   unset. Ordinary strings are domain values (including explicit neutral).
 *   For a present dimension, tagged states may express {status:"cleared"},
 *   {status:"withheld"}, {status:"conflict"}, {status:"insufficient_support"},
 *   {status:"unsupported"}, or {status:"incomplete"}. A tagged value may be
 *   expressed as {status:"value", value:"..."}. These are internal evaluator
 *   inputs, not a public API or storage schema.
 * - patch: dimension -> domain value, or { operation: "clear" }.
 * - dimensionRules: dimension -> { values, allowClear, allowSelfRelation?,
 *   transitions: [{ operation: "set"|"clear", from: value|null|state-tag,
 *   to: value|null }] }. Use null for unset and {status:"cleared"} for cleared.
 * - evidence: { status, refs }; supported refs must be non-empty, unique strings.
 *   Authorization and truth of those refs are upstream responsibilities. This
 *   function only checks declared status.
 * - ruleVersion: non-empty identifier for the pinned domain rules.
 *
 * No numeric scale, dimension list, default neutral, or implicit transition is
 * assumed. Any invalid dimension rejects the entire candidate.
 */
export function evaluateRelationshipCandidate(input) {
  if (!isRecord(input)) {
    return result("invalid_candidate", { reason: "input_must_be_object" });
  }

  const requiredInputFields = [
    "subjectId", "targetId", "currentValues", "patch",
    "dimensionRules", "evidence", "ruleVersion",
  ];
  if (!requiredInputFields.every((key) => own(input, key))) {
    return result("invalid_candidate", { reason: "input_fields_required" });
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
  if (!isRecord(evidence) || !own(evidence, "status")
      || !EVIDENCE_STATUSES.has(evidence.status)) {
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
  if (!own(evidence, "refs") || !isDataArray(evidence.refs) || evidence.refs.length === 0
      || !Array.prototype.every.call(evidence.refs, isNonEmptyString)) {
    return result("insufficient_evidence", { reason: "supported_evidence_refs_required" });
  }
  if (new Set(evidence.refs).size !== evidence.refs.length) {
    return result("insufficient_evidence", { reason: "duplicate_evidence_refs" });
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
    if (!isRecord(rule)
        || !own(rule, "values") || !own(rule, "allowClear") || !own(rule, "transitions")
        || !Object.keys(rule).every((key) =>
          ["values", "allowClear", "allowSelfRelation", "transitions"].includes(key))
        || (own(rule, "allowSelfRelation") && typeof rule.allowSelfRelation !== "boolean")
        || !isDataArray(rule.values)
        || rule.values.length === 0
        || !Array.prototype.every.call(rule.values, isNonEmptyString)
        || new Set(rule.values).size !== rule.values.length
        || typeof rule.allowClear !== "boolean"
        || !isDataArray(rule.transitions)
        || !Array.prototype.every.call(rule.transitions, (transition) =>
          isRecord(transition)
          && Object.keys(transition).length === 3
          && own(transition, "operation")
          && own(transition, "from")
          && own(transition, "to")
          && (transition.operation === "set" || transition.operation === "clear")
          && validTransitionFrom(transition.from)
          && (typeof transition.from !== "string" || rule.values.includes(transition.from))
          && own(transition, "to")
          && (transition.operation === "set"
            ? typeof transition.to === "string" && rule.values.includes(transition.to)
            : transition.to === null)
        )) {
      return result("unsupported", {
        reason: "dimension_rule_incomplete",
        dimension,
      });
    }

    if (subjectId === targetId
        && !(own(rule, "allowSelfRelation") && rule.allowSelfRelation === true)) {
      return result("invalid_candidate", {
        reason: "self_relation_not_enabled",
        dimension,
      });
    }

    const state = currentState(currentValues, dimension);
    if (state.status === "unsupported") {
      return result("unsupported", {
        reason: state.reason ?? NON_VALUE_STATES.get(state.status)?.reason
          ?? "relationship_state_shape_unsupported",
        dimension,
      });
    }
    if (state.status === "value" && !rule.values.includes(state.value)) {
      return result("unsupported", {
        reason: "current_relationship_value_outside_domain",
        dimension,
      });
    }
    const nonValue = NON_VALUE_STATES.get(state.status);
    if (nonValue) {
      return result(nonValue.result ?? nonValue.status, {
        reason: nonValue.reason,
        dimension,
      });
    }

    const from = transitionFromToken(state);
    const clearing = isRecord(requested)
      && own(requested, "operation")
      && requested.operation === "clear"
      && Object.keys(requested).length === 1;
    const operation = clearing ? "clear" : "set";
    const to = clearing ? null : requested;

    if (!clearing && (typeof to !== "string" || !rule.values.includes(to))) {
      return result("invalid_candidate", {
        reason: "unsupported_value",
        dimension,
      });
    }

    // A request that is already satisfied is a no-op, not a new transition.
    // Check this before clear authorization: no clear is performed here.
    if (clearing && (state.status === "unset" || state.status === "cleared")) {
      continue;
    }
    if (!clearing && state.status === "value" && state.value === to) {
      continue;
    }

    if (clearing && rule.allowClear !== true) {
      return result("invalid_candidate", {
        reason: "clear_not_allowed",
        dimension,
      });
    }

    if (!transitionAllowed(rule, from, to, operation)) {
      return result("invalid_candidate", {
        reason: "transition_not_allowed",
        dimension,
      });
    }

    if (clearing) {
      setOwn(candidatePatch, dimension, Object.freeze({ operation: "clear" }));
    } else {
      setOwn(candidatePatch, dimension, to);
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
