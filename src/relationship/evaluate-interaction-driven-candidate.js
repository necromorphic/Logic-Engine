/**
 * Gate an explicitly proposed Relationship transition on an unambiguous
 * interpretation of the interaction that the caller says motivated it.
 *
 * This composes existing pure domain helpers only. It does not derive a patch
 * from an interpretation, resolve World Pack versions, authorize evidence, or
 * write canonical state. Input/output are internal module shapes, not an API.
 */
import { assessInteractionInterpretations } from "./assess-interaction-interpretations.js";
import { evaluateRelationshipCandidate } from "./evaluate-candidate.js";

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isRecord = (value) => value !== null
  && typeof value === "object"
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const result = (status, details = {}) => Object.freeze({ status, ...details });

/**
 * @param {{
 *   assessments: Array<{interpretation: string, status: string, refs?: string[]}>,
 *   expectedInterpretation: string,
 *   candidate: {
 *     subjectId: string, targetId: string, currentValues: object, patch: object,
 *     dimensionRules: object, ruleVersion: string
 *   }
 * }} input
 */
export function evaluateInteractionDrivenRelationshipCandidate(input) {
  if (!isRecord(input)
      || !Object.keys(input).every((key) =>
        ["assessments", "expectedInterpretation", "candidate"].includes(key))
      || !own(input, "assessments")
      || typeof input.expectedInterpretation !== "string"
      || input.expectedInterpretation.trim().length === 0
      || !isRecord(input.candidate)
      || !Object.keys(input.candidate).every((key) => [
        "subjectId", "targetId", "currentValues", "patch", "dimensionRules", "ruleVersion",
      ].includes(key))
      || ["subjectId", "targetId", "currentValues", "patch", "dimensionRules", "ruleVersion"]
        .some((key) => !own(input.candidate, key))) {
    return result("invalid_candidate", { reason: "interaction_candidate_shape_invalid" });
  }

  const assessment = assessInteractionInterpretations({ assessments: input.assessments });
  if (assessment.status !== "supported") {
    return result("interaction_evidence_rejected", {
      assessmentStatus: assessment.status,
      reason: assessment.reason,
    });
  }

  if (assessment.interpretation !== input.expectedInterpretation.trim()) {
    return result("conflict_review_required", {
      reason: "candidate_interpretation_mismatch",
    });
  }

  const transition = evaluateRelationshipCandidate({
    ...input.candidate,
    evidence: { status: "supported", refs: assessment.evidenceRefs },
  });

  if (transition.status !== "candidate") {
    return result("transition_rejected", {
      assessmentStatus: assessment.status,
      transitionStatus: transition.status,
      reason: transition.reason,
      ...(own(transition, "dimension") ? { dimension: transition.dimension } : {}),
    });
  }

  return result("candidate", {
    subjectId: transition.subjectId,
    targetId: transition.targetId,
    ruleVersion: transition.ruleVersion,
    interpretation: assessment.interpretation,
    evidenceRefs: transition.evidenceRefs,
    patch: transition.patch,
    changedDimensions: transition.changedDimensions,
  });
}
