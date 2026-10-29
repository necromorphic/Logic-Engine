import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNpcBeliefContext,
  reduceNpcBeliefTransition,
} from '../src/application/npc-belief-state.js';

const evidenceItems = [
  {
    acquisition_id: 'acq-support',
    fact_id: 'fact-location',
    subject_ref: 'character:target',
    predicate: 'location',
    value: 'Kamurochō',
    provenance_ref: 'authoring:source-a',
    provenance_digest: 'a'.repeat(64),
    source_event_ids: ['event-a'],
  },
  {
    acquisition_id: 'acq-contradict',
    fact_id: 'fact-location-alt',
    subject_ref: 'character:target',
    predicate: 'location',
    value: 'Sotenbori',
    provenance_ref: 'authoring:source-b',
    provenance_digest: 'b'.repeat(64),
    source_event_ids: ['event-b'],
  },
];
const knowledgeRead = (overrides = {}) => ({
  status: 'ready',
  world_id: 'world-a',
  actor_id: 'npc-a',
  purpose: 'npc_turn_context',
  snapshot: { world_revision: 7, commit_sequence: 12 },
  items: [evidenceItems[0]],
  ...overrides,
});
const propositionRef = 'proposition:character%3Atarget/location';

const proposal = (overrides = {}) => ({
  world_id: 'world-a',
  actor_id: 'npc-a',
  snapshot: { world_revision: 7, commit_sequence: 12 },
  proposition_ref: propositionRef,
  proposition_value: 'Kamurochō',
  stance: 'believes_true',
  supporting_acquisition_ids: ['acq-support'],
  contradicting_acquisition_ids: [],
  reason_rule_ref: 'rule:belief-update-v1',
  ...overrides,
});

test('accepts a belief proposal only when evidence belongs to the current Core read', () => {
  const result = reduceNpcBeliefTransition({ knowledgeRead: knowledgeRead(), proposal: proposal() });
  assert.equal(result.status, 'ready');
  assert.equal(result.transition.stance, 'believes_true');
  assert.deepEqual(result.transition.evidence_acquisition_ids, ['acq-support']);
  assert.equal(Object.isFrozen(result.transition), true);
});

test('fails closed when Core knowledge contains duplicate acquisition IDs', () => {
  const duplicateRead = knowledgeRead({
    items: [evidenceItems[0], { ...evidenceItems[0], value: 'Sotenbori' }],
  });
  const result = reduceNpcBeliefTransition({ knowledgeRead: duplicateRead, proposal: proposal() });
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'invalid_core_evidence');
  assert.equal(result.transition, null);
});

test('keeps contradictory admissible evidence unresolved instead of picking a winner', () => {
  const result = reduceNpcBeliefTransition({
    knowledgeRead: knowledgeRead({ items: evidenceItems }),
    proposal: proposal({
      stance: 'unresolved_conflict',
      supporting_acquisition_ids: ['acq-support'],
      contradicting_acquisition_ids: ['acq-contradict'],
    }),
  });
  assert.equal(result.status, 'ready');
  assert.equal(result.transition.stance, 'unresolved_conflict');
  assert.equal(result.transition.supporting_acquisition_ids.length, 1);
  assert.equal(result.transition.contradicting_acquisition_ids.length, 1);
  assert.equal(reduceNpcBeliefTransition({
    knowledgeRead: knowledgeRead({ items: evidenceItems }),
    proposal: proposal({
      stance: 'believes_true',
      supporting_acquisition_ids: ['acq-support'],
      contradicting_acquisition_ids: ['acq-contradict'],
    }),
  }).reason, 'conflicting_evidence_must_remain_unresolved');
});

test('rejects evidence belonging to another NPC, a stale snapshot, or an unacquired item', () => {
  assert.equal(reduceNpcBeliefTransition({
    knowledgeRead: knowledgeRead({ actor_id: 'npc-b' }),
    proposal: proposal(),
  }).reason, 'invalid_or_stale_proposal');
  assert.equal(reduceNpcBeliefTransition({
    knowledgeRead: knowledgeRead(),
    proposal: proposal({ snapshot: { world_revision: 6, commit_sequence: 12 } }),
  }).reason, 'invalid_or_stale_proposal');
  assert.equal(reduceNpcBeliefTransition({
    knowledgeRead: knowledgeRead(),
    proposal: proposal({ supporting_acquisition_ids: ['retrieval-only-fragment'] }),
  }).reason, 'evidence_not_currently_acquired');
});

test('does not treat missing evidence as evidence for false or unknown propositions', () => {
  const result = reduceNpcBeliefTransition({
    knowledgeRead: knowledgeRead(),
    proposal: proposal({ supporting_acquisition_ids: [], contradicting_acquisition_ids: [] }),
  });
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'belief_transition_requires_evidence');
});

test('rejects malformed provenance metadata before admitting evidence into a belief', () => {
  for (const malformed of [
    { ...evidenceItems[0], fact_id: '' },
    { ...evidenceItems[0], predicate: '' },
    { ...evidenceItems[0], provenance_ref: '  forged-source' },
    { ...evidenceItems[0], provenance_digest: 'A'.repeat(64) },
    { ...evidenceItems[0], provenance_digest: 'not-a-digest' },
  ]) {
    const result = reduceNpcBeliefTransition({
      knowledgeRead: knowledgeRead({ items: [malformed] }),
      proposal: proposal(),
    });
    assert.equal(result.status, 'non_ready');
    assert.equal(result.reason, 'invalid_evidence_provenance');
    assert.equal(result.transition, null);
  }
});

test('rejects duplicate and overlapping evidence references', () => {
  assert.equal(reduceNpcBeliefTransition({
    knowledgeRead: knowledgeRead(),
    proposal: proposal({ supporting_acquisition_ids: ['acq-support', 'acq-support'] }),
  }).reason, 'invalid_evidence_references');
  assert.equal(reduceNpcBeliefTransition({
    knowledgeRead: knowledgeRead(),
    proposal: proposal({
      supporting_acquisition_ids: ['acq-support'],
      contradicting_acquisition_ids: ['acq-support'],
    }),
  }).reason, 'evidence_cannot_support_and_contradict');
});

test('preserves prior belief stance when its evidence was revoked or is no longer in the current read', () => {
  const result = reduceNpcBeliefTransition({
    knowledgeRead: knowledgeRead({ items: [] }),
    currentBelief: {
      world_id: 'world-a',
      actor_id: 'npc-a',
      proposition_ref: propositionRef,
      stance: 'believes_true',
      evidence_acquisition_ids: ['acq-support'],
    },
    proposal: proposal(),
  });
  assert.equal(result.reason, 'evidence_not_currently_acquired');
  const withNewEvidence = reduceNpcBeliefTransition({
    knowledgeRead: knowledgeRead(),
    currentBelief: {
      world_id: 'world-a',
      actor_id: 'npc-a',
      proposition_ref: propositionRef,
      stance: 'believes_true',
      evidence_acquisition_ids: ['revoked-acquisition'],
    },
    proposal: proposal({ stance: 'suspects_true' }),
  });
  assert.equal(withNewEvidence.status, 'ready');
  assert.deepEqual(withNewEvidence.transition.invalidated_prior_evidence, ['revoked-acquisition']);
  assert.equal(withNewEvidence.transition.prior_stance_preserved_despite_invalidation, true);
  assert.equal(withNewEvidence.transition.previous_stance, 'believes_true');
});

test('classifies qualitative stance changes without inventing numeric confidence', () => {
  const reduce = (previousStance, nextStance, priorEvidence = ['acq-support']) => {
    const conflicting = nextStance === 'unresolved_conflict';
    const read = knowledgeRead({ items: conflicting ? evidenceItems : [evidenceItems[0]] });
    const currentBelief = previousStance === null ? null : {
      world_id: 'world-a',
      actor_id: 'npc-a',
      proposition_ref: propositionRef,
      stance: previousStance,
      evidence_acquisition_ids: priorEvidence,
    };
    const proposalOverrides = conflicting
      ? {
        stance: 'unresolved_conflict',
        supporting_acquisition_ids: ['acq-support'],
        contradicting_acquisition_ids: ['acq-contradict'],
      }
      : nextStance === 'believes_false' || nextStance === 'suspects_false'
        ? {
          stance: nextStance,
          supporting_acquisition_ids: [],
          contradicting_acquisition_ids: ['acq-support'],
          proposition_value: 'Sotenbori',
        }
        : {
          stance: nextStance,
          supporting_acquisition_ids: ['acq-support'],
          contradicting_acquisition_ids: [],
          proposition_value: 'Kamurochō',
        };
    return reduceNpcBeliefTransition({
      knowledgeRead: read,
      currentBelief,
      proposal: proposal(proposalOverrides),
    });
  };

  assert.equal(reduce(null, 'believes_true').transition.stance_change, 'initial');
  assert.equal(reduce('believes_true', 'believes_true').transition.stance_change, 'unchanged');
  const secondSupport = {
    ...evidenceItems[0],
    acquisition_id: 'acq-support-independent',
    provenance_ref: 'authoring:source-independent',
    provenance_digest: 'd'.repeat(64),
    source_event_ids: ['event-independent'],
  };
  const addedEvidence = reduceNpcBeliefTransition({
    knowledgeRead: knowledgeRead({ items: [evidenceItems[0], secondSupport] }),
    currentBelief: {
      world_id: 'world-a',
      actor_id: 'npc-a',
      proposition_ref: propositionRef,
      stance: 'believes_true',
      evidence_acquisition_ids: ['acq-support'],
    },
    proposal: proposal({ supporting_acquisition_ids: ['acq-support', 'acq-support-independent'] }),
  });
  assert.equal(addedEvidence.status, 'ready');
  assert.equal(addedEvidence.transition.stance_change, 'evidence_lineage_changed');
  assert.equal(reduce('suspects_true', 'believes_true').transition.stance_change, 'strengthened');
  assert.equal(reduce('believes_true', 'suspects_true').transition.stance_change, 'weakened');
  assert.equal(reduce('believes_true', 'believes_false').transition.stance_change, 'reversal');
  assert.equal(reduce('believes_true', 'unresolved_conflict').transition.stance_change, 'conflict_opened');
  assert.equal(reduce('unresolved_conflict', 'believes_true', ['acq-support', 'revoked-acquisition'])
    .transition.stance_change, 'evidence_lineage_changed');
  assert.equal(reduce('believes_true', 'believes_true', ['revoked-acquisition'])
    .transition.stance_change, 'evidence_invalidated_stance_preserved');
  assert.equal('confidence' in reduce(null, 'believes_true').transition, false);
});

test('context includes only the evidence explicitly admitted by the validated transition', () => {
  const read = knowledgeRead();
  const reduced = reduceNpcBeliefTransition({ knowledgeRead: read, proposal: proposal() });
  const built = buildNpcBeliefContext(read, reduced.transition);
  assert.equal(built.status, 'ready');
  assert.equal(built.context.evidence.length, 1);
  assert.equal(built.context.evidence[0].acquisition_id, 'acq-support');
  assert.equal('acq-contradict' in built.context.evidence[0], false);
  assert.equal(Object.isFrozen(built.context), true);
});

test('context ignores caller-injected evidence outside the validated belief transition', () => {
  const unrelated = {
    acquisition_id: 'acq-unrelated',
    fact_id: 'fact-secret',
    subject_ref: 'character:other',
    predicate: 'secret',
    value: 'classified',
    provenance_ref: 'authoring:source-secret',
    provenance_digest: 'c'.repeat(64),
    source_event_ids: ['event-secret'],
  };
  const read = knowledgeRead({ items: [evidenceItems[0], unrelated] });
  const reduced = reduceNpcBeliefTransition({ knowledgeRead: read, proposal: proposal() });
  assert.equal(reduced.status, 'ready');

  // Simulate a forged/mutated transition that tries to smuggle a second,
  // unrelated acquisition into the NPC context after validation.
  const forged = {
    ...reduced.transition,
    evidence_acquisition_ids: ['acq-support', 'acq-unrelated'],
  };
  const built = buildNpcBeliefContext(read, forged);
  assert.equal(built.status, 'ready');
  assert.deepEqual(built.context.evidence.map((item) => item.acquisition_id), ['acq-support']);
  assert.equal(built.context.evidence.some((item) => item.value === 'classified'), false);
});

test('context preserves the distinction between belief, suspicion, and unresolved conflict', () => {
  const read = knowledgeRead();
  const build = (stance, overrides = {}) => {
    const reduced = reduceNpcBeliefTransition({
      knowledgeRead: read,
      proposal: proposal({ stance, ...overrides }),
    });
    assert.equal(reduced.status, 'ready');
    return buildNpcBeliefContext(read, reduced.transition);
  };

  assert.equal(build('believes_true').context.epistemic_status, 'belief');
  assert.equal(build('suspects_true').context.epistemic_status, 'suspicion');

  const conflictRead = knowledgeRead({ items: evidenceItems });
  const conflict = reduceNpcBeliefTransition({
    knowledgeRead: conflictRead,
    proposal: proposal({
      stance: 'unresolved_conflict',
      supporting_acquisition_ids: ['acq-support'],
      contradicting_acquisition_ids: ['acq-contradict'],
    }),
  });
  assert.equal(conflict.status, 'ready');
  assert.equal(buildNpcBeliefContext(conflictRead, conflict.transition).context.epistemic_status, 'conflicted');
});

test('context refuses actor or snapshot mismatch and evidence removed after reduction', () => {
  const read = knowledgeRead();
  const reduced = reduceNpcBeliefTransition({ knowledgeRead: read, proposal: proposal() });
  assert.equal(buildNpcBeliefContext(knowledgeRead({ actor_id: 'npc-b' }), reduced.transition).reason,
    'context_snapshot_or_actor_mismatch');
  assert.equal(buildNpcBeliefContext(knowledgeRead({ snapshot: { world_revision: 8, commit_sequence: 12 } }), reduced.transition).reason,
    'context_snapshot_or_actor_mismatch');
  assert.equal(buildNpcBeliefContext(knowledgeRead({ items: [] }), reduced.transition).reason,
    'context_evidence_no_longer_authorized');
  const forged = { ...reduced.transition, stance: 'believes_false' };
  const forgedContext = buildNpcBeliefContext(read, forged);
  assert.equal(forgedContext.status, 'non_ready');
  assert.equal(forgedContext.reason, 'context_transition_not_validated');
  assert.equal(forgedContext.context, null);
});

test('a false belief remains explicit when Core evidence contradicts the proposed proposition value', () => {
  const result = reduceNpcBeliefTransition({
    knowledgeRead: knowledgeRead(),
    proposal: proposal({
      proposition_value: 'Sotenbori',
      stance: 'believes_false',
      supporting_acquisition_ids: [],
      contradicting_acquisition_ids: ['acq-support'],
    }),
  });
  assert.equal(result.status, 'ready');
  assert.equal(result.transition.stance, 'believes_false');
  assert.equal(result.transition.proposition_value, 'Sotenbori');
});

test('a model cannot omit contradictory evidence or cite a different proposition', () => {
  assert.equal(reduceNpcBeliefTransition({
    knowledgeRead: knowledgeRead({ items: evidenceItems }),
    proposal: proposal({
      supporting_acquisition_ids: ['acq-support'],
      contradicting_acquisition_ids: [],
    }),
  }).reason, 'all_current_proposition_evidence_must_be_accounted_for');
  assert.equal(reduceNpcBeliefTransition({
    knowledgeRead: knowledgeRead(),
    proposal: proposal({ proposition_value: 'Sotenbori' }),
  }).reason, 'evidence_side_does_not_match_proposition_value');
});

test('withheld evidence for the same proposition blocks belief update without exposing the hidden value', () => {
  const result = reduceNpcBeliefTransition({
    knowledgeRead: knowledgeRead({
      withheld_proposition_refs: [propositionRef],
    }),
    proposal: proposal(),
  });
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'proposition_has_withheld_evidence');
  assert.equal('withheld_proposition_refs' in result, false);
});

test('a truncated Core acquisition window cannot produce a belief transition', () => {
  const result = reduceNpcBeliefTransition({
    knowledgeRead: knowledgeRead({ truncated: true }),
    proposal: proposal(),
  });
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'core_knowledge_read_not_ready');
});


test('context builder fails closed for malformed Core reads instead of throwing or replacing evidence', () => {
  const read = knowledgeRead();
  const reduced = reduceNpcBeliefTransition({ knowledgeRead: read, proposal: proposal() });
  const sparseItems = [];
  sparseItems.length = 1;
  const duplicateItems = [evidenceItems[0], { ...evidenceItems[0], value: 'Sotenbori' }];

  for (const malformedRead of [
    { ...read, items: null },
    { ...read, items: sparseItems },
    { ...read, items: duplicateItems },
    { ...read, purpose: 'unknown-purpose' },
    { ...read, snapshot: { world_revision: Number.MAX_SAFE_INTEGER + 1, commit_sequence: 1 } },
    { ...read, truncated: true },
  ]) {
    const result = buildNpcBeliefContext(malformedRead, reduced.transition);
    assert.equal(result.status, 'non_ready');
    assert.equal(result.context, null);
  }

  assert.equal(buildNpcBeliefContext(read, reduced.transition).status, 'ready');
});

test('context evidence owns an immutable copy of source event IDs', () => {
  const sourceEventIds = ['event-a'];
  const read = knowledgeRead({ items: [{ ...evidenceItems[0], source_event_ids: sourceEventIds }] });
  const reduced = reduceNpcBeliefTransition({ knowledgeRead: read, proposal: proposal() });
  const built = buildNpcBeliefContext(read, reduced.transition);

  assert.equal(built.status, 'ready');
  assert.equal(Object.isFrozen(built.context.evidence[0].source_event_ids), true);
  sourceEventIds.push('event-added-after-context-build');
  assert.deepEqual(built.context.evidence[0].source_event_ids, ['event-a']);
  assert.throws(() => built.context.evidence[0].source_event_ids.push('event-forged'));

  const malformed = knowledgeRead({
    items: [{ ...evidenceItems[0], source_event_ids: ['event-a', 'event-a'] }],
  });
  const malformedTransition = reduceNpcBeliefTransition({ knowledgeRead: malformed, proposal: proposal() });
  assert.equal(buildNpcBeliefContext(malformed, malformedTransition.transition).reason,
    'context_core_evidence_invalid');
});

test('rejects prior belief history linked to active evidence for a different proposition', () => {
  const unrelated = {
    acquisition_id: 'acq-unrelated',
    fact_id: 'fact-secret',
    subject_ref: 'character:other',
    predicate: 'secret',
    value: 'classified',
    provenance_ref: 'authoring:source-secret',
    provenance_digest: 'c'.repeat(64),
    source_event_ids: ['event-secret'],
  };
  const result = reduceNpcBeliefTransition({
    knowledgeRead: knowledgeRead({ items: [evidenceItems[0], unrelated] }),
    currentBelief: {
      world_id: 'world-a',
      actor_id: 'npc-a',
      proposition_ref: propositionRef,
      stance: 'believes_true',
      evidence_acquisition_ids: ['acq-unrelated'],
    },
    proposal: proposal({ stance: 'suspects_true' }),
  });
  assert.equal(result.status, 'non_ready');
  assert.equal(result.reason, 'current_belief_scope_invalid');
  assert.equal(result.transition, null);
});

test('rejects malformed, duplicate, or sparse references in prior belief history', () => {
  const baseBelief = {
    world_id: 'world-a',
    actor_id: 'npc-a',
    proposition_ref: propositionRef,
    stance: 'believes_true',
    evidence_acquisition_ids: ['revoked-acquisition'],
  };
  const sparseEvidence = [];
  sparseEvidence.length = 1;

  for (const evidenceIds of [
    ['revoked-acquisition', 'revoked-acquisition'],
    sparseEvidence,
    ['valid-ref', ''],
    Array.from({ length: 201 }, (_, index) => 'ref-' + index),
  ]) {
    const result = reduceNpcBeliefTransition({
      knowledgeRead: knowledgeRead(),
      currentBelief: { ...baseBelief, evidence_acquisition_ids: evidenceIds },
      proposal: proposal({ stance: 'suspects_true' }),
    });
    assert.equal(result.status, 'non_ready');
    assert.equal(result.reason, 'current_belief_scope_invalid');
    assert.equal(result.transition, null);
  }
});

