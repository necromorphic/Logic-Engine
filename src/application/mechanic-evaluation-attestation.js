// In-process provenance marker for trusted mechanic evaluations.
// This is an application wiring guard, not a cryptographic security boundary.
const trustedEvaluations = new WeakSet();

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Object.keys(value)) deepFreeze(value[key], seen);
  return Object.freeze(value);
}

export function attestMechanicEvaluation(evaluation) {
  if (evaluation === null || typeof evaluation !== 'object' || Array.isArray(evaluation)) {
    throw new TypeError('Only an evaluation object can be attested.');
  }
  const immutableEvaluation = deepFreeze(evaluation);
  trustedEvaluations.add(immutableEvaluation);
  return immutableEvaluation;
}

export function isAttestedMechanicEvaluation(evaluation) {
  return evaluation !== null && typeof evaluation === 'object' && trustedEvaluations.has(evaluation);
}
