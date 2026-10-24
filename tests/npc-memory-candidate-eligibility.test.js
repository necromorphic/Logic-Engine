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
    access: { outcome: "allow", subject_id: request.subject_id, purpose: request.purpose },
    content_kind: "claim",
    epistemic_kind: "acquired_report",
    producer: { kind: "test-fixture" },
    lifecycle: {
      content_disposition: "usable",
      source_reconciliation: "current",
      evidence_assessment: "unassessed",
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
    access: { outcome: "allow", subject_id: request.subject_id, purpose: request.purpose },
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
    evidence_assessment: "unassessed",
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
  assert.equal(result.status, "ready");
  assert.deepEqual(result.admitted, []);
});

test("candidate exclusions expose neither per-record reasons nor rejection counts", () => {
  const result = evaluateMemoryCandidateAdmission(request, completeResult([
    candidate({ record: { ref: "restricted:a", version: "1" }, access: { outcome: "deny" } }),
    candidate({ record: { ref: "restricted:b", version: "2" }, access: { outcome: "withheld" } }),
    candidate({ record: { ref: "restricted:c", version: "3" }, content_kind: "unknown" }),
  ]));
  assert.equal(result.status, "ready");
  assert.deepEqual(result.admitted, []);
  assert.equal(JSON.stringify(result).includes("restricted:"), false);
  assert.equal(JSON.stringify(result).includes("access_not_allowed"), false);
  assert.equal(JSON.stringify(result).includes("rejected"), false);
  assert.deepEqual(result, evaluateMemoryCandidateAdmission(request, completeResult([])));
});

test("missing, denied, withheld, and ambiguous access are all non-admissible", () => {
  for (const access of [undefined, {}, { outcome: "deny" }, { outcome: "withheld" }, { outcome: "unknown" }]) {
    const result = evaluateMemoryCandidateAdmission(request, completeResult([
      candidate({ access }),
    ]));
    assert.equal(result.status, "ready");
    assert.deepEqual(result.admitted, []);
  }
});

test("candidate access decision must bind allow to the requested subject and purpose", () => {
  for (const access of [
    { outcome: "allow" },
    { outcome: "allow", subject_id: "actor-other", purpose: request.purpose },
    { outcome: "allow", subject_id: request.subject_id, purpose: "different-purpose" },
  ]) {
    const result = evaluateMemoryCandidateAdmission(request, completeResult([candidate({ access })]));
    assert.equal(result.status, "ready");
    assert.deepEqual(result.admitted, []);
  }
});

test("request-level access decision must bind allow to the requested subject and purpose", () => {
  for (const access of [
    { outcome: "allow" },
    { outcome: "allow", subject_id: "actor-other", purpose: request.purpose },
    { outcome: "allow", subject_id: request.subject_id, purpose: "different-purpose" },
  ]) {
    const result = evaluateMemoryCandidateAdmission(request, completeResult([], { access }));
    assert.equal(result.status, "non_ready");
    assert.equal(result.reason, "request_access_or_scope_unconfirmed");
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
    assert.equal(result.status, "ready");
    assert.deepEqual(result.admitted, []);
  }
});

test("missing or empty producer provenance fails closed", () => {
  for (const producer of [undefined, {}, { kind: "" }]) {
    const result = evaluateMemoryCandidateAdmission(request, completeResult([
      candidate({ producer }),
    ]));
    assert.equal(result.status, "ready");
    assert.deepEqual(result.admitted, []);
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
    assert.equal(result.status, "ready");
    assert.deepEqual(result.admitted, []);
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
  assert.equal(unknownResult.status, "ready");
  assert.deepEqual(unknownResult.admitted, []);
});

test("known evidence assessments are preserved; unknown assessments fail closed", () => {
  for (const evidence_assessment of ["unassessed", "supported", "disputed", "insufficient"]) {
    const result = evaluateMemoryCandidateAdmission(request, completeResult([
      candidate({ lifecycle: { ...candidate().lifecycle, evidence_assessment } }),
    ]));
    assert.equal(result.status, "ready");
    assert.deepEqual(result.admitted, [{
      record_ref: "memory:claim-1",
      record_version: "v3",
      epistemic_kind: "acquired_report",
      evidence_assessment,
    }]);
  }

  for (const evidence_assessment of ["", "unknown", "verified_truth", undefined]) {
    const result = evaluateMemoryCandidateAdmission(request, completeResult([
      candidate({ lifecycle: { ...candidate().lifecycle, evidence_assessment } }),
    ]));
    assert.equal(result.status, "ready");
    assert.deepEqual(result.admitted, []);
  }
});

test("lifecycle deny, stale source, unusable content, and unhealthy index fail closed", () => {
  const variants = [
    { content_disposition: "deleted" },
    { content_disposition: "superseded" },
    { source_reconciliation: "pending_reconciliation" },
    { source_reconciliation: "stale" },
    { source_reconciliation: "retracted" },
    { source_reconciliation: "unavailable" },
    { access_outcome: "deny" },
    { access_outcome: "withheld" },
    { access_outcome: "unknown" },
    { index_health: "stale" },
    { index_health: "rebuilding" },
    { index_health: "unavailable" },
    { index_health: "failed" },
  ];

  for (const lifecycleChange of variants) {
    const result = evaluateMemoryCandidateAdmission(request, completeResult([
      candidate({ lifecycle: { ...candidate().lifecycle, ...lifecycleChange } }),
    ]));
    assert.equal(result.status, "ready");
    assert.deepEqual(result.admitted, []);
  }
});

test("missing or unknown content kind fails closed", () => {
  for (const content_kind of [undefined, "mystery", ""]) {
    const result = evaluateMemoryCandidateAdmission(request, completeResult([
      candidate({ content_kind }),
    ]));
    assert.equal(result.status, "ready");
    assert.deepEqual(result.admitted, []);
  }
});

test("known non-summary content kinds are explicit and summaries still require lineage", () => {
  for (const content_kind of ["claim", "report", "author_initial", "imported", "inference"]) {
    const result = evaluateMemoryCandidateAdmission(request, completeResult([
      candidate({ content_kind }),
    ]));
    assert.equal(result.status, "ready");
    assert.equal(result.admitted.length, 1);
  }
  const summaryWithoutLineage = candidate({ content_kind: "summary" });
  const result = evaluateMemoryCandidateAdmission(request, completeResult([summaryWithoutLineage]));
  assert.equal(result.status, "ready");
  assert.deepEqual(result.admitted, []);
});

test("conflicting eligible claims remain distinct and are not adjudicated by admission", () => {
  const first = candidate({
    record: { ref: "memory:claim-a", version: "v1" },
    content_kind: "claim",
    epistemic_kind: "acquired_report",
    lifecycle: { ...candidate().lifecycle, evidence_assessment: "disputed" },
  });
  const second = candidate({
    record: { ref: "memory:claim-b", version: "v7" },
    content_kind: "report",
    epistemic_kind: "rumor",
    lifecycle: { ...candidate().lifecycle, evidence_assessment: "insufficient" },
  });
  const result = evaluateMemoryCandidateAdmission(request, completeResult([first, second]));
  assert.equal(result.status, "ready");
  assert.equal(result.admitted.length, 2);
  assert.deepEqual(result.admitted.map(item => item.epistemic_kind), ["acquired_report", "rumor"]);
});

test("stale, retracted, unavailable, and unknown freshness are not current knowledge", () => {
  for (const status of ["stale", "retracted", "unavailable", "unknown", undefined]) {
    const result = evaluateMemoryCandidateAdmission(request, completeResult([
      candidate({ freshness: { status } }),
    ]));
    assert.equal(result.status, "ready");
    assert.deepEqual(result.admitted, []);
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
    assert.equal(result.status, "ready");
    assert.deepEqual(result.admitted, []);
  }
});

test("snapshot mismatch is rejected when request requires a snapshot", () => {
  const result = evaluateMemoryCandidateAdmission(request, completeResult([
    candidate({ snapshot: { world_revision: 12, commit_sequence: 39 } }),
  ]));
  assert.equal(result.status, "ready");
  assert.deepEqual(result.admitted, []);
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
    assert.equal(result.status, "ready");
    assert.deepEqual(result.admitted, []);
  }
});

test("summary lineage fails closed when source world scope is missing or unproven", () => {
  const source = {
    ref: "source:a",
    version: "1",
    access: { outcome: "allow", subject_id: request.subject_id, purpose: request.purpose },
    freshness: { status: "current" },
  };

  for (const unprovenSource of [
    source,
    { ...source, world_id: null },
    { ...source, world_id: "" },
  ]) {
    const summary = candidate({
      content_kind: "summary",
      lineage: { status: "complete", sources: [unprovenSource] },
    });
    const result = evaluateMemoryCandidateAdmission(request, completeResult([summary]));
    assert.equal(result.status, "ready");
    assert.deepEqual(result.admitted, []);
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
  const validSummary = candidate({
    content_kind: "summary",
    lineage: { status: "complete", sources: [baseSource] },
  });
  assert.equal(evaluateMemoryCandidateAdmission(request, completeResult([validSummary])).admitted.length, 1);

  for (const source of [
    { ...baseSource, world_id: "world-b" },
    { ...baseSource, access: { ...baseSource.access, subject_id: "actor-other" } },
    { ...baseSource, access: { ...baseSource.access, purpose: "other-purpose" } },
  ]) {
    const summary = candidate({ content_kind: "summary", lineage: { status: "complete", sources: [source] } });
    const result = evaluateMemoryCandidateAdmission(request, completeResult([summary]));
    assert.equal(result.status, "ready");
    assert.deepEqual(result.admitted, []);
  }
});

test("duplicate record/version is admitted once without text-based identity", () => {
  const first = candidate({ content: "first wording" });
  const duplicate = candidate({ content: "different wording" });
  const result = evaluateMemoryCandidateAdmission(request, completeResult([first, duplicate]));

  assert.equal(result.status, "ready");
  assert.equal(result.admitted.length, 1);
});

test("partial, unavailable, rebuilding, malformed, or unknown retrieval is not treated as complete-empty", () => {
  const authorizedEmpty = evaluateMemoryCandidateAdmission(request, completeResult([]));
  for (const resultInput of [
    null,
    { completeness: "partial", candidates: [candidate()] },
    { completeness: "unavailable", candidates: [candidate()] },
    { completeness: "rebuilding", candidates: [candidate()] },
    { completeness: "unknown", candidates: [candidate()] },
    { completeness: "complete", candidates: "not-an-array" },
  ]) {
    const result = evaluateMemoryCandidateAdmission(request, resultInput);
    assert.equal(result.status, "non_ready");
    assert.equal(result.reason, "result_incomplete_or_unavailable");
    assert.deepEqual(result.admitted, []);
    assert.equal(JSON.stringify(result).includes("memory:claim-1"), false);
    assert.notDeepEqual(result, authorizedEmpty);
  }
});

test("a complete authorized empty result is not proof that the subject knows nothing", () => {
  const result = evaluateMemoryCandidateAdmission(request, completeResult([]));
  assert.equal(result.status, "ready");
  assert.deepEqual(result.admitted, []);
  assert.equal(result.reason, null);
});

test("empty denied, withheld, or scope-mismatched results fail closed", () => {
  const authorizedEmpty = evaluateMemoryCandidateAdmission(request, completeResult([]));
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
    assert.notDeepEqual(result, authorizedEmpty);
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
  assert.deepEqual(result.admitted, []);
  assert.deepEqual(result, evaluateMemoryCandidateAdmission(request, completeResult([])));
  assert.equal(serialized.includes("restricted-secret-record"), false);
  assert.equal(serialized.includes("sensitive title"), false);
});

test("admission result and nested reference projections are immutable", () => {
  const result = evaluateMemoryCandidateAdmission(request, completeResult([candidate()]));
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.admitted), true);
  assert.equal(Object.isFrozen(result.admitted[0]), true);
  assert.throws(() => { result.status = "non_ready"; }, TypeError);
  assert.throws(() => { result.admitted.push({ record_ref: "forged", record_version: "v1" }); }, TypeError);
  assert.throws(() => { result.admitted[0].record_ref = "forged"; }, TypeError);
  assert.equal(result.admitted[0].record_ref, "memory:claim-1");
});

test("candidate admission does not mutate its request or result inputs", () => {
  const inputRequest = structuredClone(request);
  const inputResult = completeResult([
    candidate({
      content: "must remain caller-owned",
      lineage: {
        status: "complete",
        sources: [{
          ref: "source:a",
          version: "1",
          world_id: request.world_id,
          access: { outcome: "allow", subject_id: request.subject_id, purpose: request.purpose },
          freshness: { status: "current" },
        }],
      },
    }),
  ]);
  const requestBefore = structuredClone(inputRequest);
  const resultBefore = structuredClone(inputResult);

  evaluateMemoryCandidateAdmission(inputRequest, inputResult);

  assert.deepEqual(inputRequest, requestBefore);
  assert.deepEqual(inputResult, resultBefore);
});


test("non-finite numeric snapshot components fail closed", () => {
  for (const component of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    for (const field of ["world_revision", "commit_sequence"]) {
      const invalidSnapshot = { ...request.snapshot, [field]: component };
      const trustedResult = evaluateMemoryCandidateAdmission(
        { ...request, snapshot: invalidSnapshot },
        completeResult([candidate()]),
      );
      assert.equal(trustedResult.status, "non_ready");
      assert.equal(trustedResult.reason, "trusted_snapshot_incomplete");
      assert.deepEqual(trustedResult.admitted, []);

      const candidateResult = evaluateMemoryCandidateAdmission(
        request,
        completeResult([candidate({ snapshot: invalidSnapshot })]),
      );
      assert.equal(candidateResult.status, "ready");
      assert.deepEqual(candidateResult.admitted, []);
    }
  }
});


test("malformed candidate entries are ignored without leaking or aborting valid peers", () => {
  const valid = candidate({ record: { ref: "memory:valid-peer", version: "v1" } });
  const result = evaluateMemoryCandidateAdmission(
    request,
    completeResult([null, undefined, "not-a-candidate", 42, [], valid]),
  );

  assert.equal(result.status, "ready");
  assert.deepEqual(result.admitted, [{
    record_ref: "memory:valid-peer",
    record_version: "v1",
    epistemic_kind: "acquired_report",
    evidence_assessment: "unassessed",
  }]);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("not-a-candidate"), false);
  assert.equal(serialized.includes("invalid_candidate"), false);
});
