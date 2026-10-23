# Mechanic instance runtime — implementation design

Status: first lifecycle runtime slice implemented in `src/storage/sqlite-store.js`, `src/application/engine.js`, `src/api/server.js`, and `src/core/rules.js`. Execution semantics remain out of scope.

## 1. Source of truth

Committed `world_events` are canonical. A `mechanic_instances` table, if used, is a rebuildable world-local projection, equivalent in authority to the existing entity/fact projections. Direct API or adapter writes to that projection are forbidden.

Each instance pins exactly one immutable `(template_id, template_version)`. Template definitions remain global; instance configuration and state remain world-local.

## 2. Event contract

The first runtime slice supports only lifecycle operations:

- `mechanic.instance.create`: creates a disabled instance pinned to an existing exact template version.
- `mechanic.instance.enable`: changes disabled to enabled.
- `mechanic.instance.disable`: changes enabled to disabled.

These are engine-mediated configuration events, not generic LLM-authored effects. Until the host has a trusted actor/role contract, lifecycle mutation routes require the separate administrative credential and ordinary proposal creation must reject lifecycle effects. A shared admin token is a credential boundary, not proof of a named human identity; audit records must describe that limitation honestly.

Every transition carries an expected world revision and idempotency key. Enable/disable events causally reference the immediately preceding lifecycle event for that instance. A transition is validated against the current projection inside the same SQLite transaction that commits the event, increments revision, rebuilds projections, records audit, and stores the idempotency result.

## API surface

All lifecycle routes require the normal bearer API credential plus the separate `x-admin-token` credential. Listing is admin-only as well.

- `GET /v1/worlds/:world_id/mechanic-instances` lists the world's projected instances.
- `POST /v1/worlds/:world_id/mechanic-instances` accepts `instance_id`, `template_id`, `template_version`, optional object-valued `parameters` and `state`, `expected_revision`, and `idempotency_key`. Creation starts disabled.
- `POST /v1/worlds/:world_id/mechanic-instances/:instance_id/enable` and `/disable` accept only `expected_revision` and `idempotency_key`.

Lifecycle request bodies reject extra fields. Adapter proposals cannot carry lifecycle effects even if a proposal would otherwise pass approval.

## 3. Projection and rollback

Rebuild mechanic instances by replaying only valid events in ascending `commit_sequence`. A create event establishes the immutable template pin and initial disabled state. Enable/disable events update the projected status and last lifecycle event pointer.

Rollback must account for mechanic references in effect-reference extraction. Lifecycle events must form a causal chain per instance so rollback of creation invalidates its dependent transitions, and rollback of a transition invalidates later transitions that depend on it. Rebuild then derives status from the surviving valid history. Do not delete template records or rewrite event history.

A mechanic event is not allowed to mutate arbitrary instance state in this slice. Parameters and state are validated JSON objects fixed at creation. State evolution, processes, conflict resolution, and executable rule evaluation remain out of scope until their own event contracts exist.

## 4. Storage invariants

- Projection rows are keyed by `(world_id, instance_id)`.
- Template foreign keys pin `(template_id, template_version)`.
- The creation event must belong to the same world as the projection row.
- The projection is deleted/rebuilt atomically from valid events; it is not independently editable.
- A duplicate instance ID within a world is rejected while a valid creation exists. If that creation is rolled back, its projection row disappears and the ID may be reused by a new valid create event; the old invalid event remains in immutable history.
- `needs_review` is not enableable in this slice. It requires a separate adjudication contract; only `disabled -> enabled` and `enabled -> disabled` are supported.

## 5. Validation and transaction boundary

Validation extends the existing effect validator and rollback reference extraction together; adding event type strings alone is insufficient. Exact template existence, duplicate instance identity, valid status transition, expected revision, and lifecycle predecessor must be checked within the write transaction to avoid time-of-check/time-of-use races.

The write transaction includes event insertion, world revision update, all rebuildable projections, audit, and idempotency replay storage. A failure at any point must roll back all of them.

## 6. Required acceptance tests

- exact template version required; unknown version causes no writes;
- instance identity is isolated by world and cannot be cross-world referenced;
- create starts disabled and pins immutable template identity;
- enable/disable valid transitions succeed; invalid/repeated transitions fail without partial writes;
- stale revision and mismatched idempotency payload fail;
- same idempotency request replays without another event or revision increment;
- rollback of create removes its instance from the current projection and invalidates dependent lifecycle events;
- rollback of enable restores disabled state; independent instances and unrelated world effects survive;
- rebuilding from valid history yields the same projection as incremental commits;
- lifecycle operations require admin credential; ordinary API and adapter credentials cannot mutate instance state;
- ordinary proposals cannot smuggle lifecycle effects through the approval path;
- failed audit/projection writes leave event history, projection, revision, and idempotency store unchanged.

## 7. Deliberately deferred

This slice does not implement mechanic execution, module invocation, active process policy, manual conflict adjudication, state deltas, NPC behavior, World Packs, or adapter-specific workflows. Those require separate contracts and must not be inferred from a lifecycle registry.
