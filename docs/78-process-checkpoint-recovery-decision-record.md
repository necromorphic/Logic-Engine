# Process checkpoint recovery: Core decision record

**Status: DECISION APPROVED — fail closed on contradictory checkpoint evidence.**  
**Scope:** Core-owned recovery boundary for issue #243 and the evaluation/recalculation boundary in #262.  
**Decision owner:** Core owner approval recorded on 2026-10-29.  
**This record approves the failure policy only; it does not claim that cross-record process reconciliation is already implemented.**

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

### Remaining implementation gap

The existing TimeEngine guard establishes an operation-internal invariant. It does **not by itself prove** that every disagreement between a Process Manager milestone/process checkpoint and its related trigger, operation segment, and canonical event evidence is detected before continuation. That cross-record invariant requires a real-path regression test and implementation only through existing Core-owned seams.

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

## Explicit non-decisions

This decision does not designate a process checkpoint or a projection as canonical authority over committed events. It does not authorize automatic repair, a new API/schema/store/cursor/outbox, cross-process milestone prerequisites, global causal closure, automatic replan, or historical semantic recalculation. It does not grant NPC knowledge or player-delivery authority.

## Release boundary

- Keep #243 open until the required cross-record mismatch tests pass on an exact current head and the full acceptance matrix is evidenced.
- Keep the broader Core evaluation/recalculation/publication boundary in #262 open until its own source-backed acceptance matrix is satisfied.
- Keep production Memory→NPC **DISABLED / FAIL-CLOSED**. This decision does not authorize release or disclosure.
