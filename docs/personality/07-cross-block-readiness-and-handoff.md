# Personality Block — Cross-Block Readiness and Handoff

Status: coordination document for the Personality branch. It records boundaries and dependencies; it does not authorize implementation or claim runtime readiness.

## 1. Ownership

- **Personality:** stable-trait semantics, relationship meaning, state distinctions, non-implications, semantic acceptance cases, and World Pack authoring requirements.
- **Core:** canonical identity and state, typed write operation, trusted write authorization, provenance, atomic commit, revisions/audit, actor-authorized reads, projection/rebuild, and rollback/reconciliation.
- **NPC:** autonomous decision orchestration and consumption of authorized context; no parallel canonical relationship/personality store.
- **World Pack:** supported dimensions, values, transitions, and domain-specific sufficiency/conflict policy.
- **Character card:** derived, read-only view over authorized canonical data.

## 2. Confirmed direction versus runtime evidence

Core's response in [PR #38, comment 6377879793](https://github.com/necromorphic/Logic-Engine/pull/38#issuecomment-6377879793) establishes the current architecture direction. The consolidated record and unresolved questions are in [03-core-decision-and-integration-gates.md](./03-core-decision-and-integration-gates.md).

- The privileged admin-gated typed Relationship operation is implemented and tested on current `main`; see `tests/relationship-transition-core.test.js`. This does not establish general actor/NPC mutation authority or authorized reads.
- Partial updates, directionality, and distinct unset/neutral/clear semantics are semantic requirements; exact payload/API/storage representation remains unapproved.
- PR #45 (bounded consistent snapshot), PR #46 (opt-in tri-state condition results), and PR #49 (snapshot/context extension) provide consistency/condition primitives, not actor/purpose authorization, visibility filtering, or secret exclusion. The privileged typed Relationship write/replay slice is now implemented and tested through Core PRs #94–#96 and follow-ups; raw snapshots still must not be passed directly to a model.
- Generic event/audit infrastructure and the privileged Relationship write/replay first slice are implemented/tested. Trusted initial/import/correction and general authorized read/consumer guarantees remain unestablished.
- Deterministic replay is a conditional first-stage target only where it semantically reconstructs the intended state. Alternative-source support is not implied by event IDs.

## 3. Integration gates

| Gate | Owner | Status | Evidence required to close |
|---|---|---|---|
| Typed relationship write | Core, with Personality semantic contract | Privileged admin-authored first slice implemented/tested | Current-main real-path tests cover direction, partial/mixed patch, identity/world/rule/evidence validation, idempotency, audit/revision and failure atomicity; non-admin/NPC authority remains blocked |
| Initial/import/correction | Core | Generic event/audit exists; trusted classification boundary unverified | Trusted command and authorization boundary; provenance/audit contract; spoofed-origin rejection and history-preserving correction tests |
| Authorized read | Core | Blocking | Actor/purpose/snapshot-scoped filtering; safe distinction among known, unset, withheld, and incomplete/unsupported; actor separation and secret exclusion tested |
| Deterministic replay / rollback | Core | Privileged first-slice replay/rollback implemented/tested; independent-support semantics deferred | Current-main real-path tests cover required-dependency rollback and deterministic rebuild of surviving typed transitions; no OR/alternative-support guarantee |
| Independent multi-source support | Core + World Pack domain rule | Deferred / unsupported until specified | Domain sufficiency/conflict policy plus a narrow core-owned representation/reducer and tests, if needed |
| NPC decision context | NPC | Depends on authorized read | Only bounded authorized data is consumed; no duplicate canonical store |
| Character-card projection | Core/card owner | Depends on typed state and authorized read | Read-only projection from authorized canonical state, with no private-field leakage |

## 4. Personality work that can continue independently

The following work does not require inventing missing Core interfaces:

1. Maintain semantic invariants and acceptance IDs.
2. Improve traceability from requirements to acceptance cases and responsible boundaries.
3. Refine World Pack authoring requirements without declaring universal dimensions or values.
4. Keep stable traits distinct from temporary state, goals, beliefs, observations, and hypotheses.
5. Record conflicts or unresolved decisions instead of silently resolving them.

The traceability vocabulary and review checklist are in [08-semantic-traceability-and-review-workflow.md](./08-semantic-traceability-and-review-workflow.md).
The individual acceptance-ID ownership and evidence mapping is in [09-per-case-acceptance-traceability.md](./09-per-case-acceptance-traceability.md).

## 5. Review sequence

1. Use the Core-owner response and doc 03 as the current evidence record; revise this handoff only when new contract or implementation evidence appears.
2. Core closes the first-slice causal representation and trusted authoring/import/correction command boundary.
3. Core defines and tests the actor/purpose/snapshot read boundary before any model/player exposure.
4. The privileged typed operation is shipped; Core separately owns any remaining trusted import/correction and general authorized-read contracts.
5. Keep independent-support cases blocked unless domain sufficiency and a core-owned implementation are explicitly defined and tested.
6. Only then plan runtime integration. Do not add a Personality-owned database, event log, identity registry, authorization layer, or causal graph.

## 6. Non-claims

This handoff does not claim general authorized reads, trusted author corrections/imports, alternative support, or safe card projection. The privileged typed Relationship write/replay slice is implemented/tested; downstream consumer readiness remains blocked. The semantic acceptance cases are not passing integration tests. No runtime/API/schema/storage/prompt/UI change is authorized by this document. No PR is created or merged by this document.


## Current-main status correction (2026-10-24)

This document supersedes earlier rows that treated all typed Relationship write/replay as blocked. The privileged admin-gated first slice is implemented and tested on `main`; it does not establish general actor-authorized reads, non-admin/NPC writes, trusted initial/import/correction, safe card projection, historical migration, or NPC/Personality consumer semantics. See the exact test inventory in `docs/personality/10-issue-73-executable-evidence-audit.md`. The domain handoff is tracked separately in Issue #130.
