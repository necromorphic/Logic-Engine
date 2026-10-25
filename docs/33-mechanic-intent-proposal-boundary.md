# Mechanic intent integration boundary — proposal API

Status as of 2026-10-25: **implemented bounded integration in `main` via PR #280**. The document records the current proposal boundary and its remaining non-goals; it does not authorize a general mechanic-evaluation pipeline.

This document records the integration boundary for the bounded translator in `docs/32-mechanic-effect-translator-contract.md` and `src/core/mechanic-effect-translator.js`. It does not authorize new commit/storage paths.

## 1. Existing canonical lifecycle

The current runtime already has a proposal boundary:

1. `ProposalService.create` validates the proposal envelope and performs a rollback-only canonical event preview.
2. The proposal is stored as `pending` with its base world revision and commit sequence.
3. Approval checks that the captured revision and sequence are still current.
4. Commit rechecks those values and calls `LogicEngine.commitEvent`, which validates and commits through the existing canonical event path.
5. Proposal status, canonical event commit, and proposal audit are covered by the existing SQLite transaction.

Mechanic-intent translation is performed before the rollback-only preview and does not create another persistence or commit route.

## 2. Implemented request boundary

The existing proposal request's `event` object accepts either:

- `effects`: existing canonical effects, unchanged; or
- `effect_intents`: a non-empty array of 1–128 untrusted mechanic intents translated by `translateMechanicEffectIntents`.

The request must reject a payload containing both fields. It must not silently prefer one, merge both arrays, or treat unsupported intents as no-ops. An explicitly supplied empty `effect_intents` array is invalid; when neither field is supplied, preserve the current empty-effects behavior. Validate required event envelope fields (`turn_id` and `event_type`) before translating intents so missing-field errors take precedence.

For an `effect_intents` request, the service must create a new normalized event payload with `effects` set to the complete translator output and remove `effect_intents` before calling the canonical event validator. The translator itself remains pure and does not access the store.

The public event/commit schema must continue to contain canonical effects only. Raw intent objects must never reach `validateEffects`, `commitEvent`, or the SQLite event log.

## 3. Provenance and audit requirements

- Any non-empty intent `source_refs` or `caused_by` must fail with `TRANSLATION_REQUIRES_PROVENANCE_MAPPING` until an explicit event-level mapping is approved.
- Event-level `caused_by`, `depends_on`, `read_set`, and `causal_links` remain event-level fields and must not be synthesized from intent data.
- `effect_id` is batch-local identity for duplicate detection; it is not a canonical effect field. Do not silently claim that it becomes an event ID.
- If the proposal layer needs durable per-intent traceability, define its exact representation in the proposal/audit contract before adding fields or migrations. Do not store invented mappings in canonical effect payloads.
- Proposal idempotency must continue to hash the original request so that changing an intent while reusing an idempotency key fails with the existing conflict behavior.

## 4. Required integration tests

The merged implementation's acceptance tests must prove the following at the API/integration boundary:

1. A valid intent batch is translated before canonical validation and the stored proposal contains canonical `effects`, never raw `effect_intents`.
2. Both `effects` and `effect_intents` in one event are rejected.
3. Every unsupported intent kind and every malformed batch fails closed, including duplicate `effect_id` values and an empty `effect_intents` array.
4. Missing `turn_id` or `event_type` takes precedence over errors inside the intent batch.
5. Non-empty provenance fails with the provenance-specific error.
6. A valid first intent followed by an invalid second intent creates no proposal.
7. For all translator failures, world revision, commit sequence, canonical events, entities, facts, proposal rows, and audit rows are unchanged.
8. Successful translations still require normal approval and commit; translation never approves or commits.
9. Proposal idempotency and stale-revision/sequence checks remain unchanged.
10. The committed event, rollback behavior, and audit history are identical in shape to events submitted with equivalent canonical effects.
11. Persisted `event_payload_json` contains canonical `effects` and no raw `effect_intents`.
12. Unsafe object keys (`__proto__`, `constructor`, `prototype`) are rejected recursively inside translated JSON payloads.

Capture before/after snapshots from the public API where possible and query proposal/audit tables only in focused service-level tests. Do not weaken existing tests to make integration pass.

## 5. Implementation boundary confirmed by the merged slice

- The bounded translator and proposal integration are in `main` through PR #280; this is no longer a pending implementation task.
- No new SQLite schema migration, HTTP endpoint, alternate event store, direct-commit path, or automatic approval behavior was added for this boundary.
- The implementation does not add mechanic evaluation, policy attestation, actor authorization, or a production executor.
- No changes to NPC/card modules, World Pack behavior, SillyTavern integration, or vectorization are implied.

## 6. Explicitly unresolved

The merged slice does not decide any additional canonical identity/replacement semantics beyond the existing Core guards, and it does not authorize non-empty intent provenance mapping. It also does not specify mechanic evaluation, actor authorization, semantic matching against source text, or automatic ID allocation. Those remain separate decisions.