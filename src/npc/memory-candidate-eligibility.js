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
const KNOWN_EVIDENCE_ASSESSMENTS = new Set([
  "unassessed",
  "supported",
  "disputed",
  "insufficient",
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

function isDenseArray(values) {
  if (!Array.isArray(values)) return false;
  for (let index = 0; index < values.length; index += 1) {
    if (!Object.hasOwn(values, index)) return false;
  }
  return true;
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

  // Array.prototype.every skips holes. Check every own index explicitly so a
  // sparse lineage cannot be mistaken for a complete list of authorized sources.
  // Repeated source ref/version pairs are ambiguous without an approved immutable
  // payload digest; reject the summary instead of assuming duplicate rows agree.
  const sourceIdentities = new Set();
  for (let index = 0; index < candidate.lineage.sources.length; index += 1) {
    if (!Object.hasOwn(candidate.lineage.sources, index)) return false;
    const source = candidate.lineage.sources[index];
    if (source == null || !isNonEmptyString(source.ref) || !isNonEmptyString(source.version)) return false;
    const identity = JSON.stringify([source.ref, source.version]);
    if (sourceIdentities.has(identity)) return false;
    sourceIdentities.add(identity);
    if (
      source.world_id !== request.world_id
      || source.access?.outcome !== ALLOW
      || source.access?.subject_id !== request.subject_id
      || source.access?.purpose !== request.purpose
      || !READY_SOURCE_STATES.has(source.freshness?.status)
    ) return false;
  }
  return true;
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
  if (!KNOWN_EVIDENCE_ASSESSMENTS.has(candidate.lifecycle.evidence_assessment)) return "evidence_assessment_unknown";
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
      reason: "trusted_scope_incomplete",
    });
  }

  // Snapshot evidence is mandatory for admission. Without it, a caller could
  // bypass candidate/request snapshot comparison by omitting the request marker.
  if (!validSnapshot(request.snapshot)) {
    return Object.freeze({
      status: "non_ready",
      admitted: Object.freeze([]),
      reason: "trusted_snapshot_incomplete",
    });
  }

  if (
    result == null
    || result.completeness !== SAFE_RESULT_COMPLETENESS
    || !isDenseArray(result.candidates)
  ) {
    return Object.freeze({
      status: "non_ready",
      admitted: Object.freeze([]),
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
      reason: "request_access_or_scope_unconfirmed",
    });
  }

  // Pre-count identity/version pairs before admitting anything. Any repeated
  // pair is ambiguous here: the NPC contract has no approved immutable payload
  // digest with which to prove that duplicate answers are byte-identical. Drop
  // every occurrence rather than silently choosing the first candidate.
  const identityCounts = new Map();
  for (const candidate of result.candidates) {
    if (!validReference(candidate?.record)) continue;
    const identity = JSON.stringify([candidate.record.ref, candidate.record.version]);
    identityCounts.set(identity, (identityCounts.get(identity) ?? 0) + 1);
  }

  const admitted = [];

  for (const candidate of result.candidates) {
    const reason = candidateRejection(candidate, request);
    if (reason) {
      // Aggregate all candidate exclusions into one generic marker. Per-item
      // reasons and rejection counts can reveal protected record existence.
      continue;
    }

    const identity = JSON.stringify([candidate.record.ref, candidate.record.version]);
    if (identityCounts.get(identity) !== 1) continue;

    // Only stable reference/version are returned. Content must be fetched or
    // projected by an authorized boundary; this helper never returns content.
    admitted.push(Object.freeze({
      record_ref: candidate.record.ref,
      record_version: candidate.record.version,
      epistemic_kind: candidate.epistemic_kind,
      evidence_assessment: candidate.lifecycle.evidence_assessment,
    }));
  }

  return Object.freeze({
    status: "ready",
    admitted: Object.freeze(admitted),
    reason: null,
  });
}
