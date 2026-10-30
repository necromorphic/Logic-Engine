import { evaluateRelationshipCandidate as relationshipRulesV1 } from './evaluators/relationship-rules/1.0.0.js';

// Deployment-owned, immutable allowlist. A new semantic implementation gets a
// new version-addressed artifact and an explicit entry; never mutate an old one.
const ARTIFACTS = new Map([
  ['relationship-rules@1.0.0', Object.freeze({
    ruleModuleId: 'relationship-rules',
    ruleModuleVersion: '1.0.0',
    evaluatorContract: 'relationship-candidate/v1',
    evaluator: relationshipRulesV1,
  })],
]);

/** Resolve an executable historical evaluator by exact module ID and version.
 * Returns null for every unknown pin. There is deliberately no latest fallback.
 */
export function resolveHistoricalRelationshipEvaluator(ruleModuleId, ruleModuleVersion) {
  if (typeof ruleModuleId !== 'string' || !ruleModuleId.trim()
    || typeof ruleModuleVersion !== 'string' || !ruleModuleVersion.trim()) return null;
  return ARTIFACTS.get(ruleModuleId + '@' + ruleModuleVersion) ?? null;
}
