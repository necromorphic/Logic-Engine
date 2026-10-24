# Process Manager — first durable slice

**Status:** implemented behind a draft PR; not production-enabled until review and exact-head CI pass.

## Ownership boundary

The Process Manager is a durable lifecycle over Core's existing registered time triggers and time-advance segment transaction. It is not a second scheduler and does not commit canonical effects itself. The existing scheduler module remains responsible for due-work ordering, dependency checks, same-coordinate conflicts, interruption boundaries, and deterministic planning.

The Core application layer validates process definitions and translates each milestone into a normal Core time-trigger event proposal. SQLiteStore persists the process and milestone checkpoints. During time advancement, trigger event effects, trigger completion, process milestone completion, operation progress, event idempotency, and audit are committed within the existing outer SQLite transaction. A failed segment rolls all of them back together.

## Supported first-slice contract

- World-scoped process identity and creation idempotency.
- Required expected_revision on creation and lifecycle commands.
- 1–100 declarative milestones, each with a future integer coordinate and a validated Core event proposal.
- Same-process milestone dependencies only; missing dependencies, cycles, and impossible causal time order are rejected.
- Per-milestone causal source event references must be valid events in the same world.
- States: scheduled, running, paused, completed, cancelled, failed, needs_review. This slice uses scheduled, running, paused, completed, cancelled, and needs_review; terminal failed is reserved for a future typed failure policy rather than assigned speculatively.
- Pause cancels pending trigger registrations while preserving pending milestone definitions. Resume creates new trigger identities and requires any overdue milestone to be explicitly rescheduled into the future. It never performs automatic catch-up.
- Cancellation fails closed when a milestone is claimed by a nonterminal time-advance operation.
- Same command key + same normalized request replays the saved result; same key + changed request conflicts.
- A rollback affecting a milestone's declared source event marks that milestone and its dependency descendants needs_review; unrelated completed milestones remain intact. This is conservative because a process's broader semantic dependencies are not yet proven complete.

## Recalculation boundary

A process milestone may mutate canonical entities/facts through an ordinary Core event. The Time scheduler does not infer the complete mechanic dependency graph, execute mechanic recalculation, or publish recalculated mechanic state. A future integration may request recalculation for affected declared dependencies, but that output remains a proposal until Core revalidates world identity, world revision, commit sequence, policy/version pins, and dependency evidence and sends it through the existing proposal/commit path.

Unsupported or incomplete dependency evidence must yield a conservative fallback or needs_review; it must not silently mark derived state current. This slice does not automatically grant NPC knowledge or create player-delivery/narration records.

## Persistence and recovery

Migration 10 adds:
- world_processes: lifecycle, creation identity, causal roots, last operation, and failure/review detail;
- world_process_milestones: per-milestone schedule, dependency IDs, source-event references, current trigger generation, and durable status;
- world_process_commands: command idempotency results.

Process and milestone rows are not a parallel event ledger. Canonical event effects and rollback remain owned by Core. Trigger identities are immutable; resume increments the trigger generation and replaces only pending milestone trigger links.

## Explicit limitations

- No generic process DSL or arbitrary executable callbacks.
- No autonomous model-selected canonical duration or outcome.
- No automatic NPC knowledge, belief update, player awareness, or delivery.
- No wall-clock scheduler/catch-up.
- A rollback of a causal source currently routes affected milestones and descendants to needs_review; it does not guess a recomputation outcome.
- The current trigger planner's batch mode is ordering metadata, not proof of aggregated intermediate effects.
- The broader mechanic dependency graph is not proven complete. A/B/C strategy selection remains outside this slice.

## Acceptance evidence required

The test suite must demonstrate two milestones, interruption after the first, SQLite close/reopen, progress inspection and completion of the second; create/command idempotency and changed-payload conflict; pause/resume with fresh trigger IDs; cancellation before due work; causal rollback with independent milestone progress preserved; and world isolation. The draft PR must pass the full Runtime workflow before review.
