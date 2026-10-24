# Time advancement — Core integration audit

**Audit baseline:** `main` at `1c5854296386565ef59c50640195caf142e131aa` (2026-10-24), including the mixed-projection replay/rollback benchmark.  
**Status:** static code/document audit; no runtime changes in this document.  
**Related proposal:** `docs/58-time-domain-t1-design.md` in the T1 feature branch / PR #204.

## Findings verified in the current runtime

### 1. Existing time representation

- `worlds.initial_game_time` and `worlds.game_time` are ISO-8601 UTC text values.
- `world_events.game_time` is also ISO-8601 UTC text.
- Each event stores `time_advance_seconds`.
- `LogicEngine.prepareEvent()` validates a non-negative safe integer duration and currently hard-codes 43,200 seconds for ordinary actions and 604,800 seconds for explicit skips.
- `SQLiteStore.commit()` calculates the next ISO timestamp from the current `worlds.game_time` plus `time_advance_seconds * 1000`.

Relevant code: `src/application/engine.js` (`prepareEvent`) and `src/storage/sqlite-store.js` (`commit`, world/event schema).

### 2. The current single-event transaction is strong

`SQLiteStore.commit()` runs inside `this.tx()`. In the same SQLite transaction it:
1. checks the idempotency replay;
2. validates world existence and expected revision / commit sequence;
3. validates causal metadata and effect preconditions;
4. inserts the event;
5. updates `world_revision` and `game_time`;
6. rebuilds projections;
7. writes audit;
8. saves the idempotency result.

The transaction helper uses `BEGIN IMMEDIATE` at the outer level and SQLite savepoints for nested calls. Therefore, a future segment transaction may be implementable by introducing a Core-owned segment operation that encloses per-event Core commits in one outer transaction. This is a promising primitive, **not yet a verified segment guarantee**: there is no explicit segment API, no segment-level operation record, and no test proving that a failed later event rolls back every earlier event and all their replay/audit/projection writes.

### 3. Performance implication from the new benchmark

The repository's replay/rollback CI benchmarks demonstrate history-scan growth. In the earlier entity-only workload, a commit took about 18 ms / 64 ms / 122 ms at 1,000 / 5,000 / 10,000 prior events. The newer mixed entity/fact/relationship workload measured commit at about 65 ms / 239 ms / 494 ms, rollback at about 51 ms / 265 ms / 1,310 ms, and standalone rebuild at about 52 ms / 220 ms / 486 ms at those same sizes. These are one-run CI measurements, not performance guarantees; the mixed workload is synthetic, but it exercises all three projection families and confirms that projection rebuilding is a material cost.

**Do not implement a segment as N calls to the current commit path and assume the cost is acceptable.** Each nested call would still run causal/effect validation and a full projection rebuild, so a segment of many events could repeatedly scan the growing history. A T3 batch path should validate and apply the segment in causal order inside one outer transaction, maintain an in-memory/transaction-local projection as needed, persist event/audit/idempotency records, and rebuild or finalize canonical projections once per segment. That path needs parity tests against repeated single-event commits for all supported effect kinds.

### 4. Revision and event semantics

- The current commit increments `world_revision` once per accepted event, even if several commits are nested in a future outer transaction. That can be retained, but the segment contract must say that intermediate revisions are not externally visible before the outer commit.
- Each event has a commit sequence and event-level idempotency result. Event-level idempotency alone does not fully describe a multi-segment advance operation or recovery after a lost response.
- Existing rollback invalidates/retracts events and rebuilds projections, but deliberately does not rewind game time. A new coordinate representation must preserve that invariant.
- The existing test suite already covers replay of an identical request, changed-body idempotency conflicts, stale revisions, and rollback without time rewind.

### 5. Missing capabilities

The current runtime has no canonical integer time-coordinate fields, world calendar definition/version, duration-decision contract, due-time index/scheduler, persisted long-advance operation, segment cursor/checkpoint, interrupt protocol, or resume/recovery API. The T1 pure module does not implement any of these and must not be treated as if it did.

## Recommended T2 contract

### Compatibility-preserving coordinate migration

Add canonical coordinate fields without immediately deleting or reinterpreting the legacy ISO fields:

- World: `initial_game_time_coordinate` and `game_time_coordinate`.
- Event: `game_time_coordinate` and `time_advance_ms`.
- Keep `initial_game_time`, `game_time`, and `time_advance_seconds` temporarily as compatibility fields for existing API clients and old records.

For legacy worlds, use coordinate zero at the world's initial timestamp. Backfill current world coordinates and historical event coordinates from their stored UTC timestamps relative to `initial_game_time`, while checking that the values are safe integers and consistent with the existing duration history. If a row is inconsistent or outside the representable range, abort the migration with a clear diagnostic; do not silently round, clamp, or fabricate canonical time.

For new commits, Core validates the requested duration, converts it to milliseconds with checked arithmetic, advances the canonical coordinate, and derives the legacy ISO compatibility timestamp from the world's fixed initial ISO anchor plus the coordinate. Calendar projection remains separate and can later map that same coordinate into a non-Gregorian world calendar. The legacy ISO field must be documented as a compatibility projection, not as the custom world's canonical calendar date.

This bridge keeps the first migration reversible and avoids changing the HTTP contract in the same step. A later API version can expose calendar-projected world date/time explicitly.

### T2 commit invariants

1. Time coordinate, event row, effects, audit, revision and idempotency result commit or roll back together.
2. Event time records the resulting coordinate after the action, matching current post-advance `game_time` behavior.
3. A replay returns the stored result and never advances coordinate twice.
4. Stale `expected_revision` / `expected_commit_sequence` is rejected before mutation.
5. Rollback does not decrement the time coordinate.
6. No scheduler, calendar editing, multi-segment operation, or NPC knowledge side effect is added in T2.
7. Existing API response fields remain compatible until a separately reviewed versioned contract replaces them.

## T3 segment atomicity: implementation condition

The likely implementation path is a Core-owned segment command wrapping multiple canonical event commits in one outer SQLite transaction, with nested savepoints retained for per-event failure isolation inside the outer transaction. It must also persist the segment/advance-operation result in that same outer transaction. A failure at any event or operation-state write must roll back the entire segment.

Before enabling this path, add integration tests that prove:
- event N failing after earlier event writes leaves no segment events, effects, audit rows, replay rows, revision increments or time changes;
- successful segment commits all event histories and the operation result atomically;
- concurrent/stale callers cannot commit a plan based on an old revision;
- retrying a completed segment returns the exact stored result;
- a simulated lost response is resolved by querying the operation idempotency key before retrying;
- rollback after a committed segment preserves the advanced time coordinate.

If this proof fails, do not approximate segment atomicity by issuing independent public commits.

## Decision boundary

This audit supports the T2 coordinate migration and Core-owned advancement implemented for review in PR #209. The current CI run on that PR passes 263 tests. It does not justify adding the scheduler or resumable long skips yet. T3 is gated on a batch path that preserves causal validation while avoiding a full projection rebuild after every event; T4 is gated on T2/T3 and event-boundary semantics.


## T3 design sketch — bounded atomic segments

T3 should introduce a Core-owned segment command, not a scheduler-owned loop around public commits. The proposed execution sequence is:

1. **Identify the operation.** Validate a stable operation idempotency key and request hash, world ID, requested coordinate interval, policy/calendar version references where applicable, and the expected initial revision/cursor.
2. **Plan without mutation.** Build the candidate segment's dependency graph and read/write sets. Validate that ordering is deterministic and causal references resolve in the same world. Conflicts that cannot be resolved by declared rules return a review outcome; a sort order is not a conflict resolver.
3. **Acquire the write transaction.** Begin the Core-owned SQLite transaction, replay-check the operation key, and re-check revision/cursor. A stale plan is rejected or rebuilt; it is never committed as-is.
4. **Evaluate in causal order.** Validate each event against a transaction-local evolving projection. Relationship transitions and mechanic-instance lifecycle operations must see prior accepted effects in the same segment when dependencies require it. Do not read stale persisted projections as if earlier segment effects had already been applied.
5. **Persist the segment atomically.** Persist event records, event-level replay results, per-event audit, coordinate updates, revision/commit-sequence progression, final projection state, and the segment/operation cursor in one transaction. Rebuild the complete projection once per segment at most, or use a proven incremental projection update.
6. **Commit or roll back all.** Any validation, effect, projection, audit, replay, or operation-cursor failure rolls back the entire segment. Only after the transaction commits may its resulting coordinate be reported as confirmed.

### Segment boundaries and interrupts

A segment is an indivisible commit unit. An event whose policy says `interrupt` ends the segment at its declared boundary; it is never processed halfway through a segment. After commit, the operation returns `interrupted` with the exact confirmed coordinate and may wait for author/player adjudication or resume according to the event/world policy.

To keep segments tractable, the Core may enforce a bounded work budget (event count, effect count, and execution cost) independent of game-time duration. Exceeding that budget splits the plan into more segments; it must not silently truncate or pretend the requested endpoint was reached. The exact numeric work budget should be selected from benchmark-backed tests, not copied from the current 12-hour / 7-day gameplay limits.

### Durable operation state

Long advancement needs a durable operation record separate from event identity. Minimum fields to evaluate before schema design:

- `operation_id`, `world_id`, `idempotency_key`, `request_hash`;
- requested start/end coordinates and confirmed `committed_to_coordinate`;
- operation status (`active`, `interrupted`, `completed`, `needs_review`, `failed`);
- next segment sequence / cursor, last committed revision and commit sequence;
- pinned policy/calendar version references and timestamps;
- last result/error details sufficient for safe retry and author-visible diagnosis.

A segment ledger is useful if event IDs alone cannot reconstruct which events belong to each committed segment. It should be added only if it carries information not safely derivable from operation and event records. The operation-level idempotency result and cursor update must commit atomically with the segment whose progress they describe.

### T3 acceptance tests

- Failure injection after the first event, after audit insertion, after projection update, and before operation-cursor update leaves the segment wholly uncommitted.
- Success commits all event histories, effects, replay records, audit rows, coordinate changes, and operation cursor together.
- A replay of a completed segment returns the stored result and never repeats effects.
- An unknown commit outcome is resolved by reading the operation key and persisted cursor before retry.
- Two competing plans from the same revision cannot both commit as if they had exclusive ownership.
- Events with explicit dependencies see prior effects in the same segment; independent events remain deterministic.
- Results match sequential single-event semantics for each supported effect type, including facts, entities, relationships, and mechanic instances.
- Interrupt events terminate at a committed segment boundary; no event is half-applied.
- Rollback of committed events restores effects but does not rewind canonical time or erase segment history.
- At 1k/5k/10k-event histories, a segment performs at most one full projection rebuild; benchmark growth is recorded for entity-only and mixed-projection workloads.

**Gate:** do not implement T3 by toggling a `deferRebuild` flag on the existing commit loop alone. That would leave later events validating against stale projections. The implementation needs either a transaction-local evolving projection or a narrower, explicitly enforced independence contract. The first option is more general; the second may be a safe initial slice if it rejects any intra-segment read/write overlap or dependency it cannot prove safe.
