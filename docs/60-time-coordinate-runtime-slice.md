# Time coordinate runtime slice — T2

**Status:** implementation proposal in PR; not merged.  
**Baseline:** main's existing ISO-based runtime and migration system.  
**Scope:** canonical coordinate fields, compatibility-preserving migration, and single-event Core commit updates.

## Runtime representation

- `initial_game_time_coordinate` is zero for a new world.
- `game_time_coordinate` is the canonical integer-millisecond offset from the world's fixed `initial_game_time` anchor.
- `world_events.game_time_coordinate` records the coordinate after that event's time advance.
- `world_events.time_advance_ms` records the event duration in integer milliseconds.
- Existing ISO `initial_game_time` / `game_time` and `time_advance_seconds` remain for compatibility. The current `game_time` field is now explicitly a legacy ISO projection derived from the fixed initial timestamp plus the canonical coordinate; it is not the authoritative date of a future non-Gregorian calendar.

The calendar projection in `src/time/model.js` is still a pure independent layer. This slice does not load a World Pack calendar or expose a calendar-formatted date through the HTTP API.

## Migration 6

The migration adds the coordinate/duration columns and backfills them from the existing records:

- World initial coordinate = 0.
- Current world coordinate = parsed current ISO timestamp minus parsed initial ISO timestamp.
- Event coordinate = parsed event ISO timestamp minus the world's initial ISO timestamp.
- Event duration in milliseconds = the stored `time_advance_seconds * 1000`.

Each parsed timestamp, duration, and derived integer is checked for representability. The migration aborts transactionally on invalid timestamps, unsafe coordinate differences, or invalid durations. It does not silently round or clamp.

Historical event timestamp and duration fields are preserved independently. The legacy migration fixture includes event timestamps that do not match the defaulted duration field; migration therefore preserves the recorded timestamp coordinate and recorded duration rather than inventing corrected history. Any historical mismatch remains a separate audit/reconciliation concern.

## Single-event commit invariants

1. The event's coordinate, duration, world coordinate, ISO compatibility timestamp, world revision, event history, audit, and idempotency result are written in the existing Core-owned SQLite transaction.
2. A replay of the same request does not advance coordinate twice.
3. Coordinate overflow or an ISO compatibility timestamp outside the supported JavaScript Date range rejects the transaction without partial writes.
4. Rollback continues to preserve game time; it does not rewind the coordinate.
5. World coordinate is independent of calendar version. A later calendar change can alter the date projection without rewriting the canonical coordinate.

## Explicit limitations

- The existing action/skip duration limits in `LogicEngine.prepareEvent()` are unchanged in this slice. They are transitional compatibility limits, not the target architecture. A later World Pack `TimePolicy` integration must replace hard-coded policy decisions before the time block is considered complete.
- There is no due-time scheduler, interrupt protocol, long-skip operation state, checkpoint, resume endpoint, or segment batch commit.
- The current Core still rebuilds projections during each event commit. A multi-event segment must not naively call the full commit path N times without addressing the repeated history scan.
- The new coordinate is exposed as additive state/event/result fields; existing API fields remain intact.

## Tests

- New-world zero coordinate and ISO-anchor preservation.
- Single-event coordinate and duration update.
- Idempotent replay without double advancement.
- Overflow rejection with no event, revision, audit, or coordinate mutation.
- Legacy migration backfill and migration versioning.

The repository's full `npm test` CI result is the acceptance gate for this slice. T3 segment atomicity and T4 scheduler remain separate work packages.
