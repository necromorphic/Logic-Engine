# Relationships — social-interaction evidence assessment

Status: first domain-logic slice; pure helper only, not a production receiver or NPC/Core integration.

## Purpose

Relationships needs to reason about whether an already-interpreted social interaction is sufficiently unambiguous to support a downstream relationship-domain decision. The first slice is intentionally narrower than a social-signal classifier: it aggregates NPC-supplied interpretations and their evidence statuses, and refuses to promote an interpretation when evidence is withheld, unsupported, insufficient, explicitly conflicting, or points to multiple readings.

This is not raw-language classification. It does not decide that a sentence is flirtation, sarcasm, irony, teasing, hostility, care, rejection, or anything else. Those interpretations must come from the authorized character-relative perception path (NPC). This helper only assesses the supplied interpretation assessments.

## Current pure helper

Source: `src/relationship/assess-interaction-interpretations.js`.

Input is an internal module shape, not a public API or persistence schema:
- `assessments`: non-empty array of `{ interpretation, status, refs }`.
- `status` is one of `supported`, `withheld`, `insufficient`, `conflict`, or `unsupported`.
- A supported assessment requires non-empty unique evidence references.
- Extra fields and malformed data are rejected.

Deterministic policy:
1. Invalid input → `invalid_input`.
2. Any withheld assessment → `withheld`; no interpretation details are returned.
3. Otherwise any unsupported assessment → `unsupported`.
4. Otherwise any explicit conflict → `conflict_review_required`.
5. Otherwise any insufficient assessment → `insufficient_evidence`.
6. If supported assessments disagree on interpretation → `conflict_review_required`; there is no majority vote.
7. If all supported assessments agree → `supported`, returning that interpretation and a sorted, deduplicated union of evidence references.

This is deliberately conservative. Repeated agreement does not establish truth or increase confidence numerically. The helper does not weight sources, infer intent, or determine whether a relationship dimension should change.

## Ownership boundary

- **NPC** remains responsible for character-relative observation and interpretation, including knowledge and perspective limits.
- **Relationships** assesses whether supplied interpretations are sufficiently consistent and evidence-backed to proceed to relationship-domain rules.
- **Core** remains responsible for evidence authority/scope validation, canonical state, commit, persistence and event lifecycle.
- **Personality** retains ownership of stable traits and its own traceability.
- World Pack rule metadata and the existing typed-transition contract are unchanged. This helper is not wired into the Core transition route and does not alter existing rule-module schemas.

## Explicit non-goals

No raw text or behavior classifier; no automatic relationship delta; no reciprocity, consent, attraction, motive, or commitment inference; no durable personality inference; no canonical reads/writes; no event creation; no migration/re-evaluation runtime path; no new API, storage field, World Pack field, or NPC transport contract.

## Acceptance tests

`tests/relationship-assess-interaction-interpretations.test.js` covers agreement, flirtation-vs-sarcasm ambiguity, no majority vote, insufficient/withheld/unsupported/conflict handling, reference validation/deduplication, malformed inputs, immutability, and absence of relationship-delta inference.

These are pure helper tests only. Production readiness still requires approved NPC→Relationships input semantics and a real Core-authorized integration path.
