// In-process provenance marker for trusted mechanic evaluations.
// This is an application wiring guard, not a cryptographic security boundary.
const trustedEvaluations = new WeakSet();

export function attestMechanicEvaluation(evaluation) {
  if (evaluation === null || typeof evaluation !== 'object' || Array.isArray(evaluation)) {
    throw new TypeError('Only an evaluation object can be attested.');
  }
  trustedEvaluations.add(evaluation);
  return evaluation;
}

export function isAttestedMechanicEvaluation(evaluation) {
  return evaluation !== null && typeof evaluation === 'object' && trustedEvaluations.has(evaluation);
}
