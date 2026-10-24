# Time Domain T1 — canonical coordinate and calendar projection

**Status:** T1 pure temporal model is merged in main. The runtime coordinate migration is tracked separately in T2.  
**Scope:** pure temporal functions and their tests only. No database migration, HTTP endpoint, scheduler, Core mutation path, or SillyTavern integration.

## Decisions captured

1. The canonical coordinate is a safe integer count of **milliseconds relative to a world's configured epoch**. Calendar date strings are projections, not canonical state.
2. Input duration APIs may continue to use seconds. An adapter converts validated seconds to milliseconds with checked integer arithmetic before proposing a canonical duration; that integration is outside T1.
3. Coordinates may be negative. The valid numeric domain is JavaScript safe integers, and every addition, multiplication, and derived offset must be checked. No silent rounding, overflow, or implicit clamping is permitted.
4. Calendar definitions are declarative and versioned. A repeating `year_cycle` supports different year/month lengths (including leap patterns) without executable calendar code. Weekday cycles are independent of year length.
5. Calendar projection is deterministic and independent of host clock, locale, timezone, database, and scheduler.
6. Interval semantics are `(from, to]`. A zero-length interval is empty. A reversed interval is invalid.
7. Calendar holidays are metadata returned by projection; projecting a holiday does not create a world event, apply effects, grant NPC knowledge, or deliver a message.
8. Changing a calendar version does not mutate stored coordinates. A future scheduler must preserve the version/meaning under which each date-based deadline was authored or require an explicit migration decision.

## Implemented pure API

File: `src/time/model.js`

- `createTimeCoordinate(value)` — validate a canonical coordinate.
- `addTimeDuration(coordinate, durationMs)` — checked forward addition.
- `createTimeInterval(from, to)` — validate an interval.
- `intervalContainsTime(interval, coordinate)` — apply the open-start/closed-end boundary.
- `createCalendarDefinition(input)` — validate and normalize a declarative calendar.
- `projectCalendarDate(definition, coordinate)` — map a coordinate to year/month/day, weekday, time of day, calendar version, and matching holidays.
- `calendarDateToCoordinate(definition, date)` — inverse mapping for dates representable by that calendar.

Errors are deterministic `TemporalModelError` instances with machine-readable `code` values. Invalid or unrepresentable conversions fail explicitly.

## Calendar shape

A calendar has a stable `calendar_id`, immutable `version`, positive `day_length_ms`, named `weekdays`, and a repeating `year_cycle`. Each year-cycle entry has months with stable IDs and positive day counts. The `epoch` binds one exact coordinate to a year number, year-cycle index, month/day, weekday index, and time of day. The repeating cycle is traversed in both directions from this anchor.

A holiday without `year_number` recurs whenever the referenced month/day exists. A holiday with `year_number` is one-off. A holiday is metadata, not a scheduler trigger. Future schema evolution should add explicit policy for calendars where a recurring holiday's date is absent in some year, alternate month naming, eras, or non-repeating calendars; T1 does not guess those semantics.

## Safety and compatibility boundary

- The module has no dependency on `Date.now()`, `Date.parse()`, locale, or timezone.
- It does not replace existing `worlds.game_time` or `time_advance_seconds` fields in runtime. Current runtime compatibility requires a separate, reviewed migration/adapter plan.
- T1 does not define how duration proposals from a model are authorized or converted into canonical effects.
- T1 does not implement multi-event atomic commits, operation checkpoints, scheduler scans, interrupts, recovery, or NPC knowledge acquisition.
- The current runtime's hard-coded duration limits are not silently changed by this module.
- Calendar version references for scheduled events and the storage format for calendar definitions remain integration contracts for later stages.

## Acceptance matrix

| ID | Case | Expected result |
|---|---|---|
| TD-001 | Safe integer coordinate, including negative | Accepted |
| TD-002 | Fractional or unsafe coordinate | Explicit validation error |
| TD-003 | Duration less than zero | Rejected |
| TD-004 | Addition beyond safe integer range | Overflow error; no clamp |
| TD-005 | Event at `from` | Excluded |
| TD-006 | Event at `to` | Included |
| TD-007 | Zero-length interval | Valid empty interval |
| TD-008 | Reversed interval | Rejected |
| TD-009 | Different year lengths in a repeating cycle | Correct projection |
| TD-010 | Negative coordinate before epoch | Correct reverse projection |
| TD-011 | Date/coordinate round-trip | Exact coordinate recovered |
| TD-012 | Annual and one-off holiday | Returned as metadata only |
| TD-013 | Invalid epoch/month/day/duplicate holiday ID | Explicit validation error |
| TD-014 | Host timezone or clock changes | No effect; functions read neither |
| TD-015 | Calendar version change | Existing coordinate remains unchanged |

Automated tests for the current pure API are in `tests/time-model.test.js`. A full repository test run is still required before merge; no test result is implied by this document.

## Exit criteria for T1

- [x] Pure coordinate arithmetic and interval boundary helpers exist.
- [x] Declarative calendar projection and inverse mapping exist.
- [x] Validation errors are explicit and machine-readable.
- [x] Tests cover positive/negative coordinates, cycle boundaries, round-trips, holidays, and invalid input.
- [x] Run the complete repository test suite in CI and resolve failures (GitHub Actions `test` passed on the current PR head).
- [x] Review the public calendar schema and naming for the T1 scope; cross-field semantic constraints remain enforced by the pure validator.
- [x] Select this pure API as the proposed basis for the next Core integration design; that integration still requires its own contract and review.

T1 completion does not authorize T2–T6. Core integration remains blocked on transaction-boundary and recovery audits.
