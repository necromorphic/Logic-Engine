# Relationships — interaction-gated transition candidate

Status: second pure domain-logic slice; no runtime integration.

## Purpose

This helper composes the existing interaction-interpretation assessor with the existing Relationship candidate evaluator. It closes a small but important domain gap: an explicitly proposed partial relationship patch is not eligible for evaluation unless the caller's declared motivating interpretation matches the single supported interpretation returned by the assessor.

## Behavior

- Ambiguous, withheld, unsupported, or insufficient assessments stop before transition evaluation.
- The caller must explicitly supply both the proposed patch and its expected interpretation. This helper never maps labels such as `flirtation`, `teasing`, or `sarcasm` to relationship dimensions.
- A mismatch between assessed and expected interpretation requires conflict review.
- A matching interpretation passes only deduplicated evidence references from the assessor to `evaluateRelationshipCandidate`.
- The existing evaluator still enforces the supplied dimension domain, current state, allowed transition, and rule-version label shape.
- Invalid transition proposals remain rejected; the helper exposes no partial patch on rejection.

## Boundaries

The helper does not resolve or verify a World Pack version against a registry, authorize event references, read canonical state, infer intent/consent/reciprocity, decide which patch follows from a social signal, or commit events. Those concerns remain with the existing responsible modules and Core lifecycle. The input/output are internal module shapes, not a public API, wire contract, or new World Pack schema.

## Tests

`tests/relationship-evaluate-interaction-driven-candidate.test.js` covers matching interpretation, no inferred patch, mismatch rejection, ambiguity/withholding, existing transition-rule enforcement, rejection of caller-supplied evidence/extra fields, and immutability.
