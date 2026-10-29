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
