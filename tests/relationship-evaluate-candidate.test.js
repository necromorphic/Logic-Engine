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

test("rejects arrays with numeric-looking out-of-range custom properties", () => {
  const values = ["low"];
  Object.defineProperty(values, "4294967295", {
    value: "injected",
    enumerable: true,
    configurable: true,
  });
  const result = evaluateRelationshipCandidate({
    ...base,
    currentValues: {},
    patch: { trust: "low" },
    dimensionRules: {
      trust: {
        values,
        allowClear: false,
        transitions: [{ operation: "set", from: null, to: "low" }],
      },
    },
  });

  assert.equal(result.status, "unsupported");
  assert.equal(result.reason, "dimension_rule_incomplete");
});

test("rejects non-enumerable array elements in dimension rules", () => {
  const values = ["low"];
  Object.defineProperty(values, "0", {
    value: "low",
    enumerable: false,
    configurable: true,
  });
  const result = evaluateRelationshipCandidate({
    ...base,
    currentValues: {},
    patch: { trust: "low" },
    dimensionRules: {
      trust: {
        values,
        allowClear: false,
        transitions: [{ operation: "set", from: null, to: "low" }],
      },
    },
  });

  assert.equal(result.status, "unsupported");
  assert.equal(result.reason, "dimension_rule_incomplete");
});

test("preserves special object-property dimension names as own data keys", () => {
  const dimension = "__proto__";
  const specialRules = Object.fromEntries([
    [dimension, {
      values: ["low"],
      allowClear: false,
      transitions: [{ operation: "set", from: null, to: "low" }],
    }],
  ]);
  const specialPatch = Object.fromEntries([[dimension, "low"]]);
  const result = evaluateRelationshipCandidate({
    ...base,
    currentValues: {},
    patch: specialPatch,
    dimensionRules: specialRules,
  });

  assert.equal(result.status, "candidate");
  assert.equal(Object.hasOwn(result.patch, dimension), true);
  assert.equal(result.patch[dimension], "low");
  assert.equal(Object.getPrototypeOf(result.patch), Object.prototype);
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

test("rejects clear requests with undeclared extra fields", () => {
  const result = evaluateRelationshipCandidate({
    ...base,
    patch: { trust: { operation: "clear", reason: "cleanup" } },
  });

  assert.equal(result.status, "invalid_candidate");
  assert.equal(result.reason, "unsupported_value");
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

test("preserves each non-value relationship state instead of treating it as unset", () => {
  const cases = [
    ["conflict", "conflict_review_required", "relationship_state_conflict"],
    ["insufficient_support", "insufficient_evidence", "relationship_state_insufficiently_supported"],
    ["unsupported", "unsupported", "relationship_state_unsupported"],
    ["incomplete", "unsupported", "relationship_state_incomplete"],
  ];

  for (const [state, expectedStatus, expectedReason] of cases) {
    const result = evaluateRelationshipCandidate({
      ...base,
      currentValues: { trust: { status: state } },
      patch: { trust: "guarded" },
    });
    assert.equal(result.status, expectedStatus, state);
    assert.equal(result.reason, expectedReason, state);
  }
});

test("rejects tagged value states with undeclared extra fields", () => {
  const result = evaluateRelationshipCandidate({
    ...base,
    currentValues: { trust: { status: "value", value: "low", source: "legacy" } },
    patch: { trust: "guarded" },
  });

  assert.equal(result.status, "unsupported");
  assert.equal(result.reason, "relationship_state_shape_unsupported");
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

test("preserves the exact caller-supplied rule version label on a candidate", () => {
  const ruleVersion = "world-pack:test@1.2.3";
  const result = evaluateRelationshipCandidate({
    ...base,
    ruleVersion,
  });

  assert.equal(result.status, "candidate");
  assert.equal(result.ruleVersion, ruleVersion);
  assert.equal(Object.isFrozen(result), true);
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

test("rejects tagged current states with unexpected extra fields", () => {
  const malformedCleared = evaluateRelationshipCandidate({
    ...base,
    currentValues: { trust: { status: "cleared", value: "low" } },
    patch: { trust: "guarded" },
  });
  const malformedUnset = evaluateRelationshipCandidate({
    ...base,
    currentValues: { trust: { status: "unset" } },
    patch: { trust: "guarded" },
  });

  assert.equal(malformedCleared.status, "unsupported");
  assert.equal(malformedCleared.reason, "relationship_state_shape_unsupported");
  assert.equal(malformedUnset.status, "unsupported");
  assert.equal(malformedUnset.reason, "relationship_state_shape_unsupported");
});

test("rejects transition declarations with undeclared extra fields", () => {
  const result = evaluateRelationshipCandidate({
    ...base,
    dimensionRules: {
      trust: {
        ...rules.trust,
        transitions: [
          { operation: "set", from: "low", to: "guarded", note: "not part of the rule contract" },
        ],
      },
    },
  });

  assert.equal(result.status, "unsupported");
  assert.equal(result.reason, "dimension_rule_incomplete");
});

test("rejects malformed transition declarations as incomplete rules", () => {
  const result = evaluateRelationshipCandidate({
    ...base,
    dimensionRules: {
      trust: {
        ...rules.trust,
        transitions: [
          { operation: "set", from: { status: "mystery" }, to: "guarded" },
        ],
      },
    },
  });

  assert.equal(result.status, "unsupported");
  assert.equal(result.reason, "dimension_rule_incomplete");
});

test("rejects tagged cleared transition sources with undeclared extra fields", () => {
  const result = evaluateRelationshipCandidate({
    ...base,
    dimensionRules: {
      trust: {
        ...rules.trust,
        transitions: [
          { operation: "set", from: { status: "cleared", value: "low" }, to: "guarded" },
        ],
      },
    },
  });

  assert.equal(result.status, "unsupported");
  assert.equal(result.reason, "dimension_rule_incomplete");
});

test("rejects non-transitionable status tags in transition source rules", () => {
  const result = evaluateRelationshipCandidate({
    ...base,
    dimensionRules: {
      trust: {
        ...rules.trust,
        transitions: [
          { operation: "set", from: { status: "withheld" }, to: "guarded" },
        ],
      },
    },
  });

  assert.equal(result.status, "unsupported");
  assert.equal(result.reason, "dimension_rule_incomplete");
});

test("rejects a current value outside the active dimension domain", () => {
  const result = evaluateRelationshipCandidate({
    ...base,
    currentValues: { trust: "legacy-unknown" },
    patch: { trust: "guarded" },
  });

  assert.equal(result.status, "unsupported");
  assert.equal(result.reason, "current_relationship_value_outside_domain");
});

test("rejects transition rules sourced from values outside the dimension domain", () => {
  const result = evaluateRelationshipCandidate({
    ...base,
    dimensionRules: {
      trust: {
        ...rules.trust,
        transitions: [
          { operation: "set", from: "legacy-unknown", to: "guarded" },
        ],
      },
    },
  });

  assert.equal(result.status, "unsupported");
  assert.equal(result.reason, "dimension_rule_incomplete");
});

test("rejects accessor-backed input records without invoking their getters", () => {
  let getterCalls = 0;
  const input = { ...base };
  Object.defineProperty(input, "subjectId", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "A";
    },
  });

  const result = evaluateRelationshipCandidate(input);

  assert.equal(result.status, "invalid_candidate");
  assert.equal(result.reason, "input_must_be_object");
  assert.equal(getterCalls, 0);
});

test("rejects accessor-backed patch records without invoking their getters", () => {
  let getterCalls = 0;
  const patch = {};
  Object.defineProperty(patch, "trust", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "guarded";
    },
  });

  const result = evaluateRelationshipCandidate({ ...base, patch });

  assert.equal(result.status, "invalid_candidate");
  assert.equal(result.reason, "state_patch_and_rules_must_be_objects");
  assert.equal(getterCalls, 0);
});

test("rejects accessor-backed transition records without invoking their getters", () => {
  let getterCalls = 0;
  const transition = { operation: "set", from: "low" };
  Object.defineProperty(transition, "to", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "guarded";
    },
  });

  const result = evaluateRelationshipCandidate({
    ...base,
    dimensionRules: {
      trust: { ...rules.trust, transitions: [transition] },
    },
  });

  assert.equal(result.status, "unsupported");
  assert.equal(result.reason, "dimension_rule_incomplete");
  assert.equal(getterCalls, 0);
});

test("rejects accessor-backed evidence arrays without invoking indexed getters", () => {
  let getterCalls = 0;
  const refs = [];
  Object.defineProperty(refs, "0", {
    enumerable: true,
    configurable: true,
    get() {
      getterCalls += 1;
      return "event:E1";
    },
  });
  refs.length = 1;

  const result = evaluateRelationshipCandidate({
    ...base,
    evidence: { status: "supported", refs },
  });

  assert.equal(result.status, "insufficient_evidence");
  assert.equal(result.reason, "supported_evidence_refs_required");
  assert.equal(getterCalls, 0);
});

test("rejects sparse rule arrays as incomplete configuration", () => {
  const transitions = [];
  transitions.length = 1;

  const result = evaluateRelationshipCandidate({
    ...base,
    dimensionRules: {
      trust: { ...rules.trust, transitions },
    },
  });

  assert.equal(result.status, "unsupported");
  assert.equal(result.reason, "dimension_rule_incomplete");
});

test("rejects non-enumerable patch dimensions instead of silently ignoring them", () => {
  const patch = {};
  Object.defineProperty(patch, "trust", {
    value: "guarded",
    enumerable: false,
  });

  const result = evaluateRelationshipCandidate({ ...base, patch });

  assert.equal(result.status, "invalid_candidate");
  assert.equal(result.reason, "state_patch_and_rules_must_be_objects");
});

test("rejects undeclared dimension-rule fields instead of silently ignoring them", () => {
  const result = evaluateRelationshipCandidate({
    ...base,
    dimensionRules: {
      trust: { ...rules.trust, allowSelfRelations: true },
    },
  });

  assert.equal(result.status, "unsupported");
  assert.equal(result.reason, "dimension_rule_incomplete");
});

test("rejects a non-boolean self-relation rule flag", () => {
  const result = evaluateRelationshipCandidate({
    ...base,
    dimensionRules: {
      trust: { ...rules.trust, allowSelfRelation: "true" },
    },
  });

  assert.equal(result.status, "unsupported");
  assert.equal(result.reason, "dimension_rule_incomplete");
});

test("does not treat duplicate evidence references as additional support", () => {
  const result = evaluateRelationshipCandidate({
    ...base,
    evidence: { status: "supported", refs: ["event:E1", "event:E1"] },
  });

  assert.equal(result.status, "insufficient_evidence");
  assert.equal(result.reason, "duplicate_evidence_refs");
});

test("freezes the candidate envelope and all nested mutable collections", () => {
  const result = evaluateRelationshipCandidate({
    ...base,
    currentValues: { trust: "low" },
    patch: { trust: { operation: "clear" } },
  });

  assert.equal(result.status, "candidate");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.patch), true);
  assert.equal(Object.isFrozen(result.patch.trust), true);
  assert.equal(Object.isFrozen(result.evidenceRefs), true);
  assert.equal(Object.isFrozen(result.changedDimensions), true);
});

test("requires own input fields even when Object.prototype provides a fallback", () => {
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, "subjectId");
  Object.defineProperty(Object.prototype, "subjectId", {
    value: "A",
    configurable: true,
    writable: true,
  });
  try {
    const input = { ...base };
    delete input.subjectId;

    const result = evaluateRelationshipCandidate(input);

    assert.equal(result.status, "invalid_candidate");
    assert.equal(result.reason, "input_fields_required");
  } finally {
    if (previous) Object.defineProperty(Object.prototype, "subjectId", previous);
    else delete Object.prototype.subjectId;
  }
});

test("does not accept inherited status as a tagged transition source", () => {
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, "status");
  Object.defineProperty(Object.prototype, "status", {
    value: "cleared",
    configurable: true,
    writable: true,
  });
  try {
    const result = evaluateRelationshipCandidate({
      ...base,
      dimensionRules: {
        trust: {
          ...rules.trust,
          transitions: [{ operation: "set", from: { legacy: "tag" }, to: "guarded" }],
        },
      },
    });

    assert.equal(result.status, "unsupported");
    assert.equal(result.reason, "dimension_rule_incomplete");
  } finally {
    if (previous) Object.defineProperty(Object.prototype, "status", previous);
    else delete Object.prototype.status;
  }
});

test("does not interpret an inherited operation as an explicit clear request", () => {
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, "operation");
  Object.defineProperty(Object.prototype, "operation", {
    value: "clear",
    configurable: true,
    writable: true,
  });
  try {
    const result = evaluateRelationshipCandidate({
      ...base,
      patch: { trust: { note: "not a clear operation" } },
    });

    assert.equal(result.status, "invalid_candidate");
    assert.equal(result.reason, "unsupported_value");
  } finally {
    if (previous) Object.defineProperty(Object.prototype, "operation", previous);
    else delete Object.prototype.operation;
  }
});

test("does not accept inherited permission for self-relations", () => {
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, "allowSelfRelation");
  Object.defineProperty(Object.prototype, "allowSelfRelation", {
    value: true,
    configurable: true,
    writable: true,
  });
  try {
    const result = evaluateRelationshipCandidate({
      ...base,
      subjectId: "A",
      targetId: "A",
      currentValues: { trust: "low" },
      patch: { trust: "guarded" },
    });

    assert.equal(result.status, "invalid_candidate");
    assert.equal(result.reason, "self_relation_not_enabled");
  } finally {
    if (previous) Object.defineProperty(Object.prototype, "allowSelfRelation", previous);
    else delete Object.prototype.allowSelfRelation;
  }
});


test("rejects empty or duplicate values in a dimension domain", () => {
  const cases = [
    { values: [] },
    { values: ["low", ""] },
    { values: ["low", "low"] },
  ];

  for (const override of cases) {
    const result = evaluateRelationshipCandidate({
      ...base,
      dimensionRules: {
        trust: { ...rules.trust, ...override },
      },
    });

    assert.equal(result.status, "unsupported");
    assert.equal(result.reason, "dimension_rule_incomplete");
  }
});

test("supports all special dimension keys as own data keys for set and clear", () => {
  const dimensions = ["__proto__", "constructor", "prototype"];
  const makeRules = (operation) => Object.fromEntries(dimensions.map((dimension) => [
    dimension,
    {
      values: ["low"],
      allowClear: true,
      transitions: operation === "set"
        ? [{ operation: "set", from: null, to: "low" }]
        : [{ operation: "clear", from: "low", to: null }],
    },
  ]));

  for (const dimension of dimensions) {
    const setPatch = Object.fromEntries([[dimension, "low"]]);
    const setResult = evaluateRelationshipCandidate({
      ...base,
      currentValues: {},
      patch: setPatch,
      dimensionRules: makeRules("set"),
    });

    assert.equal(setResult.status, "candidate", `set ${dimension}`);
    assert.equal(Object.hasOwn(setResult.patch, dimension), true, `own set key ${dimension}`);
    assert.equal(setResult.patch[dimension], "low", `set value ${dimension}`);
    assert.equal(Object.getPrototypeOf(setResult.patch), Object.prototype, `set prototype ${dimension}`);

    const clearPatch = Object.fromEntries([[dimension, { operation: "clear" }]]);
    const clearResult = evaluateRelationshipCandidate({
      ...base,
      currentValues: Object.fromEntries([[dimension, "low"]]),
      patch: clearPatch,
      dimensionRules: makeRules("clear"),
    });

    assert.equal(clearResult.status, "candidate", `clear ${dimension}`);
    assert.equal(Object.hasOwn(clearResult.patch, dimension), true, `own clear key ${dimension}`);
    assert.deepEqual(clearResult.patch[dimension], { operation: "clear" }, `clear operation ${dimension}`);
    assert.equal(Object.getPrototypeOf(clearResult.patch), Object.prototype, `clear prototype ${dimension}`);
  }
});

test("preserves all special dimension keys together in a mixed set patch", () => {
  const dimensions = ["__proto__", "constructor", "prototype"];
  const patch = Object.fromEntries(dimensions.map((dimension) => [dimension, "low"]));
  const dimensionRules = Object.fromEntries(dimensions.map((dimension) => [
    dimension,
    {
      values: ["low"],
      allowClear: false,
      transitions: [{ operation: "set", from: null, to: "low" }],
    },
  ]));

  const result = evaluateRelationshipCandidate({
    ...base,
    currentValues: {},
    patch,
    dimensionRules,
  });

  assert.equal(result.status, "candidate");
  assert.deepEqual(result.changedDimensions, dimensions);
  for (const dimension of dimensions) {
    assert.equal(Object.hasOwn(result.patch, dimension), true, `own mixed key ${dimension}`);
    assert.equal(result.patch[dimension], "low", `mixed value ${dimension}`);
  }
  assert.equal(Object.getPrototypeOf(result.patch), Object.prototype);
});


test("clearing one dimension leaves every other dimension outside the candidate patch", () => {
  const currentValues = { trust: "low", affection: "warm" };
  const patch = { trust: { operation: "clear" } };
  const input = { ...base, currentValues, patch };

  const result = evaluateRelationshipCandidate(input);

  assert.equal(result.status, "candidate");
  assert.deepEqual(result.patch, { trust: { operation: "clear" } });
  assert.deepEqual(result.changedDimensions, ["trust"]);
  assert.equal(Object.hasOwn(result.patch, "affection"), false);
  assert.deepEqual(currentValues, { trust: "low", affection: "warm" });
  assert.deepEqual(patch, { trust: { operation: "clear" } });
});

test("rejects a mixed valid/invalid patch without exposing partial output or mutating inputs", () => {
  const currentValues = { trust: "low", affection: "warm" };
  const patch = { trust: "guarded", attraction: "high" };
  const dimensionRules = { ...rules };
  const beforeCurrentValues = structuredClone(currentValues);
  const beforePatch = structuredClone(patch);
  const input = { ...base, currentValues, patch, dimensionRules };

  const result = evaluateRelationshipCandidate(input);

  assert.equal(result.status, "invalid_candidate");
  assert.equal(result.reason, "unsupported_dimension");
  assert.equal(Object.hasOwn(result, "patch"), false);
  assert.equal(Object.hasOwn(result, "changedDimensions"), false);
  assert.deepEqual(currentValues, beforeCurrentValues);
  assert.deepEqual(patch, beforePatch);
  assert.deepEqual(dimensionRules, rules);
});

test("keeps explicit neutral distinct from unset and treats an existing neutral value as a no-op", () => {
  const neutralRules = {
    stance: {
      values: ["neutral", "positive"],
      allowClear: true,
      transitions: [
        { operation: "set", from: null, to: "neutral" },
        { operation: "set", from: "neutral", to: "positive" },
      ],
    },
  };
  const fromUnset = evaluateRelationshipCandidate({
    ...base,
    currentValues: {},
    patch: { stance: "neutral" },
    dimensionRules: neutralRules,
  });
  const alreadyNeutral = evaluateRelationshipCandidate({
    ...base,
    currentValues: { stance: "neutral" },
    patch: { stance: "neutral" },
    dimensionRules: neutralRules,
  });

  assert.equal(fromUnset.status, "candidate");
  assert.deepEqual(fromUnset.patch, { stance: "neutral" });
  assert.equal(alreadyNeutral.status, "no_change");
  assert.equal(alreadyNeutral.reason, "patch_matches_current_state");
});

test("accepts null-prototype data records without changing their prototype or contents", () => {
  const currentValues = Object.assign(Object.create(null), { trust: "low" });
  const patch = Object.assign(Object.create(null), { trust: "guarded" });
  const trustRule = Object.assign(Object.create(null), {
    values: ["low", "guarded", "high"],
    allowClear: true,
    transitions: [
      { operation: "set", from: "low", to: "guarded" },
    ],
  });
  const dimensionRules = Object.assign(Object.create(null), { trust: trustRule });
  const input = { ...base, currentValues, patch, dimensionRules };

  const result = evaluateRelationshipCandidate(input);

  assert.equal(result.status, "candidate");
  assert.deepEqual(result.patch, { trust: "guarded" });
  assert.equal(Object.getPrototypeOf(currentValues), null);
  assert.equal(Object.getPrototypeOf(patch), null);
  assert.equal(Object.getPrototypeOf(dimensionRules), null);
  assert.equal(Object.getPrototypeOf(trustRule), null);
  assert.deepEqual(currentValues.trust, "low");
  assert.deepEqual(patch.trust, "guarded");
});
