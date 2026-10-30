import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveHistoricalRelationshipEvaluator } from '../src/relationship/historical-evaluator-registry.js';
import { evaluateRelationshipCandidate as currentEvaluator } from '../src/relationship/evaluate-candidate.js';

const input = {
  subjectId: 'A',
  targetId: 'B',
  currentValues: { trust: 'low' },
  patch: { trust: 'guarded' },
  dimensionRules: {
    trust: {
      values: ['low', 'guarded', 'high'],
      allowClear: true,
      transitions: [{ operation: 'set', from: 'low', to: 'guarded' }],
    },
  },
  evidence: { status: 'supported', refs: ['event:E1'] },
  ruleVersion: 'relationship-rules@1.0.0',
};

test('resolves the exact historical Relationship evaluator artifact', () => {
  const artifact = resolveHistoricalRelationshipEvaluator('relationship-rules', '1.0.0');
  assert.ok(artifact);
  assert.equal(artifact.ruleModuleId, 'relationship-rules');
  assert.equal(artifact.ruleModuleVersion, '1.0.0');
  assert.equal(artifact.evaluatorContract, 'relationship-candidate/v1');
  assert.equal(typeof artifact.evaluator, 'function');
  assert.notEqual(artifact.evaluator, currentEvaluator);
});

test('does not substitute a newer or unknown historical evaluator', () => {
  assert.equal(resolveHistoricalRelationshipEvaluator('relationship-rules', '2.0.0'), null);
  assert.equal(resolveHistoricalRelationshipEvaluator('unknown-rules', '1.0.0'), null);
  assert.equal(resolveHistoricalRelationshipEvaluator('relationship-rules', ''), null);
});

test('the pinned historical evaluator is deterministic for identical inputs', () => {
  const artifact = resolveHistoricalRelationshipEvaluator('relationship-rules', '1.0.0');
  const first = artifact.evaluator(structuredClone(input));
  const second = artifact.evaluator(structuredClone(input));
  assert.deepEqual(first, second);
  assert.equal(first.status, 'candidate');
});
