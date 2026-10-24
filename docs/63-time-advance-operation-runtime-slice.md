# T5 — durable time-advance operation runtime slice

**Status:** T5 durable time-advance operations are merged in main. Persistent trigger registration and completion reconciliation are implemented in the current follow-up slice; no background wall-clock scheduler is introduced.

## Contract

A start request supplies `idempotency_key`, `expected_revision`, and target `to_coordinate` in canonical integer milliseconds. If `trigger_source: "registered"` is selected—or the request omits `triggers`—Core snapshots the world's persisted triggers. For compatibility, a caller-supplied `triggers` array selects request-scoped planning; that mode does not mutate the durable trigger registry.

The starting coordinate is read from canonical world state, never accepted from the caller. Start rejects a stale revision, pending triggers already at or before the current coordinate, and intervals that exceed the active TimePolicy skip ceiling. Execution currently requires whole-second boundaries because Core event proposals still use integer `time_advance_seconds`; sub-second coordinates are rejected rather than rounded.

## Execution and checkpoints

1. Core computes a deterministic T4 plan over `(current_coordinate, target_coordinate]`.
2. A blocked plan is persisted as `blocked` without changing canonical time.
3. Core translates each planned trigger into a validated event proposal. Scheduled effect events have zero duration; a synthetic `time.advance` event moves the world to each due coordinate first.
4. The entire requested interval is bounded by the active TimePolicy's `max_skip_duration_ms` (or the legacy seven-day ceiling for worlds without a policy).
5. For registered triggers, the operation atomically claims planned trigger IDs. Each T3 segment, trigger completion state, completion audit entry, and operation checkpoint commit in the same outer SQLite transaction.
6. A running operation can resume after restart. If the canonical world no longer matches its last confirmed coordinate/revision, or a segment fails, the operation becomes `needs_review`; it does not guess whether to continue.
7. Repeating the same operation idempotency key and same request returns or resumes the existing operation. Reusing the key with a different request is rejected.

## API and authority

- `POST /v1/worlds/:id/time-advances`
- `GET /v1/worlds/:id/time-advances/:operation_id`
- `POST /v1/worlds/:id/time-advances/:operation_id/resume`

All three routes require both the normal bearer token and the separately configured `x-engine-internal-token`. If no internal credential is configured, these routes fail closed.

## Trigger lifecycle and explicit non-goals

- `POST /v1/worlds/:id/time-triggers` registers an immutable world-scoped trigger; `GET` collection/item reads it; `POST /:trigger_id/cancel` cancels unclaimed pending work. All routes require the internal credential.
- Trigger registration/cancellation increments `world_revision` and writes audit entries so a plan based on an earlier schedule revision cannot start silently.
- Registration rejects past/current and sub-second trigger coordinates, validates the effect proposal, and derives stable event identity from the world and trigger ID.
- Planned triggers are claimed in the same transaction as operation creation. Trigger completion is committed with the segment checkpoint; blocked plans do not claim work. A trigger claimed by a running operation cannot be cancelled.
- Pending triggers at or before current time fail closed with `TIME_TRIGGER_OVERDUE_NEEDS_REVIEW`; they are not silently skipped or automatically replayed.
- The operation does not automatically grant NPC knowledge or deliver a notification to the player.
- No system-clock-based advancement or catch-up simulation runs in the background.

## Acceptance tests

The test suite covers successful execution at exact due coordinates, explicit blocked result without progress, operation replay after world revision changes, internal-only HTTP access, sub-second rejection, and recovery from a persisted checkpoint without replaying the already-confirmed segment.