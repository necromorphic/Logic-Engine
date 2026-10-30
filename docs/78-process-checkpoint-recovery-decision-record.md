# Process checkpoint recovery: Core decision record

**Status: DECISION APPROVED — fail closed on contradictory checkpoint evidence.**  
**Scope:** Core-owned recovery boundary for issue #243 and the evaluation/recalculation boundary in #262.  
**Decision owner:** Core owner approval recorded on 2026-10-29.  
**Runtime guard and targeted regression matrix are merged into `main` by PR #694 (merge commit `efe7a740b5248816a302c2301db612cf18a909a7`). Exact-head CI evidence is recorded below for the tested PR candidate; it is not represented as a fresh CI run on the current `main` head. The lifecycle and recovery acceptance evidence for #243 is reconciled below.**

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

### Cross-record guard merged into main by PR #694

- `ProcessStore.completeTrigger` now rejects any registered trigger that points to a non-pending milestone, checks that the milestone's single supporting event ID matches the registered trigger in the persisted operation segment, requires that the trigger is completed by that same operation, and verifies that the event exists in canonical history with `validity='valid'`. The safe review gate can move even previously terminal process statuses to `needs_review` when contradictory evidence is detected; it does not rewrite the contradictory milestone.
- A mismatch throws `PROCESS_CROSS_RECORD_CHECKPOINT_MISMATCH` inside the existing Core segment transaction. The segment transaction rolls back; the operation is persisted as `needs_review`; any still-pending trigger claims held by that operation are released without changing trigger `updated_at`; then the owning process is gated as `needs_review` through the existing ProcessStore path. Canonical world time/revision, commit sequence, event history, trigger status/completion and milestone progress are not committed. Regression tests compare the full trigger record before and after the rejected operation.
- `tests/process-manager.integration.test.js` adds real-path regressions through `startTimeAdvance` for stale supporting-event evidence, a completed milestone with a pending trigger, a terminal process with a non-pending milestone, and malformed persisted operation-segment evidence. They assert fail-closed behavior, unchanged canonical state/event history, unchanged trigger and milestone checkpoints, exactly one process-review audit entry on first detection, persisted `needs_review` after SQLite reopen, same-key idempotent replay, and changed-content idempotency conflict.
- These are targeted cross-record failure-path regressions, not proof that every conceivable corruption shape is covered. The exact-head CI result above verifies the PR candidate that carried this guard. The targeted cross-record regressions described here are now present in `main`; they are not an exhaustive enumeration of every conceivable corruption shape.

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

The targeted cross-record mismatch cases are now covered by the real-path regressions listed above. Coverage remains targeted rather than exhaustive for every conceivable malformed persisted shape.

## Process dependency and rollback semantics for #243

- **Within one process:** each milestone's `prerequisites` must reference milestones in that same process. The definition validator rejects missing, cyclic, self, and later-due prerequisites. A dependent milestone is not eligible until its declared prerequisites are completed; it is not enough that a prerequisite trigger merely ran.
- **Between separate processes:** cross-process milestone prerequisites are intentionally unsupported and rejected. Do not infer a dependency from shared trigger IDs, timestamps, matching entity IDs, or execution order. If one process event causally depends on another event, that relationship must be represented through Core's existing event-level causal links/read-write evidence; this is event causality, not a process-to-process scheduler dependency.
- **Rollback of a supporting event:** Core rollback invalidates the event closure using existing causal links and projection/read-set dependencies. When an invalidated event supports a completed milestone, ProcessStore marks that milestone and its transitive completed descendants within the same process `needs_review`; the process is also gated for review. Completed progress is not silently preserved as authoritative, and no replacement event or automatic milestone replay is generated.
- **Cross-process consequences of rollback:** event-level causal closure can invalidate other events that explicitly depend on the rolled-back event, but there is no general cross-process milestone graph or automatic recalculation/replan. A separate process whose event was invalidated is handled through the same event-evidence/rollback review boundary; do not claim transitive process-level recomputation that is not implemented.
- **Manual recovery boundary:** `needs_review` blocks automatic execution. A pending trigger attached to a review-gated process cannot be replayed, and time advancement cannot cross its due coordinate until an explicit reviewed reconciliation/replan occurs. Recovery must not rewrite the mismatching milestone evidence or infer a replacement checkpoint.

## #243 lifecycle and persistence acceptance matrix

| Behavior | Current evidence |
|---|---|
| Start and stage progression | `tests/process-manager.integration.test.js`: `process milestone checkpoint commits with its trigger segment and survives SQLite restart` (line 66); validates the real Core/SQLite path. |
| Pause and resume | `pause and resume rotate pending trigger identities when milestones remain in the future` (154), `resume rejects a paused process whose milestone became overdue` (314), and `paused lifecycle state and trigger cancellation survive restart before resume` (527). |
| Interrupt and continue | `interrupted time advance resumes a running process after SQLite close and reopen` (346). This exercises interruption and continuation through the persisted TimeEngine operation boundary, as required by #243; the acceptance text does not require a separate `process.interrupt` API. |
| Cancel and completion | `cancelling a process atomically cancels pending milestone triggers` (122) plus the stage-progression test (66); terminal state, trigger cancellation, and completion from required milestones are exercised. |
| Repeated request | `checkpoint failure stays terminal and same-key retry after SQLite restart leaves no residue` (588), `cross-record process checkpoint mismatch fails closed and replays idempotently` (863), `review-gated process trigger cannot be replayed or crossed with a new time-advance key` (1200), and `failed review audit keeps operation retryable and process gate atomic` (1236). |
| SQLite recovery | Restart cases at (66), (215), (346), (527), (588), (1119), and (1161) cover durable lifecycle/review state and malformed or empty persisted segment evidence. Test (1007) corrupts segment evidence during the active `completeTrigger` callback and verifies fail-closed recovery, but does not close/reopen SQLite; it is malformed-evidence coverage, not restart coverage. Cross-record mismatch tests at (863), (929), (968), and (1052) cover contradictory checkpoints and malformed event evidence. |
| Segment atomicity | `failure between canonical segment commit and process checkpoint rolls back the entire segment` (290), plus `failed review audit keeps operation retryable and process gate atomic` (1236). ProcessStore validates supporting event, registered trigger, persisted segment, operation and canonical event before milestone advancement (`src/storage/process-store.js:188-283`). |
| Rollback | `rollback invalidates the transitive completed prerequisite chain and survives restart` (215), `rolling back one process milestone preserves an independent completed process` (686), and `rollback follows an explicit cross-process event cause and gates both affected processes` (742). These do not prove global process-level recomputation. |
| Scheduler ownership | `src/application/engine.js` imports the existing pure `planDueWork` scheduler (`src/time/scheduler.js`); process milestones register normal time triggers and are advanced through `startTimeAdvance`/the persisted TimeEngine operation path. The scheduler module documents that it only plans work and does not execute effects or write storage. No second process scheduler is present in this path. |

Exact-head CI for `1fb43497c2d5896bc9cf7750c9cb2a76d94ea0ec`: Runtime `npm test` 1090/1090; recalculation oracle 20/20; `core-trusted-acquisition`, `npc-boundary`, and Memory Provider blocker 3 passed. These results support the matrix but do not substitute for current-head code review. Test names and line numbers above are from the PR head and should be rechecked if the test file changes.

## Explicit non-decisions

This decision does not designate a process checkpoint or a projection as canonical authority over committed events. It does not authorize automatic repair, a new API/schema/store/cursor/outbox, cross-process milestone prerequisites, global causal closure, automatic replan, or historical semantic recalculation. It does not grant NPC knowledge or player-delivery authority.

## Release boundary

The evidence above establishes only the specific lifecycle, persistence, atomicity, idempotency, scheduler-ownership, and rollback cases named in the matrix. It does **not** establish that every acceptance row for #243 or the broader Process Manager contract is closed. In particular, the following remain open or require explicit owner disposition:

- **Cross-world replay:** the Core boundary register still lists this as an unverified acceptance row; do not infer coverage from world-scoped identity tests alone.
- **Response-loss replay at every commit boundary:** existing retry tests cover named paths, not every possible commit/response-loss boundary.
- **Cross-process causal closure:** event-level causal invalidation has bounded coverage, but there is no general cross-process process-dependency graph or closure/recomputation engine.
- **Unrelated-progress independence:** a bounded test preserves an explicitly independent process, but the system does not prove independence when causal inputs are incomplete or unenumerable.
- **Explicit replan semantics:** overdue resume is fail-closed; the separate replan contract remains a proposal without a runtime API and requires owner approval and implementation evidence.

Keep #243 open until its remaining acceptance rows are either directly evidenced by tests/source or explicitly descoped by the issue owner. Passing CI and the bounded tests above do not close those gaps. The CI figures are exact-head results for the tested PR candidate, not a new run on the current `main` head. This record does not claim global cross-process process-graph recomputation.

- Keep the broader Core evaluation/recalculation/publication boundary in #262 open until its own source-backed acceptance matrix is satisfied.
- Keep production Memory→NPC **DISABLED / FAIL-CLOSED**. This decision does not authorize release or disclosure.
