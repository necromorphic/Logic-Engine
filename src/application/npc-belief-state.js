const STANCES = new Set([
  'believes_true',
  'believes_false',
  'suspects_true',
  'suspects_false',
  'unresolved_conflict',
]);

const isPlainObject = (value) => value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const validRef = (value) => typeof value === 'string'
  && value.length > 0
  && value.length <= 200
  && value === value.trim()
  && !/[\u0000-\u001f\u007f]/u.test(value);

const uniqueRefs = (value, label) => {
  if (!Array.isArray(value) || value.length > 200 || value.some((item) => !validRef(item))) {
    throw new TypeError(label + ' must be an array of at most 200 valid references');
  }
  if (new Set(value).size !== value.length) throw new TypeError(label + ' must not contain duplicate references');
  return [...value].sort();
};

const sameSnapshot = (left, right) => isPlainObject(left)
  && isPlainObject(right)
  && left.world_revision === right.world_revision
  && left.commit_sequence === right.commit_sequence;
const stableJson = (value) => {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (isPlainObject(value)) return '{' + Object.keys(value).sort().map((key) =>
    JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
  return JSON.stringify(value);
};
function freezeTree(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}
export const npcPropositionRefFor = (item) => validRef(item?.subject_ref) && validRef(item?.predicate)
  ? 'proposition:' + encodeURIComponent(item.subject_ref) + '/' + encodeURIComponent(item.predicate)
  : validRef(item?.fact_id) && validRef(item?.predicate)
    ? 'proposition:fact/' + encodeURIComponent(item.fact_id)
    : null;

/**
 * Validate a model-proposed belief transition against Core-authorized evidence.
 * This is a pure reducer: it does not persist state or grant knowledge.
 */
export function reduceNpcBeliefTransition({ knowledgeRead, currentBelief = null, proposal }) {
  if (!isPlainObject(knowledgeRead) || knowledgeRead.status !== 'ready'
    || !validRef(knowledgeRead.world_id) || !validRef(knowledgeRead.actor_id)
    || !['npc_turn_context', 'npc_action_evaluation'].includes(knowledgeRead.purpose)
    || !isPlainObject(knowledgeRead.snapshot)
    || !Number.isSafeInteger(knowledgeRead.snapshot.world_revision)
    || !Number.isSafeInteger(knowledgeRead.snapshot.commit_sequence)
    || knowledgeRead.truncated === true
    || !Array.isArray(knowledgeRead.items)) {
    return Object.freeze({ status: 'non_ready', reason: 'core_knowledge_read_not_ready', transition: null });
  }

  if (!isPlainObject(proposal)
    || Object.keys(proposal).sort().join(',') !== [
      'contradicting_acquisition_ids',
      'proposition_ref',
      'proposition_value',
      'reason_rule_ref',
      'stance',
      'supporting_acquisition_ids',
      'world_id',
      'actor_id',
      'snapshot',
    ].sort().join(',')
    || proposal.world_id !== knowledgeRead.world_id
    || proposal.actor_id !== knowledgeRead.actor_id
    || !sameSnapshot(proposal.snapshot, knowledgeRead.snapshot)
    || !validRef(proposal.proposition_ref)
    || !validRef(proposal.reason_rule_ref)
    || !STANCES.has(proposal.stance)) {
    return Object.freeze({ status: 'non_ready', reason: 'invalid_or_stale_proposal', transition: null });
  }

  let supporting;
  let contradicting;
  try {
    supporting = uniqueRefs(proposal.supporting_acquisition_ids, 'supporting_acquisition_ids');
    contradicting = uniqueRefs(proposal.contradicting_acquisition_ids, 'contradicting_acquisition_ids');
  } catch {
    return Object.freeze({ status: 'non_ready', reason: 'invalid_evidence_references', transition: null });
  }

  const active = new Map();
  for (const item of knowledgeRead.items) {
    if (!isPlainObject(item) || !validRef(item.acquisition_id) || active.has(item.acquisition_id)) {
      return Object.freeze({ status: 'non_ready', reason: 'invalid_core_evidence', transition: null });
    }
    active.set(item.acquisition_id, item);
  }
  const allRefs = [...supporting, ...contradicting];
  if (allRefs.some((ref) => !active.has(ref))) {
    return Object.freeze({ status: 'non_ready', reason: 'evidence_not_currently_acquired', transition: null });
  }
  if (supporting.some((ref) => contradicting.includes(ref))) {
    return Object.freeze({ status: 'non_ready', reason: 'evidence_cannot_support_and_contradict', transition: null });
  }
  if (supporting.length === 0 && contradicting.length === 0) {
    return Object.freeze({ status: 'non_ready', reason: 'belief_transition_requires_evidence', transition: null });
  }

  if (Array.isArray(knowledgeRead.withheld_proposition_refs)
    && knowledgeRead.withheld_proposition_refs.includes(proposal.proposition_ref)) {
    return Object.freeze({ status: 'non_ready', reason: 'proposition_has_withheld_evidence', transition: null });
  }
  const propositionItems = knowledgeRead.items.filter((item) =>
    npcPropositionRefFor(item) === proposal.proposition_ref);
  if (propositionItems.length === 0) {
    return Object.freeze({ status: 'non_ready', reason: 'proposition_has_no_matching_core_evidence', transition: null });
  }
  const cited = new Set(allRefs);
  if (propositionItems.some((item) => !cited.has(item.acquisition_id))) {
    return Object.freeze({ status: 'non_ready', reason: 'all_current_proposition_evidence_must_be_accounted_for', transition: null });
  }
  if (allRefs.some((ref) => npcPropositionRefFor(active.get(ref)) !== proposal.proposition_ref)) {
    return Object.freeze({ status: 'non_ready', reason: 'evidence_does_not_match_proposition', transition: null });
  }
  let propositionValueKey;
  try {
    propositionValueKey = stableJson(proposal.proposition_value);
    if (propositionValueKey === undefined) throw new TypeError('invalid proposition value');
  } catch {
    return Object.freeze({ status: 'non_ready', reason: 'invalid_proposition_value', transition: null });
  }
  const canonicalPropositionValue = freezeTree(JSON.parse(propositionValueKey));
  const valuesBySide = (refs) => new Set(refs.map((ref) => stableJson(active.get(ref).value)));
  const supportValues = valuesBySide(supporting);
  const contradictValues = valuesBySide(contradicting);
  if ([...supportValues].some((value) => contradictValues.has(value))) {
    return Object.freeze({ status: 'non_ready', reason: 'same_value_cannot_support_and_contradict', transition: null });
  }
  if (supporting.some((ref) => stableJson(active.get(ref).value) !== propositionValueKey)
    || contradicting.some((ref) => stableJson(active.get(ref).value) === propositionValueKey)) {
    return Object.freeze({ status: 'non_ready', reason: 'evidence_side_does_not_match_proposition_value', transition: null });
  }
  const propositionValues = new Set(propositionItems.map((item) => stableJson(item.value)));
  const hasConflict = propositionValues.size > 1;
  if (hasConflict && (proposal.stance !== 'unresolved_conflict'
    || supportValues.size === 0 || contradictValues.size === 0)) {
    return Object.freeze({ status: 'non_ready', reason: 'conflicting_evidence_must_remain_unresolved', transition: null });
  }
  if (!hasConflict) {
    const evidenceMatchesClaim = propositionValues.has(propositionValueKey);
    if (proposal.stance === 'unresolved_conflict'
      || (evidenceMatchesClaim && (!['believes_true', 'suspects_true'].includes(proposal.stance)
        || contradicting.length > 0))
      || (!evidenceMatchesClaim && (!['believes_false', 'suspects_false'].includes(proposal.stance)
        || supporting.length > 0))) {
      return Object.freeze({ status: 'non_ready', reason: 'stance_does_not_match_available_evidence', transition: null });
    }
  }

  let prior = null;
  if (currentBelief !== null) {
    if (!isPlainObject(currentBelief)
      || currentBelief.world_id !== knowledgeRead.world_id
      || currentBelief.actor_id !== knowledgeRead.actor_id
      || currentBelief.proposition_ref !== proposal.proposition_ref
      || !STANCES.has(currentBelief.stance)
      || !Array.isArray(currentBelief.evidence_acquisition_ids)) {
      return Object.freeze({ status: 'non_ready', reason: 'current_belief_scope_invalid', transition: null });
    }
    prior = currentBelief;
  }

  const survivingPriorEvidence = prior
    ? prior.evidence_acquisition_ids.filter((ref) => active.has(ref))
    : [];
  const invalidatedPriorEvidence = prior
    ? prior.evidence_acquisition_ids.filter((ref) => !active.has(ref))
    : [];

  const transition = Object.freeze({
    world_id: knowledgeRead.world_id,
    actor_id: knowledgeRead.actor_id,
    purpose: knowledgeRead.purpose,
    snapshot: Object.freeze({ ...knowledgeRead.snapshot }),
    proposition_ref: proposal.proposition_ref,
    proposition_value: canonicalPropositionValue,
    stance: proposal.stance,
    supporting_acquisition_ids: Object.freeze(supporting),
    contradicting_acquisition_ids: Object.freeze(contradicting),
    evidence_acquisition_ids: Object.freeze(allRefs),
    reason_rule_ref: proposal.reason_rule_ref,
    previous_stance: prior?.stance ?? null,
    surviving_prior_evidence: Object.freeze(survivingPriorEvidence),
    invalidated_prior_evidence: Object.freeze(invalidatedPriorEvidence),
    prior_stance_preserved_despite_invalidation: invalidatedPriorEvidence.length > 0
      && survivingPriorEvidence.length === 0,
  });
  return Object.freeze({ status: 'ready', reason: null, transition });
}

/**
 * Build a safe, actor-scoped context envelope from a Core read and a validated
 * transition. It intentionally contains no canonical facts beyond the read,
 * no retrieval candidates, and no withheld values.
 */
export function buildNpcBeliefContext(knowledgeRead, transition) {
  if (!isPlainObject(knowledgeRead) || knowledgeRead.status !== 'ready'
    || !validRef(knowledgeRead.world_id) || !validRef(knowledgeRead.actor_id)
    || !['npc_turn_context', 'npc_action_evaluation'].includes(knowledgeRead.purpose)
    || !isPlainObject(knowledgeRead.snapshot)
    || !Number.isSafeInteger(knowledgeRead.snapshot.world_revision)
    || !Number.isSafeInteger(knowledgeRead.snapshot.commit_sequence)
    || knowledgeRead.truncated === true
    || !Array.isArray(knowledgeRead.items)
    || !isPlainObject(transition)
    || transition.world_id !== knowledgeRead.world_id
    || transition.actor_id !== knowledgeRead.actor_id
    || !sameSnapshot(transition.snapshot, knowledgeRead.snapshot)) {
    return Object.freeze({ status: 'non_ready', reason: 'context_snapshot_or_actor_mismatch', context: null });
  }

  // This function is also a public module boundary: do not assume its caller
  // already passed the read through the reducer. Reject sparse/malformed rows
  // and duplicate IDs before constructing a map (which could otherwise throw
  // or silently replace evidence).
  const byId = new Map();
  for (let index = 0; index < knowledgeRead.items.length; index += 1) {
    const item = knowledgeRead.items[index];
    if (!(index in knowledgeRead.items) || !isPlainObject(item)
      || !validRef(item.acquisition_id) || byId.has(item.acquisition_id)) {
      return Object.freeze({ status: 'non_ready', reason: 'context_core_evidence_invalid', context: null });
    }
    byId.set(item.acquisition_id, item);
  }
  const evidence = transition.evidence_acquisition_ids;
  if (!Array.isArray(evidence) || evidence.some((id) => !byId.has(id))) {
    return Object.freeze({ status: 'non_ready', reason: 'context_evidence_no_longer_authorized', context: null });
  }

  // Re-run the pure reducer at the context boundary. This prevents a caller
  // from forging or mutating a transition between validation and context build.
  const revalidated = reduceNpcBeliefTransition({
    knowledgeRead,
    proposal: {
      world_id: transition.world_id,
      actor_id: transition.actor_id,
      snapshot: transition.snapshot,
      proposition_ref: transition.proposition_ref,
      proposition_value: transition.proposition_value,
      stance: transition.stance,
      supporting_acquisition_ids: transition.supporting_acquisition_ids,
      contradicting_acquisition_ids: transition.contradicting_acquisition_ids,
      reason_rule_ref: transition.reason_rule_ref,
    },
  });
  if (revalidated.status !== 'ready') {
    return Object.freeze({ status: 'non_ready', reason: 'context_transition_not_validated', context: null });
  }
  transition = revalidated.transition;
  const safeEvidence = evidence.map((id) => {
    const item = byId.get(id);
    return Object.freeze({
      acquisition_id: item.acquisition_id,
      fact_id: item.fact_id,
      subject_ref: item.subject_ref,
      predicate: item.predicate,
      value: freezeTree(JSON.parse(stableJson(item.value))),
      provenance_ref: item.provenance_ref,
      provenance_digest: item.provenance_digest,
      source_event_ids: item.source_event_ids,
    });
  });
  const context = Object.freeze({
    world_id: knowledgeRead.world_id,
    actor_id: knowledgeRead.actor_id,
    purpose: knowledgeRead.purpose,
    snapshot: Object.freeze({ ...knowledgeRead.snapshot }),
    proposition_ref: transition.proposition_ref,
    proposition_value: transition.proposition_value,
    belief_stance: transition.stance,
    epistemic_status: transition.stance === 'unresolved_conflict' ? 'conflicted' : 'belief_proposal',
    evidence: Object.freeze(safeEvidence),
    reason_rule_ref: transition.reason_rule_ref,
  });
  return Object.freeze({ status: 'ready', reason: null, context });
}
