import test from "node:test";
import assert from "node:assert/strict";
import { evaluateInteractionDrivenRelationshipCandidate } from "../src/relationship/evaluate-interaction-driven-candidate.js";

const assessments = [{ interpretation: "teasing", status: "supported", refs: ["event:E1"] }];
const rules = {
  trust: {
    values: ["guarded", "high"],
    allowClear: false,
    transitions: [
      { operation: "set", from: "guarded", to: "high" },
    ],
  },
};
const candidate = {
  subjectId: "A",
  targetId: "B",
  currentValues: { trust: "guarded" },
  patch: { trust: "high" },
  dimensionRules: rules,
  ruleVersion: "world-pack:test@1",
};
const base = { assessments, expectedInterpretation: "teasing", candidate };

test("passes matching supported interpretation through the existing transition evaluator", () => {
  const result = evaluateInteractionDrivenRelationshipCandidate(base);
  assert.equal(result.status, "candidate");
  assert.equal(result.interpretation, "teasing");
  assert.deepEqual(result.evidenceRefs, ["event:E1"]);
  assert.deepEqual(result.patch, { trust: "high" });
  assert.deepEqual(result.changedDimensions, ["trust"]);
});

test("does not derive or substitute a patch from the interpretation", () => {
  const result = evaluateInteractionDrivenRelationshipCandidate({
    ...base,
    candidate: { ...candidate, patch: { trust: "guarded" } },
  });
  assert.equal(result.status, "transition_rejected");
  assert.equal(result.transitionStatus, "no_change");
  assert.equal(Object.hasOwn(result, "patch"), false);
});

test("rejects a candidate whose declared motivating interpretation differs", () => {
  const result = evaluateInteractionDrivenRelationshipCandidate({
    ...base,
    expectedInterpretation: "flirtation",
  });
  assert.equal(result.status, "conflict_review_required");
  assert.equal(result.reason, "candidate_interpretation_mismatch");
  assert.equal(Object.hasOwn(result, "patch"), false);
});

test("ambiguous or withheld interaction evidence never reaches transition evaluation", () => {
  const cases = [
    [{ interpretation: "teasing", status: "supported", refs: ["event:E1"] },
      { interpretation: "sarcasm", status: "supported", refs: ["event:E2"] }],
    [{ interpretation: "teasing", status: "withheld", refs: [] }],
    [{ interpretation: "teasing", status: "insufficient", refs: [] }],
  ];
  for (const items of cases) {
    const result = evaluateInteractionDrivenRelationshipCandidate({ ...base, assessments: items });
    assert.equal(result.status, "interaction_evidence_rejected");
    assert.equal(Object.hasOwn(result, "patch"), false);
  }
});

test("still rejects transitions not allowed by the supplied domain rules", () => {
  const result = evaluateInteractionDrivenRelationshipCandidate({
    ...base,
    candidate: {
      ...candidate,
      currentValues: { trust: "guarded" },
      patch: { trust: "low" },
    },
  });
  assert.equal(result.status, "transition_rejected");
  assert.equal(result.transitionStatus, "invalid_candidate");
  assert.equal(result.reason, "unsupported_value");
});

test("does not accept caller-supplied evidence or extra candidate fields", () => {
  const withEvidence = evaluateInteractionDrivenRelationshipCandidate({
    ...base,
    candidate: { ...candidate, evidence: { status: "supported", refs: ["event:spoofed"] } },
  });
  const withExtraField = evaluateInteractionDrivenRelationshipCandidate({
    ...base,
    candidate: { ...candidate, relationshipDelta: 100 },
  });
  assert.equal(withEvidence.status, "invalid_candidate");
  assert.equal(withExtraField.status, "invalid_candidate");
});

test("does not mutate the proposed candidate or assessments", () => {
  const input = structuredClone(base);
  const before = structuredClone(input);
  evaluateInteractionDrivenRelationshipCandidate(input);
  assert.deepEqual(input, before);
});

test("rejects accessor-backed top-level input without invoking getters", () => {
  let getterCalls = 0;
  const input = { ...base };
  Object.defineProperty(input, "expectedInterpretation", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "teasing";
    },
  });
  const result = evaluateInteractionDrivenRelationshipCandidate(input);
  assert.equal(result.status, "invalid_candidate");
  assert.equal(result.reason, "interaction_candidate_shape_invalid");
  assert.equal(getterCalls, 0);
});

test("rejects accessor-backed candidate records without invoking getters", () => {
  let getterCalls = 0;
  const unsafeCandidate = { ...candidate };
  Object.defineProperty(unsafeCandidate, "patch", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return { trust: "high" };
    },
  });
  const result = evaluateInteractionDrivenRelationshipCandidate({
    ...base,
    candidate: unsafeCandidate,
  });
  assert.equal(result.status, "invalid_candidate");
  assert.equal(result.reason, "interaction_candidate_shape_invalid");
  assert.equal(getterCalls, 0);
});

test("unsupported and explicit-conflict assessments stop before transition evaluation", () => {
  const cases = [
    { status: "unsupported", expected: "unsupported" },
    { status: "conflict", expected: "conflict_review_required" },
  ];

  for (const item of cases) {
    const result = evaluateInteractionDrivenRelationshipCandidate({
      ...base,
      assessments: [{ interpretation: "teasing", status: item.status, refs: [] }],
      // If the transition evaluator were reached, this patch would be rejected
      // as an invalid candidate instead of returning the interaction gate status.
      candidate: { ...candidate, patch: { trust: "not-in-domain" } },
    });

    assert.equal(result.status, "interaction_evidence_rejected");
    assert.equal(result.assessmentStatus, item.expected);
    assert.equal(Object.hasOwn(result, "patch"), false);
    assert.equal(Object.hasOwn(result, "transitionStatus"), false);
  }
});


test("rejects Proxy-backed top-level and candidate records without invoking traps", () => {
  let trapCalls = 0;
  const unsafeCandidate = new Proxy(candidate, {
    get(target, key, receiver) { trapCalls += 1; return Reflect.get(target, key, receiver); },
  });
  const candidateResult = evaluateInteractionDrivenRelationshipCandidate({ ...base, candidate: unsafeCandidate });
  assert.equal(candidateResult.status, "invalid_candidate");
  assert.equal(trapCalls, 0);

  const unsafeInput = new Proxy(base, {
    get(target, key, receiver) { trapCalls += 1; return Reflect.get(target, key, receiver); },
  });
  const inputResult = evaluateInteractionDrivenRelationshipCandidate(unsafeInput);
  assert.equal(inputResult.status, "invalid_candidate");
  assert.equal(trapCalls, 0);
});

// Consolidated adversarial regression coverage from PR #427.
test("unsupported and explicit-conflict assessments stop before transition evaluation", () => {
  const cases = [
    { status: "unsupported", expected: "unsupported" },
    { status: "conflict", expected: "conflict_review_required" },
  ];

  for (const item of cases) {
    const result = evaluateInteractionDrivenRelationshipCandidate({
      ...base,
      assessments: [{ interpretation: "teasing", status: item.status, refs: [] }],
      // If the transition evaluator were reached, this patch would be rejected
      // as an invalid candidate instead of returning the interaction gate status.
      candidate: { ...candidate, patch: { trust: "not-in-domain" } },
    });

    assert.equal(result.status, "interaction_evidence_rejected");
    assert.equal(result.assessmentStatus, item.expected);
    assert.equal(Object.hasOwn(result, "patch"), false);
    assert.equal(Object.hasOwn(result, "transitionStatus"), false);
  }
});


test("interpretation mismatch gates before evaluating a malformed transition patch", () => {
  const result = evaluateInteractionDrivenRelationshipCandidate({
    ...base,
    expectedInterpretation: "sarcasm",
    candidate: { ...candidate, patch: { trust: "not-in-domain" } },
  });
  assert.equal(result.status, "conflict_review_required");
  assert.equal(result.reason, "candidate_interpretation_mismatch");
  assert.equal(Object.hasOwn(result, "patch"), false);
  assert.equal(Object.hasOwn(result, "transitionStatus"), false);
});

test("withheld evidence is fail-closed and exposes neither interpretation nor transition details", () => {
  const result = evaluateInteractionDrivenRelationshipCandidate({
    ...base,
    assessments: [
      { interpretation: "teasing", status: "supported", refs: ["event:E1"] },
      { interpretation: "sarcasm", status: "withheld", refs: [] },
    ],
    candidate: { ...candidate, patch: { trust: "not-in-domain" } },
  });
  assert.deepEqual(result, {
    status: "interaction_evidence_rejected",
    assessmentStatus: "withheld",
    reason: "interaction_assessment_withheld",
  });
});

test("does not amplify repeated evidence references across otherwise matching assessments", () => {
  const result = evaluateInteractionDrivenRelationshipCandidate({
    ...base,
    assessments: [
      { interpretation: "teasing", status: "supported", refs: ["event:E1", "event:E2"] },
      { interpretation: "teasing", status: "supported", refs: ["event:E1"] },
    ],
  });
  assert.equal(result.status, "candidate");
  assert.deepEqual(result.evidenceRefs, ["event:E1", "event:E2"]);
});

test("rejects sparse assessment arrays without reaching transition evaluation", () => {
  const assessments = [];
  assessments.length = 1;
  const result = evaluateInteractionDrivenRelationshipCandidate({
    ...base,
    assessments,
    candidate: { ...candidate, patch: { trust: "not-in-domain" } },
  });
  assert.equal(result.status, "interaction_evidence_rejected");
  assert.equal(result.assessmentStatus, "invalid_input");
  assert.equal(Object.hasOwn(result, "patch"), false);
  assert.equal(Object.hasOwn(result, "transitionStatus"), false);
});


test("rejects Proxy-backed top-level and candidate records without invoking traps", () => {
  let trapCalls = 0;
  const unsafeCandidate = new Proxy(candidate, {
    get(target, key, receiver) { trapCalls += 1; return Reflect.get(target, key, receiver); },
  });
  const candidateResult = evaluateInteractionDrivenRelationshipCandidate({ ...base, candidate: unsafeCandidate });
  assert.equal(candidateResult.status, "invalid_candidate");
  assert.equal(trapCalls, 0);

  const unsafeInput = new Proxy(base, {
    get(target, key, receiver) { trapCalls += 1; return Reflect.get(target, key, receiver); },
  });
  const inputResult = evaluateInteractionDrivenRelationshipCandidate(unsafeInput);
  assert.equal(inputResult.status, "invalid_candidate");
  assert.equal(trapCalls, 0);
});
