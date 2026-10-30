import test from "node:test";
import assert from "node:assert/strict";
import { applyNpcEpistemicEvent, createNpcEpistemicState, mapMemoryEvidenceToNpcEpistemicStatus } from "../src/npc/epistemic-state.js";

function apply(state, event) {
  return applyNpcEpistemicEvent(state, {
    world_id: "world-a",
    subject_id: "npc-1",
    ...event,
  });
}

function emptyState() {
  const result = createNpcEpistemicState({ world_id: "world-a", subject_id: "npc-1" });
  assert.equal(result.status, "ready");
  return result.state;
}

function admit(state, overrides = {}) {
  return apply(state, {
    type: "evidence_admitted",
    acquisition_ref: "acq-1",
    proposition_ref: "prop-secret-location",
    evidence_ref: "evidence-1",
    evidence_version: "v1",
    source_ref: "source-1",
    source_version: "v1",
    polarity: "supports_true",
    epistemic_status: "confirmed",
    evidence_assessment: "supported",
    ...overrides,
  });
}

test("receiving information does not create evidence or belief", () => {
  const result = apply(emptyState(), {
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
  const first = apply(state, event);
  assert.equal(apply(first.state, event).status, "unchanged");
  assert.equal(apply(first.state, { ...event, source_version: "v2" }).status, "non_ready");
});

test("admitted evidence does not automatically become belief", () => {
  const result = admit(emptyState());
  assert.equal(result.status, "updated");
  assert.equal(result.state.evidence.length, 1);
  assert.deepEqual(result.state.beliefs, []);
});

test("rumor remains a rumor and cannot be promoted into a confirmed belief", () => {
  const admitted = admit(emptyState(), { epistemic_status: "rumor" });
  assert.equal(admitted.status, "updated");
  assert.equal(admitted.state.evidence[0].epistemic_status, "rumor");

  const promoted = apply(admitted.state, {
    type: "belief_updated",
    proposition_ref: "prop-secret-location",
    stance: "believes_true",
    revision_rule_ref: "rule-rumor-is-not-fact",
    evidence_refs: ["evidence-1"],
  });
  assert.equal(promoted.status, "non_ready");
  assert.equal(promoted.reason, "belief_revision_epistemic_status_not_admissible");

  const tentative = apply(admitted.state, {
    type: "belief_updated",
    proposition_ref: "prop-secret-location",
    stance: "suspects_true",
    revision_rule_ref: "rule-rumor-supports-suspicion-only",
    evidence_refs: ["evidence-1"],
  });
  assert.equal(tentative.status, "updated");
  assert.equal(tentative.state.beliefs[0].stance, "suspects_true");
  assert.equal(tentative.state.evidence[0].epistemic_status, "rumor");
});

test("unconfirmed reports, suspicions, and inferences cannot create confirmed belief", () => {
  for (const epistemic_status of ["unconfirmed_report", "suspicion", "inference"]) {
    const admitted = admit(emptyState(), { epistemic_status });
    assert.equal(admitted.status, "updated");
    assert.equal(admitted.state.evidence[0].epistemic_status, epistemic_status);

    const confirmed = apply(admitted.state, {
      type: "belief_updated",
      proposition_ref: "prop-secret-location",
      stance: "believes_true",
      revision_rule_ref: "rule-no-promotion",
      evidence_refs: ["evidence-1"],
    });
    assert.equal(confirmed.status, "non_ready", epistemic_status);

    const tentative = apply(admitted.state, {
      type: "belief_updated",
      proposition_ref: "prop-secret-location",
      stance: "suspects_true",
      revision_rule_ref: "rule-tentative-only",
      evidence_refs: ["evidence-1"],
    });
    assert.equal(tentative.status, "updated", epistemic_status);
    assert.equal(tentative.state.evidence[0].epistemic_status, epistemic_status);
  }
});

test("unknown epistemic status is retained but cannot influence a belief", () => {
  const admitted = admit(emptyState(), { epistemic_status: "unknown" });
  assert.equal(admitted.status, "updated");
  assert.equal(admitted.state.evidence[0].epistemic_status, "unknown");

  for (const stance of ["believes_true", "suspects_true", "unresolved"]) {
    const result = apply(admitted.state, {
      type: "belief_updated",
      proposition_ref: "prop-secret-location",
      stance,
      revision_rule_ref: "rule-unknown-is-not-evidence",
      evidence_refs: ["evidence-1"],
    });
    assert.equal(result.status, "non_ready", stance);
  }
});

test("epistemic status and evidence assessment are required; conflicting status reuse is rejected", () => {
  const state = emptyState();
  const missing = apply(state, {
    type: "evidence_admitted",
    acquisition_ref: "acq-1",
    proposition_ref: "prop-secret-location",
    evidence_ref: "evidence-1",
    evidence_version: "v1",
    source_ref: "source-1",
    source_version: "v1",
    polarity: "supports_true",
  });
  assert.equal(missing.status, "non_ready");

  const first = admit(state, { epistemic_status: "rumor" });
  const conflict = admit(first.state, { epistemic_status: "confirmed" });
  assert.equal(conflict.status, "non_ready");
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
  const result = apply(state, event);
  assert.equal(result.status, "updated");
  assert.equal(result.state.beliefs[0].stance, "believes_true");
  assert.deepEqual(result.state.beliefs[0].supporting_evidence_refs, ["evidence-1"]);
  assert.deepEqual(result.state.beliefs[0].conflicting_evidence_refs, []);
  const replay = apply(result.state, event);
  assert.equal(replay.status, "unchanged");
  assert.equal(replay.state, result.state);
  assert.equal(apply(state, { ...event, evidence_refs: ["missing"] }).status, "non_ready");
  assert.equal(apply(state, { ...event, revision_rule_ref: "" }).status, "non_ready");
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
  const result = apply(state, {
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
  state = apply(state, {
    type: "belief_updated",
    proposition_ref: "prop-secret-location",
    stance: "believes_true",
    revision_rule_ref: "rule-initial",
    evidence_refs: ["evidence-1"],
  }).state;
  const result = apply(state, {
    type: "evidence_invalidated",
    evidence_ref: "evidence-1",
    evidence_version: "v1",
    invalidation_rule_ref: "rule-source-revoked",
  });
  assert.equal(result.status, "updated");
  assert.equal(result.state.beliefs[0].stance, "believes_true");
  assert.equal(result.state.beliefs[0].review_required, true);
  assert.equal(result.state.evidence[0].status, "invalidated");
  assert.equal(result.state.evidence[0].invalidation_rule_ref, "rule-source-revoked");
  assert.equal(apply(result.state, {
    type: "evidence_invalidated",
    evidence_ref: "evidence-1",
    evidence_version: "v1",
    invalidation_rule_ref: "rule-source-revoked",
  }).status, "unchanged");
  assert.equal(apply(result.state, {
    type: "evidence_invalidated",
    evidence_ref: "evidence-1",
    evidence_version: "v1",
    invalidation_rule_ref: "rule-different-cause",
  }).status, "non_ready");
  assert.equal(apply(result.state, {
    type: "belief_updated",
    proposition_ref: "prop-secret-location",
    stance: "believes_true",
    revision_rule_ref: "rule-invalid-source",
    evidence_refs: ["evidence-1"],
  }).status, "non_ready");
});

test("replacement source version does not silently refresh an acquired belief", () => {
  let state = admit(emptyState(), {
    evidence_ref: "evidence-source-a",
    evidence_version: "source-version-a",
    source_ref: "canonical-fact",
    source_version: "source-version-a",
  }).state;
  state = apply(state, {
    type: "belief_updated",
    proposition_ref: "prop-secret-location",
    stance: "believes_true",
    revision_rule_ref: "rule-acquire-a",
    evidence_refs: ["evidence-source-a"],
  }).state;

  state = apply(state, {
    type: "evidence_invalidated",
    evidence_ref: "evidence-source-a",
    evidence_version: "source-version-a",
    invalidation_rule_ref: "rule-source-a-rolled-back",
  }).state;

  const replacement = admit(state, {
    evidence_ref: "evidence-source-b",
    evidence_version: "source-version-b",
    acquisition_ref: "acq-source-b",
    source_ref: "canonical-fact",
    source_version: "source-version-b",
    polarity: "supports_false",
  });
  assert.equal(replacement.status, "updated");
  state = replacement.state;

  // A new source version is evidence available for evaluation, not an
  // acquisition/revision event for the already-held belief.
  assert.equal(state.beliefs[0].stance, "believes_true");
  assert.equal(state.beliefs[0].review_required, true);
  assert.deepEqual(state.beliefs[0].supporting_evidence_refs, ["evidence-source-a"]);

  const reacquired = apply(state, {
    type: "belief_updated",
    proposition_ref: "prop-secret-location",
    stance: "believes_false",
    revision_rule_ref: "rule-explicit-reacquisition-b",
    evidence_refs: ["evidence-source-b"],
  });
  assert.equal(reacquired.status, "updated");
  assert.equal(reacquired.state.beliefs[0].stance, "believes_false");
  assert.equal(reacquired.state.beliefs[0].review_required, false);
  assert.deepEqual(reacquired.state.beliefs[0].supporting_evidence_refs, ["evidence-source-b"]);
});

test("forgetting is explicit and traceable; it does not delete evidence history", () => {
  let state = admit(emptyState()).state;
  state = apply(state, {
    type: "belief_updated",
    proposition_ref: "prop-secret-location",
    stance: "believes_true",
    revision_rule_ref: "rule-initial",
    evidence_refs: ["evidence-1"],
  }).state;
  const result = apply(state, {
    type: "belief_forgotten",
    proposition_ref: "prop-secret-location",
    forgetting_rule_ref: "rule-memory-decay",
  });
  assert.equal(result.status, "updated");
  assert.equal(result.state.beliefs[0].stance, "unknown");
  assert.deepEqual(result.state.beliefs[0].supporting_evidence_refs, []);
  assert.deepEqual(result.state.beliefs[0].conflicting_evidence_refs, []);
  assert.equal(result.state.beliefs[0].history.length, 1);
  assert.deepEqual(result.state.beliefs[0].history[0].evidence_refs, ["evidence-1"]);
  assert.equal(result.state.evidence.length, 1);
  const replay = apply(result.state, {
    type: "belief_forgotten",
    proposition_ref: "prop-secret-location",
    forgetting_rule_ref: "rule-memory-decay",
  });
  assert.equal(replay.status, "unchanged");
  assert.equal(replay.state, result.state);
});

test("canonical truth changes do not silently correct NPC beliefs", () => {
  let state = admit(emptyState()).state;
  state = apply(state, {
    type: "belief_updated",
    proposition_ref: "prop-secret-location",
    stance: "believes_true",
    revision_rule_ref: "rule-initial",
    evidence_refs: ["evidence-1"],
  }).state;
  const result = apply(state, { type: "canonical_truth_changed" });
  assert.equal(result.status, "unchanged");
  assert.equal(result.state, state);
  assert.equal(result.state.beliefs[0].stance, "believes_true");
});

test("unknown events, malformed scope, and sparse evidence lists fail closed", () => {
  assert.equal(createNpcEpistemicState({ world_id: "", subject_id: "npc-1" }).status, "non_ready");
  assert.equal(apply(emptyState(), { type: "unrecognized_event" }).status, "non_ready");
  assert.equal(apply(emptyState(), { type: "constructor" }).status, "non_ready");
  assert.equal(apply(emptyState(), { type: "__proto__" }).status, "non_ready");
  const state = admit(emptyState()).state;
  const sparse = [];
  sparse.length = 1;
  assert.equal(apply(state, {
    type: "belief_updated",
    proposition_ref: "prop-secret-location",
    stance: "believes_true",
    revision_rule_ref: "rule-x",
    evidence_refs: sparse,
  }).status, "non_ready");

  const withOutOfRangeArrayProperty = ["evidence-1"];
  Object.defineProperty(withOutOfRangeArrayProperty, "4294967295", { value: "unrecognized", enumerable: true });
  assert.equal(apply(state, {
    type: "belief_updated",
    proposition_ref: "prop-secret-location",
    stance: "believes_true",
    revision_rule_ref: "rule-x",
    evidence_refs: withOutOfRangeArrayProperty,
  }).status, "non_ready");
});

test("reducer does not mutate input state or event", () => {
  const state = emptyState();
  const event = { type: "information_received", event_ref: "receipt-1", source_ref: "message-1", source_version: "v1" };
  const stateBefore = structuredClone(state);
  const eventBefore = structuredClone(event);
  apply(state, event);
  assert.deepEqual(state, stateBefore);
  assert.deepEqual(event, eventBefore);
});

test("nested getters and proxy inputs fail closed without executing getters", () => {
  let invoked = false;
  const event = {
    world_id: "world-a",
    subject_id: "npc-1",
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
    world_id: "world-a",
    subject_id: "npc-1",
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

test("events from another world or subject cannot alter this NPC state", () => {
  const state = emptyState();
  const event = {
    type: "evidence_admitted",
    acquisition_ref: "acq-1",
    proposition_ref: "prop-secret-location",
    evidence_ref: "evidence-1",
    evidence_version: "v1",
    source_ref: "source-1",
    source_version: "v1",
    polarity: "supports_true",
    epistemic_status: "unconfirmed_report",
    evidence_assessment: "supported",
  };
  assert.equal(apply(state, { ...event, world_id: "world-other" }).status, "non_ready");
  assert.equal(apply(state, { ...event, subject_id: "npc-other" }).status, "non_ready");
  assert.deepEqual(state.evidence, []);
});

test("history cannot reference evidence for another proposition", () => {
  const state = admit(emptyState()).state;
  const second = admit(state, {
    evidence_ref: "evidence-2",
    proposition_ref: "prop-another-fact",
    acquisition_ref: "acq-2",
    source_ref: "source-2",
  }).state;
  const malformed = structuredClone(second);
  malformed.beliefs = [{
    proposition_ref: "prop-secret-location",
    stance: "unknown",
    supporting_evidence_refs: [],
    conflicting_evidence_refs: [],
    revision_rule_ref: "rule-initial",
    review_required: false,
    history: [{
      stance: "believes_true",
      revision_rule_ref: "rule-initial",
      evidence_refs: ["evidence-2"],
    }],
  }];
  assert.equal(applyNpcEpistemicEvent(malformed, {
    world_id: "world-a",
    subject_id: "npc-1",
    type: "canonical_truth_changed",
  }).status, "non_ready");
});

test("state validation rejects unknown beliefs with active evidence and unreviewed invalidation", () => {
  let state = admit(emptyState()).state;
  state = apply(state, {
    type: "belief_updated",
    proposition_ref: "prop-secret-location",
    stance: "believes_true",
    revision_rule_ref: "rule-initial",
    evidence_refs: ["evidence-1"],
  }).state;

  const unknownWithEvidence = structuredClone(state);
  unknownWithEvidence.beliefs[0].stance = "unknown";
  assert.equal(applyNpcEpistemicEvent(unknownWithEvidence, {
    world_id: "world-a",
    subject_id: "npc-1",
    type: "canonical_truth_changed",
  }).status, "non_ready");

  const invalidatedWithoutReview = structuredClone(state);
  invalidatedWithoutReview.evidence[0].status = "invalidated";
  invalidatedWithoutReview.evidence[0].invalidation_rule_ref = "rule-source-revoked";
  assert.equal(applyNpcEpistemicEvent(invalidatedWithoutReview, {
    world_id: "world-a",
    subject_id: "npc-1",
    type: "canonical_truth_changed",
  }).status, "non_ready");
});

test("event schemas reject unknown fields even when the value is ordinary data", () => {
  const state = emptyState();
  const event = {
    type: "information_received",
    event_ref: "receipt-extra",
    source_ref: "message-extra",
    source_version: "v1",
    unrecognized_metadata: "must-not-be-silently-ignored",
  };
  const result = apply(state, event);
  assert.equal(result.status, "non_ready");
  assert.equal(result.reason, "event_shape_invalid");
  assert.deepEqual(state.received, []);
});

test("event type validation never executes inherited or own accessors", () => {
  const original = Object.getOwnPropertyDescriptor(Object.prototype, "type");
  if (original && original.configurable === false) return;
  let inheritedGetterCalls = 0;
  let ownGetterCalls = 0;
  try {
    Object.defineProperty(Object.prototype, "type", {
      configurable: true,
      get() {
        inheritedGetterCalls += 1;
        throw new Error("inherited type getter must not execute");
      },
    });
    const missingType = {
      world_id: "world-a",
      subject_id: "npc-1",
    };
    const missingResult = applyNpcEpistemicEvent(emptyState(), missingType);
    assert.equal(missingResult.status, "non_ready");
    assert.equal(inheritedGetterCalls, 0);

    const ownAccessor = {
      world_id: "world-a",
      subject_id: "npc-1",
    };
    Object.defineProperty(ownAccessor, "type", {
      enumerable: true,
      get() {
        ownGetterCalls += 1;
        throw new Error("own type getter must not execute");
      },
    });
    const accessorResult = applyNpcEpistemicEvent(emptyState(), ownAccessor);
    assert.equal(accessorResult.status, "non_ready");
    assert.equal(ownGetterCalls, 0);
    assert.equal(inheritedGetterCalls, 0);
  } finally {
    if (original) Object.defineProperty(Object.prototype, "type", original);
    else delete Object.prototype.type;
  }
});

test("revoked proxies fail closed in state and event inputs", () => {
  const revokedEvent = Proxy.revocable({}, {});
  revokedEvent.revoke();
  assert.equal(applyNpcEpistemicEvent(emptyState(), revokedEvent.proxy).status, "non_ready");

  const revokedState = Proxy.revocable(emptyState(), {});
  revokedState.revoke();
  assert.equal(applyNpcEpistemicEvent(revokedState.proxy, {
    world_id: "world-a",
    subject_id: "npc-1",
    type: "canonical_truth_changed",
  }).status, "non_ready");
});

test("unsupported primitive values fail closed in event metadata", () => {
  const base = {
    world_id: "world-a",
    subject_id: "npc-1",
    type: "information_received",
    event_ref: "receipt-unsafe",
    source_ref: "source-1",
    source_version: "v1",
  };
  assert.equal(applyNpcEpistemicEvent(emptyState(), { ...base, extra: () => "not data" }).status, "non_ready");
  assert.equal(applyNpcEpistemicEvent(emptyState(), { ...base, extra: Number.NaN }).status, "non_ready");
  assert.equal(applyNpcEpistemicEvent(emptyState(), { ...base, extra: undefined }).status, "non_ready");
});

test("state validation rejects unknown fields that could bypass shallow freezing", () => {
  const state = admit(emptyState()).state;

  const withNestedEvidenceExtension = structuredClone(state);
  withNestedEvidenceExtension.evidence[0].extension = { nested: { mutable: true } };
  assert.equal(applyNpcEpistemicEvent(withNestedEvidenceExtension, {
    world_id: "world-a",
    subject_id: "npc-1",
    type: "canonical_truth_changed",
  }).status, "non_ready");

  const withTopLevelExtension = structuredClone(state);
  withTopLevelExtension.extension = { mutable: true };
  assert.equal(applyNpcEpistemicEvent(withTopLevelExtension, {
    world_id: "world-a",
    subject_id: "npc-1",
    type: "canonical_truth_changed",
  }).status, "non_ready");
});

test("state validation rejects unknown fields in receipt, belief, and history records", () => {
  const received = apply(emptyState(), {
    type: "information_received",
    event_ref: "receipt-shape",
    source_ref: "message-shape",
    source_version: "v1",
  }).state;
  const withReceiptExtension = structuredClone(received);
  withReceiptExtension.received[0].extension = { mutable: true };
  assert.equal(apply(withReceiptExtension, { type: "canonical_truth_changed" }).status, "non_ready");

  let withBelief = admit(emptyState()).state;
  withBelief = apply(withBelief, {
    type: "belief_updated",
    proposition_ref: "prop-secret-location",
    stance: "believes_true",
    revision_rule_ref: "rule-first",
    evidence_refs: ["evidence-1"],
  }).state;

  const withBeliefExtension = structuredClone(withBelief);
  withBeliefExtension.beliefs[0].extension = { mutable: true };
  assert.equal(apply(withBeliefExtension, { type: "canonical_truth_changed" }).status, "non_ready");

  const withHistory = apply(withBelief, {
    type: "belief_updated",
    proposition_ref: "prop-secret-location",
    stance: "suspects_true",
    revision_rule_ref: "rule-second",
    evidence_refs: ["evidence-1"],
  }).state;
  const withHistoryExtension = structuredClone(withHistory);
  withHistoryExtension.beliefs[0].history[0].extension = { mutable: true };
  assert.equal(apply(withHistoryExtension, { type: "canonical_truth_changed" }).status, "non_ready");
});

test("serialized failure diagnostics do not disclose rejected evidence identifiers or content", () => {
  const secretMarkers = [
    "private-record-7f31",
    "private-source-9a42",
    "private-claim-text-do-not-disclose",
    "private-acquisition-6b12",
  ];
  const result = applyNpcEpistemicEvent(emptyState(), {
    world_id: "world-other",
    subject_id: "npc-1",
    type: "evidence_admitted",
    evidence_ref: secretMarkers[0],
    source_ref: secretMarkers[1],
    proposition_ref: secretMarkers[2],
    acquisition_ref: secretMarkers[3],
    evidence_version: "v-secret",
    source_version: "v-secret",
    polarity: "supports_true",
    epistemic_status: "unconfirmed_report",
    evidence_assessment: "supported",
  });
  assert.equal(result.status, "non_ready");
  const serialized = JSON.stringify(result);
  for (const marker of secretMarkers) {
    assert.equal(serialized.includes(marker), false, `failure diagnostic leaked protected marker: ${marker}`);
  }
});


test("restored belief states require evidence and preserve epistemic restrictions", () => {
  const noEvidence = {
    ...emptyState(),
    beliefs: [{
      proposition_ref: "prop-secret-location",
      stance: "believes_true",
      supporting_evidence_refs: [],
      conflicting_evidence_refs: [],
      revision_rule_ref: "rule-restored",
      review_required: false,
      history: [],
    }],
  };
  assert.equal(apply(noEvidence, { type: "canonical_truth_changed" }).status, "non_ready");

  const tentativeEvidence = admit(emptyState(), { epistemic_status: "rumor" }).state;
  const forgedConfirmedBelief = {
    ...tentativeEvidence,
    beliefs: [{
      proposition_ref: "prop-secret-location",
      stance: "believes_true",
      supporting_evidence_refs: ["evidence-1"],
      conflicting_evidence_refs: [],
      revision_rule_ref: "rule-restored",
      review_required: false,
      history: [],
    }],
  };
  assert.equal(apply(forgedConfirmedBelief, { type: "canonical_truth_changed" }).status, "non_ready");

  const unknownEvidence = admit(emptyState(), { epistemic_status: "unknown" }).state;
  const forgedUnknownBelief = {
    ...unknownEvidence,
    beliefs: [{
      proposition_ref: "prop-secret-location",
      stance: "suspects_true",
      supporting_evidence_refs: ["evidence-1"],
      conflicting_evidence_refs: [],
      revision_rule_ref: "rule-restored",
      review_required: false,
      history: [],
    }],
  };
  assert.equal(apply(forgedUnknownBelief, { type: "canonical_truth_changed" }).status, "non_ready");
});

test("restored directional beliefs require evidence with matching polarity", () => {
  const oppositeEvidence = admit(emptyState(), { polarity: "supports_false" }).state;
  const forgedBelief = {
    ...oppositeEvidence,
    beliefs: [{
      proposition_ref: "prop-secret-location",
      stance: "believes_true",
      supporting_evidence_refs: ["evidence-1"],
      conflicting_evidence_refs: [],
      revision_rule_ref: "rule-restored",
      review_required: false,
      history: [],
    }],
  };
  assert.equal(apply(forgedBelief, { type: "canonical_truth_changed" }).status, "non_ready");
});

test("state validation does not invoke a polluted Array iterator", () => {
  const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
  let getterCalls = 0;
  let result;
  Object.defineProperty(Array.prototype, Symbol.iterator, {
    configurable: true,
    get() {
      getterCalls += 1;
      throw new Error("polluted Array iterator must not execute");
    },
  });
  try {
    result = apply(emptyState(), {
      type: "information_received",
      event_ref: "receipt-polluted-iterator",
      source_ref: "message-1",
      source_version: "v1",
    });
  } finally {
    Object.defineProperty(Array.prototype, Symbol.iterator, descriptor);
  }
  assert.equal(result.status, "updated");
  assert.equal(getterCalls, 0);
});


test("directional and unresolved stances require evidence on the asserted side", () => {
  const supportsFalse = admit(emptyState(), { polarity: "supports_false" }).state;
  for (const stance of ["believes_true", "suspects_true"]) {
    const result = apply(supportsFalse, {
      type: "belief_updated",
      proposition_ref: "prop-secret-location",
      stance,
      revision_rule_ref: "rule-no-opposing-only",
      evidence_refs: ["evidence-1"],
    });
    assert.equal(result.status, "non_ready", stance);
    assert.equal(result.reason, "belief_revision_evidence_does_not_support_stance");
  }

  const onlyOneSide = apply(admit(emptyState()).state, {
    type: "belief_updated",
    proposition_ref: "prop-secret-location",
    stance: "unresolved",
    revision_rule_ref: "rule-conflict-requires-two-sides",
    evidence_refs: ["evidence-1"],
  });
  assert.equal(onlyOneSide.status, "non_ready");
  assert.equal(onlyOneSide.reason, "belief_revision_evidence_does_not_support_stance");

  let conflicting = admit(emptyState()).state;
  conflicting = admit(conflicting, {
    evidence_ref: "evidence-2",
    evidence_version: "v1",
    acquisition_ref: "acq-2",
    source_ref: "source-2",
    source_version: "v1",
    polarity: "supports_false",
  }).state;
  const unresolved = apply(conflicting, {
    type: "belief_updated",
    proposition_ref: "prop-secret-location",
    stance: "unresolved",
    revision_rule_ref: "rule-both-sides",
    evidence_refs: ["evidence-1", "evidence-2"],
  });
  assert.equal(unresolved.status, "updated");
  assert.deepEqual(unresolved.state.beliefs[0].supporting_evidence_refs, ["evidence-1"]);
  assert.deepEqual(unresolved.state.beliefs[0].conflicting_evidence_refs, ["evidence-2"]);
});


test("trusted scope requires own data descriptors for world and subject", () => {
  const previousWorld = Object.getOwnPropertyDescriptor(Object.prototype, "world_id");
  const previousSubject = Object.getOwnPropertyDescriptor(Object.prototype, "subject_id");
  let getterCalls = 0;
  Object.defineProperties(Object.prototype, {
    world_id: {
      configurable: true,
      get() {
        getterCalls += 1;
        throw new Error("inherited world_id getter must not execute");
      },
    },
    subject_id: {
      configurable: true,
      get() {
        getterCalls += 1;
        throw new Error("inherited subject_id getter must not execute");
      },
    },
  });
  let result;
  try {
    result = createNpcEpistemicState({});
  } finally {
    if (previousWorld) Object.defineProperty(Object.prototype, "world_id", previousWorld);
    else delete Object.prototype.world_id;
    if (previousSubject) Object.defineProperty(Object.prototype, "subject_id", previousSubject);
    else delete Object.prototype.subject_id;
  }
  assert.equal(result.status, "non_ready");
  assert.equal(result.reason, "trusted_scope_incomplete");
  assert.equal(getterCalls, 0);
});

test("restored belief history validates directional polarity and unresolved conflict", () => {
  const supportsFalse = admit(emptyState(), { polarity: "supports_false" }).state;
  const forgedDirectionalHistory = {
    ...supportsFalse,
    beliefs: [{
      proposition_ref: "prop-secret-location",
      stance: "unknown",
      supporting_evidence_refs: [],
      conflicting_evidence_refs: [],
      revision_rule_ref: "rule-current",
      review_required: false,
      history: [{
        stance: "believes_true",
        revision_rule_ref: "rule-history",
        evidence_refs: ["evidence-1"],
      }],
    }],
  };
  assert.equal(apply(forgedDirectionalHistory, { type: "canonical_truth_changed" }).status, "non_ready");

  const supportsTrue = admit(emptyState()).state;
  const forgedUnresolvedHistory = {
    ...supportsTrue,
    beliefs: [{
      proposition_ref: "prop-secret-location",
      stance: "unknown",
      supporting_evidence_refs: [],
      conflicting_evidence_refs: [],
      revision_rule_ref: "rule-current",
      review_required: false,
      history: [{
        stance: "unresolved",
        revision_rule_ref: "rule-history",
        evidence_refs: ["evidence-1"],
      }],
    }],
  };
  assert.equal(apply(forgedUnresolvedHistory, { type: "canonical_truth_changed" }).status, "non_ready");
});


test("Memory epistemic classes map conservatively without promoting supported evidence to confirmed", () => {
  assert.equal(mapMemoryEvidenceToNpcEpistemicStatus("acquired_report", "supported"), "unconfirmed_report");
  assert.equal(mapMemoryEvidenceToNpcEpistemicStatus("rumor", "supported"), "rumor");
  assert.equal(mapMemoryEvidenceToNpcEpistemicStatus("inference", "supported"), "inference");
  assert.notEqual(mapMemoryEvidenceToNpcEpistemicStatus("acquired_report", "supported"), "confirmed");
  assert.notEqual(mapMemoryEvidenceToNpcEpistemicStatus("rumor", "supported"), "confirmed");
  assert.notEqual(mapMemoryEvidenceToNpcEpistemicStatus("inference", "supported"), "confirmed");
});

test("disputed Memory evidence preserves its epistemic class for unresolved stance handling", () => {
  assert.equal(mapMemoryEvidenceToNpcEpistemicStatus("acquired_report", "disputed"), "unconfirmed_report");
  assert.equal(mapMemoryEvidenceToNpcEpistemicStatus("rumor", "disputed"), "rumor");
  assert.equal(mapMemoryEvidenceToNpcEpistemicStatus("inference", "disputed"), "inference");
});

test("insufficient Memory evidence maps to unknown and unassessed evidence does not enter belief revision", () => {
  assert.equal(mapMemoryEvidenceToNpcEpistemicStatus("acquired_report", "insufficient"), "unknown");
  assert.equal(mapMemoryEvidenceToNpcEpistemicStatus("rumor", "insufficient"), "unknown");
  assert.equal(mapMemoryEvidenceToNpcEpistemicStatus("inference", "insufficient"), "unknown");
  assert.equal(mapMemoryEvidenceToNpcEpistemicStatus("acquired_report", "unassessed"), null);
  assert.equal(mapMemoryEvidenceToNpcEpistemicStatus("rumor", "unassessed"), null);
  assert.equal(mapMemoryEvidenceToNpcEpistemicStatus("inference", "unassessed"), null);
});

test("canonical, assigned, imported, and suspicion labels are not Memory-to-belief mappings", () => {
  for (const kind of ["canonical", "authored_initial", "imported", "suspicion", "unknown", "confirmed"]) {
    assert.equal(mapMemoryEvidenceToNpcEpistemicStatus(kind, "supported"), null);
  }
  assert.equal(mapMemoryEvidenceToNpcEpistemicStatus("acquired_report", "future-assessment"), null);
});


test("disputed evidence cannot produce a directional stance and requires both sides for unresolved", () => {
  const disputed = admit(emptyState(), { evidence_assessment: "disputed" }).state;
  const directional = apply(disputed, {
    type: "belief_updated",
    proposition_ref: "prop-secret-location",
    stance: "suspects_true",
    revision_rule_ref: "rule-disputed-directional",
    evidence_refs: ["evidence-1"],
  });
  assert.equal(directional.status, "non_ready");

  const opposite = apply(disputed, {
    type: "evidence_admitted",
    acquisition_ref: "acq-2",
    proposition_ref: "prop-secret-location",
    evidence_ref: "evidence-2",
    evidence_version: "v1",
    source_ref: "source-2",
    source_version: "v1",
    polarity: "supports_false",
    epistemic_status: "unconfirmed_report",
    evidence_assessment: "disputed",
  });
  assert.equal(opposite.status, "updated");
  const unresolved = apply(opposite.state, {
    type: "belief_updated",
    proposition_ref: "prop-secret-location",
    stance: "unresolved",
    revision_rule_ref: "rule-disputed-unresolved",
    evidence_refs: ["evidence-1", "evidence-2"],
  });
  assert.equal(unresolved.status, "updated");
  assert.deepEqual(unresolved.state.beliefs[0].supporting_evidence_refs, ["evidence-1"]);
  assert.deepEqual(unresolved.state.beliefs[0].conflicting_evidence_refs, ["evidence-2"]);
});

test("evidence admission requires an explicit recognized assessment", () => {
  const missingAssessment = apply(emptyState(), {
    type: "evidence_admitted",
    acquisition_ref: "acq-1",
    proposition_ref: "prop-secret-location",
    evidence_ref: "evidence-1",
    evidence_version: "v1",
    source_ref: "source-1",
    source_version: "v1",
    polarity: "supports_true",
    epistemic_status: "unconfirmed_report",
  });
  assert.equal(missingAssessment.status, "non_ready");
});
