# Process checkpoint recovery: Core decision record

**Status: DECISION APPROVED — fail closed on contradictory checkpoint evidence.**  
**Scope:** Core-owned recovery boundary for issue #243 and the evaluation/recalculation boundary in #262.  
**Decision owner:** Core owner approval recorded on 2026-10-29.  
**Runtime guard and regression are implemented on the PR branch; acceptance remains pending exact-head CI and review of the full matrix.**

## Approved rule

When persisted Process Manager state conflicts with the existing TimeEngine operation/segment checkpoint, trigger state, or canonical committed event evidence:

1. Mark the affected process as `needs_review` through an existing safe Core-owned path. If the existing transaction path cannot safely record that status without mutating canonical state, fail the request closed and leave canonical records untouched; do not invent a new write path.
2. Do not automatically repair/reconcile either checkpoint, resume the process, advance a milestone, replay effects, or recalculate dependent processes.
3. Do not mutate canonical world state, canonical event history, world revision, commit sequence, trigger completion, or milestone progress as a consequence of detecting the contradiction.
4. Repeating the same request/idempotency key with the same content must return the same persisted outcome and must not create additional events, revisions, audit entries, trigger changes, or process progress. Reusing a key with changed content remains an idempotency conflict.
5. Missing, stale, malformed, or ambiguous evidence is treated as a contradiction. Do not infer authority from timestamps, insertion order, or a convenient projection.
6. Manual review is required before any explicit reconciliation or replan. This decision does not authorize an automatic repair API or a new schema/table/cursor/outbox.

The `needs_review` status is a gate, not permission to auto-resume. The existing Core transaction remains the only authority for canonical writes.

## Existing evidence and boundary

### Verified in current main source

- `src/storage/sqlite-store.js` checks a persisted time-advance operation's `next_segment_index` against its `confirmed_coordinate` and rejects invalid indexes/coordinates into `needs_review`.
- `tests/time-advance-operation.test.js` covers a mismatched operation index/coordinate and negative/out-of-range indexes, asserting no world-time advance or event commit.
- The TimeEngine operation checkpoint, segment effects, trigger completion and process milestone completion use the existing Core segment transaction; process-checkpoint failure coverage is documented in `tests/process-manager.integration.test.js`.
- `src/storage/process-store.js` persists process and milestone status, milestone supporting event IDs, checkpoint versions, and lifecycle idempotency records. Process milestone prerequisites are scoped to one process.
- Rollback invalidation can mark a completed milestone and completed descendants within that same process `needs_review`. Explicit event-level causal links can be handled by Core rollback closure; this is not a general cross-process process-dependency/recalculation engine.

### Cross-record guard added on the PR branch

- `ProcessStore.completeTrigger` now rejects any registered trigger that points to a non-pending milestone, checks that the milestone's single supporting event ID matches the registered trigger in the persisted operation segment, requires that the trigger is completed by that same operation, and verifies that the event exists in canonical history with `validity='valid'`. The safe review gate can move even previously terminal process statuses to `needs_review` when contradictory evidence is detected; it does not rewrite the contradictory milestone.
- A mismatch throws `PROCESS_CROSS_RECORD_CHECKPOINT_MISMATCH` inside the existing Core segment transaction. The segment transaction rolls back; the operation is persisted as `needs_review`; any still-pending trigger claims held by that operation are released without changing trigger `updated_at`; then the owning process is gated as `needs_review` through the existing ProcessStore path. Canonical world time/revision, commit sequence, event history, trigger status/completion and milestone progress are not committed. Regression tests compare the full trigger record before and after the rejected operation.
- `tests/process-manager.integration.test.js` adds real-path regressions through `startTimeAdvance` for stale supporting-event evidence, a completed milestone with a pending trigger, a terminal process with a non-pending milestone, and malformed persisted operation-segment evidence. They assert fail-closed behavior, unchanged canonical state/event history, unchanged trigger and milestone checkpoints, exactly one process-review audit entry on first detection, persisted `needs_review` after SQLite reopen, same-key idempotent replay, and changed-content idempotency conflict.
- This test is a targeted cross-record failure-path regression, not proof that every conceivable corruption shape is covered. Full Runtime CI on the latest exact head and the remaining acceptance matrix are still required before #243 can close.

## Required regression matrix

Each case must use the real Core/SQLite path; synthetic helper-only tests are insufficient.

| Case | Required result |
|---|---|
| Process milestone says completed but supporting event is absent or invalidated | Fail closed; process/milestone gated for review where safely possible; no canonical writes |
| Trigger status/claim conflicts with the process milestone or operation segment | Fail closed; no trigger completion, event, time advance, or milestone progress |
| Operation checkpoint disagrees with its segment boundary | Existing TimeEngine guard returns `needs_review`; no canonical advance or event commit |
| Process/trigger/operation evidence is missing, malformed, or stale | Fail closed; no guessing or auto-repair |
| SQLite close/reopen after a contradiction | The same review outcome remains; no continuation |
| Same-key retry after contradiction | Same persisted outcome, no duplicate event/revision/commit sequence/audit/progress |
| Same key with changed request content | Idempotency conflict; no canonical mutation |
| Independent world with identical IDs | No cross-world contamination |
| Rollback invalidates supporting event | Existing Core rollback policy gates affected process progress; no automatic recomputation |
| Process completion | No NPC knowledge acquisition, belief update, report, or player delivery is implied |

For every rejected mismatch, compare before/after world time, world revision, commit sequence, canonical event IDs/validity, trigger status, process/milestone status and version, operation result, and audit row count.

## Verified behavior already covered

- **Failure before successful segment commit:** PR #335 records a failure/restart/same-key retry regression. Recheck its current merge/CI state before treating it as mainline evidence.
- **Successful commit, response lost:** PR #340 records a successful durable commit followed by SQLite reopen and same-key replay, including changed-content conflict. Recheck its current merge/CI state before treating it as mainline evidence.
- **Operation-internal checkpoint mismatch:** current-main test `tests/time-advance-operation.test.js` covers the index/coordinate disagreement and invalid indexes.
- **Process lifecycle/atomicity:** merged Process Manager runtime coverage includes milestone/trigger/segment atomicity, restart continuation, lifecycle retries, rollback invalidation and process-local prerequisite closure.

These cases are not substitutes for the missing cross-record mismatch regression matrix above.

## Process dependency and rollback semantics for #243

- **Within one process:** each milestone's `prerequisites` must reference milestones in that same process. The definition validator rejects missing, cyclic, self, and later-due prerequisites. A dependent milestone is not eligible until its declared prerequisites are completed; it is not enough that a prerequisite trigger merely ran.
- **Between separate processes:** cross-process milestone prerequisites are intentionally unsupported and rejected. Do not infer a dependency from shared trigger IDs, timestamps, matching entity IDs, or execution order. If one process event causally depends on another event, that relationship must be represented through Core's existing event-level causal links/read-write evidence; this is event causality, not a process-to-process scheduler dependency.
- **Rollback of a supporting event:** Core rollback invalidates the event closure using existing causal links and projection/read-set dependencies. When an invalidated event supports a completed milestone, ProcessStore marks that milestone and its transitive completed descendants within the same process `needs_review`; the process is also gated for review. Completed progress is not silently preserved as authoritative, and no replacement event or automatic milestone replay is generated.
- **Cross-process consequences of rollback:** event-level causal closure can invalidate other events that explicitly depend on the rolled-back event, but there is no general cross-process milestone graph or automatic recalculation/replan. A separate process whose event was invalidated is handled through the same event-evidence/rollback review boundary; do not claim transitive process-level recomputation that is not implemented.
- **Manual recovery boundary:** `needs_review` blocks automatic execution. A pending trigger attached to a review-gated process cannot be replayed, and time advancement cannot cross its due coordinate until an explicit reviewed reconciliation/replan occurs. Recovery must not rewrite the mismatching milestone evidence or infer a replacement checkpoint.

## #243 lifecycle and persistence acceptance matrix

| Behavior | Required evidence |
|---|---|
| Start and stage progression | Real Core/SQLite integration test; milestone and trigger completion commit in the same segment transaction |
| Pause and resume | Lifecycle version/idempotency checks; paused process does not execute stages; resume rejects overdue work unless explicitly replanned |
| Interrupt and continue | TimeEngine operation persists its interrupted boundary; close/reopen and a new valid advance continues from the last confirmed coordinate without replay |
| Cancel and completion | Terminal state transition and pending-trigger cancellation are persisted/audited; completion is derived from all required milestones |
| Repeated request | Same key/same payload returns the durable result; changed payload conflicts; no duplicate event, revision, audit, trigger or milestone writes |
| SQLite recovery | Operation and process checkpoints survive close/reopen; malformed, empty, stale or contradictory evidence fails closed |
| Segment atomicity | Event commit, trigger completion, milestone result and operation checkpoint either commit together or the segment rolls back |
| Rollback | Supporting-event invalidation gates completed dependent milestones under existing Core rollback closure; no automatic cross-process recalculation |
| Scheduler ownership | Process milestones use registered triggers and the existing TimeEngine/operation segment scheduler; no second scheduler or process-side canonical-write path |

The runtime tests and exact-head CI are the evidence for these behaviors. A row in this table is not considered verified merely because it is documented; the corresponding current test and CI result must be checked before closing #243.

## Explicit non-decisions

This decision does not designate a process checkpoint or a projection as canonical authority over committed events. It does not authorize automatic repair, a new API/schema/store/cursor/outbox, cross-process milestone prerequisites, global causal closure, automatic replan, or historical semantic recalculation. It does not grant NPC knowledge or player-delivery authority.

## Release boundary

- Keep #243 open until the required cross-record mismatch tests pass on an exact current head and the full acceptance matrix is evidenced.
- Keep the broader Core evaluation/recalculation/publication boundary in #262 open until its own source-backed acceptance matrix is satisfied.
- Keep production Memory→NPC **DISABLED / FAIL-CLOSED**. This decision does not authorize release or disclosure.
