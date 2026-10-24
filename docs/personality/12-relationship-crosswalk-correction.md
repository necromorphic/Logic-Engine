# Issue #73 — Crosswalk correction: no automatic drift vs old-event knowledge acquisition

Status: documentation correction to the Issue #73 crosswalk. This document explicitly supersedes the over-broad interpretation in the synthetic regression row in `docs/personality/09-per-case-acceptance-traceability.md` that grouped repeated evaluation and newly acquired knowledge about an old event under `PERS-SEM-008, PERS-SEM-020; REL-MOD-005`.

## Correct separation

| Scenario | Existing criteria / cross-block ID | Correct expected result | Evidence disposition |
|---|---|---|---|
| Repeated evaluation without new causal evidence / no automatic drift | `PERS-SEM-008`, `PERS-SEM-020`, `REL-MOD-005` | Scene co-presence, repeated evaluation, or lack of new causal evidence must not by itself create a relationship transition or a new causal explanation. If the evaluator returns the same candidate for identical inputs, that is pure-evaluation behavior only. | Pure-evaluator tests cover deterministic, side-effect-free re-evaluation and bounded evidence interpretation. They do **not** prove canonical commit idempotency or event deduplication. |
| New acquisition of knowledge about an already-existing old event | `REL-MOD-015` only as the direct cross-block requirement; **no direct existing PERS-SEM ID** | Acquiring information about an old canonical event must not create a duplicate canonical event or silently rewrite the previously committed transition. Any new interpretation must follow an explicit acquisition/re-evaluation contract. | Contract-only / blocked on the NPC acquisition contract and Core event identity, deduplication, correction, versioning, and replay contracts. No production-boundary executable test was found. |

## Explicit non-mappings

- Do **not** credit `PERS-SEM-008`, `PERS-SEM-020`, or legacy `REL-MOD-005` with event identity or knowledge-acquisition deduplication.
- `PERS-SEM-008` is the co-presence/no-automatic-transition criterion; `PERS-SEM-020` is a provenance/causal-evidence non-implication. Neither establishes canonical event identity.
- `PERS-SEM-024` is deterministic replay/evaluation under identical pinned inputs/version within the supported replayable subset. It does not establish event deduplication or acquisition semantics.
- `PERS-SEM-029` concerns meaning-changing World Pack versions, explicit migration, or incompatibility. It does not establish event identity or acquisition semantics.
- Keep `REL-MOD-015` as a separate cross-block requirement; do not create a duplicate Personality criterion merely to force a one-to-one mapping.

## Test status and ownership

The second scenario remains a test-design requirement only; no production NPC/Core acquisition/event-identity test was found in the current-main evidence reviewed for this update. A future test must exercise the approved acquisition/re-evaluation and canonical event identity/deduplication boundary, not just repeat the pure evaluator call. The privileged Core transition writer's idempotency tests do not establish knowledge-acquisition deduplication. Ownership remains with the relevant NPC/Memory/Core contract owners.

The prior row in `09-per-case-acceptance-traceability.md` must be read narrowly for the no-automatic-drift scenario only; its mention of knowledge acquisition is superseded by this correction. This correction adds no `PERS-SEM-*` IDs and makes no runtime pass claim.

## References

- [Per-case acceptance traceability](./09-per-case-acceptance-traceability.md)
- [Executable-evidence audit](./10-issue-73-executable-evidence-audit.md)
- [Relationship → Personality cross-block update](./11-relationship-to-personality-cross-block-update.md)
- [Relationship test traceability](https://github.com/necromorphic/Logic-Engine/blob/main/docs/47-relationship-module-test-traceability.md)


## Current-main link/status correction (2026-10-24)

Relationship test traceability is now available at `../47-relationship-module-test-traceability.md` on `main` (ported through PR #80); the old feature-branch URL is historical. Core Issue #77 is closed for the privileged write/replay first slice, but that does not resolve old-event knowledge acquisition: a new actor knowledge acquisition is not necessarily the same logical request as an idempotent retry of a canonical transition. No new PERS-SEM ID is introduced, and `PERS-SEM-024`/`029` remain non-mappings for acquisition-event identity semantics.
