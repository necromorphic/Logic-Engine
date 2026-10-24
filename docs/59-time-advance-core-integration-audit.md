# Time advancement — Core integration audit

**Audit baseline:** `main` at `afec1de5ad013ff8d69ac628d0214c065c1649ca` (2026-10-24).  
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

### 3. Revision and event semantics

- The current commit increments `world_revision` once per accepted event, even if several commits are nested in a future outer transaction. That can be retained, but the segment contract must say that intermediate revisions are not externally visible before the outer commit.
- Each event has a commit sequence and event-level idempotency result. Event-level idempotency alone does not fully describe a multi-segment advance operation or recovery after a lost response.
- Existing rollback invalidates/retracts events and rebuilds projections, but deliberately does not rewind game time. A new coordinate representation must preserve that invariant.
- The existing test suite already covers replay of an identical request, changed-body idempotency conflicts, stale revisions, and rollback without time rewind.

### 4. Missing capabilities

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

This audit supports proceeding with a **small T2 compatibility migration and Core-owned coordinate advancement**, after its implementation contract and migration tests are reviewed. It does not justify adding the scheduler or resumable long skips yet. T3 is gated on the explicit atomic-segment tests above; T4 is gated on T2/T3 and event-boundary semantics.
