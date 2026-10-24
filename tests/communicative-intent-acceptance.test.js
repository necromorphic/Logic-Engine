import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const fixtureUrl = new URL('./fixtures/communicative-intent-cases.json', import.meta.url);
const corpus = JSON.parse(readFileSync(fileURLToPath(fixtureUrl), 'utf8'));

const allowedStatuses = new Set([
  'assessed',
  'disputed',
  'stale_then_reassess',
  'stale_or_withheld',
  'unverified_non_ready',
]);

test('communicative-intent corpus is versioned, non-empty, and has unique case IDs', () => {
  assert.equal(corpus.version, 1);
  assert.ok(Array.isArray(corpus.cases));
  assert.ok(corpus.cases.length >= 20);
  const ids = corpus.cases.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => /^CI-\d{3}$/.test(id)));
});

test('every case records multiple candidates, contextual evidence, and explicit safety invariants', () => {
  for (const entry of corpus.cases) {
    assert.equal(typeof entry.name, 'string', entry.id);
    assert.equal(typeof entry.utterance, 'string', entry.id);
    assert.ok(entry.utterance.length > 0, entry.id);
    assert.ok(Array.isArray(entry.context) && entry.context.length > 0, entry.id);
    assert.ok(Array.isArray(entry.candidates) && entry.candidates.length >= 2, entry.id);
    assert.equal(new Set(entry.candidates).size, entry.candidates.length, entry.id);
    assert.ok(allowedStatuses.has(entry.expected_status), entry.id);
    assert.ok(Array.isArray(entry.must_preserve) && entry.must_preserve.length > 0, entry.id);
    assert.ok(Array.isArray(entry.forbidden_promotions) && entry.forbidden_promotions.length > 0, entry.id);
    assert.ok(entry.forbidden_promotions.some((value) => /fact|confirmed|consent|authorization|permission|belief|history|current_use|grounded/i.test(value)), entry.id);
  }
});

test('flirtation candidates never imply consent or permission', () => {
  const flirtCases = corpus.cases.filter((entry) => entry.candidates.includes('flirtation'));
  assert.ok(flirtCases.length >= 2);
  for (const entry of flirtCases) {
    assert.ok(entry.forbidden_promotions.includes('consent'), entry.id);
  }
});

test('mixed threat and joking/banter preserve the possibility of both readings', () => {
  const mixedCases = corpus.cases.filter((entry) =>
    entry.candidates.includes('threat')
    && entry.candidates.some((candidate) => /joke|banter|theatrical/i.test(candidate)));
  assert.ok(mixedCases.length >= 1);
  for (const entry of mixedCases) {
    assert.ok(entry.must_preserve.includes('mixed_intent_possible'), entry.id);
    assert.ok(entry.forbidden_promotions.includes('joke_cancels_threat'), entry.id);
  }
});

test('edited, deleted, unverifiable, or missing-rule sources cannot be promoted as current truth', () => {
  const sourceFailureCases = corpus.cases.filter((entry) =>
    ['edited_revision', 'deleted', 'unverifiable', 'context_rule_unavailable'].includes(entry.source_status));
  assert.equal(sourceFailureCases.length, 4);
  for (const entry of sourceFailureCases) {
    assert.ok(['stale_then_reassess', 'stale_or_withheld', 'unverified_non_ready'].includes(entry.expected_status), entry.id);
    assert.ok(entry.must_preserve.some((value) => /invalidation|revision|source_uncertainty|missing_rule_status/i.test(value)), entry.id);
  }
});

test('subject-relative readings remain separate and are not shared without communication', () => {
  const entry = corpus.cases.find((candidate) => candidate.id === 'CI-009');
  assert.ok(entry);
  assert.ok(entry.must_preserve.includes('subject_relative_interpretations'));
  assert.ok(entry.forbidden_promotions.includes('shared_belief_without_communication'));
});

test('model confidence and a speaker claim are not independently authoritative', () => {
  const confidenceCase = corpus.cases.find((entry) => entry.id === 'CI-020');
  const disagreementCase = corpus.cases.find((entry) => entry.id === 'CI-008');
  assert.ok(confidenceCase);
  assert.ok(disagreementCase);
  assert.ok(confidenceCase.must_preserve.includes('confidence_authority_separation'));
  assert.ok(confidenceCase.forbidden_promotions.includes('confidence_equals_confirmation'));
  assert.ok(disagreementCase.must_preserve.includes('separate_subject_claims'));
  assert.ok(disagreementCase.forbidden_promotions.includes('speaker_claim_equals_objective_truth'));
});

// These tests validate the semantic corpus only. They do not execute an LLM,
// prove classification quality, or establish any production/runtime behavior.
