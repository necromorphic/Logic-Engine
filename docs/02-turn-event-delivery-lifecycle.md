# 02. Turn, event and delivery lifecycle

Status: target lifecycle contract. The core proposal-to-commit API is partially implemented; see `docs/28-proposal-api-stage1.md` for implemented routes, approval gating, rollback-only deterministic validation, and explicit limits. This document still specifies broader adapter, World Pack, authorization, and delivery behavior that is not yet implemented.

## 1. Three independent lifecycles

A Turn is an input/generation attempt. A WorldEvent is an accepted world occurrence. A Delivery is an attempt to show narrative or event information to the player. Their statuses must not be conflated.

### Turn
Suggested states:
- `received`
- `interpreting`
- `validated`
- `committing`
- `state_committed`
- `narration_pending`
- `completed`
- terminal non-success states: `rejected`, `cancelled_precommit`, `failed_precommit`, `needs_review`

A failure after state commit must not be treated as if no world effects occurred. It should resume delivery or run an explicit rollback operation.

### WorldEvent
Suggested current validity:
- `valid`
- `retracted`
- `invalidated`
- `superseded`
- `conflicted`

These are semantic validity states, not delivery states. Audit records are append-only; the current projection reflects validity.

### Delivery
Suggested states:
- `pending`
- `selected`
- `injected_unconfirmed`
- `shown`
- `failed`
- `superseded`
- `rolled_back`
- `orphaned`
- `rejected_by_author`

`injected_unconfirmed` is not equivalent to `shown`. A delivery retry must reuse the original world event and idempotency identity, not recommit its effects.

## 2. Idempotency and identifiers

- Adapter assigns a stable `turn_id` at first acceptance.
- A retry of the same accepted attempt reuses `turn_id`.
- A genuinely new generation, including a swipe/regeneration branch, receives a new `generation_id` and new turn identity when it can cause a distinct outcome.
- Identical message text is not a reliable identity key.
- A commit request has an idempotency key unique within its world/session scope.
- A rollback has a stable `rollback_id`; repeated delivery of the same host deletion signal must not apply the rollback twice.
- IDs exposed by the host must be stored alongside our own stable IDs. If host IDs are unavailable, do not guess silently.

## 3. Commit boundary

The only path to canonical mutation is:

1. Receive user action / time-advance request / scheduled-process trigger.
2. Read a revision-consistent context and permitted knowledge.
3. Produce structured proposal(s).
4. Validate schema, permissions, preconditions, causal references and world-pack rules.
5. Resolve deterministic effects directly; use model adjudication only for explicitly ambiguous outcomes.
6. Validate proposed ambiguous result and derived effects.
7. Atomically persist accepted effects, audit records, idempotency result and resulting revision.
8. Update/rebuild derived projections.
9. Queue narrative delivery separately.
10. Record delivery outcome without duplicating the world effect.

A model cannot write directly to canonical storage. An adapter cannot bypass validation.

## 4. Concurrency and stale proposals

Stage 1 default: serialize mutations per world. A proposal records the revision and read-set it used. If the world revision or a relevant read-set item changes before commit, revalidate or reject the stale proposal; do not blindly apply it.

Short database transactions should cover the final validation against the latest state and atomic commit. Expensive model calls occur outside the transaction.

## 5. Failure policy

- Before commit: safe retry or cancellation can leave world state unchanged.
- During an atomic commit: transaction either commits all required records or none.
- After commit but before narration: world remains committed; delivery resumes independently.
- During delivery: retry delivery without repeating state mutation.
- During rollback: atomically commit rollback metadata and updated canonical projection; if unresolved conflict exists, persist ConflictRecord and mark affected branch needs_review.
- Repeated requests with same idempotency key return the stored result.

## 6. Open implementation verification

The exact SillyTavern hook names, timing and stable identifiers are not assumed by this contract. Verify against the target host and extension lifecycle before implementing the adapter. The current core API exposes a cancellation endpoint, but it cannot independently verify that a host generation was cancelled or superseded. The contract defines required semantics, not a claim that the host currently exposes every signal.
