# Core 1.7 — Time advance operation contract (T2 design gate)

**Status:** contract proposal only. This document does not add runtime behavior, tables, or API endpoints.  
**Depends on:** the pure T1 primitives in the Time Domain PR and the Core transaction audit.

## Purpose and boundaries

A time advance is an explicit Core operation, not a side effect owned by a scheduler or adapter. It coordinates time movement and any canonical effects that the operation is authorized to apply. The Time Domain can calculate intervals and project calendars; it cannot write canonical state directly. The scheduler, when introduced, only discovers and orders due work. Each due item still requires validation and canonical Core commit.

This contract intentionally does not decide database table shape. Storage should be designed only after the operation lifecycle and the minimum durable recovery facts are agreed.

## Request shape (logical contract, not a committed schema)

An advance request should contain:

- `operation_id`: stable caller-generated idempotency identity for the whole requested advance;
- `world_id`;
- `world_pack_ref`: immutable World Pack identity/version used for policy and calendar interpretation;
- `kind`: `action`, `explicit_skip`, or `author_correction`;
- exactly one of a requested duration or requested target coordinate, where allowed by policy;
- `expected_revision` and, when needed by the existing Core contract, `expected_commit_sequence`;
- a bounded duration decision (or the inputs needed for Core to resolve it deterministically);
- request origin/actor and a canonical request hash.

The model must not supply an arbitrary coordinate or raw duration that bypasses World Pack policy. A model proposal can select only a declared category/parameter within a validated policy; Core calculates the final duration. Author correction is a separately authorized command and must not masquerade as an ordinary action.

## Idempotency and replay

1. The operation identity is scoped to the world and bound to a canonical request hash.
2. A repeated operation identity with the same hash returns the stored operation result and does not rerun event generation, effects, or resource deductions.
3. Reusing the identity with a different hash is rejected as an idempotency conflict.
4. The replay lookup occurs before any non-idempotent effect or model-generated follow-up.
5. If the client cannot tell whether a commit succeeded, it queries/retries with the same operation identity. It must not invent a new identity to force progress.
6. Event-level idempotency remains distinct from operation-level idempotency. The former protects individual canonical commits; the latter protects the requested advance across retries and segments.

## Revision and stale-plan handling

The request and each segment plan are based on a known canonical revision (and commit sequence where applicable). Immediately before commit, Core validates that the expected revision still matches. On mismatch, Core must either reject with a stale-plan result or rebuild the plan against current state. It must never commit effects calculated against an obsolete state.

Deterministic ordering is not a substitute for causal dependencies. A stable sort key can break ties only after dependencies and conflict policy have been checked.

## Operation lifecycle

Logical states:

- `accepted`: request validated and operation identity reserved;
- `planning`: the next segment is being calculated without canonical mutation;
- `committing`: a segment is being committed through Core;
- `paused`: a declared interruption boundary or unresolved author decision stopped progress;
- `completed`: target reached and final result durably stored;
- `failed`: terminal failure with reason and last confirmed boundary;
- `needs_review`: a conflict/ambiguity cannot be resolved under world policy.

These are conceptual states; do not create a status table or enum until persistence design confirms which are required to recover correctly.

## Segment semantics

- A short advance may consist of one segment.
- A long advance may consist of multiple segments; each segment boundary is durable and reported.
- A segment is all-or-nothing: all canonical events/effects in the segment, resulting time, revisions, audit, event idempotency results, and operation progress become visible together or not at all.
- An interrupting item is a **segment boundary**, never an instruction to stop inside an atomic segment. The operation can pause after the segment commits and before the next begins.
- An operation result reports the last confirmed coordinate, not the requested target, if the operation is paused or fails.
- Time may advance through an interval with no due events. The advance itself is auditable; do not create fake events merely to represent empty time.
- A due trigger is not proof that its effects were applied. Effects, NPC knowledge, and player delivery remain separate transitions.

## Calendar and policy pinning

The operation records the immutable calendar/policy version used to interpret it. A later calendar edit must not silently reinterpret historical coordinates or already accepted work. For future scheduled work, a version change must have an explicit policy: retain the original version, safely re-evaluate under the new version, or require author review. The correct choice may depend on the type of scheduled item and must be recorded rather than inferred.

## Recovery matrix

| Situation | Required behavior |
|---|---|
| Completed operation retried | Return stored final result; do not replay effects |
| Segment commit confirmed, later segment not started | Resume from the next segment after the last durable boundary |
| Commit outcome unknown | Read operation/segment state using the same identity before deciding to retry |
| Revision changed while planning | Reject or replan; never commit stale plan |
| Interruption boundary reached | Commit current segment, then pause or continue according to explicit policy |
| Rollback requested | Perform a separate causal rollback operation; do not rewind game time or delete history |

## NPC knowledge and delivery boundary

A temporal trigger can create a due-work/system record. It must not automatically grant an NPC knowledge of the underlying event. Knowledge acquisition requires a separately authorized epistemic transition through the relevant agent/Memory integration. Player-facing delivery/narration is also separate and may be delayed, suppressed, or retried without recommitting world effects.

## Core transaction prerequisites

Before implementing T2/T3, tests must demonstrate:

1. successful multi-event segment commit publishes all records together;
2. failure during a segment rolls back all event/world-time/revision/audit/idempotency changes;
3. per-event idempotency replay does not duplicate events;
4. operation-level idempotency replay does not regenerate effects;
5. stale revision causes rejection or deterministic replanning;
6. a failed/unknown request can be resolved by querying its stable operation identity;
7. cross-world operation and event identifiers cannot affect another world's canonical state.

An outer SQLite transaction with nested savepoints appears to be a possible implementation technique, but the technique is not the contract. It must be tested against the actual projection, audit, idempotency, and failure paths and checked for unacceptable repeated projection rebuild costs.

## Non-goals for this contract

- No schema or migration.
- No API endpoint.
- No scheduler or trigger execution.
- No changes to SillyTavern storage, vectorization, or insertion.
- No NPC knowledge/delivery implementation.
- No assumption that current 12-hour/7-day runtime limits are architecture requirements; world policy chooses operational limits within Core safety bounds.
