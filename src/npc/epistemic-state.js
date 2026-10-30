import { types as utilTypes } from "node:util";

/**
 * NPC-local epistemic reducer.
 *
 * This is not an authorization service or a Core/Memory adapter. Callers may
 * submit evidence_admitted only after an existing trusted boundary has
 * established acquisition, subject/world scope, source validity, and access.
 * The reducer keeps receipt, admitted evidence, and belief as separate states.
 * It never reads or changes canonical world truth and never executes actions.
 */

const ID_MAX = 200;
const POLARITIES = new Set(["supports_true", "supports_false"]);
const STANCES = new Set(["believes_true", "believes_false", "suspects_true", "suspects_false", "unresolved", "unknown"]);
const EPISTEMIC_STATUSES = new Set(["confirmed", "unconfirmed_report", "suspicion", "inference", "rumor", "unknown"]);
const EVIDENCE_ASSESSMENTS = new Set(["supported", "disputed", "insufficient"]);

const MEMORY_EPISTEMIC_KINDS = new Set(["acquired_report", "rumor", "inference"]);
const MEMORY_EVIDENCE_ASSESSMENTS = new Set(["unassessed", "supported", "disputed", "insufficient"]);

/**
 * Map the approved Memory evidence vocabulary into NPC-local epistemic status.
 *
 * This is classification only: it does not authenticate provenance, authorize
 * disclosure, establish acquisition, or revise belief. `supported` never upgrades a report/rumor/inference to `confirmed`. Canonical and assigned/imported knowledge require their
 * separate Core acquisition path; suspicion is produced by NPC cognition.
 *
 * Returns null when the evidence must not enter belief revision.
 */
export function mapMemoryEvidenceToNpcEpistemicStatus(epistemicKind, evidenceAssessment) {
  if (!MEMORY_EVIDENCE_ASSESSMENTS.has(evidenceAssessment)
    || !MEMORY_EPISTEMIC_KINDS.has(epistemicKind)) return null;
  if (evidenceAssessment === "unassessed") return null;
  if (evidenceAssessment === "insufficient") return "unknown";
  if (epistemicKind === "acquired_report") return "unconfirmed_report";
  if (epistemicKind === "rumor") return "rumor";
  if (epistemicKind === "inference") return "inference";
  return null;
}

const nonReady = (reason = "invalid_epistemic_input") => Object.freeze({
  status: "non_ready",
  state: null,
  reason,
});

function validId(value) {
  return typeof value === "string"
    && value === value.trim()
    && value.length > 0
    && value.length <= ID_MAX
    && (() => {
      for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code < 32 || code === 127) return false;
      }
      return true;
    })();
}

function isPlainDataObject(value) {
  if (value === null || typeof value !== "object" || utilTypes.isProxy(value) || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Reflect.ownKeys(value).every((key) => {
      if (typeof key !== "string") return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor != null && Object.hasOwn(descriptor, "value");
    });
  } catch {
    return false;
  }
}

function hasExactKeys(value, expected) {
  if (!isPlainDataObject(value)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length
    && expected.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => typeof key === "string" && expected.includes(key));
}

function isSafeDataTree(value, active = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (utilTypes.isProxy(value) || active.has(value)) return false;
  try {
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype
      : (prototype !== Object.prototype && prototype !== null)) return false;
    active.add(value);
    const keys = Reflect.ownKeys(value);
    // Avoid for..of here: it invokes Array.prototype[Symbol.iterator] on the
    // array returned by Reflect.ownKeys, before caller state can be rejected.
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (array && key !== "length" && (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || !Number.isSafeInteger(Number(key)) || Number(key) >= value.length)) return false;
      if (!array && typeof key !== "string") return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) return false;
      if (key !== "length" && !isSafeDataTree(descriptor.value, active)) return false;
    }
    active.delete(value);
    return true;
  } catch {
    active.delete(value);
    return false;
  }
}

function denseArray(value) {
  if (utilTypes.isProxy(value) || !Array.isArray(value) || !isSafeDataTree(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function hasUniqueItems(value) {
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    if (seen.has(value[index])) return false;
    seen.add(value[index]);
  }
  return true;
}

function freezeState(state) {
  return Object.freeze({
    world_id: state.world_id,
    subject_id: state.subject_id,
    received: Object.freeze(state.received.map((item) => Object.freeze({ ...item }))),
    evidence: Object.freeze(state.evidence.map((item) => Object.freeze({ ...item }))),
    beliefs: Object.freeze(state.beliefs.map((item) => Object.freeze({
      ...item,
      supporting_evidence_refs: Object.freeze(item.supporting_evidence_refs.map((ref) => ref)),
      conflicting_evidence_refs: Object.freeze(item.conflicting_evidence_refs.map((ref) => ref)),
      history: Object.freeze(item.history.map((entry) => Object.freeze({
        ...entry,
        evidence_refs: Object.freeze(entry.evidence_refs.map((ref) => ref)),
      }))),
    }))),
  });
}

function validState(state) {
  if (!hasExactKeys(state, ["world_id", "subject_id", "received", "evidence", "beliefs"])
    || !validId(state.world_id)
    || !validId(state.subject_id)
    || !denseArray(state.received)
    || !denseArray(state.evidence)
    || !denseArray(state.beliefs)) return false;

  const receivedKeys = new Set();
  for (let index = 0; index < state.received.length; index += 1) {
    const item = state.received[index];
    if (!hasExactKeys(item, ["event_ref", "source_ref", "source_version"])
      || !validId(item.event_ref)
      || !validId(item.source_ref)
      || !validId(item.source_version)
      || receivedKeys.has(item.event_ref)) return false;
    receivedKeys.add(item.event_ref);
  }

  const evidenceKeys = new Set();
  const evidenceRefs = new Set();
  const evidenceByRef = new Map();
  for (let index = 0; index < state.evidence.length; index += 1) {
    const item = state.evidence[index];
    if (!hasExactKeys(item, ["ref", "version", "proposition_ref", "acquisition_ref", "source_ref", "source_version", "polarity", "epistemic_status", "evidence_assessment", "status", "invalidation_rule_ref"])
      || !validId(item.ref)
      || !validId(item.version)
      || !validId(item.proposition_ref)
      || !validId(item.acquisition_ref)
      || !validId(item.source_ref)
      || !validId(item.source_version)
      || !POLARITIES.has(item.polarity)
      || !EPISTEMIC_STATUSES.has(item.epistemic_status)
      || !EVIDENCE_ASSESSMENTS.has(item.evidence_assessment)
      || !["valid", "invalidated"].includes(item.status)
      || !(item.invalidation_rule_ref === null || validId(item.invalidation_rule_ref))
      || (item.status === "valid" && item.invalidation_rule_ref !== null)
      || (item.status === "invalidated" && item.invalidation_rule_ref === null)) return false;
    const key = JSON.stringify([item.ref, item.version]);
    // Beliefs refer to stable evidence refs (not a ref/version pair), so one
    // ref cannot ambiguously name multiple versions in the same state.
    if (evidenceKeys.has(key) || evidenceRefs.has(item.ref)) return false;
    evidenceKeys.add(key);
    evidenceRefs.add(item.ref);
    evidenceByRef.set(item.ref, item);
  }

  const propositionKeys = new Set();
  for (let beliefIndex = 0; beliefIndex < state.beliefs.length; beliefIndex += 1) {
    const belief = state.beliefs[beliefIndex];
    if (!hasExactKeys(belief, ["proposition_ref", "stance", "supporting_evidence_refs", "conflicting_evidence_refs", "revision_rule_ref", "review_required", "history"])
      || !validId(belief.proposition_ref)
      || !STANCES.has(belief.stance)
      || !validId(belief.revision_rule_ref)
      || typeof belief.review_required !== "boolean"
      || !denseArray(belief.supporting_evidence_refs)
      || !denseArray(belief.conflicting_evidence_refs)
      || !denseArray(belief.history)
      || propositionKeys.has(belief.proposition_ref)) return false;
    const currentRefs = belief.supporting_evidence_refs.concat(belief.conflicting_evidence_refs);
    if (currentRefs.some((ref) => !validId(ref) || !evidenceByRef.has(ref)
      || evidenceByRef.get(ref).proposition_ref !== belief.proposition_ref)) return false;
    if (belief.stance === "unknown") {
      if (currentRefs.length > 0 || belief.review_required) return false;
    } else {
      // A restored non-unknown stance must retain an evidence basis. Invalidated
      // refs remain as history only when review_required is set by invalidation.
      if (currentRefs.length === 0) return false;
      if (belief.stance !== "unresolved" && belief.supporting_evidence_refs.length === 0) return false;
      if (belief.stance === "unresolved"
        && (belief.supporting_evidence_refs.length === 0 || belief.conflicting_evidence_refs.length === 0)) return false;
      const negative = belief.stance === "believes_false" || belief.stance === "suspects_false";
      const supportingPolarity = negative ? "supports_false" : "supports_true";
      const conflictingPolarity = negative ? "supports_true" : "supports_false";
      if (belief.supporting_evidence_refs.some((ref) => evidenceByRef.get(ref).polarity !== supportingPolarity)
        || belief.conflicting_evidence_refs.some((ref) => evidenceByRef.get(ref).polarity !== conflictingPolarity)) return false;
      if (currentRefs.some((ref) => evidenceByRef.get(ref).epistemic_status === "unknown")) return false;
      if (currentRefs.some((ref) => evidenceByRef.get(ref).evidence_assessment === "disputed")
        && belief.stance !== "unresolved") return false;
      if ((belief.stance === "believes_true" || belief.stance === "believes_false")
        && currentRefs.some((ref) => evidenceByRef.get(ref).epistemic_status !== "confirmed")) return false;
    }
    if (currentRefs.some((ref) => evidenceByRef.get(ref).status === "invalidated")
      && !belief.review_required) return false;
    if (!hasUniqueItems(belief.supporting_evidence_refs)
      || !hasUniqueItems(belief.conflicting_evidence_refs)
      || belief.supporting_evidence_refs.some((ref) => belief.conflicting_evidence_refs.includes(ref))) return false;
    for (let historyIndex = 0; historyIndex < belief.history.length; historyIndex += 1) {
      const entry = belief.history[historyIndex];
      if (!hasExactKeys(entry, ["stance", "revision_rule_ref", "evidence_refs"])
        || !STANCES.has(entry.stance)
        || !validId(entry.revision_rule_ref)
        || !denseArray(entry.evidence_refs)
        || !entry.evidence_refs.every((ref) => validId(ref)
          && evidenceByRef.has(ref)
          && evidenceByRef.get(ref).proposition_ref === belief.proposition_ref)
        || (entry.stance === "unknown" && entry.evidence_refs.length > 0)
        || (entry.stance !== "unknown" && entry.evidence_refs.length === 0)
        || entry.evidence_refs.some((ref) => evidenceByRef.get(ref).epistemic_status === "unknown")
        || (entry.evidence_refs.some((ref) => evidenceByRef.get(ref).evidence_assessment === "disputed")
          && entry.stance !== "unresolved")
        || ((entry.stance === "believes_true" || entry.stance === "believes_false")
          && entry.evidence_refs.some((ref) => evidenceByRef.get(ref).epistemic_status !== "confirmed"))) return false;
      if (entry.stance !== "unknown") {
        const historicalEvidence = entry.evidence_refs.map((ref) => evidenceByRef.get(ref));
        const negativeHistory = entry.stance === "believes_false" || entry.stance === "suspects_false";
        const supportingPolarity = negativeHistory ? "supports_false" : "supports_true";
        if (entry.stance === "unresolved") {
          if (!historicalEvidence.some((item) => item.polarity === "supports_true")
            || !historicalEvidence.some((item) => item.polarity === "supports_false")) return false;
        } else if (!historicalEvidence.some((item) => item.polarity === supportingPolarity)) {
          return false;
        }
      }
    }
    propositionKeys.add(belief.proposition_ref);
  }
  return true;
}

function sameRefs(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function findEvidence(state, ref, version) {
  return state.evidence.find((item) => item.ref === ref && item.version === version);
}

const EVENT_KEYS = Object.freeze({
  information_received: ["world_id", "subject_id", "type", "event_ref", "source_ref", "source_version"],
  evidence_admitted: ["world_id", "subject_id", "type", "acquisition_ref", "proposition_ref", "evidence_ref", "evidence_version", "source_ref", "source_version", "polarity", "epistemic_status", "evidence_assessment"],
  belief_updated: ["world_id", "subject_id", "type", "proposition_ref", "stance", "revision_rule_ref", "evidence_refs"],
  evidence_invalidated: ["world_id", "subject_id", "type", "evidence_ref", "evidence_version", "invalidation_rule_ref"],
  canonical_truth_changed: ["world_id", "subject_id", "type"],
  belief_forgotten: ["world_id", "subject_id", "type", "proposition_ref", "forgetting_rule_ref"],
});

function validEventShape(event, eventType) {
  if (!Object.hasOwn(EVENT_KEYS, eventType)) return false;
  return hasExactKeys(event, EVENT_KEYS[eventType]);
}

function applyEventUnsafe(state, event) {
  if (!isSafeDataTree(state) || !validState(state) || !isSafeDataTree(event)
    || !isPlainDataObject(event)) return nonReady();
  // Do not read eventType until its own data descriptor has been verified.
  // A getter on Object.prototype must not run for a malformed event.
  const typeDescriptor = Object.getOwnPropertyDescriptor(event, "type");
  if (!typeDescriptor || !Object.hasOwn(typeDescriptor, "value")
    || !validId(typeDescriptor.value)) return nonReady();
  const eventType = typeDescriptor.value;
  if (!validEventShape(event, eventType)) return nonReady("event_shape_invalid");
  if (!validId(event.world_id) || !validId(event.subject_id)
    || event.world_id !== state.world_id || event.subject_id !== state.subject_id) {
    return nonReady("event_scope_mismatch");
  }

  if (eventType === "information_received") {
    if (!validId(event.event_ref) || !validId(event.source_ref) || !validId(event.source_version)) {
      return nonReady("receipt_metadata_incomplete");
    }
    if (state.received.some((item) => item.event_ref === event.event_ref)) {
      const prior = state.received.find((item) => item.event_ref === event.event_ref);
      if (prior.source_ref !== event.source_ref || prior.source_version !== event.source_version) {
        return nonReady("receipt_identity_conflict");
      }
      return Object.freeze({ status: "unchanged", state, reason: null });
    }
    return Object.freeze({
      status: "updated",
      state: freezeState({ ...state, received: state.received.concat([{
        event_ref: event.event_ref,
        source_ref: event.source_ref,
        source_version: event.source_version,
      }]) }),
      reason: null,
    });
  }

  if (eventType === "evidence_admitted") {
    const required = [
      event.acquisition_ref, event.proposition_ref, event.evidence_ref,
      event.evidence_version, event.source_ref, event.source_version,
    ];
    if (!required.every(validId) || !POLARITIES.has(event.polarity)
      || !EPISTEMIC_STATUSES.has(event.epistemic_status)
      || !EVIDENCE_ASSESSMENTS.has(event.evidence_assessment)) {
      return nonReady("admitted_evidence_metadata_incomplete");
    }
    const prior = findEvidence(state, event.evidence_ref, event.evidence_version);
    const otherVersion = state.evidence.find((item) => item.ref === event.evidence_ref);
    if (otherVersion && !prior) return nonReady("evidence_identity_conflict");
    const nextEvidence = {
      ref: event.evidence_ref,
      version: event.evidence_version,
      proposition_ref: event.proposition_ref,
      acquisition_ref: event.acquisition_ref,
      source_ref: event.source_ref,
      source_version: event.source_version,
      polarity: event.polarity,
      epistemic_status: event.epistemic_status,
      evidence_assessment: event.evidence_assessment,
      status: "valid",
      invalidation_rule_ref: null,
    };
    if (prior) {
      const same = prior.proposition_ref === nextEvidence.proposition_ref
        && prior.acquisition_ref === nextEvidence.acquisition_ref
        && prior.source_ref === nextEvidence.source_ref
        && prior.source_version === nextEvidence.source_version
        && prior.polarity === nextEvidence.polarity
        && prior.epistemic_status === nextEvidence.epistemic_status
        && prior.evidence_assessment === nextEvidence.evidence_assessment;
      return same
        ? Object.freeze({ status: "unchanged", state, reason: null })
        : nonReady("evidence_identity_conflict");
    }
    return Object.freeze({
      status: "updated",
      state: freezeState({ ...state, evidence: state.evidence.concat([nextEvidence]) }),
      reason: null,
    });
  }

  if (eventType === "belief_updated") {
    if (!validId(event.proposition_ref)
      || !STANCES.has(event.stance)
      || event.stance === "unknown"
      || !validId(event.revision_rule_ref)
      || !denseArray(event.evidence_refs)
      || event.evidence_refs.length === 0
      || !event.evidence_refs.every(validId)
      || !hasUniqueItems(event.evidence_refs)) {
      return nonReady("belief_revision_metadata_incomplete");
    }
    const evidence = event.evidence_refs.map((ref) => state.evidence.find((item) => item.ref === ref && item.status === "valid"));
    if (evidence.some((item) => !item || item.proposition_ref !== event.proposition_ref)) {
      return nonReady("belief_revision_evidence_unavailable");
    }
    // The reducer preserves the caller-established epistemic class; it does not
    // authenticate it. Reports, suspicions, inferences and rumors may support
    // only a tentative stance or an unresolved state. They cannot be promoted
    // into a confirmed belief by choosing a stronger stance at this boundary.
    if (evidence.some((item) => item.epistemic_status === "unknown")
      || (evidence.some((item) => item.evidence_assessment === "disputed") && event.stance !== "unresolved")
      || ((event.stance === "believes_true" || event.stance === "believes_false")
        && evidence.some((item) => item.epistemic_status !== "confirmed"))) {
      return nonReady("belief_revision_epistemic_status_not_admissible");
    }
    const negativeStance = event.stance === "believes_false" || event.stance === "suspects_false";
    // "unresolved" retains both sides distinctly rather than placing every
    // evidence item in both lists.
    const supporting = evidence.filter((item) => item.polarity === (negativeStance ? "supports_false" : "supports_true")).map((item) => item.ref);
    const conflicting = evidence.filter((item) => item.polarity === (negativeStance ? "supports_true" : "supports_false")).map((item) => item.ref);
    if ((event.stance === "unresolved" && (supporting.length === 0 || conflicting.length === 0))
      || (event.stance !== "unresolved" && supporting.length === 0)) {
      return nonReady("belief_revision_evidence_does_not_support_stance");
    }
    const current = state.beliefs.find((item) => item.proposition_ref === event.proposition_ref);
    if (current
      && current.stance === event.stance
      && current.revision_rule_ref === event.revision_rule_ref
      && current.review_required === false
      && sameRefs(current.supporting_evidence_refs, supporting)
      && sameRefs(current.conflicting_evidence_refs, conflicting)) {
      return Object.freeze({ status: "unchanged", state, reason: null });
    }
    const history = current ? current.history.concat([{
      stance: current.stance,
      revision_rule_ref: current.revision_rule_ref,
      evidence_refs: current.supporting_evidence_refs.concat(current.conflicting_evidence_refs),
    }]) : [];
    const nextBelief = {
      proposition_ref: event.proposition_ref,
      stance: event.stance,
      supporting_evidence_refs: supporting,
      conflicting_evidence_refs: conflicting,
      revision_rule_ref: event.revision_rule_ref,
      review_required: false,
      history,
    };
    const beliefs = current
      ? state.beliefs.map((item) => item.proposition_ref === event.proposition_ref ? nextBelief : item)
      : state.beliefs.concat([nextBelief]);
    return Object.freeze({ status: "updated", state: freezeState({ ...state, beliefs }), reason: null });
  }

  if (eventType === "evidence_invalidated") {
    if (!validId(event.evidence_ref) || !validId(event.evidence_version) || !validId(event.invalidation_rule_ref)) {
      return nonReady("invalidation_metadata_incomplete");
    }
    const prior = findEvidence(state, event.evidence_ref, event.evidence_version);
    if (!prior) return nonReady("evidence_not_found");
    if (prior.status === "invalidated") {
      return prior.invalidation_rule_ref === event.invalidation_rule_ref
        ? Object.freeze({ status: "unchanged", state, reason: null })
        : nonReady("invalidation_identity_conflict");
    }
    const evidence = state.evidence.map((item) => item.ref === prior.ref && item.version === prior.version
      ? { ...item, status: "invalidated", invalidation_rule_ref: event.invalidation_rule_ref }
      : item);
    const beliefs = state.beliefs.map((belief) => {
      const usesEvidence = belief.supporting_evidence_refs.includes(prior.ref)
        || belief.conflicting_evidence_refs.includes(prior.ref);
      return usesEvidence ? { ...belief, review_required: true } : belief;
    });
    return Object.freeze({ status: "updated", state: freezeState({ ...state, evidence, beliefs }), reason: null });
  }

  if (eventType === "canonical_truth_changed") {
    // Canonical world changes are not evidence that this NPC acquired a
    // correction. Keep the subject-relative belief untouched.
    return Object.freeze({
      status: "unchanged",
      state,
      reason: "canonical_truth_does_not_revise_belief",
    });
  }

  if (eventType === "belief_forgotten") {
    if (!validId(event.proposition_ref) || !validId(event.forgetting_rule_ref)) {
      return nonReady("forgetting_metadata_incomplete");
    }
    const current = state.beliefs.find((item) => item.proposition_ref === event.proposition_ref);
    if (!current) return nonReady("belief_not_found");
    if (current.stance === "unknown"
      && current.revision_rule_ref === event.forgetting_rule_ref
      && current.review_required === false
      && current.supporting_evidence_refs.length === 0
      && current.conflicting_evidence_refs.length === 0) {
      return Object.freeze({ status: "unchanged", state, reason: null });
    }
    const history = current.history.concat([{
      stance: current.stance,
      revision_rule_ref: current.revision_rule_ref,
      evidence_refs: current.supporting_evidence_refs.concat(current.conflicting_evidence_refs),
    }]);
    const beliefs = state.beliefs.map((item) => item.proposition_ref === event.proposition_ref
      ? {
        ...item,
        stance: "unknown",
        supporting_evidence_refs: [],
        conflicting_evidence_refs: [],
        revision_rule_ref: event.forgetting_rule_ref,
        review_required: false,
        history,
      }
      : item);
    return Object.freeze({ status: "updated", state: freezeState({ ...state, beliefs }), reason: null });
  }

  return nonReady("event_type_unknown");
}

/** Create an empty, NPC-local epistemic state. */
export function createNpcEpistemicState(scope) {
  if (!isSafeDataTree(scope) || !isPlainDataObject(scope)) {
    return nonReady("trusted_scope_incomplete");
  }
  const worldDescriptor = Object.getOwnPropertyDescriptor(scope, "world_id");
  const subjectDescriptor = Object.getOwnPropertyDescriptor(scope, "subject_id");
  if (!worldDescriptor || !Object.hasOwn(worldDescriptor, "value")
    || !subjectDescriptor || !Object.hasOwn(subjectDescriptor, "value")
    || !validId(worldDescriptor.value) || !validId(subjectDescriptor.value)) {
    return nonReady("trusted_scope_incomplete");
  }
  return Object.freeze({
    status: "ready",
    state: freezeState({
      world_id: worldDescriptor.value,
      subject_id: subjectDescriptor.value,
      received: [],
      evidence: [],
      beliefs: [],
    }),
    reason: null,
  });
}

/**
 * Apply one explicit NPC-local event. Evidence admission/authorization is
 * outside this function; this reducer only records the caller's established
 * result and keeps belief changes explicit and traceable.
 */
export function applyNpcEpistemicEvent(state, event) {
  try {
    return applyEventUnsafe(state, event);
  } catch {
    return nonReady();
  }
}
