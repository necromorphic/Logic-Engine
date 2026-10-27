# Relationships — NPC interpretation boundary and uncertainty semantics

Status: domain-side clarification for the NPC → Relationships v0.2 review. This document does not define a transport contract, runtime API, persistence schema, or new state model. It describes the existing pure helper proposal in PR #459 and marks the remaining cross-block gaps explicitly.

Related sources:
- `docs/76-relationships-social-interaction-evidence-assessment.md`
- `docs/77-relationships-interaction-gated-transition-candidate.md`
- `src/relationship/assess-interaction-interpretations.js` (PR #459)
- `src/relationship/evaluate-interaction-driven-candidate.js` (PR #459)
- `tests/relationship-assess-interaction-interpretations.test.js` (PR #459)
- `tests/relationship-evaluate-interaction-driven-candidate.test.js` (PR #459)
- Core provenance/source-invalidation ownership: Issue #260
- World Pack/history boundary: `docs/75-relationships-world-pack-version-semantics.md`

## 1. Input decision: one interpretation or competing candidates?

**Decision:** Relationships may assess multiple already-prepared interpretation assessments without choosing which interpretation is psychologically or factually “correct.” A caller may also provide one assessment. The pure helper is not a classifier and does not replace NPC's character-relative perception.

Current helper behavior:
- One supported interpretation with non-empty evidence references can return `supported`.
- Multiple assessments with the same normalized interpretation can return `supported`; their references are unioned and deduplicated.
- Distinct supported interpretations return `conflict_review_required`. There is no majority vote, source-count weighting, or “most likely” winner.
- A caller's expected interpretation must match the one supported interpretation before the separate candidate evaluator is called. A mismatch is rejected before transition evaluation.

**Limit:** “Compatible but differently worded” interpretations are not currently represented as a domain relation. The helper compares trimmed strings; it does not infer that “teasing,” “affection,” and “flirtation” are equivalent or compatible. Treat distinct labels as conflict unless an approved domain rule explicitly establishes their equivalence. No such mapping or schema is added here.

Evidence: `assessInteractionInterpretations` in `src/relationship/assess-interaction-interpretations.js`; tests `does not vote between different supported interpretations`, `does not resolve ambiguity by majority vote`, `same interpretation from multiple assessments aggregates unique evidence refs`; candidate tests `rejects a candidate whose declared motivating interpretation differs` and `ambiguous or withheld interaction evidence never reaches transition evaluation`.

## 2. Uncertainty and the meaning of “supported”

The helper's statuses are gate outcomes over supplied assessments, not universal epistemic states and not proof of objective truth:

| Result | Relationships meaning | Does not establish |
|---|---|---|
| `supported` | The supplied assessments agree on one normalized interpretation and each supported assessment has non-empty unique refs. The candidate may proceed to domain-rule evaluation if its declared interpretation matches. | Truth, intent, consent, attraction, belief of a particular NPC, evidence authorization, or permission to commit. |
| `insufficient_evidence` | At least one assessment says the supplied basis is insufficient; do not promote another reading from the same batch. | That the interaction did not happen or that the opposite interpretation is true. |
| `conflict_review_required` | Explicit conflict exists, distinct supported readings remain, or the proposed candidate's interpretation differs from the assessed reading. | Which interpretation should win, objective truth, or permission to commit. |
| `unsupported` | At least one assessment is marked unsupported; no relationship candidate is promoted by this helper. | A negative relationship value or proof that a source is false. |
| `withheld` | At least one assessment is withheld; the helper suppresses interpretation and evidence-reference details in its result. | That the withheld interpretation is false or absent, that withheld material may be disclosed, or permission to commit. |
| `invalid_input` | The internal input shape is malformed or outside the helper's narrow contract. | A semantic judgment about the interaction. |

An assessment's inclusion in context, retrieval, admission, or a list of candidates is not itself a status of `supported`. A non-empty reference is a reference string only; the helper does not authenticate its source, validate access, or establish provenance. Core owns those checks.

The implementation validates the shape of all assessments before applying semantic status precedence. Among valid assessments, precedence is conservative: withheld → unsupported → explicit conflict → insufficient → distinct supported readings → one supported reading. Precedence is a fail-closed aggregation rule, not a ranking of psychological plausibility.

Evidence: source and tests listed above; the Core handoff `docs/74-relationships-typed-transition-handoff.md` distinguishes evaluator outcomes from canonical values and authority.

## 3. Reconsideration after new evidence, contradiction, or source withdrawal

**Supported today:** The pure helpers are stateless. A caller can submit a new batch of assessments and evaluate a new candidate. The helpers do not mutate the prior input, and they do not directly mutate relationship state. A rejected result contains no candidate patch.

**Not supported by this helper:** It has no durable interpretation identity, revision history, supersession relation, source-validity ledger, event-invalidation mechanism, or canonical audit lifecycle. It cannot preserve an interpretation's history across requests by itself. It cannot discover that a referenced source was later edited, withdrawn, rolled back, or invalidated.

Required domain behavior:
1. A later interpretation is a new assessment of the available evidence, not an in-place rewrite of the historical assessment.
2. Reassessment must not automatically reset, reverse, or otherwise mutate a relationship value. Any resulting relationship transition must be independently justified by current evidence and allowed domain rules, then submitted through the existing authorized Core path.
3. If source validity or provenance has changed, Relationships must not treat the old reference string as still valid merely because it remains in an input array.
4. Historical committed events retain their historical meaning. Projection replay, historical semantic re-evaluation, and meaning-changing migration remain distinct operations as defined in `docs/75-relationships-world-pack-version-semantics.md`.

**BLOCKED — Core (#260 / existing Core provenance and source-invalidation ownership):** The current pure helper has no approved input representing authoritative source invalidation or revision lineage. Do not invent such a field or claim that re-running the helper preserves audit history. Core must supply an approved provenance/invalidation boundary before end-to-end behavior can be tested.

**BLOCKED — NPC:** The transport and ownership contract for how NPC supplies character-relative interpretation candidates and any NPC-relative knowledge/belief state is not implemented by these pure Relationships helpers. This document does not prescribe new NPC fields or state.

## 4. Ownership boundary

- **NPC:** character-relative observation, perspective, interpretation candidates, and NPC-owned knowledge/belief state within its approved contract. It must not treat a Relationships gate result as a substitute for its own epistemic state.
- **Relationships:** determine whether supplied interpretations are sufficiently consistent for a relationship-domain candidate; enforce domain transition rules; keep ambiguity explicit; never infer consent, intent, reciprocity, commitment, or stable Personality traits from a signal alone.
- **Core:** authoritative source identity/provenance, source invalidation, canonical authorization, persistence, event/audit lifecycle, commit/replay, and any approved historical correction or migration path.
- **Personality:** stable traits and Personality-owned semantic traceability; a transient interpretation does not silently become a durable trait.

The helper's `supported` result is an internal domain assessment only. It is not a trusted actor assertion, canonical relationship fact, or production NPC→Relationships receiver. Production Memory→NPC remains DISABLED / FAIL-CLOSED.


## 5. Crosswalk to Core's proposed epistemic states

Core PR #339, `docs/77-core-communicative-intent-interpretation-contract.md`, proposes conceptual states `candidate`, `model-selected`, `explicitly confirmed`, `disputed`, and `stale / revoked`. That document is still a draft proposal, not an implemented runtime contract. These labels are **not** the same enum as Relationships' local assessment outcomes.

- Core's `candidate` / `model-selected` can be input context for an assessment, but neither automatically satisfies Relationships' `supported` gate.
- Core's `explicitly confirmed` only confirms the narrow proposition supported by the permitted source. It does not automatically establish a relationship dimension or a broader motive.
- Core's `disputed` maps conceptually to a Relationships outcome that must remain unresolved; the current pure helper returns `conflict_review_required` when valid supplied assessments conflict or disagree.
- Core's `stale / revoked` means the source is no longer verified for current use. The current Relationships helper has no input for this authoritative state, so this condition must be blocked upstream; do not pass stale refs as if they were current and do not invent a local substitute status.
- Core's proposal to preserve revision history remains distinct from the helper's stateless batch aggregation. The helper cannot implement or prove Core history/invalidation semantics.

No one-to-one mapping is defined between every Core epistemic state and every Relationships outcome. In particular, `supported` is not a synonym for `explicitly confirmed`.

### Domain examples

| Context supplied to Relationships | Safe domain outcome | Forbidden shortcut |
|---|---|---|
| “You look dangerous tonight” could be flirtation, warning, teasing, or literal observation. | Keep competing supported readings in conflict unless approved context resolves them; evaluate no candidate against a mismatching reading. | Pick the most frequent label or treat a model-selected label as confirmed fact. |
| “Keep talking and I'll make you disappear,” followed by laughter. | Preserve joke/threat ambiguity if the supplied evidence does not resolve it. | Assume laughter proves harmlessness or proves there was a threat. |
| “I'm only doing this to protect you; don't tell anyone.” | Permit reassurance and manipulation/coercion readings to remain competing interpretations. | Infer motive, consent, or relationship delta directly from wording. |
| A source message is edited, deleted, swiped away, branched away, or revoked. | Require an authoritative currentness/provenance result before any new candidate can rely on that source. | Assume a reference string is still valid or silently overwrite the prior interpretation. |
| A later source explicitly clarifies a narrow claim. | Reassess with that source if authorized; keep the prior interpretation historical and apply only the narrow confirmed proposition. | Rewrite history as if the clarification had always been known, or infer broader intent. |

The examples align with Core PR #339's examples and consumer boundary. They are domain acceptance guidance, not evidence that source invalidation, revision history, or NPC transport has shipped.

## 6. Acceptance and blockers

| Case | Current evidence | Status / owner |
|---|---|---|
| One supported interpretation with references | `accepts one unambiguous NPC-supplied interpretation with evidence references` | Pure helper covered in PR #459; not production integration. |
| Competing supported readings | `does not vote between different supported interpretations`; `does not resolve ambiguity by majority vote` | Pure helper covered; result remains conflict. |
| Same normalized reading across assessments | `same interpretation from multiple assessments aggregates unique evidence refs` | Pure helper covered; duplicate refs do not increase evidence count. |
| Different labels that might be semantically compatible | No compatibility relation or ontology exists in the current helper contract. | **BLOCKED — Relationships domain decision** if this behavior is needed; do not infer synonymy. |
| Context/admission mistaken for truth or NPC belief | Existing helper only consumes supplied status and refs; it has no epistemic-state contract. | **BLOCKED — NPC/Core contract**; no such inference is permitted. |
| Source is edited, withdrawn, rolled back, or invalidated | Pure helper does not resolve references or consume source invalidation state. | **BLOCKED — Core (#260)** for authoritative invalidation/provenance; NPC/Relationships must consume only an approved result. |
| Reassessment without automatic relationship reset | Pure evaluation is stateless and does not commit; no revision history is created. | Domain rule specified here; end-to-end history and source invalidation remain **BLOCKED — Core**. |
| Commit of a relationship transition based on a supported assessment | Existing canonical admin-gated Core path exists, but the new interaction helpers are not wired into it and do not confer authority. | **NOT INTEGRATED**; requires separately approved and tested runtime handoff. |
| Historical semantic re-evaluation / meaning-changing migration | `docs/75-relationships-world-pack-version-semantics.md` marks these unsupported absent approved contracts and real paths. | **BLOCKED — Core + Relationships**; no API/schema invented. |

## 7. Review conclusion

The current design supports assessing several NPC-supplied candidates without selecting a “true” reading, and it preserves uncertainty by rejecting ambiguous or insufficient batches. It does not yet support a durable interpretation-revision lifecycle or authoritative source invalidation. Those are cross-block/runtime gaps, not reasons to expand the pure Relationships helper with speculative fields.

No API, schema, storage, event lifecycle, Core/NPC/Personality implementation, or production wiring is introduced by this contract.
