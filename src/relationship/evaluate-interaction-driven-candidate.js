/**
 * Gate an explicitly proposed Relationship transition on an unambiguous
 * interpretation of the interaction that the caller says motivated it.
 *
 * This composes existing pure domain helpers only. It does not derive a patch
 * from an interpretation, resolve World Pack versions, authorize evidence, or
 * write canonical state. Input/output are internal module shapes, not an API.
 */
import { isProxy } from "node:util/types";
import { assessInteractionInterpretations } from "./assess-interaction-interpretations.js";
import { evaluateRelationshipCandidate } from "./evaluate-candidate.js";

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

const isRecord = (value) => {
  if (value === null || typeof value !== "object" || Array.isArray(value) || isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === "string"
      && descriptor !== undefined
      && descriptor.enumerable
      && own(descriptor, "value");
  });
};

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
      || !own(input, "expectedInterpretation")
      || typeof input.expectedInterpretation !== "string"
      || input.expectedInterpretation.trim().length === 0
      || !own(input, "candidate")
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

  // The top-level candidate is data-only before spreading; nested shapes are
  // validated by the existing evaluator without granting them new authority.
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
