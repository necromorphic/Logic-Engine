# Issue #73 — Relationship → Personality cross-block update

Status: documentation-only cross-block audit, prepared 2026-10-24. This file supplements the canonical PERS-SEM crosswalk and the executable-evidence audit. It does not create new Personality criterion IDs and does not claim runtime integration tests exist.

## Source basis

- Relationship domain design: `feat/relationship-domain-module:docs/46-relationship-domain-module-design.md`, reported updated at commit `164582435cef8fb0b89a3b4f2ef454356ca69c25`.
- Relationship test traceability: `feat/relationship-domain-module:docs/47-relationship-module-test-traceability.md`, reported updated at commit `61797d76f4256efad5f25a722d73713319ab3a03`.
- Relationship crosswalk correction: commit `bfe2e67f0af9fc4fa43e88200acf0185c21d998b`.
- Personality canonical acceptance matrix: `docs/personality/04-semantic-acceptance-matrix.md`.
- Personality per-case traceability: `docs/personality/09-per-case-acceptance-traceability.md`.
- Personality executable-evidence audit: `docs/personality/10-issue-73-executable-evidence-audit.md`.
- NPC consumer compatibility: `feat/npc-subsystem:docs/52-npc-relationship-consumer-compatibility.md`, a contract document, not an executable test.

The Relationship commits and NPC contract are cross-branch references. This audit does not assert that those commits are merged into `main`, nor that documentation in another branch constitutes a runtime test.

## Per-scenario disposition

| Relationship scenario | Existing Personality mapping | Evidence disposition | Remaining gap |
|---|---|---|---|
| REL-MOD-013 — relationship changes must not mutate stable traits, values, or boundaries | Direct: `PERS-SEM-014`, `PERS-SEM-016`. Adjacent dimension-isolation criterion: `PERS-SEM-005`. Supporting lifecycle source: `docs/personality/06-stable-trait-lifecycle.md`. | Specified / contract-only. The Personality lifecycle rules and NPC consumer compatibility contract state the boundary. The inspected NPC branch did not provide an executable production consumer test proving non-mutation. | Add/locate a production NPC-consumer regression test once the approved consumer seam exists. Do not treat pure relationship candidate tests as trait-store tests. |
| REL-MOD-014 — relationship labels do not prove consent, motive/cause, obligation, knowledge, loyalty, or reciprocity | Direct: `PERS-SEM-001`, `PERS-SEM-005`, `PERS-SEM-018`, `PERS-SEM-019`, `PERS-SEM-020`. `PERS-SEM-025` and `PERS-SEM-026` are adjacent actor/purpose read gates, not proof of the non-implications themselves. | Semantic specification / consumer contract only for the full set of non-implications. Evaluator tests for insufficient/conflicting evidence establish candidate-evaluation behavior only; they do not prove the NPC consumer will not infer these concepts. | Add/locate explicit consumer-level negative tests for each implication at the production NPC/Core boundary. Authorized read enforcement remains a separate Core blocker. |
| REL-MOD-015 — acquiring new knowledge about an old event is not a new canonical event and must not silently rewrite the old transition | No direct Personality acceptance ID currently covers event identity/deduplication on knowledge acquisition. `PERS-SEM-024` concerns deterministic replay under identical pinned inputs/version; `PERS-SEM-029` concerns meaning-changing World Pack versions, migration, and incompatibility. They are adjacent only. | No direct Personality criterion or executable test found in the inspected Personality/evaluator/NPC evidence for acquisition-triggered event deduplication/correction semantics. | Keep this as an external Core/NPC acquisition/event-identity contract dependency; do not add a duplicate PERS-SEM ID or imply that PERS-SEM-024/029 cover it. The owner should define the canonical event identity, acquisition/re-evaluation operation, correction behavior, deduplication, and version/replay interaction before executable acceptance can be assigned. |

## Required boundary distinctions

- A relationship transition and a character's acquisition of knowledge about an earlier event are different concepts. The latter must not be represented as a new canonical event unless the approved event contract explicitly says so.
- A new interpretation of old evidence requires an explicit acquisition/re-evaluation contract. It must not silently duplicate an event or rewrite an earlier transition.
- Event deduplication, correction, rule-version pinning, and replay are separate requirements. A deterministic pure evaluator does not establish any of them at the canonical persistence boundary.
- `PERS-SEM-024` remains limited to deterministic evaluation/replay under the same explicit pinned inputs and version, within the supported replayable subset.
- `PERS-SEM-029` remains limited to meaning-changing World Pack updates, explicit migration, or declared incompatibility. It does not establish event identity or acquisition semantics.
- No Personality runtime API, Core contract, NPC behavior, or new Personality criterion ID is invented by this crosswalk.

## Acceptance outcome

This update satisfies the documentation crosswalk request by mapping REL-MOD-013 and REL-MOD-014 to existing Personality IDs and explicitly recording the absence of a direct ID for REL-MOD-015. It does **not** close the underlying runtime gaps: all three remain without executable production NPC/Core evidence in the inspected source set. No new CI pass is claimed for the external Relationship commits by this documentation change.

## References

- [Personality semantic acceptance matrix](./04-semantic-acceptance-matrix.md)
- [Personality per-case acceptance traceability](./09-per-case-acceptance-traceability.md)
- [Issue #73 executable-evidence audit](./10-issue-73-executable-evidence-audit.md)
- [Relationship domain design, reported commit 1645824](https://github.com/necromorphic/Logic-Engine/blob/164582435cef8fb0b89a3b4f2ef454356ca69c25/docs/46-relationship-domain-module-design.md)
- [Relationship test traceability, reported commit 61797d7](https://github.com/necromorphic/Logic-Engine/blob/61797d76f4256efad5f25a722d73713319ab3a03/docs/47-relationship-module-test-traceability.md)
- [Relationship crosswalk correction, commit bfe2e67](https://github.com/necromorphic/Logic-Engine/commit/bfe2e67f0af9fc4fa43e88200acf0185c21d998b)
