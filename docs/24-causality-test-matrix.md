# Stage 1 causality test matrix — proposal

Status: **test specification proposal**. These scenarios do not claim that the current runtime supports typed causal relationships, historical cursors, manifests, or per-event rollback classification. They define expected behavior for implementation planning and should be promoted to executable tests only after the corresponding API/storage contract is approved.

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
3. At cursor 3, independent event D also establishes `character:X.status = "destroyed"` and does not depend on A.
4. At cursor 4, event B records that `character:X.status = "alive"` was false.
5. Roll back A.

Expected:
- D still supports destroyed status at B's observation point.
- The alive predicate remains false at cursor 4 in reconstructed canonical history.
- B's negative observation remains consistent and B is not invalidated by this observation alone.
- The result depends on D being genuinely independent and valid at B's cursor; merely existing later is insufficient.

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

## T-05R — manifest contains every declared read

Setup:
- Trusted generation-bound manifest contains `F1, F2, F3, F4`.
- Event declares `read_set = [F1, F3]`.

Expected: basis status is `all_verified`. F2 and F4 being unused or undeclared in the read set does not imply incompleteness.

## T-05S — a declared read is absent from the manifest

Setup:
- Trusted manifest contains `F1, F2`.
- Event declares `read_set = [F1, F6]`.

Expected: basis status is `invalid_declared`; commit behavior (reject versus preserve as review-only) must be decided by the runtime/API contract before implementation.

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

## Promotion checklist

Before turning a scenario into a normative executable test:
- [ ] Define the event and context-generation cursor fields in the API.
- [ ] Define whether invalid manifest/read declarations reject commit or are stored as review-only metadata.
- [ ] Define predicate evaluation and three-valued unknown handling.
- [ ] Define projection recomputation and how multiple independent sources are represented.
- [ ] Define whether rollback can leave an operation partially resolved without partially committing its state changes.
- [ ] Define transactional atomicity for event status, projections, audit rows, and world revision.
- [ ] Verify compatibility/migration for existing string-based metadata.
