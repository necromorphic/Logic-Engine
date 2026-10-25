# Canonical fact identity and `fact.set` semantics

Status: **implemented and tested on current `main`; this document records the implemented contract. It is not authorization to enable a general mechanic executor or bypass proposal → approval → commit.**

This document records the canonical identity and claim semantics implemented by the current Core commit boundary. The implementation and regression evidence are in `src/core/rules.js`, `src/storage/sqlite-store.js`, `tests/fact-identity.test.js`, and the translated-intent API tests in `tests/api.test.js`. It does not authorize a general mechanic executor or change the proposal → approval → commit boundary.

## 1. Existing behavior observed in the runtime

The current SQLite projection treats `fact.set` as an append-only claim:
- A committed effect contributes a claim associated with `fact_id` and its source event.
- Claims with the same `fact_id` and deeply equal values project as one active value, while source event IDs remain recorded.
- Different values under the same `fact_id` project as a conflicted fact; the runtime does not silently choose the latest value.
- Rollback rebuilds fact projections from the remaining valid events.

The earlier gaps are addressed by current main:
- The commit boundary checks `fact_claims` for all existing claims in the world and rejects a changed predicate or normalized `subject_ref`, including inconsistent historical claims that the current projection may hide.
- Duplicate `fact.set` effects for one `fact_id` in the same event are rejected with `DUPLICATE_FACT_EFFECT` before writes.
- Canonical effect validation rejects empty/whitespace-only identity fields and leading/trailing whitespace rather than silently trimming them or normalizing an empty subject to SQL `NULL`.

These guarantees are covered by `tests/fact-identity.test.js`; they do not prove source authority, NPC belief semantics, or downstream delivery.

## 2. Implemented semantic contract

### 2.1 Stable identity

Treat `fact_id` as the stable identity of one proposition slot within a world. Its identity consists of:
- `fact_id`;
- `predicate`;
- `subject_ref`, where an absent field and explicit `null` both normalize to `null`, and a non-empty string is preserved exactly.

An empty or whitespace-only `subject_ref` is invalid and must be rejected during canonical effect validation; it must not be silently converted to `null`. This makes identity normalization explicit and avoids treating malformed identifiers as an absent subject.

For `fact_id`, `predicate`, and non-null `subject_ref`, leading or trailing whitespace is invalid. Reject it at validation; do not trim or silently rewrite identity strings. Preserve valid, unpadded strings exactly. Missing and explicit-null `subject_ref` remain equivalent. This keeps translator validation and the canonical commit identity check consistent.

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

## 3. Canonical commit-boundary guarantees

The current canonical commit boundary enforces these rules for every caller of canonical effects:
1. Validate identity consistency against all existing valid claims for the same `fact_id` in this world and against other `fact.set` effects in the pending event. Do not use the `facts` projection as the sole source for historical identity because it currently retains only the last claim's `subject_ref` and `predicate`.
2. Reject identity mismatch and duplicate same-event fact IDs before inserting the event or rebuilding projections.
3. Keep all checks and the commit inside the existing transaction, with no event, revision, projection, idempotency, or audit residue after rejection.
4. Preserve the existing proposal → approval → commit lifecycle. Translation is not a substitute for canonical validation.
5. Keep rollback behavior deterministic and based on event history rather than mutating/deleting prior claims in place.

No new schema or new commit path is proposed. If later requirements need multiple claims with the same `fact_id` inside one event, revisit the storage key and event claim identity explicitly instead of relying on accidental SQLite behavior.

## 4. Translator boundary

The translator may validate local structure and reject malformed intent batches, but it must not query storage or decide whether a fact already exists. Existing facts and cross-event identity consistency are checked only at canonical commit time.

Until an explicit provenance mapping is approved, non-empty intent `source_refs` and `caused_by` must continue to fail closed. This decision does not authorize dropping or guessing intent provenance.

## 5. Current-main conformance evidence

1. First claim for a new `fact_id` creates an active fact.
2. Same `fact_id`, same identity and same value across separate events remains active with one distinct candidate and preserves all valid source event IDs.
3. Same `fact_id`, same identity but a different value across separate events produces a conflicted fact, not last-write-wins.
4. Same `fact_id` with a different predicate is rejected with `FACT_IDENTITY_MISMATCH`, including when an earlier inconsistent claim is no longer visible in the current projection.
5. Same `fact_id` with a different normalized `subject_ref` is rejected with `FACT_IDENTITY_MISMATCH`; absent and explicit `null` are equivalent, but a non-empty string differs from `null`.
6. Empty and whitespace-only `subject_ref` values are rejected as `INVALID_EFFECT` before writes; they are not normalized to `null`.
7. Two `fact.set` effects for the same `fact_id` in one event are rejected with `DUPLICATE_FACT_EFFECT`, before durable writes.
8. Rejected identity/duplicate cases leave event history, world revision, fact projections, audit entries, and idempotency state unchanged.
9. Rollback of one competing claim rebuilds the expected active/conflicted projection from remaining valid claims.
10. Existing canonical effects and mechanic-intent-translated effects follow the same commit rules.
11. No test relies on storage constraint exceptions as domain behavior.

The implemented test coverage includes:
- `fact.set accepts repeated same-value claims with stable identity and preserves provenance`;
- `fact.set preserves conflict-aware projection for competing values`;
- `fact.set rejects changed predicate or subject identity before writes` and `fact identity guard checks historical claims hidden by the current projection`;
- `fact.set rejects duplicate fact IDs within one event with a stable domain error` and `fact.set rejects exact duplicate effects in one event`;
- `fact.set rejects empty and whitespace-only subject references`, `fact.set rejects surrounding whitespace in canonical identity fields before writes`, and absent/null subject equivalence;
- rollback projection rebuild, world isolation, idempotency-key non-consumption after rejection, and releasing identity when the last claim is rolled back;
- translated mechanic intents use the same canonical fact-identity guard as direct effects (`tests/api.test.js`).

## 6. Non-goals and questions still open

This proposal does not define:
- a provenance mapping from intent `source_refs`/`caused_by` to event-level causal/context metadata;
- fact retraction/deletion semantics;
- automatic fact ID allocation;
- a semantic matching algorithm for deciding whether two different IDs describe the same real-world proposition;
- NPC beliefs, knowledge access, character cards, or SillyTavern behavior.

The current-main implementation is covered by the tests listed above. Any future change to fact identity, claim accumulation, duplicate handling, or rollback reconstruction should update this contract and the exact regression tests together.