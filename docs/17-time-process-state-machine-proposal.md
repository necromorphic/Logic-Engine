# Time-owned Process Manager contract reconciliation

**Status:** Time review of the existing Core runtime draft; no second process model or scheduler is introduced here.

Related work:
- [Issue #243 — Process Manager acceptance](https://github.com/necromorphic/Logic-Engine/issues/243)
- [Core transaction/recovery boundary, PR #247](https://github.com/necromorphic/Logic-Engine/pull/247)
- [Core durable Process Manager runtime, PR #248](https://github.com/necromorphic/Logic-Engine/pull/248)
- [Shared architecture and decision register](https://app.notion.com/p/403a42c0-fcaf-8145-850b-cd7cfd9bcdf7)

## Contract agreed for review

PR #248 is the implementation candidate and owns the durable process definition, lifecycle records, trigger registration, and process persistence. Time's responsibility is to verify that its milestone semantics are compatible with the existing deterministic scheduler and time-advance pipeline. This PR must not introduce a second process lifecycle implementation.

The shared contract is:

- **Identity:** `process_id` is unique within `world_id`; `definition_version` identifies the authored definition. `milestone_id` identifies a milestone within the process. `trigger_id` identifies the existing scheduler record and is not the process identity.
- **Definition shape:** each milestone uses `due_coordinate`, `prerequisites` (milestone IDs at the process boundary), `read_set`, `write_set`, and a validated Core event proposal. Core maps prerequisites to trigger IDs before planning. The scheduler receives its existing trigger shape, with trigger-ID dependencies.
- **Temporal rule:** coordinates are safe integers; creation requires milestones strictly in the future. A prerequisite cannot be scheduled later than its dependent. Equal-coordinate prerequisite ordering is allowed only when explicitly declared; the scheduler still enforces read/write conflicts and segment boundaries.
- **Lifecycle:** `scheduled`, `running`, `paused`, `completed`, `cancelled`, `failed`, `needs_review`. Resume is an operation returning to `scheduled`, not a stored state. It must mint fresh trigger IDs for pending milestones only when their original due coordinates remain in the future; overdue resume fails with `PROCESS_RESUME_REQUIRES_REPLAN`.
- **Commit authority:** Time proposes due work and interruption boundaries. Core validates current world/revision and event proposals, and commits canonical effects plus process/trigger/segment checkpoints atomically through the existing segment transaction.
- **Rollback:** currently supported behavior is conservative invalidation to `needs_review` for directly affected completed milestones. Full causal closure/recomputation and proof of independent-progress preservation remain unsupported; do not claim otherwise.
- **Knowledge/delivery:** process completion does not grant NPC knowledge, update beliefs, create reports, or notify the player.

## Ownership by PR

- **#247 — Core boundary:** proposal/test matrix for atomicity, snapshot validation, idempotency, recovery, and rollback/rebuild. Documentation-only; not itself runtime implementation.
- **#248 — Core runtime candidate:** durable process/milestone storage and lifecycle operations over existing triggers and segment transactions. Draft/unmerged; exact-head CI is branch evidence, not production approval.
- **#249 — Time contract review:** tests the existing scheduler semantics using process-shaped milestone fixtures and records any mismatch. It must not duplicate #248's runtime contract or add a second scheduler.

## Time-owned acceptance

1. Deterministic due ordering and same-coordinate declared prerequisite boundaries.
2. Missing, cancelled, not-yet-due, and cyclic prerequisites fail closed without a partial plan.
3. Same-coordinate read/write conflicts without a declared causal order require review.
4. Interruption completes all work at the interruption coordinate, leaves later milestones unplanned, and allows a subsequent plan from the confirmed coordinate.
5. Durable interruption + SQLite close/reopen + continuation of the same process is covered by the integration test in #248; Time's scheduler tests are complementary, not a replacement for that real-path test.

The existing generic scheduler tests already cover these rules at the trigger layer. The added Time tests bind the process contract's `prerequisites` vocabulary to those trigger-level semantics without adding runtime code. The overall issue remains open until the cross-PR review and all required acceptance evidence are complete.
