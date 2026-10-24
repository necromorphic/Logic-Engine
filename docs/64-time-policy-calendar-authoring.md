# T6 — versioned calendar and TimePolicy authoring

## Configuration contract

A world can activate an immutable time configuration tied to its pinned `world_pack_id` and `world_pack_version`. Each configuration version contains:
- a declarative calendar definition accepted by the pure T1 calendar validator;
- a declarative TimePolicy with action/skip ceilings and duration rules;
- an immutable content hash and an activation audit record.

Registering a new configuration version increments `world_revision` and updates the active version pointer. It does not change the canonical time coordinate or rewrite past timestamps. Older versions remain readable and immutable. Reusing a version with different content is rejected.

The host/authoring adapter is responsible for loading the intended World Pack content and submitting it through the trusted Core boundary; this slice does not create a World Pack registry or execute calendar code.

## Duration decisions

A TimePolicy can define per-event-type:
- `fixed`: a single duration in milliseconds;
- `range`: deterministic midpoint selection or an explicit `needs_author` result;
- `category_map`: a proposal can select only a predeclared category and duration.

When a configuration is active, Core resolves action duration from the policy. A caller-supplied duration that differs from the resolved duration is rejected. Missing rules permit zero-duration events only; nonzero arbitrary durations are rejected. Ambiguous ranges do not silently select a value.

Explicit skip remains a separate intent and is bounded by the active policy's `max_skip_duration_ms`. Current event commit APIs still require whole-second durations; a policy that resolves a sub-second action duration fails closed until a millisecond-duration commit contract is added.

The active configuration version is included in duration-decision metadata and audit. If the configuration changes between resolution and commit, Core rejects the stale decision.

## API

- `POST /v1/worlds/:id/time-configurations` — admin-only registration/activation.
- `GET /v1/worlds/:id/time-configurations/current` — trusted read of the active or requested version.
- `GET /v1/worlds/:id/time` — trusted calendar projection of the current coordinate or an explicitly supplied coordinate.

The API requires the general bearer token in addition to the separate admin/internal credential.

## Current limits

- TimePolicy limits cannot exceed the existing seven-day per-event safety ceiling.
- The active TimePolicy is per-world and pinned to the world's World Pack ID/version, but this slice does not fetch or parse World Pack files itself.
- Calendar configuration changes alter future projections only; they never mutate the canonical coordinate.
- Author-required duration decisions currently return a typed conflict. A dedicated author-resolution workflow is not implemented.
- NPC knowledge, player delivery, and persistent trigger registration remain separate systems.


---

# T7 — durable time-trigger registry and atomic lifecycle

**Status:** implementation proposal in this branch. This slice makes trigger definitions Core-owned and reconciles their lifecycle with durable time-advance checkpoints. It does not implement a background/system-clock scheduler.

## Contract

A trigger is world-scoped and identified by an immutable `trigger_id`. It contains a canonical integer-millisecond `due_coordinate`, dependency trigger IDs, declared projection `read_set` and `write_set`, `exact` or `batch` processing metadata, an optional interrupt-after-coordinate policy, and a validated event proposal payload.

A trigger can be registered only strictly after the world's current coordinate. Re-registering the same ID with the same normalized content is idempotent; the same ID with different content is rejected. The first slice has no reschedule or reopen operation. Cancellation is permitted only while a trigger is pending and unclaimed.

The registry is isolated by `world_id`. Registration and cancellation increment the world's revision and write audit entries. The registry is limited to 10,000 triggers per world, 32 MiB total stored payload bytes per world, and 256 KiB per event payload. Registry list responses omit payload content to keep response size bounded.

## Operation selection and reservation

The HTTP time-advance endpoint no longer accepts caller-supplied trigger arrays. It plans from the Core-owned registry. Pending triggers at or before the current coordinate cause a typed `TIME_TRIGGER_OVERDUE` refusal; Core does not silently skip overdue work.

The planner sees pending, completed, and cancelled registry records so it can resolve dependency status. Missing, cancelled, not-yet-due, cyclic, or conflicting dependencies preserve the existing fail-closed planner behavior.

Before an operation is persisted, the same SQLite transaction checks the starting coordinate/revision, verifies each planned registry trigger is still pending, unclaimed and within the interval, inserts the operation, and reserves the planned trigger IDs. A failed reservation rolls back the operation row.

## Atomic completion and failure

Each planned segment stores the registry trigger IDs represented by its trigger events. The segment's canonical events, world time, event/audit/idempotency records, trigger transition to `completed`, trigger completion audit, and operation checkpoint commit inside the same outer SQLite transaction.

If segment execution fails, canonical effects and trigger completion both roll back. The operation becomes `needs_review`; the trigger remains pending but claimed by that review-required operation. Core does not release it for automatic re-execution, and cancellation is rejected while claimed. A human/author resolution workflow remains future work.

A successful operation replay returns its saved result. A new operation cannot execute a completed trigger again. `batch` remains processing metadata in this slice; effects are not aggregated.

## API and limits

All routes require the general bearer token and separate `x-engine-internal-token`:
- `POST /v1/worlds/:id/time-triggers` — register an immutable trigger.
- `GET /v1/worlds/:id/time-triggers` — list lifecycle records.
- `POST /v1/worlds/:id/time-triggers/:trigger_id/cancel` — cancel an unclaimed pending trigger.
- `POST /v1/worlds/:id/time-advances` — advance through the registry; inline `triggers` and `completed_trigger_ids` are rejected.
- Existing operation status and resume routes remain unchanged.

No system-clock advancement, NPC knowledge, player delivery, World Pack trigger authoring, or automatic recovery from `needs_review` is introduced.
