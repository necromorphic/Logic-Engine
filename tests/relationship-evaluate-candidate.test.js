import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRelationshipCandidate } from "../src/relationship/evaluate-candidate.js";

const rules = {
  trust: {
    values: ["low", "guarded", "high"],
    allowClear: true,
    transitions: [
      { operation: "set", from: null, to: "low" },
      { operation: "set", from: { status: "cleared" }, to: "low" },
      { operation: "set", from: "low", to: "guarded" },
      { operation: "set", from: "guarded", to: "high" },
      { operation: "set", from: "low", to: "high" },
      { operation: "clear", from: "low", to: null },
      { operation: "clear", from: "guarded", to: null },
      { operation: "clear", from: "high", to: null },
    ],
  },
  affection: {
    values: ["absent", "warm", "strong"],
    allowClear: false,
    transitions: [
      { operation: "set", from: null, to: "absent" },
      { operation: "set", from: "absent", to: "warm" },
      { operation: "set", from: "warm", to: "strong" },
    ],
  },
};

const base = {
  subjectId: "A",
  targetId: "B",
  currentValues: { trust: "low", affection: "warm" },
  patch: { trust: "guarded" },
  dimensionRules: rules,
  evidence: { status: "supported", refs: ["event:E1"] },
  ruleVersion: "world-pack:test@1",
};

test("returns a candidate without mutating the supplied state or patch", () => {
  const currentValues = { trust: "low", affection: "warm" };
  const patch = { trust: "guarded" };
  const input = { ...base, currentValues, patch };

  const result = evaluateRelationshipCandidate(input);

  assert.equal(result.status, "candidate");
  assert.deepEqual(result.patch, { trust: "guarded" });
  assert.deepEqual(result.changedDimensions, ["trust"]);
  assert.deepEqual(currentValues, { trust: "low", affection: "warm" });
  assert.deepEqual(patch, { trust: "guarded" });
});

test("keeps direction explicit and does not create a reciprocal patch", () => {
  const result = evaluateRelationshipCandidate(base);

  assert.equal(result.subjectId, "A");
  assert.equal(result.targetId, "B");
  assert.equal(Object.hasOwn(result, "reciprocalPatch"), false);
});

test("omitted dimensions remain omitted from the candidate patch", () => {
  const result = evaluateRelationshipCandidate(base);

  assert.deepEqual(result.patch, { trust: "guarded" });
  assert.equal(Object.hasOwn(result.patch, "affection"), false);
});

test("rejects the whole candidate if any dimension is unsupported", () => {
  const result = evaluateRelationshipCandidate({
    ...base,
    patch: { trust: "guarded", attraction: "high" },
  });

  assert.equal(result.status, "invalid_candidate");
  assert.equal(result.reason, "unsupported_dimension");
  assert.equal(Object.hasOwn(result, "patch"), false);
});

test("does not infer a neutral/default value for an unset dimension", () => {
  const result = evaluateRelationshipCandidate({
    ...base,
    currentValues: {},
    patch: { trust: "guarded" },
  });

  assert.equal(result.status, "invalid_candidate");
  assert.equal(result.reason, "transition_not_allowed");
});

test("distinguishes explicit domain values from unset state", () => {
  const result = evaluateRelationshipCandidate({
    ...base,
    currentValues: {},
    patch: { trust: "low" },
  });

  assert.equal(result.status, "candidate");
  assert.deepEqual(result.patch, { trust: "low" });
});

test("uses an explicit clear operation, not omission or a sentinel value", () => {
  const result = evaluateRelationshipCandidate({
    ...base,
    patch: { trust: { operation: "clear" } },
  });

  assert.equal(result.status, "candidate");
  assert.deepEqual(result.patch, { trust: { operation: "clear" } });
});

test("rejects clearing where the active dimension rule disallows it", () => {
  const result = evaluateRelationshipCandidate({
    ...base,
    patch: { affection: { operation: "clear" } },
  });

  assert.equal(result.status, "invalid_candidate");
  assert.equal(result.reason, "clear_not_allowed");
});

test("distinguishes unset from a previously cleared dimension", () => {
  const fromUnset = evaluateRelationshipCandidate({
    ...base,
    currentValues: {},
    patch: { trust: "low" },
  });
  const rulesWithoutClearedTransition = {
    trust: {
      ...rules.trust,
      transitions: rules.trust.transitions.filter((transition) =>
        !(typeof transition.from === "object"
          && transition.from?.status === "cleared")),
    },
  };
  const fromCleared = evaluateRelationshipCandidate({
    ...base,
    currentValues: { trust: { status: "cleared" } },
    patch: { trust: "low" },
    dimensionRules: rulesWithoutClearedTransition,
  });

  assert.equal(fromUnset.status, "candidate");
  assert.equal(fromCleared.status, "invalid_candidate");
  assert.equal(fromCleared.reason, "transition_not_allowed");
});

test("does not silently treat a withheld current relationship value as unset", () => {
  const result = evaluateRelationshipCandidate({
    ...base,
    currentValues: { trust: { status: "withheld" } },
    patch: { trust: "guarded" },
  });

  assert.equal(result.status, "withheld");
  assert.equal(result.reason, "relationship_value_withheld");
});

test("clearing an already cleared or unset dimension is a no-change", () => {
  const cleared = evaluateRelationshipCandidate({
    ...base,
    currentValues: { trust: { status: "cleared" } },
    patch: { trust: { operation: "clear" } },
  });
  const unset = evaluateRelationshipCandidate({
    ...base,
    currentValues: {},
    patch: { trust: { operation: "clear" } },
  });

  assert.equal(cleared.status, "no_change");
  assert.equal(unset.status, "no_change");
});

test("returns no-change when the requested value already holds", () => {
  const result = evaluateRelationshipCandidate({
    ...base,
    patch: { trust: "low" },
  });

  assert.equal(result.status, "no_change");
});

test("does not evaluate a transition when evidence is insufficient or conflicting", () => {
  const insufficient = evaluateRelationshipCandidate({
    ...base,
    evidence: { status: "insufficient", refs: [] },
  });
  const conflict = evaluateRelationshipCandidate({
    ...base,
    evidence: { status: "conflict", refs: ["event:E1", "event:E2"] },
  });

  assert.equal(insufficient.status, "insufficient_evidence");
  assert.equal(conflict.status, "conflict_review_required");
});

test("does not treat unsupported evidence as an empty or neutral relationship", () => {
  const result = evaluateRelationshipCandidate({
    ...base,
    evidence: { status: "unsupported", refs: [] },
  });

  assert.equal(result.status, "unsupported");
});

test("preserves withheld evidence as an access outcome distinct from unsupported and insufficient", () => {
  const result = evaluateRelationshipCandidate({
    ...base,
    evidence: { status: "withheld", refs: [] },
  });

  assert.equal(result.status, "withheld");
  assert.equal(result.reason, "evidence_withheld");
});

test("requires explicit evidence references for a supported assessment", () => {
  const result = evaluateRelationshipCandidate({
    ...base,
    evidence: { status: "supported", refs: [] },
  });

  assert.equal(result.status, "insufficient_evidence");
});

test("does not silently apply a transition absent from the World Pack rules", () => {
  const result = evaluateRelationshipCandidate({
    ...base,
    currentValues: { trust: "high", affection: "warm" },
    patch: { trust: "low" },
  });

  assert.equal(result.status, "invalid_candidate");
  assert.equal(result.reason, "transition_not_allowed");
});

test("requires a pinned rule version", () => {
  const result = evaluateRelationshipCandidate({
    ...base,
    ruleVersion: "",
  });

  assert.equal(result.status, "unsupported");
  assert.equal(result.reason, "rule_version_required");
});

test("returns a non-mutating unsupported result when dimension rules are incomplete", () => {
  const result = evaluateRelationshipCandidate({
    ...base,
    dimensionRules: { trust: {} },
  });

  assert.equal(result.status, "unsupported");
  assert.equal(result.reason, "dimension_rule_incomplete");
});

test("empty patch is a no-change result", () => {
  const result = evaluateRelationshipCandidate({ ...base, patch: {} });

  assert.equal(result.status, "no_change");
  assert.equal(result.reason, "empty_patch");
});

test("self-relations are rejected unless each affected dimension explicitly allows them", () => {
  const rejected = evaluateRelationshipCandidate({
    ...base,
    subjectId: "A",
    targetId: "A",
    patch: { trust: "guarded" },
  });
  assert.equal(rejected.status, "invalid_candidate");
  assert.equal(rejected.reason, "self_relation_not_enabled");

  const selfRules = {
    trust: {
      ...rules.trust,
      allowSelfRelation: true,
    },
  };
  const allowed = evaluateRelationshipCandidate({
    ...base,
    subjectId: "A",
    targetId: "A",
    currentValues: { trust: "low" },
    patch: { trust: "guarded" },
    dimensionRules: selfRules,
  });
  assert.equal(allowed.status, "candidate");
});

test("re-evaluating identical inputs is deterministic and side-effect-free", () => {
  const input = {
    ...base,
    currentValues: { trust: "low" },
    patch: { trust: "guarded" },
  };
  const before = structuredClone(input);

  const first = evaluateRelationshipCandidate(input);
  const second = evaluateRelationshipCandidate(input);

  assert.deepEqual(first, second);
  assert.deepEqual(input, before);
});

test("clearing an unset dimension is a no-op even when clearing is disallowed", () => {
  const result = evaluateRelationshipCandidate({
    ...base,
    currentValues: {},
    patch: { affection: { operation: "clear" } },
  });

  assert.equal(result.status, "no_change");
});

test("treats missing transition rules as incomplete configuration, not a denied transition", () => {
  const result = evaluateRelationshipCandidate({
    ...base,
    dimensionRules: {
      trust: {
        values: ["low", "guarded", "high"],
        allowClear: true,
      },
    },
  });

  assert.equal(result.status, "unsupported");
  assert.equal(result.reason, "dimension_rule_incomplete");
});

test("rejects malformed tagged current values instead of treating them as unset", () => {
  const result = evaluateRelationshipCandidate({
    ...base,
    currentValues: { trust: { status: "value", value: 42 } },
    patch: { trust: "guarded" },
  });

  assert.equal(result.status, "unsupported");
  assert.equal(result.reason, "relationship_state_shape_unsupported");
});
