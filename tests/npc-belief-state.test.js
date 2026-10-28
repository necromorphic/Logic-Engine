import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNpcBeliefContext,
  reduceNpcBeliefTransition,
} from '../src/application/npc-belief-state.js';

const knowledgeRead = (overrides = {}) => ({
  status: 'ready',
  world_id: 'world-a',
  actor_id: 'npc-a',
  purpose: 'npc_turn_context',
  snapshot: { world_revision: 7, commit_sequence: 12 },
  items: [
    {
      acquisition_id: 'acq-support',
      fact_id: 'fact-location',
      subject_ref: 'character:target',
      predicate: 'location',
      value: 'Kamurocho',
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
  ],
  ...overrides,
});

const proposal = (overrides = {}) => ({
  world_id: 'world-a',
  actor_id: 'npc-a',
  snapshot: { world_revision: 7, commit_sequence: 12 },
  proposition_ref: 'proposition:target-location',
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

test('keeps contradictory admissible evidence unresolved instead of picking a winner', () => {
  const result = reduceNpcBeliefTransition({
    knowledgeRead: knowledgeRead(),
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
    knowledgeRead: knowledgeRead(),
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
      proposition_ref: 'proposition:target-location',
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
      proposition_ref: 'proposition:target-location',
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
});
