# T5 — durable time-advance operation runtime slice

**Status:** T5 durable time-advance operation is merged in main. The operation manager is wired to the T4 planner and T3 segment commit, but trigger registration/completion reconciliation remains external.

## Contract

A start request supplies:
- `idempotency_key`;
- `expected_revision`;
- target `to_coordinate` in canonical integer milliseconds;
- a trigger set accepted by `planDueWork`;
- each executable trigger's `payload.event` proposal, which is normalized and validated by Core.

The starting coordinate is read from the canonical world state, never accepted from the caller. Start rejects a stale revision. Execution currently requires whole-second boundaries because Core event proposals still use integer `time_advance_seconds`; the operation rejects sub-second coordinates rather than rounding them.

## Execution and checkpoints

1. Core computes a deterministic T4 plan over `(current_coordinate, target_coordinate]`.
2. A blocked plan is persisted as `blocked` without changing canonical time.
3. Core translates each planned trigger into a validated event proposal. Scheduled effect events have zero duration; a synthetic `time.advance` event moves the world to each due coordinate first.
4. Gaps longer than seven days are split into bounded time-advance segments to respect the existing explicit-skip limit.
5. Each T3 segment and its operation checkpoint update commit in the same outer SQLite transaction. The checkpoint stores the confirmed coordinate, current world revision, and next segment index.
6. A running operation can resume after restart. If the canonical world no longer matches its last confirmed coordinate/revision, or a segment fails, the operation becomes `needs_review`; it does not guess whether to continue.
7. Repeating the same operation idempotency key and same request returns or resumes the existing operation. Reusing the key with a different request is rejected.

## API and authority

- `POST /v1/worlds/:id/time-advances`
- `GET /v1/worlds/:id/time-advances/:operation_id`
- `POST /v1/worlds/:id/time-advances/:operation_id/resume`

All three routes require both the normal bearer token and the separately configured `x-engine-internal-token`. If no internal credential is configured, these routes fail closed.

## Explicit non-goals / remaining gates

- Trigger definitions and their pending/completed/cancelled lifecycle are not persisted by this slice. The operation stores the supplied plan and reports completed trigger IDs; the host still owns reconciliation of its trigger source.
- The operation does not automatically grant NPC knowledge or deliver a notification to the player.
- World Pack `TimePolicy`, calendar persistence/version authoring, and arbitrary sub-second event duration are not integrated.
- The existing 12-hour action / 7-day explicit-skip limits remain unchanged.
- No system-clock-based advancement or catch-up simulation runs in the background.

## Acceptance tests

The test suite covers successful execution at exact due coordinates, explicit blocked result without progress, operation replay after world revision changes, internal-only HTTP access, sub-second rejection, and recovery from a persisted checkpoint without replaying the already-confirmed segment.