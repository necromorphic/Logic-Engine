import test from "node:test";
import assert from "node:assert/strict";
import { assessInteractionInterpretations } from "../src/relationship/assess-interaction-interpretations.js";

const supported = (interpretation, refs = ["event:E1"]) => ({
  interpretation,
  status: "supported",
  refs,
});

test("accepts one unambiguous NPC-supplied interpretation with evidence references", () => {
  const result = assessInteractionInterpretations({
    assessments: [supported("flirtation")],
  });
  assert.deepEqual(result, { status: "supported", interpretation: "flirtation", evidenceRefs: ["event:E1"] });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.evidenceRefs), true);
});

test("does not vote between different supported interpretations", () => {
  const result = assessInteractionInterpretations({
    assessments: [supported("flirtation", ["event:E1"]), supported("sarcasm", ["event:E2"])],
  });
  assert.equal(result.status, "conflict_review_required");
  assert.equal(result.reason, "multiple_supported_interpretations");
  assert.equal(Object.hasOwn(result, "interpretation"), false);
});

test("does not resolve ambiguity by majority vote", () => {
  const result = assessInteractionInterpretations({
    assessments: [supported("flirtation", ["event:E1"]), supported("flirtation", ["event:E2"]), supported("sarcasm", ["event:E3"])],
  });
  assert.equal(result.status, "conflict_review_required");
});

test("insufficient evidence blocks promotion of another interpretation", () => {
  const result = assessInteractionInterpretations({
    assessments: [supported("flirtation"), { interpretation: "sarcasm", status: "insufficient", refs: [] }],
  });
  assert.equal(result.status, "insufficient_evidence");
  assert.equal(Object.hasOwn(result, "interpretation"), false);
});

test("withheld assessment takes precedence and suppresses interpretation details", () => {
  const result = assessInteractionInterpretations({
    assessments: [supported("flirtation"), { interpretation: "sarcasm", status: "withheld", refs: [] }],
  });
  assert.deepEqual(result, { status: "withheld", reason: "interaction_assessment_withheld" });
});

test("unsupported and explicit conflict outcomes remain distinct", () => {
  const unsupported = assessInteractionInterpretations({
    assessments: [{ interpretation: "irony", status: "unsupported", refs: [] }],
  });
  const conflict = assessInteractionInterpretations({
    assessments: [{ interpretation: "irony", status: "conflict", refs: [] }],
  });
  assert.equal(unsupported.status, "unsupported");
  assert.equal(conflict.status, "conflict_review_required");
});

test("same interpretation from multiple assessments aggregates unique evidence refs", () => {
  const result = assessInteractionInterpretations({
    assessments: [supported("teasing", ["event:E2", "event:E1"]), supported("teasing", ["event:E1", "event:E3"])],
  });
  assert.deepEqual(result, {
    status: "supported",
    interpretation: "teasing",
    evidenceRefs: ["event:E1", "event:E2", "event:E3"],
  });
});

test("rejects supported assessments without non-empty unique evidence refs", () => {
  for (const refs of [[], ["event:E1", "event:E1"], [""]]) {
    const result = assessInteractionInterpretations({ assessments: [supported("flirtation", refs)] });
    assert.equal(result.status, "invalid_input");
    assert.equal(result.reason, "assessment_shape_invalid");
  }
});

test("rejects unknown statuses, extra fields, and malformed top-level inputs", () => {
  const cases = [
    null,
    {},
    { assessments: [] },
    { assessments: [supported("flirtation"), { interpretation: "sarcasm", status: "maybe", refs: [] }] },
    { assessments: [{ ...supported("flirtation"), confidence: 0.9 }] },
    { assessments: [supported("flirtation")], policy: "latest" },
  ];
  for (const input of cases) assert.equal(assessInteractionInterpretations(input).status, "invalid_input");
});

test("does not mutate caller-owned assessments", () => {
  const input = { assessments: [supported("teasing", ["event:E2", "event:E1"]), supported("teasing", ["event:E1"])] };
  const before = structuredClone(input);
  assessInteractionInterpretations(input);
  assert.deepEqual(input, before);
});

test("does not assign relationship deltas, reciprocity, intent, or consent", () => {
  const result = assessInteractionInterpretations({ assessments: [supported("flirtation")] });
  for (const key of ["patch", "relationshipDelta", "reciprocal", "intent", "consent"]) {
    assert.equal(Object.hasOwn(result, key), false);
  }
});
