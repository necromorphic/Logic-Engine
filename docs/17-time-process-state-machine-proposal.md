# Time-owned Process Manager state-machine proposal

**Status:** proposal only. This PR adds a pure validator and tests; it does not add runtime persistence, HTTP routes, scheduler behavior, or canonical state mutation.

Related work:
- Core transaction/recovery boundary: [PR #247](https://github.com/necromorphic/Logic-Engine/pull/247)
- Process Manager integration issue: [Issue #243](https://github.com/necromorphic/Logic-Engine/issues/243)
- Shared coordination register: [Notion architecture and requirements](https://app.notion.com/p/403a42c0fcaf8145850bcd7cfd9bcdf7)

## Ownership split

- **Time:** coordinate-based milestone proposal, dependency ordering, lifecycle transition proposal, and fail-closed temporal checks.
- **Core:** current world/revision/snapshot validation, canonical proposal validation, transaction boundary, idempotency, audit, rollback/rebuild, and durable recovery.
- **NPC/delivery:** knowledge acquisition, belief, narration, and player awareness remain separate transitions.

The functions in `src/process/model.js` are pure proposal helpers. A returned transition is not authorization to mutate canonical state. Core must revalidate current world identity, revision/commit sequence, policy/version pins, and dependency evidence before committing through its existing transaction path.

## Proposed first-slice rules

- Process IDs are scoped by world; a process definition is bounded to 1–100 milestones.
- Milestone coordinates are safe integers and must be strictly in the future at creation.
- Dependencies must resolve within the same process, be acyclic, and not point to a later coordinate. Equal-coordinate dependency order is allowed only as a declared dependency; the scheduler/Core conflict rules still govern actual execution.
- States: `scheduled`, `running`, `paused`, `completed`, `cancelled`, `failed`, `needs_review`.
- Resume is an operation returning to `scheduled`, not a persistent state. It requires explicit re-scheduling of every pending milestone into the future.
- Pause/cancel must not race an in-flight claimed milestone.
- Completion requires every milestone to be durably completed; the pure helper checks the supplied snapshot but cannot prove its truth.
- `failed` requires a recorded reason. `needs_review` is conservative for unresolved conflicts/unknown dependencies. Resolving review requires explicit revalidation.
- No wall-clock catch-up; no implicit NPC knowledge or player delivery; no second scheduler.

## What this PR does not prove

- It does not prove process checkpoint + canonical effects are atomic.
- It does not add schema, API, trigger registration, or lifecycle storage.
- It does not implement causal rollback/rebuild.
- It does not validate that caller-supplied snapshot/context flags are authoritative; those must come from Core's validated snapshot at the integration boundary.
- It does not select production mechanic recalculation strategy A/B/C.

## Required Core/Time reconciliation before runtime integration

1. Agree the process identity and definition/version fingerprint.
2. Agree which fields are Core-authoritative and which are Time proposal metadata.
3. Confirm the existing segment transaction can include a process checkpoint without a new persistence boundary.
4. Agree causal source/output references and the rollback invalidation rule.
5. Turn the Core PR #247 test matrix and Time state-machine tests into integrated acceptance against the same runtime path.

Until those are resolved, keep runtime schema/API out of this branch.
