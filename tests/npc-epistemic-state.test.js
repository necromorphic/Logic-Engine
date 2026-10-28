import test from "node:test";
import assert from "node:assert/strict";
import { applyNpcEpistemicEvent, createNpcEpistemicState } from "../src/npc/epistemic-state.js";

function emptyState() {
  const result = createNpcEpistemicState({ world_id: "world-a", subject_id: "npc-1" });
  assert.equal(result.status, "ready");
  return result.state;
}

function admit(state, overrides = {}) {
  return applyNpcEpistemicEvent(state, {
    type: "evidence_admitted",
    acquisition_ref: "acq-1",
    proposition_ref: "prop-secret-location",
    evidence_ref: "evidence-1",
    evidence_version: "v1",
    source_ref: "source-1",
    source_version: "v1",
    polarity: "supports_true",
    ...overrides,
  });
}

test("receiving information does not create evidence or belief", () => {
  const result = applyNpcEpistemicEvent(emptyState(), {
    type: "information_received",
    event_ref: "receipt-1",
    source_ref: "message-1",
    source_version: "v1",
  });
  assert.equal(result.status, "updated");
  assert.equal(result.state.received.length, 1);
  assert.deepEqual(result.state.evidence, []);
  assert.deepEqual(result.state.beliefs, []);
});

test("receipt replay is idempotent and conflicting identity reuse fails closed", () => {
  const state = emptyState();
  const event = { type: "information_received", event_ref: "receipt-1", source_ref: "message-1", source_version: "v1" };
  const first = applyNpcEpistemicEvent(state, event);
  assert.equal(applyNpcEpistemicEvent(first.state, event).status, "unchanged");
  assert.equal(applyNpcEpistemicEvent(first.state, { ...event, source_version: "v2" }).status, "non_ready");
});

test("admitted evidence does not automatically become belief", () => {
  const result = admit(emptyState());
  assert.equal(result.status, "updated");
  assert.equal(result.state.evidence.length, 1);
  assert.deepEqual(result.state.beliefs, []);
});

test("same evidence identity is idempotent; conflicting reuse is rejected", () => {
  const first = admit(emptyState()).state;
  assert.equal(admit(first).status, "unchanged");
  assert.equal(admit(first, { polarity: "supports_false" }).status, "non_ready");
});

test("belief revision requires valid evidence for the same proposition and a rule reference", () => {
  const state = admit(emptyState()).state;
  const event = {
    type: "belief_updated",
    proposition_ref: "prop-secret-location",
    stance: "believes_true",
    revision_rule_ref: "rule-evaluate-source",
    evidence_refs: ["evidence-1"],
  };
  const result = applyNpcEpistemicEvent(state, event);
  assert.equal(result.status, "updated");
  assert.equal(result.state.beliefs[0].stance, "believes_true");
  assert.deepEqual(result.state.beliefs[0].supporting_evidence_refs, ["evidence-1"]);
  assert.deepEqual(result.state.beliefs[0].conflicting_evidence_refs, []);
  assert.equal(applyNpcEpistemicEvent(state, { ...event, evidence_refs: ["missing"] }).status, "non_ready");
  assert.equal(applyNpcEpistemicEvent(state, { ...event, revision_rule_ref: "" }).status, "non_ready");
});

test("conflicting admissible evidence remains explicit rather than choosing a winner", () => {
  let state = admit(emptyState()).state;
  const second = admit(state, {
    evidence_ref: "evidence-2",
    acquisition_ref: "acq-2",
    source_ref: "source-2",
    polarity: "supports_false",
  });
  assert.equal(second.status, "updated");
  state = second.state;
  const result = applyNpcEpistemicEvent(state, {
    type: "belief_updated",
    proposition_ref: "prop-secret-location",
    stance: "believes_true",
    revision_rule_ref: "rule-preserve-prior-belief",
    evidence_refs: ["evidence-1", "evidence-2"],
  });
  assert.equal(result.status, "updated");
  assert.deepEqual(result.state.beliefs[0].supporting_evidence_refs, ["evidence-1"]);
  assert.deepEqual(result.state.beliefs[0].conflicting_evidence_refs, ["evidence-2"]);
});

test("invalidating evidence preserves the belief but marks it for review", () => {
  let state = admit(emptyState()).state;
  state = applyNpcEpistemicEvent(state, {
    type: "belief_updated",
    proposition_ref: "prop-secret-location",
    stance: "believes_true",
    revision_rule_ref: "rule-initial",
    evidence_refs: ["evidence-1"],
  }).state;
  const result = applyNpcEpistemicEvent(state, {
    type: "evidence_invalidated",
    evidence_ref: "evidence-1",
    evidence_version: "v1",
    invalidation_rule_ref: "rule-source-revoked",
  });
  assert.equal(result.status, "updated");
  assert.equal(result.state.beliefs[0].stance, "believes_true");
  assert.equal(result.state.beliefs[0].review_required, true);
  assert.equal(result.state.evidence[0].status, "invalidated");
  assert.equal(applyNpcEpistemicEvent(result.state, {
    type: "belief_updated",
    proposition_ref: "prop-secret-location",
    stance: "believes_true",
    revision_rule_ref: "rule-invalid-source",
    evidence_refs: ["evidence-1"],
  }).status, "non_ready");
});

test("forgetting is explicit and traceable; it does not delete evidence history", () => {
  let state = admit(emptyState()).state;
  state = applyNpcEpistemicEvent(state, {
    type: "belief_updated",
    proposition_ref: "prop-secret-location",
    stance: "believes_true",
    revision_rule_ref: "rule-initial",
    evidence_refs: ["evidence-1"],
  }).state;
  const result = applyNpcEpistemicEvent(state, {
    type: "belief_forgotten",
    proposition_ref: "prop-secret-location",
    forgetting_rule_ref: "rule-memory-decay",
  });
  assert.equal(result.status, "updated");
  assert.equal(result.state.beliefs[0].stance, "unknown");
  assert.deepEqual(result.state.beliefs[0].supporting_evidence_refs, []);
  assert.deepEqual(result.state.beliefs[0].conflicting_evidence_refs, []);
  assert.equal(result.state.beliefs[0].history.length, 1);
  assert.equal(result.state.evidence.length, 1);
});

test("unknown events, malformed scope, and sparse evidence lists fail closed", () => {
  assert.equal(createNpcEpistemicState({ world_id: "", subject_id: "npc-1" }).status, "non_ready");
  assert.equal(applyNpcEpistemicEvent(emptyState(), { type: "canonical_truth_changed" }).status, "non_ready");
  const state = admit(emptyState()).state;
  const sparse = [];
  sparse.length = 1;
  assert.equal(applyNpcEpistemicEvent(state, {
    type: "belief_updated",
    proposition_ref: "prop-secret-location",
    stance: "believes_true",
    revision_rule_ref: "rule-x",
    evidence_refs: sparse,
  }).status, "non_ready");
});

test("reducer does not mutate input state or event", () => {
  const state = emptyState();
  const event = { type: "information_received", event_ref: "receipt-1", source_ref: "message-1", source_version: "v1" };
  const stateBefore = structuredClone(state);
  const eventBefore = structuredClone(event);
  applyNpcEpistemicEvent(state, event);
  assert.deepEqual(state, stateBefore);
  assert.deepEqual(event, eventBefore);
});

test("nested getters and proxy inputs fail closed without executing getters", () => {
  let invoked = false;
  const event = {
    type: "information_received",
    event_ref: "receipt-1",
    source_ref: "message-1",
    source_version: "v1",
  };
  Object.defineProperty(event, "extra", {
    enumerable: true,
    get() { invoked = true; return "unsafe"; },
  });
  assert.equal(applyNpcEpistemicEvent(emptyState(), event).status, "non_ready");
  assert.equal(invoked, false);
  assert.equal(applyNpcEpistemicEvent(new Proxy(emptyState(), {}), {
    type: "information_received",
    event_ref: "receipt-1",
    source_ref: "message-1",
    source_version: "v1",
  }).status, "non_ready");
});

test("a stable evidence reference cannot ambiguously identify two versions", () => {
  const first = admit(emptyState()).state;
  const result = admit(first, { evidence_version: "v2", source_version: "v2" });
  assert.equal(result.status, "non_ready");
});
