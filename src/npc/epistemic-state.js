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
    && ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    });
}

function isPlainDataObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value)) return false;
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

function isSafeDataTree(value, active = new Set()) {
  if (value === null || typeof value !== "object") return true;
  if (utilTypes.isProxy(value) || active.has(value)) return false;
  try {
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : (prototype !== Object.prototype && prototype !== null)) return false;
    active.add(value);
    for (const key of Reflect.ownKeys(value)) {
      if (array && key !== "length" && (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key))) return false;
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
  if (!Array.isArray(value) || !isSafeDataTree(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
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
      supporting_evidence_refs: Object.freeze([...item.supporting_evidence_refs]),
      conflicting_evidence_refs: Object.freeze([...item.conflicting_evidence_refs]),
      history: Object.freeze(item.history.map((entry) => Object.freeze({
        ...entry,
        evidence_refs: Object.freeze([...entry.evidence_refs]),
      }))),
    }))),
  });
}

function validState(state) {
  if (!isPlainDataObject(state)
    || !validId(state.world_id)
    || !validId(state.subject_id)
    || !denseArray(state.received)
    || !denseArray(state.evidence)
    || !denseArray(state.beliefs)) return false;

  const receivedKeys = new Set();
  for (const item of state.received) {
    if (!isPlainDataObject(item)
      || !validId(item.event_ref)
      || !validId(item.source_ref)
      || !validId(item.source_version)
      || receivedKeys.has(item.event_ref)) return false;
    receivedKeys.add(item.event_ref);
  }

  const evidenceKeys = new Set();
  const evidenceRefs = new Set();
  const evidenceByRef = new Map();
  for (const item of state.evidence) {
    if (!isPlainDataObject(item)
      || !validId(item.ref)
      || !validId(item.version)
      || !validId(item.proposition_ref)
      || !validId(item.acquisition_ref)
      || !validId(item.source_ref)
      || !validId(item.source_version)
      || !POLARITIES.has(item.polarity)
      || !["valid", "invalidated"].includes(item.status)) return false;
    const key = JSON.stringify([item.ref, item.version]);
    // Beliefs refer to stable evidence refs (not a ref/version pair), so one
    // ref cannot ambiguously name multiple versions in the same state.
    if (evidenceKeys.has(key) || evidenceRefs.has(item.ref)) return false;
    evidenceKeys.add(key);
    evidenceRefs.add(item.ref);
    evidenceByRef.set(item.ref, item);
  }

  const propositionKeys = new Set();
  for (const belief of state.beliefs) {
    if (!isPlainDataObject(belief)
      || !validId(belief.proposition_ref)
      || !STANCES.has(belief.stance)
      || !validId(belief.revision_rule_ref)
      || typeof belief.review_required !== "boolean"
      || !denseArray(belief.supporting_evidence_refs)
      || !denseArray(belief.conflicting_evidence_refs)
      || !denseArray(belief.history)
      || propositionKeys.has(belief.proposition_ref)) return false;
    const currentRefs = [...belief.supporting_evidence_refs, ...belief.conflicting_evidence_refs];
    if (currentRefs.some((ref) => !validId(ref) || !evidenceByRef.has(ref)
      || evidenceByRef.get(ref).proposition_ref !== belief.proposition_ref)) return false;
    if (new Set(belief.supporting_evidence_refs).size !== belief.supporting_evidence_refs.length
      || new Set(belief.conflicting_evidence_refs).size !== belief.conflicting_evidence_refs.length
      || belief.supporting_evidence_refs.some((ref) => belief.conflicting_evidence_refs.includes(ref))) return false;
    for (const entry of belief.history) {
      if (!isPlainDataObject(entry)
        || !STANCES.has(entry.stance)
        || !validId(entry.revision_rule_ref)
        || !denseArray(entry.evidence_refs)
        || !entry.evidence_refs.every((ref) => validId(ref) && evidenceByRef.has(ref))) return false;
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

function applyEventUnsafe(state, event) {
  if (!isSafeDataTree(state) || !validState(state) || !isSafeDataTree(event)
    || !isPlainDataObject(event) || !validId(event.type)) return nonReady();
  if (!validId(event.world_id) || !validId(event.subject_id)
    || event.world_id !== state.world_id || event.subject_id !== state.subject_id) {
    return nonReady("event_scope_mismatch");
  }

  if (event.type === "information_received") {
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
      state: freezeState({ ...state, received: [...state.received, {
        event_ref: event.event_ref,
        source_ref: event.source_ref,
        source_version: event.source_version,
      }] }),
      reason: null,
    });
  }

  if (event.type === "evidence_admitted") {
    const required = [
      event.acquisition_ref, event.proposition_ref, event.evidence_ref,
      event.evidence_version, event.source_ref, event.source_version,
    ];
    if (!required.every(validId) || !POLARITIES.has(event.polarity)) {
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
      status: "valid",
    };
    if (prior) {
      const same = prior.proposition_ref === nextEvidence.proposition_ref
        && prior.acquisition_ref === nextEvidence.acquisition_ref
        && prior.source_ref === nextEvidence.source_ref
        && prior.source_version === nextEvidence.source_version
        && prior.polarity === nextEvidence.polarity;
      return same
        ? Object.freeze({ status: "unchanged", state, reason: null })
        : nonReady("evidence_identity_conflict");
    }
    return Object.freeze({
      status: "updated",
      state: freezeState({ ...state, evidence: [...state.evidence, nextEvidence] }),
      reason: null,
    });
  }

  if (event.type === "belief_updated") {
    if (!validId(event.proposition_ref)
      || !STANCES.has(event.stance)
      || event.stance === "unknown"
      || !validId(event.revision_rule_ref)
      || !denseArray(event.evidence_refs)
      || event.evidence_refs.length === 0
      || !event.evidence_refs.every(validId)
      || new Set(event.evidence_refs).size !== event.evidence_refs.length) {
      return nonReady("belief_revision_metadata_incomplete");
    }
    const evidence = event.evidence_refs.map((ref) => state.evidence.find((item) => item.ref === ref && item.status === "valid"));
    if (evidence.some((item) => !item || item.proposition_ref !== event.proposition_ref)) {
      return nonReady("belief_revision_evidence_unavailable");
    }
    const negativeStance = event.stance === "believes_false" || event.stance === "suspects_false";
    // "unresolved" retains both sides distinctly rather than placing every
    // evidence item in both lists.
    const supporting = evidence.filter((item) => item.polarity === (negativeStance ? "supports_false" : "supports_true")).map((item) => item.ref);
    const conflicting = evidence.filter((item) => item.polarity === (negativeStance ? "supports_true" : "supports_false")).map((item) => item.ref);
    const current = state.beliefs.find((item) => item.proposition_ref === event.proposition_ref);
    const history = current ? [...current.history, {
      stance: current.stance,
      revision_rule_ref: current.revision_rule_ref,
      evidence_refs: [...current.supporting_evidence_refs, ...current.conflicting_evidence_refs],
    }] : [];
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
      : [...state.beliefs, nextBelief];
    return Object.freeze({ status: "updated", state: freezeState({ ...state, beliefs }), reason: null });
  }

  if (event.type === "evidence_invalidated") {
    if (!validId(event.evidence_ref) || !validId(event.evidence_version) || !validId(event.invalidation_rule_ref)) {
      return nonReady("invalidation_metadata_incomplete");
    }
    const prior = findEvidence(state, event.evidence_ref, event.evidence_version);
    if (!prior) return nonReady("evidence_not_found");
    if (prior.status === "invalidated") return Object.freeze({ status: "unchanged", state, reason: null });
    const evidence = state.evidence.map((item) => item.ref === prior.ref && item.version === prior.version
      ? { ...item, status: "invalidated" }
      : item);
    const beliefs = state.beliefs.map((belief) => {
      const usesEvidence = belief.supporting_evidence_refs.includes(prior.ref)
        || belief.conflicting_evidence_refs.includes(prior.ref);
      return usesEvidence ? { ...belief, review_required: true } : belief;
    });
    return Object.freeze({ status: "updated", state: freezeState({ ...state, evidence, beliefs }), reason: null });
  }

  if (event.type === "canonical_truth_changed") {
    // Canonical world changes are not evidence that this NPC acquired a
    // correction. Keep the subject-relative belief untouched.
    return Object.freeze({
      status: "unchanged",
      state,
      reason: "canonical_truth_does_not_revise_belief",
    });
  }

  if (event.type === "belief_forgotten") {
    if (!validId(event.proposition_ref) || !validId(event.forgetting_rule_ref)) {
      return nonReady("forgetting_metadata_incomplete");
    }
    const current = state.beliefs.find((item) => item.proposition_ref === event.proposition_ref);
    if (!current) return nonReady("belief_not_found");
    const history = [...current.history, {
      stance: current.stance,
      revision_rule_ref: current.revision_rule_ref,
      evidence_refs: [...current.supporting_evidence_refs, ...current.conflicting_evidence_refs],
    }];
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
  if (!isSafeDataTree(scope) || !isPlainDataObject(scope) || !validId(scope.world_id) || !validId(scope.subject_id)) {
    return nonReady("trusted_scope_incomplete");
  }
  return Object.freeze({
    status: "ready",
    state: freezeState({
      world_id: scope.world_id,
      subject_id: scope.subject_id,
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
