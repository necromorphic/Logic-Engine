# Core 1.7 — Time Domain T1: coordinate and calendar primitives

**Status:** T1 implementation proposal on a feature branch; not merged and not wired into runtime.  
**Scope:** pure deterministic functions only. No SQLite schema, API, scheduler, NPC knowledge, delivery, or canonical state mutation.

## Decisions captured

1. Canonical game time is an integer coordinate, not a formatted calendar string.
2. The initial coordinate unit is a millisecond-sized time unit. This preserves sub-second precision already representable by existing ISO timestamps while keeping integer arithmetic. Action durations may continue to arrive in whole seconds and be converted at the boundary.
3. Coordinates are safe integers and may be negative. The coordinate origin is a world-specific temporal epoch; it is not itself a calendar date. Compatibility code must use an explicit anchor when translating existing ISO timestamps to/from coordinates.
4. Calendar projection is a pure function over a versioned declarative definition. It must not read the system clock, locale, timezone, or mutable global state.
5. Event interval semantics are `(from, to]`: an event at `from` is not re-triggered merely because an advance starts there; an event at `to` is included.
6. An empty interval is valid and contains no time point under these semantics. Reversed intervals are invalid.
7. This T1 calendar primitive supports fixed month lengths, a repeating weekday cycle, recurring month/day holidays, one-off year/month/day holidays, and non-standard day lengths. It intentionally does not infer leap-year, intercalary, lunar, or variable-year rules. Those require an explicit, versioned declarative schema extension before such calendars are claimed as supported.
8. No production caller should use these functions until the coordinate-to-existing-ISO compatibility contract is reviewed and implemented separately.

## Why millisecond-sized integer units

- Whole seconds would discard milliseconds from valid existing ISO timestamps unless the runtime explicitly rejected or rounded them.
- Floating-point fractional seconds introduce avoidable rounding.
- Millisecond-sized units retain integer arithmetic and convert whole-second action durations exactly.
- JavaScript safe-integer limits are enforced. The usable coordinate range is therefore bounded; conversion to/from ISO timestamps has an additional platform-date range and must validate it independently.
- The unit is a precision choice, not a commitment that all worlds have 24-hour days. A calendar definition supplies its own positive `unitsPerDay`.

The coordinate origin must be explicit per world when bridging the current `initial_game_time` / `game_time` ISO fields. Do not silently assume that a world-local coordinate is a Unix timestamp.

## Pure API introduced

### `src/time/coordinate.js`

- `assertTimeCoordinate(value, name?)`: validate a safe integer, including negative values.
- `addTimeUnits(coordinate, delta)`: add units and reject unsafe results.
- `differenceTimeCoordinates(to, from)`: compute a safe difference or reject overflow.
- `secondsToTimeUnits(seconds)`: convert non-negative whole seconds to units without rounding.
- `createTimeInterval(from, to)`: validate an ordered interval.
- `intervalContains(interval, coordinate)`: apply `(from, to]` semantics.
- `compareTimeCoordinates(left, right)`: deterministic comparison.

### `src/time/duration.js`

- `resolveDurationDecision(rule, proposal?)`: resolve a fixed duration, deterministically resolve a declared range, request author adjudication for a range configured for author choice, or let a model proposal select only a predeclared world-rule category.

The model cannot submit arbitrary canonical units. Unsupported categories or proposals containing extra fields are rejected. A fixed rule remains authoritative; a range never silently chooses a random value.

### `src/time/iso-compat.js`

- `isoInstantToCoordinate(isoInstant, epochIsoInstant)`: translate an ISO date-time to an integer offset from an explicit ISO anchor.
- `coordinateToIsoInstant(coordinate, epochIsoInstant)`: translate an offset back to canonical ISO UTC.

The adapter requires explicit timezone information and at most millisecond precision, rejects invalid date/time components, and enforces both safe-integer and platform date limits. It is a pure compatibility boundary only; it is not connected to runtime persistence.

### `src/time/calendar.js`

- `projectFixedCalendar(coordinate, definition)`: project a coordinate through a declarative fixed-layout calendar.

Calendar definitions contain a version, a positive `unitsPerDay`, month names and lengths, weekday names, an epoch mapping (coordinate/year/month/day/weekday index), and optional recurring or one-off holidays. Projection returns the calendar version with the date, weekday, within-day units, and matching holiday identifiers.

The function rejects malformed definitions and unsafe arithmetic rather than silently normalizing them. The function does not mutate its definition or the world. `epoch.coordinate` denotes the beginning of the configured epoch date; `time_of_day_units` is zero at that coordinate.

## Explicit non-goals

- No changes to `LogicEngine`, `SQLiteStore`, current `game_time` persistence, event commit semantics, or API payloads.
- No calendar version editing workflow, World Pack loader, migration, or backfill.
- No due-event scheduler, event execution, segment checkpoints, or resume protocol.
- No automatic time advancement based on wall-clock time.
- No NPC knowledge or player delivery side effects.
- No claim that an atomic multi-event segment is supported by the current storage layer.

## Acceptance criteria

- Safe integer validation and overflow detection are covered.
- Duration rules reject unsafe values and unapproved model proposals; ambiguous ranges resolve deterministically or require author input.
- Negative coordinates and pre-epoch calendar projection are covered.
- Seconds-to-unit conversion is exact for supported inputs and rejects unsafe results.
- Interval boundaries and zero-length intervals are covered.
- ISO conversion requires an explicit anchor, preserves millisecond precision, and rejects ambiguous or invalid inputs.
- Fixed-layout calendar projection supports non-standard month lengths, weekday cycles, non-standard day lengths, and explicit holidays.
- Invalid calendar definitions fail deterministically.
- Functions are pure and do not use `Date.now()`, timezone, locale, database, network, or mutable shared state.
- Runtime integration remains out of scope until a separate compatibility design is reviewed.

## Known limitation to resolve before broader calendar support

The current projection primitive has fixed month lengths within a repeating year. It is a useful T1 base, not the final calendar language. Before T6, define declarative rules for leap years, intercalary days, variable year cycles, and any world-specific cycle requirements. Version changes must state how already-scheduled event dates are interpreted; historical coordinates must never be silently reinterpreted.

## Verification status

The new test file uses Node's built-in test runner. The repository's full test suite and this new test file still need to be executed in CI or a local checkout before the branch can be considered verified. Static creation of tests is not evidence that they pass.
