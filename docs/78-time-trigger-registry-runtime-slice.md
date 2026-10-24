# T5 follow-up — persisted world-scoped time triggers

## Purpose

A time-advance operation can now plan from a durable trigger registry rather than requiring the host to resend all trigger definitions on every request. This is scheduling metadata owned by Core; it does not replace canonical event history and does not start a background clock.

## Trigger contract

A registered trigger contains:
- stable `trigger_id` within one `world_id`;
- integer millisecond `due_coordinate`, currently aligned to whole seconds and strictly later than the current coordinate at registration;
- trigger-ID dependencies;
- declared `read_set` and `write_set`;
- `processing_mode` (`exact` or `batch`) and `interrupt_after_coordinate`;
- a `payload.event` proposal validated by Core.

Core derives stable event identity from world and trigger ID, and unions the trigger's declared conflict sets with the event proposal's read set and effect writes so omitted declarations cannot make conflicting effects appear independent. Scheduled effects are revalidated against the active TimePolicy at registration and planning; because a trigger fires at its due coordinate with zero additional duration, a rule that resolves to a positive or author-required duration blocks the trigger instead of silently bypassing the policy. A trigger ID is immutable: repeating the same registration returns the existing lifecycle record; reusing it with changed content is rejected. Forward dependencies may be registered before their dependency, but a due plan is blocked until the dependency is known and completed.

## Lifecycle and atomicity

Lifecycle states are `pending`, `completed`, and `cancelled`. An optional `claimed_by_operation_id` prevents concurrent operations from consuming the same pending trigger.

1. Registration/cancellation is world-scoped, audited, and increments `world_revision`, invalidating plans prepared against the previous scheduling state.
2. A registered-mode advance snapshots all triggers for the world and completed IDs. Pending triggers already at or before current time cause `TIME_TRIGGER_OVERDUE_NEEDS_REVIEW`; the engine never silently drops them because the interval uses `(from, to]`.
3. Operation creation claims every trigger that appears in a planned segment in the same SQLite transaction that records the operation.
4. For each segment, canonical events, trigger completion updates, completion audit records, and the durable operation checkpoint commit or roll back together.
5. A blocked plan makes no time progress and claims no trigger. A trigger claimed by a running operation cannot be cancelled. If an operation requires review, a claimed pending trigger can be cancelled explicitly; it is not silently released for automatic replay.

The registry is capped at 10,000 triggers per world, 32 MiB total stored payload bytes per world, and 256 KiB per trigger payload. List responses omit payload bodies; a single-trigger read is bounded by the per-trigger cap. A world TimePolicy sets the maximum whole-operation skip duration; when that exceeds seven days, Core splits the advance into synthetic events no longer than seven days each. A separate 1,024-segment hard work cap prevents an unbounded synchronous operation, so larger requests must be split by the caller. Scheduled trigger proposals cannot be `time.advance` events or add their own duration. No timer, wall-clock scheduler, or automatic catch-up is introduced.

## API

All routes require the general bearer token and the separately configured `x-engine-internal-token`.

- `POST /v1/worlds/:id/time-triggers` — register immutable trigger definition.
- `GET /v1/worlds/:id/time-triggers` — list lifecycle records.
- `GET /v1/worlds/:id/time-triggers/:trigger_id` — read one record.
- `POST /v1/worlds/:id/time-triggers/:trigger_id/cancel` — cancel a pending unclaimed trigger (or one whose claiming operation is no longer running), with an optional reason.

A `POST /v1/worlds/:id/time-advances` request that omits `triggers` uses registered triggers. Supplying `triggers` selects the existing request-scoped compatibility path. The two sources cannot be mixed in one request, and request-scoped mode is rejected if it would cross any registered pending trigger.

A `POST /v1/worlds/:id/time-actions` request resolves the action duration through the active TimePolicy, plans the same durable trigger registry over the resulting interval, and commits the action event at the confirmed target after due work. The caller cannot set the duration, event ID, or revision cursor. If due work blocks or interrupts the interval, the action is not committed and the result states why. Conflicting scheduled effects at the action's exact target are rejected for explicit review. Direct timed event/segment commits require an expected revision and are rejected if they would cross registered pending triggers.

## Explicit limitations

- Trigger completion is transactional with the segment checkpoint, but NPC knowledge and player delivery are separate and never implied by trigger completion.
- A pending trigger that becomes overdue after an external/request-scoped advance is not automatically rebased; the next registered-mode advance fails closed and reports its ID for review.
- A trigger whose execution segment fails is retained as pending and claimed by the operation that requires review. The operator can inspect and explicitly cancel it; automatic retry is not inferred.
- `batch` remains planner metadata. This runtime does not aggregate intermediate process effects.
