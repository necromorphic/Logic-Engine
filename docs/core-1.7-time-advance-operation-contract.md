# Core 1.7 — Time advance operation contract (T2 design gate)

**Status:** contract proposal only. This document adds no runtime behavior, tables, or API endpoints.  
**Depends on:** the pure T1 coordinate/calendar/duration primitives and the Core transaction audit.

## Purpose and boundaries

A time advance is an explicit Core operation, not a side effect owned by a scheduler or adapter. It coordinates time movement and authorized canonical effects. The Time Domain calculates intervals and projects calendars; it cannot write canonical state. A future scheduler discovers and orders due work, but every due item still requires validation and canonical Core commit.

This contract intentionally does not decide database table shape. Storage should be designed only after the operation lifecycle and minimum durable recovery facts are agreed.

## Logical request contract

An advance request should contain:

- `operation_id`: stable caller-generated idempotency identity for the whole advance;
- `world_id` and immutable `world_pack_ref` used for policy/calendar interpretation;
- `kind`: `action`, `explicit_skip`, or `author_correction`;
- exactly one of requested duration or requested target coordinate, where policy permits;
- `expected_revision` and, where required, `expected_commit_sequence`;
- bounded duration decision or deterministic inputs for Core to resolve it;
- request origin/actor and canonical request hash.

The model must not supply an arbitrary coordinate or raw duration that bypasses World Pack policy. A model proposal may select only a declared category/parameter within validated policy; Core calculates final duration. Author correction is separately authorized and must not masquerade as an ordinary action.

## Idempotency and replay

1. Operation identity is scoped to the world and bound to a canonical request hash.
2. Repeating the same identity and hash returns the stored result without rerunning event generation, effects, or resource deductions.
3. Reusing the identity with a different hash is an idempotency conflict.
4. Replay lookup precedes every non-idempotent effect or model-generated follow-up.
5. If commit success is uncertain, query/retry with the same operation identity; do not invent a new identity to force progress.
6. Event-level idempotency protects individual canonical commits; operation-level idempotency protects the requested advance across retries and segments.

## Revision and stale-plan handling

The request and each segment plan use a known canonical revision (and commit sequence where applicable). Immediately before commit, Core validates that the expected revision still matches. On mismatch, Core rejects with a stale-plan result or rebuilds the plan against current state. It never commits effects calculated against obsolete state.

Deterministic ordering does not replace causal dependency checks. A stable sort key breaks ties only after dependencies and conflict policy have been checked.

## Operation lifecycle

Conceptual states:

- `accepted`: request validated and operation identity reserved;
- `planning`: next segment calculated without canonical mutation;
- `committing`: segment committed through Core;
- `paused`: declared interruption boundary or unresolved author decision stopped progress;
- `completed`: target reached and final result durably stored;
- `failed`: terminal failure with reason and last confirmed boundary;
- `needs_review`: conflict/ambiguity cannot be resolved under world policy.

These are conceptual states. Do not create a status table or enum until persistence design confirms what is required for correct recovery.

## Segment semantics

- A short advance may be one segment; a long advance may use multiple segments with durable boundaries.
- A segment is all-or-nothing: canonical events/effects, resulting time, revisions, audit, event-idempotency results, and operation progress become visible together or not at all.
- An interrupting item is a segment boundary, never an instruction to stop inside an atomic segment. The operation may pause after the segment commits and before the next begins.
- A paused/failed result reports the last confirmed coordinate, not the requested target.
- Time may advance through an interval with no due events. The advance remains auditable; do not create fake events to represent empty time.
- A due trigger is not proof its effects were applied. Effects, NPC knowledge, and player delivery remain separate transitions.

## Calendar and policy pinning

Record the immutable calendar/policy version used to interpret the operation. Later calendar edits must not silently reinterpret historical coordinates or accepted work. For future scheduled work, a version change needs an explicit policy: retain the original version, safely re-evaluate under the new version, or require author review. Record the selected policy rather than inferring it.

## Recovery matrix

| Situation | Required behavior |
|---|---|
| Completed operation retried | Return stored result; do not replay effects. |
| Segment committed, next segment not started | Resume after the last durable boundary. |
| Commit outcome unknown | Resolve operation/segment state using the same identity before retrying. |
| Revision changed during planning | Reject or replan; never commit stale plan. |
| Interruption boundary reached | Commit current segment, then pause/continue under explicit policy. |
| Rollback requested | Perform a separate causal rollback operation; do not rewind time or delete history. |

## NPC knowledge and delivery boundary

A temporal trigger may create a due-work/system record. It must not automatically grant an NPC knowledge of the underlying event. Knowledge acquisition requires a separately authorized epistemic transition through the relevant agent/Memory integration. Player-facing narration/delivery is also separate and may be delayed, suppressed, or retried without recommitting world effects.

## Core transaction prerequisites

Before implementing T2/T3, demonstrate:

1. multi-event segment commit publishes all records together;
2. failure during a segment rolls back event/world-time/revision/audit/idempotency changes;
3. event-level idempotency replay does not duplicate events;
4. operation-level idempotency replay does not regenerate effects;
5. stale revision rejects or triggers deterministic replanning;
6. failed/unknown requests resolve through their stable operation identity;
7. cross-world operation/event identifiers cannot affect another world's canonical state.

An outer SQLite transaction with nested savepoints may be an implementation technique, but it is not the contract. It must be tested against actual projection, audit, idempotency, and failure paths, including projection-rebuild cost.

## Non-goals

- No schema or migration.
- No API endpoint.
- No scheduler or trigger execution.
- No changes to SillyTavern storage, vectorization, or insertion.
- No NPC knowledge/delivery implementation.
- No assumption that current 12-hour/7-day runtime limits are architecture requirements; world policy chooses operational limits within Core safety bounds.

**Provenance:** selectively preserved from closed PR #223 (`cfe8a5cca07da736da7b694a88eda3f51e746d80`). The working T1 primitives were separately ported to `integration/host-core-v1`; this document is a future T2 design gate only.