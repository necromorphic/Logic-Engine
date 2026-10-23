# Stage 1 causality test matrix — proposal

Status: **mixed executable coverage and test specification**. The current runtime supports a limited `causal_links[]` subset (`READS_SOURCE`, `READS_ENTITY`, `READS_CLAIM`, and `REQUIRES` for entity existence/attributes and fact values) with declared-edge rollback. Direct event causation remains in `caused_by[]`. The per-world `commit_sequence` cursor and tri-state fact-value precondition handling are implemented; context manifests, general predicate composition, and proof of causal completeness remain proposals. Scenarios below must not be read as claims that those deferred capabilities are implemented.

Related: [Stage 1 causality contract](21-stage1-causality-contract.md), [Causality semantics proposal](22-causality-semantics.md).

## Test conventions

- Each event is shown in commit order: `A@1` means A commits at history cursor 1.
- `game_time` may be equal across multiple commits and is not a unique history cursor.
- A rollback creates a new world revision; it does not decrement `game_time` or reuse an old revision number.
- “Canonical history at cursor k” means the valid events up to that cursor after applying the rollback correction. Generation manifests remain immutable evidence of what was presented to the model.
- A projection/claim must be recomputed from remaining valid sources; it must not be deleted merely because one of several sources was invalidated.
- Unless stated otherwise, the operation can resolve a declared graph case even though global `causal_completeness` remains `unknown`.

## T-03R — negative observation over reconstructed history

**Purpose:** define how rollback affects an observation that a predicate was false at an earlier point. The observation must be consistent when committed; rollback can later make it inconsistent by removing the only support for the predicate's negation.

### T-03R-A — rollback removes the only support for the negative observation

Setup:
1. At cursor 1, event S establishes `character:X.status = "alive"`.
2. At cursor 2, event A changes X to `status = "destroyed"`.
3. At cursor 3, event B records that predicate `character:X.status = "alive"` was false at cursor 3. Its generation manifest is immutable.
4. Roll back A at a later world revision.

Expected under the recommended reconstructed-history policy:
- At B's commit point, the predicate was false because A's destroyed status superseded the prior alive status.
- After reconstructing canonical history without A, X is alive at cursor 3.
- B's assertion that the alive predicate was false is inconsistent with the reconstructed canonical history; B becomes an invalidation candidate.
- The original manifest is not rewritten.
- If predicate evaluation is `unknown`, do not coerce it to false; classification needs review or partial resolution.

### T-03R-B — independent support preserves the negative observation

Setup:
1. At cursor 1, event S establishes `character:X.status = "alive"`.
2. At cursor 2, event A changes X to `status = "destroyed"`.
3. At cursor 3, event D also establishes `character:X.status = "destroyed"`. D requires only `entity_exists(X)` established by S; it has no `READS_SOURCE(A)` edge and does not read a state/claim produced by A. Thus D has no direct or transitive dependency on A and remains valid when A is rolled back.
4. At cursor 4, event B records that `character:X.status = "alive"` was false.
5. Roll back A.

Expected:
- D still supports destroyed status at B's observation point.
- The alive predicate remains false at cursor 4 in reconstructed canonical history.
- B's negative observation remains consistent and B is not invalidated by this observation alone.
- The result depends on D being genuinely independent and valid at B's cursor; merely existing later is insufficient.

### T-03R-B2 — apparent independent support is itself dependent on A

Setup:
1. Use the same S, A, and B setup as T-03R-B.
2. D establishes `character:X.status = "destroyed"`, but declares a causal dependency on A (directly or through a declared dependency chain).
3. Roll back A.

Expected:
- D is invalidated by the declared dependency.
- With both A and D removed from reconstructed canonical history, X is alive at B's observation point.
- B's negative observation is inconsistent and becomes an invalidation candidate.

These scenarios test canonical-history reconstruction, not whether the model's reported basis is complete. The manifest proves availability, not causal use.

## T-04R-1 — required precondition loses its only support

Setup:
1. A creates entity X before cursor 1.
2. C commits before cursor 2 with `REQUIRES(entity_exists(X))` at C's commit point.
3. B commits before cursor 3 with `REQUIRES(entity_attribute(X, status, "destroyed"))`.
4. C changes X's status to destroyed as part of its event.
5. Roll back A.

Expected:
- C is invalidated because X did not exist at C's commit point after reconstruction.
- C's produced change is removed from the canonical projection.
- B is invalidated if no other valid source establishes the destroyed predicate at B's commit point.
- The rollback outcome can be `resolved` for this fully declared case; global causal completeness remains `unknown`.

Note: C's own entity reference must satisfy the commit-time precondition rule. A mutation against a nonexistent entity must not be silently accepted as a valid state transition.

### T-04R-1b — independent source survives invalidation of C

Setup:
1. S creates entity X.
2. A establishes `X.status = "active"`.
3. C commits with `REQUIRES(X.status = "active")` and changes the status to `destroyed`.
4. D independently establishes `X.status = "destroyed"`; D requires only `entity_exists(X)` from S and declares no dependency on A or C.
5. B requires `X.status = "destroyed"` at B's commit point.
6. Roll back A.

Expected:
- C is invalidated because its required `active` predicate loses its only support; its produced claim is removed.
- D remains valid because X's existence is independently supported by S and D does not depend on A or C.
- B remains valid if D still supports the exact required predicate at B's commit point.
- The projection retains D as a source; it is not deleted merely because C was invalidated.

## T-04R-3 — independent source preserves a required predicate

Setup:
1. A establishes `X.status = "active"`.
2. D independently establishes `X.status = "destroyed"` with a valid causal basis that does not depend on A.
3. B commits with `REQUIRES(X.status = "destroyed")` at B's commit point.
4. Roll back A.

Expected:
- If D remains valid and still supports the predicate at B's commit point, B remains valid.
- The destroyed claim/projection remains supported by D.
- If D is also invalidated by a separately declared dependency, the expected result must be recalculated; do not hardcode survival merely because D once existed.

### T-04R-3b — the apparent independent source depends on A

Setup:
1. A establishes `X.status = "active"`.
2. D establishes `X.status = "destroyed"` but declares `READS_SOURCE(A)` or a `REQUIRES` predicate whose only support is A.
3. B commits with `REQUIRES(X.status = "destroyed")` at B's commit point.
4. Roll back A.

Expected:
- D is invalidated because its declared dependency on A no longer holds.
- If no other valid source supports `X.status = "destroyed"` at B's commit point, B is invalidated.
- This differs from T-04R-3: apparent multiplicity of claims is not independence if the source's own causal basis is invalidated.

## T-05R — manifest contains every declared read

Setup:
- Trusted generation-bound manifest contains `F1, F2, F3, F4`.
- Event declares `read_set = [F1, F3]`.

Expected: basis status is `all_verified`. F2 and F4 being unused or undeclared in the read set does not imply incompleteness.

## T-05S — a declared read is absent from the manifest

Setup:
- Trusted manifest contains `F1, F2`.
- Event declares `read_set = [F1, F6]`.

Expected: basis status is `invalid_declared`; the proposed API policy rejects the event commit with HTTP `400` before a committed event, successful idempotency result, or state-changing world-audit row is created. A corrected retry may reuse the key, subject to the final request-hash/idempotency contract. Operational rejection logging is separate.

## T-06R — empty read set with a bound manifest

Setup: trusted generation-bound manifest exists; event declares an empty read set.

Expected: basis status is `undeclared`. This says no reads were declared, not that the model read nothing.

## T-06S — unbound or unavailable manifest

Setup: manifest is missing or cannot be bound to the generation that produced the event.

Expected: basis status is `unbound`, including when the read set is empty. No read can be verified against an untrusted or unbound manifest.

## T-07R — source-specific read versus claim-level read

Setup:
1. A and D independently support the same claim F.
2. B1 declares `READS_SOURCE(A)`.
3. B2 declares `READS_CLAIM(F)`.
4. Roll back A while D remains valid.

Expected:
- B1 is an invalidation candidate because its declared source was removed.
- B2 remains valid if F still satisfies its declared predicate through D.
- The system must not collapse `READS_SOURCE` and `READS_CLAIM` into one relationship.

If B1 also has an independent valid basis sufficient for its outcome, that must be represented explicitly; the engine must not infer it from D's support for F.

### T-07R-b — claim loses its remaining support through a separate rollback

Setup:
1. D is the only valid source for claim F.
2. B2 commits with `READS_CLAIM(F)` and the claim is supported at B2's commit point.
3. In a later, separate rollback operation, D is invalidated for a reason independent of B2.

Expected:
- Recompute F's support after rolling back D.
- If F has no remaining valid source and no independent support satisfying the declared dependency, B2 becomes an invalidation candidate even though D was not the root of an earlier unrelated rollback.
- Claim identity remains `F`; its support status changes. Do not confuse stable `claim_id` with current historical support.

## T-08 — operation outcome is distinct from event status

Setup:
- Rollback invalidates B through a fully declared `REQUIRES` dependency.
- Event C is known to be unaffected.
- Event D has a typed predicate that the runtime cannot evaluate, or an unbound manifest that blocks classification.

Expected:
- B's event status may be `invalidated`.
- C's event status may remain `valid`.
- The rollback operation is `partially_resolved` or `requires_review` because D remains unresolved.
- The per-event reason for D is distinct from the operation-level outcome.
- `causal_completeness = unknown` alone does not force review for B or C.

## T-15 — historical `REQUIRES` fact-value predicates (implemented subset)

Executable coverage verifies:
- a fact-value precondition accepts a single active matching value;
- a conflicted fact evaluates to `unknown` and rejects a new event with `REQUIRED_PREDICATE_UNKNOWN` before consuming the idempotency key;
- rollback reconstructs the fact projection before the requiring event's `commit_sequence`;
- removing one of multiple same-value sources preserves the requiring event, while removing its only historical support invalidates it.

If rollback recomputation remains unknown for an otherwise still-valid requiring event, the event is preserved and returned in `requires_review_event_ids`. This is a review disposition, not a new event-validity status. General predicate composition and negative reads remain deferred.

## T-14 — historical `REQUIRES` entity predicates (implemented subset)

Executable coverage verifies:
- a `REQUIRES` predicate must be true against the current canonical entity projection before an event commits;
- if rollback removes the only support for an entity predicate at the requiring event's historical commit point, the requiring event is invalidated and its effects are removed;
- if an independent surviving event still makes the predicate true at that historical point, the requiring event remains valid.

Supported predicates are `entity_exists(entity_id)` and `entity_attribute(entity_id, attribute, value)`; `attribute: "status"` reads the entity's status field. Missing entities/attributes or mismatched values evaluate false. Fact predicates, negative reads, and tri-state unknown handling remain deferred.

## T-13 — stable per-world event-history cursor (implemented)

Executable coverage verifies that:
- committed events receive per-world `commit_sequence` values starting at 1 and increasing in commit order;
- rollback advances `world_revision` but does not consume or rewind `commit_sequence`;
- each world has an independent sequence;
- legacy event rows are backfilled deterministically and new events continue from the next value.

`commit_sequence` is a history cursor, not a predicate evaluator. It does not by itself implement historical `REQUIRES` or negative-read reconstruction.

## T-12 — typed source and claim links (implemented subset)

Executable coverage in `tests/causality-contract.test.js` verifies:
- `READS_SOURCE` points to a prior valid event and makes the reader a rollback candidate when that source is retracted.
- `READS_CLAIM` preserves the reader when another valid source still supports the same fact/claim projection.
- `READS_CLAIM` points to a fact/claim identity with current valid support and makes the reader a rollback candidate when that claim loses its only source.
- unsupported typed relationships (including deferred `MAINTAINS`) are rejected before an idempotency key is consumed; corrected input can retry the same key.

Limit: these links currently refer to event or projection identities, not historical versions. They do not establish historical predicate evaluation, manifest verification, causal completeness, or tri-state predicate evaluation. The separate `commit_sequence` cursor is tested for monotonic committed history and legacy migration.

## T-09 — causal diamond and independent branch (existing regression)

Retain the existing regression in `tests/causality-contract.test.js`:
- root event supports two branches;
- one branch declares a read of the root-produced witness;
- the other branch depends on the witness entity;
- a join event depends on both branches;
- an unrelated branch is independent.

Rollback of the root must invalidate the declared dependent diamond and preserve the independent branch. The test is evidence for the currently implemented declared-edge behavior only; it does not prove graph completeness.

## T-10 — unsupported `MAINTAINS` is not silently enforced

Setup: submit a causal relationship with type `MAINTAINS` to a Stage 1 endpoint that does not support it.

Expected: the executable causal contract rejects the unsupported relationship (or rejects the entire event transaction); it must not commit it as an enforced invariant. If an authoring tool preserves the proposal for review, that record must be explicitly non-executable and outside the committed causal graph.

## T-11 — unresolved dependency blocks a derived partial update

**Purpose:** ensure a rollback does not commit a derived event/projection update when an unresolved event can still change the dependency evaluation, even if another branch has already been classified.

Setup:
1. A creates entity X at cursor 1.
2. B at cursor 2 produces claim F from X and is invalidated when A is rolled back.
3. D at cursor 3 is an unresolved source for the same claim F (for example, its source/manifest binding cannot be evaluated). D's status cannot yet be classified.
4. C at cursor 4 declares `READS_CLAIM(F)` and its result depends on the recomputed support for F, not on a direct `READS_SOURCE(B)` edge alone.
5. Roll back A.

Expected:
- B is classified `invalidated`.
- D retains its prior status because its classification is unresolved.
- F's support projection remains unresolved because D may or may not be a valid source after reconstruction.
- C retains its prior status and no derived projection change for C is committed while F's support cannot be resolved.
- The operation may return `partially_resolved` only if the B classification can be committed without exposing an inconsistent F/C projection; otherwise it returns `requires_review` with no semantic state changes.
- Audit/revision behavior follows the atomicity rule in `docs/22-causality-semantics.md` §5.

This case is intentionally conservative: a direct dependency that independently and conclusively invalidates C may be classified without waiting for D, but a derived claim read whose validity depends on unresolved support must not be guessed.

## Promotion checklist

Before turning a scenario into a normative executable test:
- [x] Define the committed-event `commit_sequence` cursor; [ ] define context-manifest/generation binding fields in the API.
- [ ] Confirm the proposed invalid manifest/read policy and define rejected-request audit/idempotency behavior, including corrected retries with the same key.
- [x] Define and test the initial boolean entity-predicate evaluator; [ ] define the full predicate vocabulary and three-valued unknown handling.
- [ ] Define projection recomputation and how multiple independent sources are represented.
- [ ] Define whether rollback can leave an operation partially resolved without partially committing its state changes; include T-11's transitive unresolved-dependency case.
- [ ] Define transactional atomicity for event status, projections, audit rows, and world revision, including transitive unresolved dependencies and no-op `requires_review` outcomes.
- [ ] Formalize character-card/management invariants before implementation: cards cannot become a duplicate writable source of canonical truth; management exposes validated engine operations rather than direct storage updates.
- [ ] Verify compatibility/migration for existing string-based metadata.
