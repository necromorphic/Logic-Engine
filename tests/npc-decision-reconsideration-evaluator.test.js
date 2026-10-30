import test from "node:test";
import assert from "node:assert/strict";
import { evaluateNpcDecisionReconsideration } from "../src/npc/decision-reconsideration-evaluator.js";

const base = () => ({
  prior_decision: {
    id: "decision-17",
    option_id: "protect-ally",
    context_ref: "snapshot-42",
    reason_refs: ["reason:loyalty", "reason:threat"],
    conflict_refs: ["conflict:loyalty-vs-safety"],
  },
  current_context: {
    snapshot_ref: "snapshot-43",
    assessment_complete: true,
    changes: [],
  },
});

test("requests reconsideration when a relevant assumption changes", () => {
  const input = base();
  input.current_context.changes.push({
    id: "change-1",
    kind: "assumption_changed",
    relevance: "relevant",
    source_ref: "evidence:door-is-locked",
  });
  const result = evaluateNpcDecisionReconsideration(input);
  assert.equal(result.status, "reconsideration_required");
  assert.equal(result.review_required, true);
  assert.equal(result.reason, "material_change_detected");
  assert.deepEqual(result.history_event_proposal.trigger_change_ids, ["change-1"]);
});

test("preserves the original decision, rationale, and unresolved conflict references", () => {
  const input = base();
  input.current_context.changes.push({
    id: "change-1",
    kind: "new_evidence",
    relevance: "relevant",
    source_ref: "evidence:ally-was-seen",
  });
  const result = evaluateNpcDecisionReconsideration(input);
  assert.deepEqual(result.preserved_prior_basis, {
    decision_id: "decision-17",
    option_id: "protect-ally",
    context_ref: "snapshot-42",
    reason_refs: ["reason:loyalty", "reason:threat"],
    conflict_refs: ["conflict:loyalty-vs-safety"],
  });
  assert.deepEqual(result.history_event_proposal.preserved_reason_refs, [
    "reason:loyalty",
    "reason:threat",
  ]);
  assert.deepEqual(result.history_event_proposal.preserved_conflict_refs, [
    "conflict:loyalty-vs-safety",
  ]);
});

test("does not request reconsideration for a complete context with only irrelevant changes", () => {
  const input = base();
  input.current_context.changes.push({
    id: "change-1",
    kind: "outcome_observed",
    relevance: "irrelevant",
    source_ref: "event:rain-started",
  });
  const result = evaluateNpcDecisionReconsideration(input);
  assert.equal(result.status, "no_material_change");
  assert.equal(result.review_required, false);
  assert.equal("history_event_proposal" in result, false);
});

test("unknown change relevance requires review rather than guessing", () => {
  const input = base();
  input.current_context.changes.push({
    id: "change-1",
    kind: "new_evidence",
    relevance: "unknown",
    source_ref: "evidence:unclassified",
  });
  const result = evaluateNpcDecisionReconsideration(input);
  assert.equal(result.status, "needs_review");
  assert.equal(result.reason, "change_relevance_unknown");
  assert.equal(result.review_required, true);
  assert.deepEqual(result.history_event_proposal.trigger_change_ids, []);
  assert.deepEqual(result.history_event_proposal.review_change_ids, ["change-1"]);
});

test("incomplete current assessment requires review even without a known relevant change", () => {
  const input = base();
  input.current_context.assessment_complete = false;
  const result = evaluateNpcDecisionReconsideration(input);
  assert.equal(result.status, "needs_review");
  assert.equal(result.reason, "current_assessment_incomplete");
});

test("a known relevant change triggers reconsideration even if other context is incomplete", () => {
  const input = base();
  input.current_context.assessment_complete = false;
  input.current_context.changes.push({
    id: "change-1",
    kind: "constraint_changed",
    relevance: "relevant",
    source_ref: "constraint:curfew",
  });
  const result = evaluateNpcDecisionReconsideration(input);
  assert.equal(result.status, "reconsideration_required");
  assert.equal(result.review_required, true);
});

test("rejects malformed references, duplicate changes, and unsupported change kinds", () => {
  const missingRef = base();
  missingRef.current_context.changes.push({
    id: "change-1",
    kind: "new_evidence",
    relevance: "relevant",
    source_ref: " ",
  });
  assert.equal(evaluateNpcDecisionReconsideration(missingRef).status, "non_ready");

  const duplicate = base();
  duplicate.current_context.changes = [
    { id: "same", kind: "new_evidence", relevance: "relevant", source_ref: "evidence:a" },
    { id: "same", kind: "goal_changed", relevance: "irrelevant", source_ref: "goal:b" },
  ];
  assert.equal(evaluateNpcDecisionReconsideration(duplicate).status, "non_ready");

  const unsupported = base();
  unsupported.current_context.changes.push({
    id: "change-1",
    kind: "canonical_truth_overwrite",
    relevance: "relevant",
    source_ref: "evidence:a",
  });
  assert.equal(evaluateNpcDecisionReconsideration(unsupported).status, "non_ready");
});

test("rejects sparse arrays and does not invoke accessor-backed fields", () => {
  const sparse = base();
  sparse.current_context.changes.length = 1;
  assert.equal(evaluateNpcDecisionReconsideration(sparse).status, "non_ready");

  let invoked = false;
  const hostile = base();
  Object.defineProperty(hostile.prior_decision, "id", {
    enumerable: true,
    get() {
      invoked = true;
      return "decision-17";
    },
  });
  assert.equal(evaluateNpcDecisionReconsideration(hostile).status, "non_ready");
  assert.equal(invoked, false);
});

test("does not mutate caller-owned input", () => {
  const input = base();
  const before = structuredClone(input);
  evaluateNpcDecisionReconsideration(input);
  assert.deepEqual(input, before);
});

test("fails closed when the prior decision has no identifier or no basis references", () => {
  const noId = base();
  noId.prior_decision.id = "";
  assert.equal(evaluateNpcDecisionReconsideration(noId).status, "non_ready");

  const noReasons = base();
  noReasons.prior_decision.reason_refs = ["reason:a", "reason:a"];
  const noReasonsResult = evaluateNpcDecisionReconsideration(noReasons);
  assert.equal(noReasonsResult.status, "non_ready");
  assert.equal(noReasonsResult.review_required, true);
});


test("does not accept inherited required fields as supplied input", () => {
  const input = base();
  delete input.prior_decision.id;
  Object.defineProperty(Object.prototype, "id", {
    configurable: true,
    value: "inherited-decision-id",
  });
  try {
    assert.equal(evaluateNpcDecisionReconsideration(input).status, "non_ready");
  } finally {
    delete Object.prototype.id;
  }

  const changeInput = base();
  changeInput.current_context.changes.push({
    kind: "new_evidence",
    relevance: "relevant",
    source_ref: "evidence:door",
  });
  Object.defineProperty(Object.prototype, "id", {
    configurable: true,
    value: "inherited-change-id",
  });
  try {
    assert.equal(evaluateNpcDecisionReconsideration(changeInput).status, "non_ready");
  } finally {
    delete Object.prototype.id;
  }
});
