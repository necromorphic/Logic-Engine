# Personality Block — Cross-Block Readiness and Handoff

Status: coordination document for the Personality branch. It records boundaries and dependencies; it does not authorize implementation or claim runtime readiness.

## 1. Ownership

- **Personality:** stable-trait semantics, relationship meaning, state distinctions, non-implications, semantic acceptance cases, and World Pack authoring requirements.
- **Core:** canonical identity and state, typed write operation, trusted write authorization, provenance, atomic commit, revisions/audit, actor-authorized reads, projection/rebuild, and rollback/reconciliation.
- **NPC:** autonomous decision orchestration and consumption of authorized context; no parallel canonical relationship/personality store.
- **World Pack:** supported dimensions, values, transitions, and domain-specific sufficiency/conflict policy.
- **Character card:** derived, read-only view over authorized canonical data.

## 2. Confirmed direction versus runtime evidence

The Core response in [Issue #59](https://github.com/necromorphic/Logic-Engine/issues/59#issuecomment-6378586821) confirms the current architecture direction and remaining blockers. The consolidated record and unresolved questions are in [03-core-decision-and-integration-gates.md](./03-core-decision-and-integration-gates.md).

- A typed canonical relationship operation is required, but no such runtime operation has been verified.
- Partial updates, directionality, and distinct unset/neutral/clear semantics are semantic requirements; exact payload/API/storage representation remains unapproved.
- PR #45 (bounded consistent snapshot) and PR #46 (opt-in tri-state condition results) are merged into `main`; the snapshot/context extension was merged via PR #49. These primitives improve consistency and condition-result representation but do not provide actor/purpose authorization, visibility filtering, or secret exclusion. Raw snapshot output must not be passed directly to a model.
- Generic event/audit and rollback infrastructure exists, but the trusted authoring/import/correction boundary and relationship-specific replay guarantees are not established.
- Deterministic replay is a conditional first-stage target only where it semantically reconstructs the intended state. Alternative-source support is not implied by event IDs.

## 3. Integration gates

| Gate | Owner | Status | Evidence required to close |
|---|---|---|---|
| Typed relationship write | Core, with Personality semantic contract | Blocking; semantic direction approved | Contract against existing typed-effect conventions; atomic rejection/acceptance; partial patch, direction, identity, event/revision/audit behavior tested on the real path |
| Initial/import/correction | Core | Generic event/audit exists; trusted classification boundary unverified | Trusted command and authorization boundary; provenance/audit contract; spoofed-origin rejection and history-preserving correction tests |
| Authorized read | Core | Blocking | Actor/purpose/snapshot-scoped filtering; safe distinction among known, unset, withheld, and incomplete/unsupported; actor separation and secret exclusion tested |
| Deterministic replay / rollback | Core | Generic rollback exists; relationship guarantee unproven | Explicit first-slice boundary and tests on real typed relationship events |
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
4. Core finalizes and tests the typed relationship operation on the canonical commit path.
5. Keep independent-support cases blocked unless domain sufficiency and a core-owned implementation are explicitly defined and tested.
6. Only then plan runtime integration. Do not add a Personality-owned database, event log, identity registry, authorization layer, or causal graph.

## 6. Non-claims

This handoff does not claim that runtime supports typed relationships, authorized reads, author corrections, relationship rollback, alternative support, or safe card projection. The semantic acceptance cases are not passing integration tests. No runtime/API/schema/storage/prompt/UI change is authorized by this document. No PR is created or merged by this document.
