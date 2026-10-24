# Core 1.7 — Time advancement and segment atomicity audit

**Status:** implementation audit and test evidence; no runtime behavior changed by this document.  
**Scope:** current Core transaction boundary and the prerequisites for T2/T3. The time-domain primitives in PR #219 are not wired into the runtime.

## Findings against current main

### Existing behavior

- LogicEngine.prepareEvent() accepts time_advance_seconds and time_mode (action / explicit_skip).
- The runtime currently enforces hard-coded limits of 43,200 seconds for ordinary actions and 604,800 seconds for explicit skips.
- The canonical world time and event time are currently stored as ISO strings. The event records the post-advance time.
- SQLiteStore.commit() checks idempotency replay and expected revision/commit sequence, calculates the new time, inserts the event, updates world time and revision, rebuilds projections, writes audit, and stores the replay result inside one transaction.
- SQLiteStore.tx() uses BEGIN IMMEDIATE for the outer transaction and SQLite savepoints for nested calls.
- Rollback invalidates causal effects and advances revision, but does not rewind game time.
- There is no dedicated time-advance operation record, segment cursor, due-work scheduler, calendar rules store, interruption protocol, or restart-resume protocol in the inspected runtime.

References:
- src/application/engine.js: prepareEvent() and commitEvent().
- src/storage/sqlite-store.js: tx(), commit(), and rollback().
- docs/02-turn-event-delivery-lifecycle.md: required separation of turn, event, and delivery.
- docs/03-storage-and-persistence-contract.md: canonical mutation and audit requirements.

## Important refinement: segment atomicity may reuse the existing transaction primitive

The nested savepoint behavior suggests a multi-event segment can potentially be implemented as one outer store.tx(() => { ...commit(...)... }) operation. Each event can retain its own event ID, revision, commit sequence, causal metadata, audit entry, and idempotency result while remaining invisible to other SQLite transactions until the outer transaction commits.

This is a **feasibility result, not yet a production guarantee**. The new test tests/time-segment-transaction-audit.test.js exercises rollback of two nested event commits and verifies that world time, revision, events, and per-event idempotency results all roll back together. CI must pass before treating the proof as verified.

Caveats remain:
- Every nested commit() rebuilds projections; repeated rebuilds inside a long segment may be expensive.
- A segment-level operation identity and durable resume cursor do not currently exist.
- A network failure with an unknown outer-commit outcome still requires a stable operation identity and a way to inspect its saved result.
- Segment boundaries, interruption semantics, and due-work selection are not implemented.
- The current ISO timestamp model remains the runtime source of truth until a separate migration is designed and reviewed.

## Recommended next contracts

### T2 — canonical advance request

A future AdvanceTimeRequest should distinguish:
- operation ID / idempotency key;
- world ID and pinned World Pack version;
- operation kind: action-derived advance, explicit skip, or authorized author correction;
- requested duration or target coordinate;
- expected_revision and, where relevant, expected_commit_sequence;
- the validated duration decision and policy version;
- request hash and origin metadata.

The Core must resolve a replay before executing effects. The same key with a different request hash must be rejected. A stale revision must not commit a plan calculated against old state.

### T3 — segment commit

A segment commit must atomically include:
- all accepted canonical events/effects in the segment;
- the resulting time coordinate and compatibility projection;
- per-event audit, causal history, revision and idempotency records;
- segment/operation progress and its idempotency result.

Either all of these records become visible, or none do. A sequence of independently committed calls is not a segment transaction. If commit() is used inside an outer transaction, the implementation must test both successful multi-event commit and rollback-on-failure, including duplicate/retry behavior.

### Durable recovery

Keep three cases distinct:
1. A completed operation is replayed from its saved result.
2. An operation whose previous segment committed resumes after the last confirmed segment boundary.
3. An unknown commit outcome is checked against durable operation state before any retry.

Rollback is a separate causal operation; it is not a method of rewinding time or deleting audit history.

## Migration constraint for integer coordinates

The T1 helpers use millisecond-sized integer units relative to an explicit ISO anchor. A safe compatibility migration can use each world's immutable initial_game_time as the anchor and derive existing coordinates as:

    coordinate = parseISO(game_time) - parseISO(initial_game_time)

This must be applied consistently to current world time and historical event times, with safe-integer and platform-date-range checks. The existing ISO fields should not be removed until migration, rollback, API compatibility, and projection rebuild behavior are tested. A calendar date is a projection of the coordinate; ISO compatibility strings are not the canonical calendar for every world.

## Gate before T2/T3 runtime implementation

- T1 coordinate/calendar/duration tests pass in CI.
- The segment transaction test passes in CI.
- The ISO-anchor migration and legacy API compatibility strategy are reviewed.
- The World Pack time-policy source and immutable version semantics are specified.
- The operation-level idempotency/recovery contract is specified before adding tables.
- No scheduler or NPC knowledge mutation is added as part of this audit.
