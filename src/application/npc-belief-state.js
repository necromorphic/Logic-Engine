const STANCES = new Set([
  'believes_true',
  'believes_false',
  'suspects_true',
  'suspects_false',
  'unresolved_conflict',
]);

const isPlainObject = (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Reflect.ownKeys(value).every((key) => {
      if (typeof key !== 'string') return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor && descriptor.enumerable && Object.hasOwn(descriptor, 'value');
    });
  } catch {
    return false;
  }
};

const isDenseDataArray = (value, maxLength = 200) => {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length > maxLength) return false;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || !keys.includes('length')) return false;
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return false;
    }
    return true;
  } catch {
    return false;
  }
};

const isJsonDataTree = (value, state = { nodes: 0, ancestors: new Set(), depth: 0 }) => {
  state.nodes += 1;
  if (state.nodes > 10000 || state.depth > 32) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || utilTypes.isProxy(value) || state.ancestors.has(value)) return false;
  const array = Array.isArray(value);
  if (array ? !isDenseDataArray(value, 10000) : !isPlainObject(value)) return false;
  state.ancestors.add(value);
  state.depth += 1;
  try {
    if (array) {
      for (let index = 0; index < value.length; index += 1) {
        if (!isJsonDataTree(value[index], state)) return false;
      }
    } else {
      for (const key of Reflect.ownKeys(value)) {
        if (!isJsonDataTree(Object.getOwnPropertyDescriptor(value, key).value, state)) return false;
      }
    }
    return true;
  } catch {
    return false;
  } finally {
    state.depth -= 1;
    state.ancestors.delete(value);
  }
};

const validRef = (value) => typeof value === 'string'
  && value.length > 0
  && value.length <= 200
  && value === value.trim()
  && ![...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });

const uniqueRefs = (value, label) => {
  if (!isDenseDataArray(value, 200)) {
    throw new TypeError(label + ' must be a dense standard array of at most 200 references');
  }
  const result = [];
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!validRef(item)) throw new TypeError(label + ' contains an invalid reference');
    if (seen.has(item)) throw new TypeError(label + ' must not contain duplicate references');
    seen.add(item);
    result.push(item);
  }
  return result.sort();
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
function reduceNpcBeliefTransitionUnsafe({ knowledgeRead, currentBelief = null, proposal }) {
  if (!isPlainObject(knowledgeRead) || knowledgeRead.status !== 'ready'
    || !validRef(knowledgeRead.world_id) || !validRef(knowledgeRead.actor_id)
    || !['npc_turn_context', 'npc_action_evaluation'].includes(knowledgeRead.purpose)
    || !isPlainObject(knowledgeRead.snapshot)
    || !Number.isSafeInteger(knowledgeRead.snapshot.world_revision)
    || !Number.isSafeInteger(knowledgeRead.snapshot.commit_sequence)
    || knowledgeRead.truncated === true
    || !isDenseDataArray(knowledgeRead.items, 200)) {
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
    if (!isPlainObject(item) || !validRef(item.acquisition_id) || !isJsonDataTree(item.value)) {
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

  if (Object.hasOwn(knowledgeRead, 'withheld_proposition_refs')
    && (!isDenseDataArray(knowledgeRead.withheld_proposition_refs, 200)
      || knowledgeRead.withheld_proposition_refs.some((ref) => !validRef(ref)))) {
    return Object.freeze({ status: 'non_ready', reason: 'invalid_withheld_proposition_refs', transition: null });
  }
  if (Object.hasOwn(knowledgeRead, 'withheld_proposition_refs')
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
  if (!isJsonDataTree(proposal.proposition_value)) {
    return Object.freeze({ status: 'non_ready', reason: 'invalid_proposition_value', transition: null });
  }
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
      || !isDenseDataArray(currentBelief.evidence_acquisition_ids, 200)
      || currentBelief.evidence_acquisition_ids.some((ref) => !validRef(ref))) {
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

export function reduceNpcBeliefTransition(input) {
  try {
    if (!isPlainObject(input)) {
      return Object.freeze({ status: 'non_ready', reason: 'invalid_reducer_input', transition: null });
    }
    return reduceNpcBeliefTransitionUnsafe(input);
  } catch {
    return Object.freeze({ status: 'non_ready', reason: 'invalid_reducer_input', transition: null });
  }
}

/**
 * Build a safe, actor-scoped context envelope from a Core read and a validated
 * transition. It intentionally contains no canonical facts beyond the read,
 * no retrieval candidates, and no withheld values.
 */
function buildNpcBeliefContextUnsafe(knowledgeRead, transition) {
  if (!isPlainObject(knowledgeRead) || knowledgeRead.status !== 'ready'
    || !isPlainObject(transition)
    || transition.world_id !== knowledgeRead.world_id
    || transition.actor_id !== knowledgeRead.actor_id
    || !sameSnapshot(transition.snapshot, knowledgeRead.snapshot)) {
    return Object.freeze({ status: 'non_ready', reason: 'context_snapshot_or_actor_mismatch', context: null });
  }
  if (!isDenseDataArray(knowledgeRead.items, 200) || !isJsonDataTree(transition.proposition_value)) {
    return Object.freeze({ status: 'non_ready', reason: 'context_core_evidence_invalid', context: null });
  }
  const byId = new Map();
  for (const item of knowledgeRead.items) {
    if (!isPlainObject(item) || !validRef(item.acquisition_id) || !isJsonDataTree(item.value)) {
      return Object.freeze({ status: 'non_ready', reason: 'context_core_evidence_invalid', context: null });
    }
    byId.set(item.acquisition_id, item);
  }
  const evidence = transition.evidence_acquisition_ids;
  if (!isDenseDataArray(evidence, 200) || evidence.some((id) => !validRef(id) || !byId.has(id))) {
    return Object.freeze({ status: 'non_ready', reason: 'context_evidence_no_longer_authorized', context: null });
  }
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
}export function buildNpcBeliefContext(knowledgeRead, transition) {
  try {
    return buildNpcBeliefContextUnsafe(knowledgeRead, transition);
  } catch {
    return Object.freeze({ status: 'non_ready', reason: 'context_input_invalid', context: null });
  }
}


