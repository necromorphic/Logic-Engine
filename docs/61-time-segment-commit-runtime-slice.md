# T3 — bounded atomic segment commit

**Status:** T3 bounded atomic segment commit is merged in main.  
**Scope:** Core-internal bounded segment API for a set of provably independent events. No scheduler, long-operation cursor, or HTTP route.

## Contract

`LogicEngine.commitSegment(worldId, request)` accepts:

- a segment-level idempotency key;
- the expected starting world revision and optional commit sequence;
- 1–32 event proposals, each with explicit event ID and its own event idempotency key.

Per-event expected revision/cursor fields are rejected; the segment owns the base cursor. The Core computes the event cursor for each event in the segment. Segment and event keys must be distinct and unique.

### Independence requirement

The initial implementation deliberately supports only independent events in one segment. It rejects:
- causal or `depends_on` references to another event in the same segment;
- two events writing the same entity, fact, relationship pair, or mechanic instance;
- a segment event reading a projection another event writes, including explicit read sets, entity/fact dependencies, `READS_ENTITY`, `READS_CLAIM`, `REQUIRES`, relationship participants, and typed fact subjects.

These are not semantic conflicts to be auto-resolved. The caller must split the segment at the dependency boundary. The restriction keeps validation against the segment's starting projection sound; the current commit path does not yet maintain a fully evolving in-memory projection.

## Atomic commit algorithm

1. Prepare and normalize every event; validate the independence contract before opening a write transaction.
2. Enter a Core-owned outer SQLite transaction.
3. Replay-check the segment key, then validate world/revision/cursor.
4. Commit each event through the existing Core commit path with nested savepoints and projection rebuild deferred. Each event still writes its event row, revision, audit, and event-level idempotency result.
5. Rebuild canonical projections once after all event records have been accepted.
6. Save the segment-level idempotency result in the same outer transaction.
7. Commit the outer transaction. Any failure before that point rolls back every event, effect, coordinate change, audit row, replay row, and revision increment in the segment.

The operation result includes the segment ID, event IDs/results, starting/ending coordinates, revisions, and commit-sequence range. Replaying the same segment key/body returns the stored result and does not rebuild or apply effects again.

## Important boundary

This is a bounded **single segment** command. It does not yet represent a multi-segment time-advance operation with durable resume state. A later operation manager must store the requested interval, confirmed coordinate, policy/calendar versions, status, and next segment cursor atomically with each committed segment. The scheduler is not implemented here.

The 32-event limit is a Core work-budget safeguard, not a gameplay duration limit. The existing 12-hour / 7-day limits remain transitional until World Pack TimePolicy is integrated.

## Acceptance tests

- Two independent events commit atomically and projection rebuild occurs once.
- Event timestamps/coordinates and per-event revisions remain ordered within the segment.
- Segment retry returns the exact stored result without repeating effects.
- A later event failure rolls back earlier event writes, replay rows, audit, revisions, and time.
- Intra-segment dependencies and read/write overlap are rejected before mutation.
- A stale starting revision is rejected without partial mutation.
- The complete existing suite and the new segment tests pass in CI.

## Known limitation

The segment can only batch events whose independence is provable from explicit references and known effect semantics. Future effect kinds must declare their read/write footprint before they are admitted to this API. Do not weaken the validator to improve throughput without adding parity and failure-injection tests.
