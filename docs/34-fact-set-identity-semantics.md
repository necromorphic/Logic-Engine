# Decision proposal: canonical fact identity and `fact.set` semantics

Status: **proposed decision; review required. Not an implementation authorization.**

This document resolves the open design question referenced by `docs/32-mechanic-effect-translator-contract.md`. It describes the behavior the canonical commit boundary should guarantee before mechanic execution is enabled. It does not change runtime code, SQLite schema, API behavior, effect vocabulary, or the translator contract by itself.

## 1. Existing behavior observed in the runtime

The current SQLite projection treats `fact.set` as an append-only claim:
- A committed effect contributes a claim associated with `fact_id` and its source event.
- Claims with the same `fact_id` and deeply equal values project as one active value, while source event IDs remain recorded.
- Different values under the same `fact_id` project as a conflicted fact; the runtime does not silently choose the latest value.
- Rollback rebuilds fact projections from the remaining valid events.

There are two gaps in the current implementation that should not be mistaken for approved semantics:
- The projection takes `subject_ref` and `predicate` from the last claim for a `fact_id`, without checking that all claims share the same fact identity.
- The `fact_claims` table is keyed by `(world_id, fact_id, event_id)`. Two `fact.set` effects for the same `fact_id` in a single event cannot both be stored under that key; the current path can therefore fail with a storage constraint error instead of a stable domain error.
- `validateEffects` currently accepts an empty-string `subject_ref`, but persistence uses `effect.subject_ref || null`, so an empty string is silently collapsed to SQL `NULL`. That is inconsistent with a rule where only an absent or explicit `null` subject means “no subject”. The canonical validation contract should reject empty or whitespace-only `subject_ref` values rather than silently normalizing them.

## 2. Proposed semantic decision

### 2.1 Stable identity

Treat `fact_id` as the stable identity of one proposition slot within a world. Its identity consists of:
- `fact_id`;
- `predicate`;
- `subject_ref`, where an absent field and explicit `null` both normalize to `null`, and a non-empty string is preserved exactly.

An empty or whitespace-only `subject_ref` is invalid and must be rejected during canonical effect validation; it must not be silently converted to `null`. This makes identity normalization explicit and avoids treating malformed identifiers as an absent subject.

For any existing `fact_id`, subsequent claims must use the same `predicate` and normalized `subject_ref`. A mismatch is not a competing value for the same proposition; it is an identity collision and must be rejected at the canonical commit boundary with a stable 409 error such as `FACT_IDENTITY_MISMATCH`. Do not overwrite the existing identity or reinterpret the previous claims.

### 2.2 Claim accumulation, not replacement

Keep the existing append-only model:
- If `fact_id` does not exist, the first valid claim establishes its identity and value.
- A later claim with the same identity and an equal value is retained in provenance/history; the projected fact remains active with one distinct value.
- A later claim with the same identity but a different value adds a competing claim. The projection becomes `conflicted` and exposes the distinct candidate values; it must not silently select the newest claim.
- `fact.set` does not mean upsert, overwrite, retract, or delete. Retraction remains a separate future design decision.
- Rollback continues to rebuild the projection from valid events, removing claims contributed only by invalidated events.

This proposal deliberately preserves the current conflict-aware behavior instead of introducing last-write-wins semantics.

### 2.3 Duplicate effects within one event

Until the storage model explicitly supports multiple independent claims for one `fact_id` from the same event, an event must contain at most one `fact.set` effect per `fact_id`. Reject duplicates before durable writes with a stable 400 error such as `DUPLICATE_FACT_EFFECT`; do not leak a SQLite constraint error or turn the batch into a partial commit.

Different events may still make competing claims for the same fact identity; that is how the conflict projection is formed.

## 3. Canonical commit-boundary requirements

The canonical commit boundary, not the mechanic translator, must enforce these rules for every caller of canonical effects:
1. Validate identity consistency against existing valid claims for the world and against other `fact.set` effects in the pending event.
2. Reject identity mismatch and duplicate same-event fact IDs before inserting the event or rebuilding projections.
3. Keep all checks and the commit inside the existing transaction, with no event, revision, projection, idempotency, or audit residue after rejection.
4. Preserve the existing proposal → approval → commit lifecycle. Translation is not a substitute for canonical validation.
5. Keep rollback behavior deterministic and based on event history rather than mutating/deleting prior claims in place.

No new schema or new commit path is proposed. If later requirements need multiple claims with the same `fact_id` inside one event, revisit the storage key and event claim identity explicitly instead of relying on accidental SQLite behavior.

## 4. Translator boundary

The translator may validate local structure and reject malformed intent batches, but it must not query storage or decide whether a fact already exists. Existing facts and cross-event identity consistency are checked only at canonical commit time.

Until an explicit provenance mapping is approved, non-empty intent `source_refs` and `caused_by` must continue to fail closed. This decision does not authorize dropping or guessing intent provenance.

## 5. Required conformance tests before implementation

1. First claim for a new `fact_id` creates an active fact.
2. Same `fact_id`, same identity and same value across separate events remains active with one distinct candidate and preserves all valid source event IDs.
3. Same `fact_id`, same identity but a different value across separate events produces a conflicted fact, not last-write-wins.
4. Same `fact_id` with a different predicate is rejected with `FACT_IDENTITY_MISMATCH`.
5. Same `fact_id` with a different normalized `subject_ref` is rejected with `FACT_IDENTITY_MISMATCH`; absent and explicit `null` are equivalent, but a non-empty string differs from `null`.
6. Empty and whitespace-only `subject_ref` values are rejected as `INVALID_EFFECT` before writes; they are not normalized to `null`.
7. Two `fact.set` effects for the same `fact_id` in one event are rejected with `DUPLICATE_FACT_EFFECT`, before durable writes.
8. Rejected identity/duplicate cases leave event history, world revision, fact projections, audit entries, and idempotency state unchanged.
9. Rollback of one competing claim rebuilds the expected active/conflicted projection from remaining valid claims.
10. Existing canonical effects and mechanic-intent-translated effects follow the same commit rules.
11. No test relies on storage constraint exceptions as domain behavior.

## 6. Non-goals and questions still open

This proposal does not define:
- a provenance mapping from intent `source_refs`/`caused_by` to event-level causal/context metadata;
- fact retraction/deletion semantics;
- automatic fact ID allocation;
- a semantic matching algorithm for deciding whether two different IDs describe the same real-world proposition;
- NPC beliefs, knowledge access, character cards, or SillyTavern behavior.

Review this decision before implementing the commit-boundary checks.