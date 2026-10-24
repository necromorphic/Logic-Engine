import test from "node:test";
import assert from "node:assert/strict";
import { evaluateMemoryCandidateAdmission } from "../src/npc/memory-candidate-eligibility.js";

const request = {
  world_id: "world-a",
  subject_id: "actor-7",
  purpose: "bounded-scene-context",
  snapshot: { world_revision: 12, commit_sequence: 40 },
};

function candidate(overrides = {}) {
  return {
    record: { ref: "memory:claim-1", version: "v3" },
    world_id: request.world_id,
    subject_id: request.subject_id,
    purpose: request.purpose,
    access: { outcome: "allow" },
    content_kind: "claim",
    epistemic_kind: "acquired_report",
    producer: { kind: "test-fixture" },
    lifecycle: {
      content_disposition: "usable",
      source_reconciliation: "current",
      evidence_assessment: "unverified",
      access_outcome: "allow",
      index_health: "ready",
    },
    freshness: { status: "current" },
    snapshot: { ...request.snapshot },
    ...overrides,
  };
}

function completeResult(candidates, overrides = {}) {
  return {
    completeness: "complete",
    access: { outcome: "allow" },
    scope: {
      world_id: request.world_id,
      subject_id: request.subject_id,
      purpose: request.purpose,
    },
    candidates,
    ...overrides,
  };
}

test("admits only the safe reference metadata, never content", () => {
  const result = evaluateMemoryCandidateAdmission(request, completeResult([
    candidate({ content: "restricted raw text", title: "secret title" }),
  ]));

  assert.equal(result.status, "ready");
  assert.deepEqual(result.admitted, [{
    record_ref: "memory:claim-1",
    record_version: "v3",
    epistemic_kind: "acquired_report",
  }]);
  assert.equal(JSON.stringify(result).includes("restricted raw text"), false);
  assert.equal(JSON.stringify(result).includes("secret title"), false);
});

test("fails closed when trusted scope is missing", () => {
  const result = evaluateMemoryCandidateAdmission({ ...request, subject_id: "" }, completeResult([candidate()]));
  assert.equal(result.status, "non_ready");
  assert.equal(result.reason, "trusted_scope_incomplete");
  assert.deepEqual(result.admitted, []);
});

test("rejects candidates from another world", () => {
  const result = evaluateMemoryCandidateAdmission(request, completeResult([
    candidate({ world_id: "world-b" }),
  ]));
  assert.equal(result.status, "non_ready");
  assert.deepEqual(result.admitted, []);
  assert.deepEqual(result.rejected, [{ reason: "scope_mismatch" }]);
});

test("missing, denied, withheld, and ambiguous access are all non-admissible", () => {
  for (const access of [undefined, {}, { outcome: "deny" }, { outcome: "withheld" }, { outcome: "unknown" }]) {
    const result = evaluateMemoryCandidateAdmission(request, completeResult([
      candidate({ access }),
    ]));
    assert.equal(result.status, "non_ready");
    assert.deepEqual(result.admitted, []);
    assert.deepEqual(result.rejected, [{ reason: "access_not_allowed" }]);
  }
});

test("access decision is bound to the requested subject and purpose", () => {
  for (const overrides of [{ subject_id: "actor-other" }, { purpose: "different-purpose" }]) {
    const result = evaluateMemoryCandidateAdmission(request, completeResult([candidate(overrides)]));
    assert.equal(result.status, "non_ready");
    assert.deepEqual(result.admitted, []);
  }
});

test("missing identity, version, or epistemic kind fails closed", () => {
  for (const overrides of [
    { record: { ref: "memory:claim-1" } },
    { record: { version: "v3" } },
    { epistemic_kind: "mystery" },
    { epistemic_kind: undefined },
  ]) {
    const result = evaluateMemoryCandidateAdmission(request, completeResult([candidate(overrides)]));
    assert.equal(result.status, "non_ready");
    assert.deepEqual(result.admitted, []);
  }
});

test("missing or empty producer provenance fails closed", () => {
  for (const producer of [undefined, {}, { kind: "" }]) {
    const result = evaluateMemoryCandidateAdmission(request, completeResult([
      candidate({ producer }),
    ]));
    assert.equal(result.status, "non_ready");
    assert.deepEqual(result.admitted, []);
    assert.deepEqual(result.rejected, [{ reason: "producer_provenance_incomplete" }]);
  }
});

test("every missing lifecycle dimension fails closed", () => {
  const validLifecycle = candidate().lifecycle;
  for (const field of [
    "content_disposition",
    "source_reconciliation",
    "evidence_assessment",
    "access_outcome",
    "index_health",
  ]) {
    const lifecycle = { ...validLifecycle };
    delete lifecycle[field];
    const result = evaluateMemoryCandidateAdmission(request, completeResult([
      candidate({ lifecycle }),
    ]));
    assert.equal(result.status, "non_ready");
    assert.deepEqual(result.admitted, []);
    assert.deepEqual(result.rejected, [{ reason: "lifecycle_dimensions_incomplete" }]);
  }

  const unknownLifecycleValues = candidate({
    lifecycle: {
      content_disposition: "owner-value-a",
      source_reconciliation: "owner-value-b",
      evidence_assessment: "owner-value-c",
      access_outcome: "owner-value-d",
      index_health: "owner-value-e",
    },
  });
  const unknownResult = evaluateMemoryCandidateAdmission(request, completeResult([unknownLifecycleValues]));
  assert.equal(unknownResult.status, "non_ready");
  assert.deepEqual(unknownResult.rejected, [{ reason: "lifecycle_not_admissible" }]);
});

test("lifecycle deny, stale source, unusable content, and unhealthy index fail closed", () => {
  const variants = [
    { content_disposition: "deleted" },
    { source_reconciliation: "pending_reconciliation" },
    { access_outcome: "deny" },
    { index_health: "rebuilding" },
  ];

  for (const lifecycleChange of variants) {
    const result = evaluateMemoryCandidateAdmission(request, completeResult([
      candidate({ lifecycle: { ...candidate().lifecycle, ...lifecycleChange } }),
    ]));
    assert.equal(result.status, "non_ready");
    assert.deepEqual(result.admitted, []);
    assert.deepEqual(result.rejected, [{ reason: "lifecycle_not_admissible" }]);
  }
});

test("missing or unknown content kind fails closed", () => {
  for (const content_kind of [undefined, "mystery", ""]) {
    const result = evaluateMemoryCandidateAdmission(request, completeResult([
      candidate({ content_kind }),
    ]));
    assert.equal(result.status, "non_ready");
    assert.deepEqual(result.admitted, []);
    assert.deepEqual(result.rejected, [{ reason: "content_kind_unknown" }]);
  }
});

test("known non-summary content kinds are explicit and summaries still require lineage", () => {
  for (const content_kind of ["claim", "report", "author_initial", "imported", "inference"]) {
    const result = evaluateMemoryCandidateAdmission(request, completeResult([
      candidate({ content_kind }),
    ]));
    assert.equal(result.status, "ready");
  }
  const summaryWithoutLineage = candidate({ content_kind: "summary" });
  const result = evaluateMemoryCandidateAdmission(request, completeResult([summaryWithoutLineage]));
  assert.equal(result.status, "non_ready");
  assert.deepEqual(result.rejected, [{ reason: "lineage_not_safe" }]);
});

test("stale, retracted, unavailable, and unknown freshness are not current knowledge", () => {
  for (const status of ["stale", "retracted", "unavailable", "unknown", undefined]) {
    const result = evaluateMemoryCandidateAdmission(request, completeResult([
      candidate({ freshness: { status } }),
    ]));
    assert.equal(result.status, "non_ready");
    assert.deepEqual(result.admitted, []);
    assert.deepEqual(result.rejected, [{ reason: "source_not_current" }]);
  }
});

test("malformed trusted or candidate snapshots fail closed", () => {
  for (const snapshot of [{}, { world_revision: 12 }, { world_revision: "", commit_sequence: 40 }]) {
    const result = evaluateMemoryCandidateAdmission(
      { ...request, snapshot },
      completeResult([candidate()]),
    );
    assert.equal(result.status, "non_ready");
    assert.equal(result.reason, "trusted_snapshot_incomplete");
    assert.deepEqual(result.admitted, []);
  }

  for (const snapshot of [undefined, {}, { world_revision: 12 }, { world_revision: 12, commit_sequence: "" }]) {
    const result = evaluateMemoryCandidateAdmission(request, completeResult([
      candidate({ snapshot }),
    ]));
    assert.equal(result.status, "non_ready");
    assert.deepEqual(result.admitted, []);
    assert.deepEqual(result.rejected, [{ reason: "snapshot_mismatch" }]);
  }
});

test("snapshot mismatch is rejected when request requires a snapshot", () => {
  const result = evaluateMemoryCandidateAdmission(request, completeResult([
    candidate({ snapshot: { world_revision: 12, commit_sequence: 39 } }),
  ]));
  assert.equal(result.status, "non_ready");
  assert.deepEqual(result.admitted, []);
  assert.deepEqual(result.rejected, [{ reason: "snapshot_mismatch" }]);
});

test("a derived summary requires complete lineage and current authorized sources", () => {
  const summary = candidate({
    content_kind: "summary",
    lineage: {
      status: "complete",
      sources: [
        { ref: "source:a", version: "1", world_id: request.world_id, access: { outcome: "allow", subject_id: request.subject_id, purpose: request.purpose }, freshness: { status: "current" } },
        { ref: "source:b", version: "4", world_id: request.world_id, access: { outcome: "allow", subject_id: request.subject_id, purpose: request.purpose }, freshness: { status: "current" } },
      ],
    },
  });
  assert.equal(evaluateMemoryCandidateAdmission(request, completeResult([summary])).status, "ready");

  const unsafeVariants = [
    { ...summary, lineage: { status: "unavailable", sources: [] } },
    { ...summary, lineage: { status: "complete", sources: [{ ref: "source:a", version: "1", world_id: request.world_id, access: { outcome: "allow", subject_id: request.subject_id, purpose: request.purpose }, freshness: { status: "current" } }, { ref: "source:b", version: "4", world_id: request.world_id, access: { outcome: "deny", subject_id: request.subject_id, purpose: request.purpose }, freshness: { status: "current" } }] } },
    { ...summary, lineage: { status: "complete", sources: [{ ref: "source:a", version: "1", world_id: request.world_id, access: { outcome: "allow", subject_id: request.subject_id, purpose: request.purpose }, freshness: { status: "stale" } }] } },
    { ...summary, lineage: { status: "complete", sources: [{ ref: "source:a", world_id: request.world_id, access: { outcome: "allow", subject_id: request.subject_id, purpose: request.purpose }, freshness: { status: "current" } }] } },
  ];

  for (const unsafe of unsafeVariants) {
    const result = evaluateMemoryCandidateAdmission(request, completeResult([unsafe]));
    assert.equal(result.status, "non_ready");
    assert.deepEqual(result.admitted, []);
    assert.deepEqual(result.rejected, [{ reason: "lineage_not_safe" }]);
  }
});

test("summary lineage sources must match the requested world, subject, and purpose", () => {
  const baseSource = {
    ref: "source:a",
    version: "1",
    world_id: request.world_id,
    access: { outcome: "allow", subject_id: request.subject_id, purpose: request.purpose },
    freshness: { status: "current" },
  };
  for (const source of [
    { ...baseSource, world_id: "world-b" },
    { ...baseSource, access: { ...baseSource.access, subject_id: "actor-other" } },
    { ...baseSource, access: { ...baseSource.access, purpose: "other-purpose" } },
  ]) {
    const summary = candidate({ content_kind: "summary", lineage: { status: "complete", sources: [source] } });
    const result = evaluateMemoryCandidateAdmission(request, completeResult([summary]));
    assert.equal(result.status, "non_ready");
    assert.deepEqual(result.rejected, [{ reason: "lineage_not_safe" }]);
  }
});

test("duplicate record/version is admitted once without text-based identity", () => {
  const first = candidate({ content: "first wording" });
  const duplicate = candidate({ content: "different wording" });
  const result = evaluateMemoryCandidateAdmission(request, completeResult([first, duplicate]));

  assert.equal(result.status, "partial");
  assert.equal(result.admitted.length, 1);
  assert.deepEqual(result.rejected, [{ reason: "duplicate_record_version" }]);
});

test("partial or unavailable retrieval is not treated as an empty complete result", () => {
  for (const resultInput of [
    { completeness: "partial", candidates: [] },
    { completeness: "unavailable", candidates: [] },
    { candidates: [] },
    null,
  ]) {
    const result = evaluateMemoryCandidateAdmission(request, resultInput);
    assert.equal(result.status, "non_ready");
    assert.equal(result.reason, "result_incomplete_or_unavailable");
    assert.deepEqual(result.admitted, []);
  }
});

test("a complete authorized empty result is not proof that the subject knows nothing", () => {
  const result = evaluateMemoryCandidateAdmission(request, completeResult([]));
  assert.equal(result.status, "ready");
  assert.deepEqual(result.admitted, []);
  assert.equal(result.reason, null);
});

test("empty denied, withheld, or scope-mismatched results fail closed", () => {
  const variants = [
    completeResult([], { access: { outcome: "deny" } }),
    completeResult([], { access: { outcome: "withheld" } }),
    completeResult([], { scope: { ...request, purpose: "other-purpose" } }),
    completeResult([], { scope: undefined }),
  ];

  for (const input of variants) {
    const result = evaluateMemoryCandidateAdmission(request, input);
    assert.equal(result.status, "non_ready");
    assert.equal(result.reason, "request_access_or_scope_unconfirmed");
    assert.deepEqual(result.admitted, []);
  }
});

test("candidate rejection output does not leak rejected record identifiers", () => {
  const result = evaluateMemoryCandidateAdmission(request, completeResult([
    candidate({
      record: { ref: "restricted-secret-record", version: "v1" },
      access: { outcome: "withheld" },
      title: "sensitive title",
    }),
  ]));

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("restricted-secret-record"), false);
  assert.equal(serialized.includes("sensitive title"), false);
});

test("candidate admission never mutates acquisition, delivery, belief, or canonical state", () => {
  const semanticState = {
    acquisition: [{ id: "existing-acquisition" }],
    delivery: [{ id: "existing-delivery" }],
    belief: [{ id: "existing-belief" }],
    canonical: [{ id: "canonical-fact" }],
  };
  const before = structuredClone(semanticState);

  evaluateMemoryCandidateAdmission(request, completeResult([candidate()]));

  assert.deepEqual(semanticState, before);
});
