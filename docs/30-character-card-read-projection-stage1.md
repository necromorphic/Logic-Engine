# Character Card Read Projection — Stage 1 Specification

Status: proposed implementation specification for review. This document does not claim that character-card, knowledge, or audience-filtering runtime features already exist.

Related documents:
- `docs/23-character-and-control-architecture.md` — character/control planning boundaries.
- `docs/03-storage-and-persistence-contract.md` — canonical versus derived data.
- `docs/07-knowledge-and-narrative-boundaries.md` — truth, knowledge, delivery, and search separation.
- `docs/21-stage1-causality-contract.md` and `docs/22-causality-semantics.md` — causal guarantees and their current limits.
- Character Cards Contract v1.2.1 in PR #29 — card semantics, provenance, drafts, notes, cache/access policy, and conflict behavior.

## 1. Goal

Add the smallest safe, read-only character-card projection over data already accepted by the engine. The projection is a view, not a new source of truth. It must not create, update, or delete world state, commit events, infer missing canon, grant knowledge, or expand access.

Stage 1 is deliberately narrower than the full card contract. It proves that a deterministic read model can be built and tested before adding authored profile storage, card editing, player notes, or a knowledge subsystem.

## 2. Non-goals

Stage 1 does not implement:
- canonical authored-profile persistence or profile version history;
- character creation or automatic ID allocation;
- knowledge records, belief updates, or evidence acquisition;
- player-facing secret filtering or a general access-control policy;
- edits, drafts, approvals, conflict resolution, or canonical commits;
- relationship, goal, plan, process, StoryBeat, or resource subsystems not already available as authoritative structured data;
- vectorization, embedding changes, SillyTavern integration, prompt assembly, or changes to the existing adapter;
- causal-completeness verification or stronger rollback guarantees than the current core provides;
- player notes or automatic character development.

These features must not be simulated by putting extra fields into a card blob.

## 3. Source-of-truth rules

1. The world store and accepted event/fact/entity state remain authoritative.
2. The projection may read only records exposed by a deliberately chosen internal read interface; it must not write to the store.
3. A field is included only when it can be sourced from an existing authoritative record or an explicitly approved, typed source.
4. Absence of a field means “not supplied by this projection”; it does not mean false, none, empty, impossible, or not applicable.
5. Do not synthesize biography, personality, skills, relationships, motives, habits, knowledge, or secrets.
6. Do not treat narrative text, vector-search results, a model-generated statement, or a player note as a canonical fact.
7. Do not interpret arbitrary entity attributes as verified card fields merely because their names look familiar. Any mapping must be explicit, documented, and tested.
8. Preserve source references and epistemic status wherever the current data model makes them available. If source provenance is unavailable, do not fabricate it; expose the limitation to trusted internal callers or omit the unsupported field.

## 4. Proposed projection boundary

The implementation should expose a pure application-level projector, conceptually:

`projectCharacterCard(worldSnapshot, entityId, projectionOptions) -> CharacterCardProjection`

This is a design signature, not a requirement to add that exact public API. The projector:
- receives a bounded snapshot/read result for one world and one entity;
- performs no network, database, clock, random, or model calls itself;
- does not mutate its inputs;
- returns the same output for the same inputs and projection version;
- never traverses records from another world;
- returns a typed not-found/unsupported result rather than inventing a placeholder character.

The application/service layer is responsible for obtaining a consistent read snapshot, validating world/entity scope, and translating errors. Keep database details out of the pure projector.

### 4.1 Minimum output

The Stage 1 projection should contain only:
- `projection_version`: explicit identifier for the projection mapping, not a database migration version;
- `world_id`;
- `entity_id`: the existing stable entity identifier, not a new card-generated ID;
- `entity_type`;
- `status`;
- `profile`: only explicitly mapped fields that already exist in an approved authoritative source; omit the object if no approved profile source exists;
- `known_state`: only explicitly mapped current-state fields sourced from accepted structured state; omit unknown/unmapped fields;
- `source_refs`: stable references to source records where available;
- `source_revision`: the world revision or consistent snapshot marker used to build the result, if available from the read interface.

The final schema must follow repository naming and validation conventions after code review. This specification intentionally does not prescribe a writable card record.

Do not return the entire raw entity attribute object by default. A generic attributes bag can contain internal or sensitive material and has no reliable field-level access semantics.

## 5. Read consistency and determinism

- Build the projection from one consistent world snapshot/read boundary. Do not combine entity data from one revision with facts or events read later at another revision.
- Include the source revision in the result when available. This is a freshness marker, not a promise that every field has independently verified provenance.
- The same snapshot and projection version must yield structurally identical output. Sort collections and source references deterministically.
- Do not include current wall-clock time, random IDs, unstable database iteration order, or generated prose in the projection.
- If the existing store cannot supply a consistent snapshot through its current interface, document that limitation and add a narrow read method rather than issuing unrelated reads and implying atomicity.
- A projection is disposable and rebuildable. Stage 1 should not add a persistent cache. If a cache is proposed later, its key must include world/entity scope, source revision, projection/schema version, and access-policy context; policy changes must invalidate or revalidate cached output.

### 5.1 Snapshot boundary contract to settle before storage changes

The current `SQLiteStore.state(worldId)` reads the world, entities, and facts in separate statements without an explicit read transaction around the complete read. Therefore, it must not be passed off as an atomic card snapshot.

**Sequencing constraint:** settle this contract and its test cases first. Do not change `src/storage/sqlite-store.js`, `src/api/server.js`, or existing API response shapes until the core 1.3 semantics/review explicitly authorize that step. This Stage 1 card work must not pre-empt the core causal-semantics workstream.

When storage implementation is authorized, the narrow read boundary should satisfy:

1. **One world, one read view:** world metadata, the selected entity, and any explicitly requested source records are read from one SQLite-consistent snapshot. Never compose a projection from independently observed revisions.
2. **Read-only:** the operation must not create events, update rows, advance `world_revision` or `commit_sequence`, or write idempotency/audit records.
3. **World scoping:** entity and source-record lookup must be scoped to the requested world. An entity ID found in another world must not satisfy the request.
4. **Bounded result:** return only the records requested by the internal read contract; do not expose the entire world state as a convenience.
5. **Stable cursor:** return the revision/cursor actually observed inside the same read view. Do not sample the revision before or after the read and label it as the snapshot's revision.
6. **Transaction discipline:** use the SQLite driver's supported read-transaction semantics; do not assume that opening a transaction in the caller automatically makes every driver/read path consistent. Document the chosen isolation mechanism.
7. **Failure behavior:** if the snapshot cannot be obtained, fail the whole read. Do not silently fall back to several uncoordinated reads.
8. **No route yet:** the first boundary is an internal store/application operation, not a new HTTP endpoint. API exposure requires a separate authorization and response-shape review.

### 5.1.1 Snapshot marker semantics

The internal read boundary must capture a **composite snapshot marker** from the same SQLite read view as the returned world/entity/source rows:

- `world_revision` identifies the canonical projection generation visible in that read view. It advances for accepted state transitions, including rollback, even when rollback creates no new event.
- `commit_sequence` is the greatest committed event sequence visible for that world in the same read view; use `0` when no committed event is visible.
- These values are a pair, not interchangeable alternatives. `commit_sequence` alone cannot identify current projected state because rollback can advance `world_revision` without adding an event. `world_revision` alone does not identify the event-history cursor needed by causal/history-aware callers.
- Read both values inside the same transaction/read view as the rows. Do not sample either value before or after the snapshot queries, and do not combine a cursor from one view with rows from another.
- The internal snapshot result must carry both values. The pure card projection may expose `source_revision` as the observed `world_revision`; it need not expose `commit_sequence` as a player-facing card field. Callers that need history-aware staleness checks must retain the full internal marker pair.

This clarifies the card-read contract without adding a revision counter or changing the existing meaning of either core cursor.

### 5.2 Snapshot acceptance tests (contract-first)

Before implementing the storage method, reviewers should agree on these observable tests:

- **Consistent revision:** the returned snapshot marker and entity/source values belong to the same read view even if a concurrent writer commits while the read is in progress.
- **No writes:** capture `world_revision`, `commit_sequence`, event count, and relevant row values before/after; a successful read changes none of them.
- **Failure atomicity:** injected read/transaction failure yields an error and no partial snapshot object.
- **World isolation:** same entity ID in two worlds cannot cause cross-world data to appear in the requested snapshot.
- **Missing entity:** return the established typed not-found outcome for the requested world; do not return an entity from another world.
- **Deterministic ordering:** if more than one source record is explicitly requested, results use a documented stable order.
- **No API regression:** existing `GET .../state` response shape and authorization behavior remain unchanged in this slice.
- **No hidden-data expansion:** the method returns only the requested internal records, and the pure projector continues to omit arbitrary attributes and raw fact/event payloads unless a later reviewed field mapping explicitly authorizes them.

A test using only sequential reads cannot prove concurrency consistency. The test harness must coordinate a concurrent writer/read interleaving or use a deterministic storage hook/fault-injection seam. Do not claim the race is tested if the test only checks the returned object in a single-threaded happy path.

### 5.3 Concrete test scenarios and pass/fail oracle

Use a temporary database and synthetic records only. The test names below are contract IDs for future automated tests; they do not imply that the storage boundary already exists.

| ID | Setup / interleaving | Required observation | Fail if |
|---|---|---|---|
| CARD-SNAP-001 | Seed world W at revision R with entity E and source record S. Start the read and pause it after the snapshot is established. A second connection commits a transaction changing E/S and advancing revision. Resume the read. | The returned entity, S, and revision/cursor all describe one permitted database read view. | Values combine pre-write and post-write state, or the cursor is sampled outside the read view. |
| CARD-SNAP-002 | Repeat CARD-SNAP-001 with the writer committing before the reader establishes its snapshot. | The reader returns the complete newer state and its matching marker. | The result mixes state from both sides of the commit. |
| CARD-SNAP-003 | Start the read, then inject a failure after world metadata but before entity/source retrieval completes. | The operation rejects with a typed error; no partial snapshot is returned. | A partial object is returned or an uncoordinated fallback is attempted. |
| CARD-SNAP-004 | Snapshot W1 where entity ID E exists only in W2. Request (W1, E). | Typed not-found for W1; no fields from W2. | Cross-world data is returned or the error includes hidden W2 data. |
| CARD-SNAP-005 | Capture revision, commit sequence, event/audit/idempotency counts, and the relevant rows; perform a successful read. | Every captured canonical value remains unchanged. | The read creates any canonical write or advances a counter. |
| CARD-SNAP-006 | Inject transaction-open, query, and transaction-close failures separately. | Each failure is surfaced; connection/transaction cleanup follows the driver's documented behavior; no snapshot escapes unless it is complete and valid. | A failure is swallowed, the connection remains in a bad transaction state, or partial data escapes. |
| CARD-SNAP-007 | Return multiple requested source records with intentionally shuffled insertion order. | Output ordering is stable under the documented sort key, and repeated reads of the same view are structurally equal. | Database incidental order changes the result. |
| CARD-SNAP-008 | Invoke the existing public state endpoint before and after the internal read implementation is added. | Existing response shape and authorization behavior are unchanged. | This work silently changes or exposes the existing endpoint. |

| CARD-SNAP-009 | Seed a world with a committed event at cursor C, then perform a successful rollback that advances `world_revision` but creates no new committed event. Read a snapshot after the rollback. | The marker reports the post-rollback `world_revision` and the unchanged greatest visible `commit_sequence` C from the same read view. A marker captured before rollback must not be presented as current. | The implementation relies on `commit_sequence` alone, reports a stale `world_revision`, or samples marker fields outside the read view. |

**Driver-specific gate:** before selecting a transaction pattern, inspect the exact SQLite driver/version and its documented transaction/isolation behavior. A test must prove the behavior actually provided by that driver and journal mode; the contract must not assume that the word “transaction” alone guarantees a snapshot. If the driver cannot provide the required view, stop and document the weaker guarantee for explicit review rather than weakening the test silently.

**Concurrency-test implementation note:** use two independent database connections and an explicit synchronization seam (barrier/hooks around snapshot establishment and selected reads), not arbitrary sleeps. Where deterministic interleaving cannot be created with the current store, introduce a test-only seam or lower-level storage test; do not add production timing hooks solely to make the test pass.

**Scope gate:** these scenarios authorize neither a new public API nor changes to SQLite code by themselves. The core owner must explicitly approve the storage step after reviewing the contract and these test oracles.



### 5.4 Cross-contract review against PR #29 and current core

The current draft has been checked against the Character Cards Contract v1.2.1 in PR #29, the Stage 1 causal contracts (docs/21 and docs/22), and the Stage 1.3 mechanic-execution boundary now merged into main as docs/30-stage1.3-mechanic-execution-boundary.md.

- **Consistent with PR #29:** the projection remains a disposable view over authoritative records; it does not become a second source of truth, infer canon, grant protagonist knowledge, or expose unrestricted author data. The empty initial profile allowlist and omission of profile / known_state are intentional, not missing defaults.
- **Consistent with the causal boundary:** the projection may reflect the current accepted state, but must not claim that declared provenance proves causal completeness. Rollback and source validity remain core responsibilities; the card layer adds no causal edges or rollback rules.
- **Consistent with Stage 1.3 snapshot discipline:** any future storage read must bind its data to one immutable read view and report the actual world_revision and commit_sequence observed there. A read marker sampled before or after the data queries is not sufficient. This is a read-consistency requirement, not permission to add a new revision counter or bypass the canonical core pipeline.
- **Scope remains limited:** merging the Stage 1.3 documentation does not by itself authorize a SQLite/API implementation. The current storage read is still not proven atomic, and the core semantics/test review must authorize the implementation step before those files are changed.
- **Review status:** no cross-contract contradiction was identified in this pass. Runtime support, concurrency behavior, and causal completeness are not thereby proven; the acceptance tests in Section 5.2 remain required.

## 6. Access and caller boundary

The current general world-state endpoint is not, by itself, a player-safe character-card API. Stage 1 must not expose this projection to an untrusted player or to a model context until a separate server-side audience/access filter exists.

For the first implementation:
- keep the projection internal to the engine/application test boundary, or expose it only through a trusted administrative route whose authorization and intended audience are explicit;
- do not use UI-only hiding as a security control;
- do not assume authenticated means authorized to see every hidden fact;
- do not return secrets, private intentions, raw audit payloads, arbitrary attributes, or all world facts as part of the card;
- do not claim that `profile` or `known_state` represents what the protagonist has learned unless a knowledge/acquisition model explicitly supports that claim.

If the repository lacks a distinct trusted internal authorization boundary for a proposed route, do not add a public route in this stage. A pure projector plus tests is an acceptable Stage 1 deliverable.

## 7. Canonical state and rollback

The projection must be recomputed from the current accepted state after a commit or rollback; it must not maintain its own mutable copy of character state.

- Retracted or invalidated events must not be treated as current support merely because they remain in historical logs.
- If a source fact is conflicted, unknown, or lacks sufficient provenance for a field's declared semantics, the projector must not silently turn it into a confirmed value.
- Do not implement custom rollback logic inside the card subsystem.
- Existing rollback guarantees are bounded. A read projection cannot repair missing causal declarations or claim that causal completeness has been proved.
- If current source data cannot distinguish valid current state from unsupported historical claims, omit the affected field or return a structured unsupported/ambiguous result; do not guess.

## 8. Error behavior

Use the repository's established error/result conventions. At minimum distinguish:
- world not found;
- entity not found within the requested world;
- entity exists but is not a supported character-like type for this projection;
- inconsistent or unavailable source snapshot;
- unsupported/ambiguous source data, where it prevents a safe projection.

Error responses must not include unauthorized values, hidden source payloads, or secrets. Avoid leaking whether a hidden entity exists to untrusted callers; that policy belongs to the future access layer.

## 9. Test plan and acceptance criteria

### Unit tests
1. Projection of a supported entity includes only approved mapped fields.
2. Missing optional data is omitted, not converted to negative assertions or invented defaults.
3. Arbitrary attributes are not copied wholesale.
4. Same input snapshot yields deep-equal output across repeated calls.
5. Collections/source references are sorted deterministically.
6. Projection does not mutate input objects.
7. Unsupported entity type returns the documented result.
8. Conflicted or unsupported facts are omitted or marked according to an explicit typed rule, never silently confirmed.

### Integration tests
1. Entity lookup is scoped to the requested world.
2. Missing world/entity follows the established error convention.
3. Projection reads do not increment world revision or commit sequence.
4. Projection reads create no WorldEvent, audit mutation, or idempotency record.
5. A rollback followed by a new read reflects the current accepted state, while valid independent sources remain represented according to the core's actual projection rules.
6. No player-facing route is introduced without server-side authorization and access filtering.
7. Existing API and runtime tests remain green.

### Acceptance gate
Do not merge Stage 1 implementation unless:
- all tests pass;
- no existing public response shape is changed;
- no writes occur during projection;
- no arbitrary entity attributes or unfiltered raw facts are exposed;
- projection behavior and limitations are documented;
- a reviewer has checked the implementation against the current core and PR #29 contract.

## 10. Suggested implementation sequence

1. Review the current store's state/query semantics and determine which fields have explicit provenance.
2. Agree on the narrow internal read boundary and the exact allowlist of mapped fields.
3. Implement a pure projector with no persistent cache.
4. Add unit and integration tests from Section 9.
5. Run the complete existing test suite and inspect the diff for accidental adapter, vectorization, or unrelated core changes.
6. Request independent review before any merge.

## 11.1 Findings from the current repository audit

The following are source-backed implementation constraints, not assumptions:

- `SQLiteStore.state(worldId)` currently reads the world row, entity rows, and fact rows using separate SELECT statements without an explicit read transaction around the whole snapshot. It returns the full entity attribute objects and fact payloads. Do not treat this method as a proven atomic snapshot boundary for a card projection.
- Entity rows currently contain `entity_id`, `entity_type`, `status`, arbitrary `attributes`, `created_by_event_id`, and `updated_revision`. The entity projection is rebuilt from accepted event effects. The runtime does not enforce a character-only entity-type taxonomy or a typed schema for profile attributes.
- The event contract currently accepts caller-supplied entity IDs in entity effects. The card contract's eventual invariant that IDs are system-generated is therefore not satisfied by the current runtime. Stage 1 must reuse an existing ID and must not claim to solve identity allocation; this gap remains visible for core planning.
- The existing `GET .../state` route returns the general state payload. It is not an acceptable card endpoint and must not be repurposed as one. The existing internal token guard applies to direct event commits; it does not establish an authorization boundary for a new read route.
- Current error handling uses `EngineError` codes/statuses, but Stage 1 does not need an HTTP route. Keep projector-level failures internal and translate them only at an established application/API boundary.
- Causal completeness is explicitly unknown in Stage 1. The projector must not infer source validity solely from the presence of an event reference or claim stronger rollback guarantees than the core contract.

## 11.2 Conservative decisions for the first implementation

To avoid inventing schema or exposing data before the relevant subsystems exist, the first implementation should use these defaults:

1. **Supported entities:** no implicit type-name guessing. Require an explicit allowlist supplied by the internal caller/configuration. If no allowlist is configured, do not classify arbitrary entities as characters. Do not add guessed aliases such as `npc`, `person`, or `character` without evidence from the World Pack/tests.
2. **Profile fields:** the approved attribute allowlist is empty initially. Do not copy `attributes` into `profile`. Add a field only after a typed schema/source contract and fixtures are agreed.
3. **Current state:** Stage 1 may expose only the entity's explicit identity/type/status metadata plus source revision, and only to trusted internal tests/callers. Do not label raw attributes or world facts as character knowledge. `profile` and `known_state` are omitted until approved mappings exist.
4. **Snapshot:** add a narrow storage read boundary that obtains world metadata, the selected entity, and any explicitly needed source records under one read transaction/snapshot. Do not reuse the existing multi-query `state()` method while claiming atomicity. If the database driver/runtime cannot provide the required transaction behavior, document the exact weaker guarantee before proceeding.
5. **Caller:** first implementation is a pure application-level projector plus an internal service/read method and tests only. No new public route, no model-context exposure, and no UI path.
6. **Errors:** use internal typed result/error conventions consistent with `EngineError`; preserve `WORLD_NOT_FOUND` for a missing world and define a stable entity-not-found/unsupported-type code only if needed by the implementation. Error payloads must not include raw source data.
7. **Identity contract gap:** do not retrofit ID generation as part of this read-only slice. Track it as a separate core-contract/runtime alignment item before authoring/card-creation features depend on it.

These defaults make the first slice deliberately small. They are safer than pretending the current arbitrary attributes are a complete character schema. A later slice can expand the projection only after the World Pack/type contract and authored-profile source are explicit.

## 12. Remaining decisions to resolve during implementation review

These are intentionally not guessed here:
- Which current entity types should count as characters in the first supported slice?
- Which exact existing entity attributes, if any, are approved profile fields rather than opaque data?
- Does the current storage interface provide a consistent snapshot suitable for the projection, or is a narrow read method needed?
- Which trusted internal caller can use the projection without creating a new public disclosure path?
- What exact result/error shape matches current repository conventions?

Resolve these against current source and tests before coding. Do not broaden Stage 1 to answer them by assumption.

## 13. Implementation status disclaimer

This is a proposed specification only. It does not claim that the projector, card API, character profile store, knowledge model, or player-safe access filtering has been implemented. The current runtime and its tests remain the source for claims about existing behavior.
