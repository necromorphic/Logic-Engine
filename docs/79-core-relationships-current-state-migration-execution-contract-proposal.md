# Core execution contract proposal — Relationships current-state migration B

**Status:** proposal for review; not an approved runtime contract.  
**Depends on:** Relationships domain policy in Section 14 of `docs/75-relationships-world-pack-version-semantics.md` (currently carried by PR #745).  
**Scope:** Core execution and persistence only. This document does not define Relationships mapping semantics and does not authorize implementation.

## 1. Purpose and non-negotiable boundaries

Implement the approved B operation: transform the **current Relationships projection state** from one exact semantic version to another using an immutable, Relationships-owned mapping artifact.

The operation must preserve these boundaries:

- Source events, committed effects, evaluator snapshots, rule pins, and provenance are never rewritten or marked `superseded`.
- The migration writes a separate immutable derived result.
- Missing or ambiguous source provenance, missing mapping coverage, unknown values, unsupported states, or version mismatch reject the entire operation before canonical writes.
- No latest/nearest version fallback, automatic reciprocal relation, automatic version-chain traversal, partial success, neutral/default substitution, or runtime `unsupported`/`unresolved` placeholder.
- Historical candidate re-evaluation (Core PRs #733/#739) is source-semantic audit/evidence only. It is not called as the transformation engine.
- Personality state and NPC knowledge are not migration targets. Memory→NPC remains `DISABLED / FAIL-CLOSED`.

This is a Core execution contract proposal. It does not define an HTTP endpoint, public API schema, or implementation patch.

## 2. Verified current-main constraints

The proposal is grounded in the existing implementation:

1. `relationships` is an event-derived projection. `SQLiteStore.rebuild()` clears it and replays valid `relationship.transition` effects in commit order.
2. The current row stores `rule_module_id`, `rule_module_version`, `last_event_id`, and `updated_revision`; it does not store the World Pack pin.
3. A committed v2 historical evaluation snapshot stores the exact World Pack ID/version and captured `dimensionRules`, bound to the originating event and protected by input/envelope digests.
4. New transition commits require the exact registered rule-module version to declare a relationship domain matching the world's active World Pack ID/version.
5. The current rollback dependency contract is directed-pair-level. `read_set` accepts entity, fact, and directed Relationship pair references; rollback compares pair projections reconstructed from valid event history.
6. The store already provides a transaction helper, event idempotency/replay handling, world revision and commit-sequence freshness checks, and audit entries.

Consequences:

- Writing migrated values only into `relationships` is invalid: the next rebuild would erase them.
- The row's rule-module pin alone is insufficient to establish its exact source World Pack version.
- Existing rollback projection comparison does not account for a migration-derived base. That behavior must be extended before migration can be enabled.

## 3. Operation boundary

### 3.1 Logical operation

Core exposes one privileged application operation conceptually equivalent to:

`migrateCurrentRelationships(worldId, migrationArtifactPin, expectedRevision, expectedCommitSequence, idempotencyKey)`

This is a logical contract, not a prescribed method name or public route.

The operation is world-scoped and atomic: it migrates the complete current Relationships projection for one world. It does not migrate selected pairs independently. A later narrower scope would require a separate domain and Core contract.

The operation requires the existing privileged administrative authority or a separately reviewed authority at least as restrictive. It is not callable by an NPC, model proposal, Memory consumer, or ordinary event commit path.

### 3.2 Freshness and transaction boundary

Before any canonical write, Core must:

1. Resolve the exact immutable migration artifact by its full identity and version.
2. Read the world, current projection head, current Relationships projection, source provenance, world revision, and commit sequence from one consistent SQLite read snapshot. Resolve the exact active source and target World Pack entries through the configured trusted World Pack catalog and compare their SHA-256 digests to the migration artifact and stored world pin.
3. Require both caller freshness values to match the snapshot.
4. Validate every source row and every mapping entry needed by the current state.
5. Compute the complete target projection and its digest in memory.
6. Recheck/hold the same transaction boundary for the writes.

Any validation error rejects the whole operation. No world revision, active World Pack pin, projection head, projection row, migration result, audit record, or idempotency result may be partially changed.

A successful migration increments `world_revision` exactly once. It does not create or rewrite a `world_events` row and therefore does not fabricate a commit sequence. The source `commit_sequence` is captured as the migration's base cursor. The migration result, current-head selection, active World Pack pin update, materialized projection update, audit record, and idempotency result commit in one SQLite transaction.

### 3.3 Exact artifact and version binding

The migration artifact must be immutable and addressable by exact migration ID/version. It must declare:

- exact source World Pack ID/version/**digest**;
- exact source rule-module ID/version;
- exact target World Pack ID/version/**digest**;
- exact target rule-module ID/version;
- artifact schema/contract version;
- complete dimension and value mappings, including special-state handling and explicit treatment of target-only/removed dimensions.

Core must verify that the artifact's source tuple matches the current projection's proven source tuple, that the world's active World Pack ID/version/digest still equals the artifact's source World Pack ID/version/digest, and that the target rule-module version is registered and compatible with the target World Pack ID/version. The current `worlds` record exposes `world_pack_digest`, but legacy worlds may have a null digest; a null source digest is insufficient proof and rejects migration. The event-local v2 snapshot captures World Pack ID/version but not digest, so Core uses the immutable world-scoped active digest only when it still matches the same source ID/version; it must not pretend the event snapshot itself contains that digest. The repository already provides `loadTrustedWorldPackCatalog()` and `worldPackCatalog.resolve(worldPackId, version)`; the resolver returns the exact catalog-pinned SHA-256 and rechecks artifact bytes at resolution time. Migration must use that deployment-controlled resolver for both source and target tuples, then compare its returned digest with the migration artifact and stored world pin. The current Relationship rule-module manifest contract proves only World Pack ID/version compatibility, not the pack content digest; the trusted catalog supplies that separate content-integrity proof. If the engine has no trusted catalog configured, the exact entry is absent, or the digest does not match, reject migration. The resolver establishes deployment trust, artifact identity, and byte integrity; it does **not** establish complete World Pack schema/conformance validation. `docs/04-world-pack-format.md` explicitly says the full format and production loader are not finalized. Therefore the approved migration artifact/release gate must also carry explicit target-pack conformance evidence under the supported contract; catalog presence alone must not be represented as semantic validation. If that evidence is unavailable, migration remains fail-closed. If the active world pin has already moved independently of the current Relationships state, reject rather than guessing which semantic version the world is migrating from. Core must not infer compatibility from a version label.

The current implementation stores no World Pack pin on a relationship projection row. Core must obtain it from the exact v2 evaluation snapshot attached to each row's `last_event_id`; it must not use the world's current manifest to reconstruct historical provenance. A missing, legacy, corrupt, mismatched, or unavailable snapshot rejects the migration.

**First-release conservative rule:** all current dimension rows in the world must resolve to the same exact source World Pack and rule-module tuple declared by the migration artifact. Mixed or ambiguous source tuples reject the entire migration. Supporting multiple source tuples in one migration would require an explicit expanded domain artifact contract and is not implied here.

The target ID/version/digest becomes the world's active World Pack binding for subsequent typed transitions. Historical event snapshots retain their original source pins. Rollback must restore the predecessor ID/version/digest as one atomic binding.

## 4. Mapping execution boundary

Relationships owns and approves the mapping semantics. Core performs deterministic, exact lookup and structural validation only.

- Every current source dimension must have exactly one explicit disposition in the artifact.
- Every current source value must have an explicit exact mapping.
- `cleared` must have an explicit mapping distinct from an ordinary value and from absence.
- `unset` is represented by absence in the current projection; Core must not synthesize a source row for it.
- `withheld`, `conflict`, `insufficient`, and any other non-value state are not inferred from ordinary rows. If such a state is present in an input contract, it needs an explicit supported mapping; otherwise reject.
- A removed source dimension may be dropped only if the artifact explicitly says so and Relationships has approved that disposition.
- A target-only dimension must have an explicit instruction, including whether it remains unset or is initialized to a specific target value/state. No implicit neutral value is allowed.
- Multiple source dimensions mapping to one target dimension are rejected in v1 unless the artifact contract explicitly defines a deterministic collision operation. No merge rule is inferred.
- Value matching is exact and type-preserving. No coercion, fuzzy match, nearest value, or fallback.

A single unmapped dimension/value/state rejects the entire world migration. Manual resolution is performed only by changing and approving a new immutable mapping artifact, then retrying the whole operation.

## 5. Immutable derived result and effective projection

### 5.1 Derived result

A successful operation creates an immutable derived result containing, at minimum:

- stable migration result ID and exact migration artifact ID/version;
- world ID;
- source World Pack ID/version/digest and rule-module ID/version;
- target World Pack ID/version/digest and rule-module ID/version;
- source world revision and commit-sequence cursor;
- source projection-head/migration ID, if the source was itself derived;
- canonical source projection snapshot or a losslessly recoverable immutable representation;
- source projection digest;
- complete target Relationships projection snapshot and target digest;
- per-dimension source lineage (including originating event IDs);
- operation identity, trusted executor, creation timestamp, and audit reference.

The payload is immutable. Current selection/lifecycle is separate metadata or an append-only lifecycle record; it must never mutate the result payload or any source event.

### 5.2 Current projection head

Core maintains a separate world-scoped current Relationships projection head identifying the selected migration base, if any. The ordinary `relationships` table remains a materialized effective projection, not the durable migration record.

For a world with an active migration base at source cursor S:

1. Start rebuild from the immutable target snapshot of the selected migration result.
2. Replay valid `relationship.transition` events with `commit_sequence > S`, in commit order.
3. Preserve the exact pins on those later committed events.
4. Do not replay pre-S events over the migrated base.
5. Do not execute historical evaluators during rebuild.

For a world without an active migration base, retain the existing event-only rebuild behavior.

This makes the derived result durable across restart/rebuild without changing the historical event stream.

### 5.3 Subsequent typed transitions

Every Relationship transition committed after a migration must be evaluated against the effective projection (migration base plus post-base valid events) and carry a durable dependency on the active migration result in addition to the existing directed-pair read reference.

The current read-set grammar does not support migration-result references. Core must add a typed, world-scoped migration-base dependency and validate it against the active head. A stale/missing/non-current migration dependency rejects the transition before commit.

A later migration is a separate explicit step. Its source is the then-current effective projection and its exact source tuple; it must use a separately approved mapping artifact for that exact step. Core must not skip versions or chain mappings automatically.

## 6. Rollback and dependency semantics

The existing rollback algorithm reconstructs Relationship pair state from valid events only. That is insufficient once a migration base exists.

The migration contract must extend rollback as follows:

1. A rollback affecting events at or before a migration's source cursor recomputes the source Relationships projection at that cursor using the proposed invalidation set.
2. Compare the recomputed source projection digest with the immutable source digest captured by the migration.
3. If the digest is unchanged, the migration base remains valid.
4. If the digest changes, the migration result is no longer eligible as the current projection base. Append a migration lifecycle/invalidation record and move the current head to its valid predecessor (or to event-only history if none exists). Never alter the migration result payload or source event contents.
5. Relationship events committed after that migration and dependent on its migration-base reference must participate in rollback dependency closure. They must not silently survive on a base that is no longer current.
6. If Core cannot determine the affected migration/dependent-event closure deterministically, rollback returns the existing no-write/requires-review outcome. It must not proceed with a stale derived base.
7. A rollback that invalidates a migration in a chain must evaluate dependent migration heads in order. No descendant may remain current when its source migration is invalid.
8. Any active World Pack binding restored by migration invalidation must be restored atomically to the predecessor source tuple, with an audit entry. Source event pins remain untouched.

The current directed-pair dependency granularity remains unchanged. This contract does not introduce dimension-level rollback isolation.

A migration's lifecycle may become non-current or invalidated because its source projection changed. This does not mark source events `superseded` and does not rewrite the immutable derived result.

## 7. Idempotency, audit, recovery

- Idempotency is scoped to world + migration operation key.
- Same key + same normalized request returns the original migration result without a second derived record or revision increment.
- Same key + different request fails with a stable idempotency conflict.
- The audit entry records the migration ID, artifact pin, source/target tuples, source cursor/digest, derived result ID/digest, trusted executor, and outcome.
- Restart recovery must select the same valid migration head and rebuild the same effective projection.
- A partially persisted migration is impossible: the derived result, head, world target pin, materialized projection, audit and idempotency record share one transaction.
- Corrupt/missing derived payload, digest mismatch, unavailable exact artifact, or inconsistent head lineage fails closed. Core must not fall back to latest mapping or silently rebuild from target semantics.
- The original event log remains independently auditable and replayable under its original committed effects and pins.

## 8. Error/refusal classes

The implementation should expose stable internal error classes for at least:

- exact migration artifact not found;
- source World Pack/rule pin mismatch;
- target rule module missing/incompatible;
- source projection provenance missing/legacy/corrupt;
- mixed source semantic pins;
- unmapped dimension/value/special state;
- target-dimension collision or invalid target initialization;
- stale world revision/commit sequence;
- stale migration head;
- migration idempotency conflict;
- migration dependency invalidated during rollback;
- derived result integrity/head-lineage failure.

Error payloads may identify the failing dimension/value key to the privileged migration operator, but must not leak relationship contents through NPC/model-facing or ordinary read APIs.

## 9. Acceptance test matrix

All acceptance tests must exercise the real Core application/store path at the exact reviewed commit. Pure mapping helper tests are supplemental only.

| Area | Required assertion |
|---|---|
| Exact artifact | Exact migration ID/version selected; unknown version rejected; newer artifact never substituted |
| Exact source pins | Source WP ID/version and rule pin proven from captured event snapshots; active source digest must be non-null and match the world's exact ID/version; absent, legacy, corrupt, mismatched or mixed pins reject |
| Exact target pins | Target rule module exists and declares the exact target World Pack ID/version; configured `worldPackCatalog.resolve()` verifies exact artifact digest; missing catalog/entry or mismatch rejects |
| Complete mapping | Every present dimension/value/special state mapped; one missing mapping rejects the entire operation |
| No implicit defaults | No neutral value, dropped dimension, coercion, or target-only initialization without explicit mapping |
| Atomicity | On every refusal, world revision, commit sequence, active World Pack pin, current head, relationship rows, migration records, audit and idempotency state remain unchanged |
| Directionality | A→B remains A→B; no B→A record is created |
| Source immutability | Event payloads, effects, snapshots, pins and provenance are byte-for-byte unchanged by migration |
| Derived persistence | Derived result survives close/reopen and deterministic rebuild |
| Post-migration transition | Transition reads migrated effective state, pins target semantics, and records dependency on the active migration result |
| Explicit chain | A second migration succeeds only with an exact separately approved mapping from the first target tuple to the next target tuple |
| Rollback unchanged source | Rollback that leaves the source projection digest unchanged preserves the migration head |
| Rollback changed source | Rollback that changes source digest invalidates migration selection and propagates to dependent post-migration transitions atomically |
| Rollback uncertainty | If dependency closure cannot be established, rollback is no-write/requires-review |
| Idempotency | Same request returns the same result; key reuse with different payload conflicts |
| Recovery | Restart during/after commit yields either the complete pre-migration state or complete post-migration state, never a partial state |
| Isolation | Other worlds and opposite directed pairs are unaffected |
| Ownership | Migration does not alter Personality traits or NPC knowledge; Memory→NPC remains disabled/fail-closed |

## 10. Implementation gates and non-goals

Implementation is not authorized by this proposal. Before runtime work:

1. Relationships reviews and merges the approved domain policy in PR #745.
2. Core reviews and approves this execution contract, including the derived-base/rebuild and rollback dependency semantics.
3. The mapping artifact contract is finalized by Relationships; Core does not invent dimension/value mappings.
4. Core implementation is split into storage/migration ledger, effective projection rebuild/read path, transition dependency integration, and rollback/recovery.
5. Exact-head CI and production-path integration tests pass; independent review is completed before merge.

Explicit non-goals:

- historical event re-materialization or rewriting (model C);
- historical candidate re-evaluation as a transform engine;
- Personality or NPC state migration;
- Memory→NPC enablement;
- NPC/model-facing Relationship mutation or read authorization;
- public HTTP API design in this proposal;
- dimension-level rollback dependency redesign;
- automatic migration chains, latest fallback, or manual per-record resolution.

Until all gates pass, migration remains unavailable and fail-closed.
