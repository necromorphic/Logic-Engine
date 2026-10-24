/**
 * NPC-side Memory candidate admission oracle.
 *
 * This is a pure, schema-neutral consumer helper, NOT an authorization service,
 * Memory adapter, or production read API. It only evaluates evidence supplied
 * by an owner-approved caller. Missing evidence fails closed.
 *
 * No content is copied into the decision result, which avoids turning a
 * rejection report into a secondary content-disclosure surface.
 */

const ALLOW = "allow";
const SAFE_RESULT_COMPLETENESS = "complete";
const READY_SOURCE_STATES = new Set(["current"]);
const KNOWN_CONTENT_KINDS = new Set([
  "claim",
  "report",
  "summary",
  "author_initial",
  "imported",
  "inference",
]);
const KNOWN_EPISTEMIC_KINDS = new Set([
  "canonical",
  "acquired_report",
  "rumor",
  "inference",
  "authored_initial",
  "imported",
]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function matchesRequest(candidate, request) {
  return candidate.world_id === request.world_id
    && candidate.subject_id === request.subject_id
    && candidate.purpose === request.purpose;
}

function isSnapshotComponent(value) {
  return (typeof value === "string" && value.trim().length > 0)
    || (typeof value === "number" && Number.isFinite(value));
}

function validSnapshot(snapshot) {
  return snapshot != null
    && isSnapshotComponent(snapshot.world_revision)
    && isSnapshotComponent(snapshot.commit_sequence);
}

function sameSnapshot(candidate, request) {
  if (request.snapshot == null) return true;
  if (!validSnapshot(request.snapshot) || !validSnapshot(candidate.snapshot)) return false;
  return candidate.snapshot.world_revision === request.snapshot.world_revision
    && candidate.snapshot.commit_sequence === request.snapshot.commit_sequence;
}

function validReference(record) {
  return record != null
    && isNonEmptyString(record.ref)
    && isNonEmptyString(record.version);
}

function producerIsPresent(candidate) {
  return candidate.producer != null
    && isNonEmptyString(candidate.producer.kind);
}

function lifecycleIsPresent(candidate) {
  const lifecycle = candidate.lifecycle;
  return lifecycle != null
    && isNonEmptyString(lifecycle.content_disposition)
    && isNonEmptyString(lifecycle.source_reconciliation)
    && isNonEmptyString(lifecycle.evidence_assessment)
    && isNonEmptyString(lifecycle.access_outcome)
    && isNonEmptyString(lifecycle.index_health);
}

function lifecycleIsAdmissible(candidate) {
  const lifecycle = candidate.lifecycle;
  // These are the positive semantic states shown by the proposal contract.
  // Unknown owner-defined states fail closed until their meaning is approved.
  return lifecycle.content_disposition === "usable"
    && lifecycle.source_reconciliation === "current"
    && lifecycle.access_outcome === ALLOW
    && lifecycle.index_health === "ready";
}

function lineageIsSafe(candidate, request) {
  if (candidate.content_kind !== "summary") return true;
  if (candidate.lineage?.status !== "complete") return false;
  if (!Array.isArray(candidate.lineage.sources) || candidate.lineage.sources.length === 0) {
    return false;
  }

  return candidate.lineage.sources.every((source) =>
    source != null
      && isNonEmptyString(source.ref)
      && isNonEmptyString(source.version)
      && source.world_id === request.world_id
      && source.access?.outcome === ALLOW
      && source.access?.subject_id === request.subject_id
      && source.access?.purpose === request.purpose
      && READY_SOURCE_STATES.has(source.freshness?.status)
  );
}

function candidateRejection(candidate, request) {
  if (candidate == null || typeof candidate !== "object") return "invalid_candidate";
  if (!matchesRequest(candidate, request)) return "scope_mismatch";
  if (
    candidate.access?.outcome !== ALLOW
    || candidate.access?.subject_id !== request.subject_id
    || candidate.access?.purpose !== request.purpose
  ) return "access_not_allowed";
  if (!validReference(candidate.record)) return "record_identity_incomplete";
  if (!KNOWN_CONTENT_KINDS.has(candidate.content_kind)) return "content_kind_unknown";
  if (!KNOWN_EPISTEMIC_KINDS.has(candidate.epistemic_kind)) return "epistemic_kind_unknown";
  if (!producerIsPresent(candidate)) return "producer_provenance_incomplete";
  if (!lifecycleIsPresent(candidate)) return "lifecycle_dimensions_incomplete";
  if (!lifecycleIsAdmissible(candidate)) return "lifecycle_not_admissible";
  if (!READY_SOURCE_STATES.has(candidate.freshness?.status)) return "source_not_current";
  if (!sameSnapshot(candidate, request)) return "snapshot_mismatch";
  if (!lineageIsSafe(candidate, request)) return "lineage_not_safe";
  return null;
}

/**
 * Evaluate whether supplied candidates are eligible for a bounded NPC context.
 *
 * Request fields are trusted bindings established by the caller, not values
 * that should be accepted from model output. The function does not establish
 * that those bindings are authentic or that the access decision is genuine.
 */
export function evaluateMemoryCandidateAdmission(request, result) {
  if (
    request == null
    || !isNonEmptyString(request.world_id)
    || !isNonEmptyString(request.subject_id)
    || !isNonEmptyString(request.purpose)
  ) {
    return Object.freeze({
      status: "non_ready",
      admitted: Object.freeze([]),
      rejected: Object.freeze([]),
      reason: "trusted_scope_incomplete",
    });
  }

  if (request.snapshot != null && !validSnapshot(request.snapshot)) {
    return Object.freeze({
      status: "non_ready",
      admitted: Object.freeze([]),
      rejected: Object.freeze([]),
      reason: "trusted_snapshot_incomplete",
    });
  }

  if (result == null || result.completeness !== SAFE_RESULT_COMPLETENESS || !Array.isArray(result.candidates)) {
    return Object.freeze({
      status: "non_ready",
      admitted: Object.freeze([]),
      rejected: Object.freeze([]),
      reason: "result_incomplete_or_unavailable",
    });
  }

  // This request-level gate is required even for zero candidates: an empty
  // denied/withheld result must not be mistaken for an authorized empty search.
  if (
    result.access?.outcome !== ALLOW
    || result.access?.subject_id !== request.subject_id
    || result.access?.purpose !== request.purpose
    || result.scope?.world_id !== request.world_id
    || result.scope?.subject_id !== request.subject_id
    || result.scope?.purpose !== request.purpose
  ) {
    return Object.freeze({
      status: "non_ready",
      admitted: Object.freeze([]),
      rejected: Object.freeze([]),
      reason: "request_access_or_scope_unconfirmed",
    });
  }

  const admitted = [];
  const rejected = [];
  const seen = new Set();

  for (const candidate of result.candidates) {
    const reason = candidateRejection(candidate, request);
    if (reason) {
      // Aggregate all candidate exclusions into one generic marker. Per-item
      // reasons and rejection counts can reveal protected record existence.
      if (rejected.length === 0) {
        rejected.push(Object.freeze({ reason: "candidate_not_admissible" }));
      }
      continue;
    }

    const identity = `${candidate.record.ref}\u0000${candidate.record.version}`;
    if (seen.has(identity)) {
      if (rejected.length === 0) {
        rejected.push(Object.freeze({ reason: "candidate_not_admissible" }));
      }
      continue;
    }
    seen.add(identity);

    // Only stable reference/version are returned. Content must be fetched or
    // projected by an authorized boundary; this helper never returns content.
    admitted.push(Object.freeze({
      record_ref: candidate.record.ref,
      record_version: candidate.record.version,
      epistemic_kind: candidate.epistemic_kind,
    }));
  }

  return Object.freeze({
    status: rejected.length === 0 ? "ready" : admitted.length > 0 ? "ready_with_exclusions" : "non_ready",
    admitted: Object.freeze(admitted),
    rejected: Object.freeze(rejected),
    reason: rejected.length === 0 ? null : "one_or_more_candidates_excluded",
  });
}
