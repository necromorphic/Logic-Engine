# Core Decision Proposal — Initial NPC Knowledge Acquisition Representation

**Status:** coordinator recommendation for Core review; not implemented.  
**Scope:** first slice only: `author_initial` and `imported`.  
**Related:** docs 43, 50, 51, 83, 84; tracking issue #557; governing integration gates #140/#264/#356.

## 1. Decision recommended

Use a **Core-owned, event-sourced acquisition effect with a derived read projection**, not an NPC-owned table and not ordinary `fact.set`.

Proposed effect family (names are proposal-only until the Core contract is approved):
- `knowledge.acquisition.assign` — records one explicit assignment of one canonical item/source to one canonical subject in one world.
- `knowledge.acquisition.invalidate` — records a Core-authorized invalidation of a specific assignment/source support when the existing source lifecycle cannot express the invalidation through a supported rollback path.

The durable authority remains the existing Core event stream and its validity/replay boundary. The query projection is derived from valid acquisition effects and is rebuilt/reconciled from that stream. It is not a second authority or a second event log. Do not add an independent revision counter; reads use the existing `(world_revision, commit_sequence)` cursor.

This is a **design recommendation**, not a claim that the current event validator, rollback engine, importer, or model-dispatch path already supports these effects.

## 2. Why this representation

Source audit shows:
- `fact.set` creates canonical world-truth claims; it has no subject-acquisition semantics.
- `context_manifests` bind generation/snapshot metadata and referenced items; they do not grant knowledge.
- `ActorBindingService` resolves a trusted adapter-to-canonical-actor binding; it does not authorize item disclosure.
- `world_events` already own canonical effects, validity, replay/reprojection, rollback metadata, and the per-world commit cursor.
- `SQLiteStore.readSnapshot()` supplies the existing snapshot cursor.

Therefore the least divergent Core design is to keep assignments within the Core event/validity lifecycle and expose them through a derived projection. A standalone NPC table or prompt/manifest-based record would create a competing authority and would not inherit replay/rollback automatically.

## 3. Semantic shape (not wire JSON or SQL schema)

Each assignment must semantically carry:
- canonical `world_id`;
- canonical `subject_id`, resolved by the trusted Core boundary;
- canonical item reference or explicitly supported source reference;
- `acquisition_kind`: exactly `author_initial` or `imported`;
- stable authoring/import source identity and version where available;
- explicit assignment/authorization rule identity and version;
- initial/import boundary;
- event identity and validity derived from Core lifecycle;
- restriction reference resolved by the existing trusted access-policy mechanism.

Do not use display names, model-provided actor IDs, context manifest IDs, prompt text, vector hits, or generic fact presence as assignment authority. Do not include belief, confidence, delivery, comprehension, observation, or in-world discovery.

The exact serialized contract, table shape, public API and enum spelling remain implementation details to be decided after the event/effect and source contracts are reviewed.

## 4. Independent support and invalidation

Treat each accepted assignment as a distinct support path. Two independent author/import assignments to the same subject/item must remain distinguishable.

Required projection semantics:
1. An assignment is active only while its own event and its required source/authorization basis remain valid.
2. Invalidating one support does not remove another independently valid support.
3. No active support means the item is not returned as currently acquired.
4. A source replacement/invalidation must be represented through an explicit Core-owned validity transition or an existing proven rollback/replay contract. Do not infer source invalidation merely from a changed fact value, a `depends_on` list, or a `causal_links` entry.
5. If Core cannot yet represent source validity and independent supports without a new source lifecycle primitive, keep the acquisition slice blocked and submit that minimal extension for review before coding the query path.

The current rollback implementation is not proof of this general behavior. Production tests must establish it for acquisition effects.

## 5. Trusted assignment entry points

### `author_initial`
Accept only from a trusted authoring/configuration operation that explicitly names the canonical world, canonical subject, item/source, and authorization rule at the declared initial boundary. Ordinary world initialization or fact creation is not sufficient.

### `imported`
Accept only from a trusted importer that validates the package/source identity and explicitly maps the item to the canonical subject. A generic world-pack import that merely creates canonical facts is not sufficient. Current World Pack documentation does not establish a finished production loader, so this path stays unsupported until a real trusted import entry point is identified or implemented.

If there is no supported entry point for either kind, return `unsupported`/non-ready; do not synthesize assignment from model context.

## 6. Read path

Expose a Core-internal operation (method name intentionally undecided) that requires:
- a server-authenticated adapter identity;
- Core-resolved canonical actor binding;
- a bounded, Core-validated purpose (initially `npc_decision`);
- expected `world_revision` and `commit_sequence`.

Within one consistent snapshot it resolves the active acquisition projection, canonical item/source validity, and the existing trusted restriction policy. It returns only a filtered safe envelope. If identity, source, snapshot, completeness, or access policy cannot be proven, return a non-ready/withheld/unsupported result and do not return restricted values.

No raw snapshot fallback. No disclosure-policy duplication. Integrate through the existing #140/#264/#356 dispatch/readiness gate and test the exact serialized model input there.

## 7. Required implementation sequence

1. **Core source audit and source contract:** identify the supported authoring/import entry points; document whether they can express subject-specific assignment. The current audit did not identify a completed production path.
2. **Core effect and validity review:** check the existing effect validator, event commit, replay/reprojection and rollback paths. Specify the smallest event-sourced acquisition effect and the exact source-validity transition before implementation.
3. **Core assignment entry points:** implement only the supported trusted source paths; leave unsupported source types fail-closed.
4. **Core projection and snapshot read:** derive assignments from valid Core events at the existing snapshot cursor, preserving independent supports and status distinctions.
5. **Existing access/dispatch gate:** filter before serialization through the governed boundary; do not add a parallel egress system.
6. **Production tests:** replay/restart, duplicate/conflicting identity, replacement, invalidation, independent supports, actor isolation, snapshot mismatch, read purity, withheld-secret omission from exact model input and diagnostics.
7. **Coordinator review:** update #557 and #140/#251/#252 with commit and test evidence. Do not promote readiness until every mandatory gate passes.

## 8. Explicit non-decisions and stop conditions

This proposal does not approve:
- a public endpoint or caller-controlled assignment API;
- a new standalone acquisition database/table as the source of truth;
- treating ordinary facts, imports, manifests or prompts as acquisition;
- a new parallel revision cursor, source graph, rollback engine or dispatch gate;
- observation, communication, inference, rumor, delivery, comprehension or belief;
- enabling Memory → NPC or changing Host readiness.

**Stop condition:** if Core cannot tie the assignment and its source validity to a trusted source contract and the existing event/replay boundary, do not implement a partial acquisition read. Return explicit unsupported/non-ready and bring the smallest missing Core-owned lifecycle contract back for review.

## 9. Current recommendation

Approve the event-sourced effect + derived projection as the target representation **in principle**, subject to the source-entry and validity review in steps 1–2. This narrows the design choice while preserving the existing Core authority and avoids pretending that the missing importer or lifecycle has already been solved.

## 10. Trusted World Pack catalog and bootstrap acceptance contract (proposal; not runtime approval)

This section makes the recommended authoring-catalog slice testable. It does not authorize runtime changes.

### 11.1 Deployment catalog boundary

Use a deployment-provided, read-only catalog loaded during Core startup from a configured local artifact directory or deployment-owned configuration. The first implementation must not expose catalog create/update/delete operations over the Core HTTP API.

Each immutable catalog entry contains:
- world_pack_id;
- exact version;
- a digest computed by Core over the canonical pack bytes;
- the validated pack manifest and payload, or a stable read-only reference to those exact bytes;
- the supported schema/contract version.

Requirements:
- Catalog entry identity is the tuple (world_pack_id, version); duplicate tuples fail startup rather than use last-write-wins.
- A digest mismatch between catalog metadata and the bytes loaded by Core fails startup or the relevant pack resolution. A digest proves byte identity only; trust comes from deployment control of the catalog location and configuration.
- The catalog must not follow mutable remote URLs or paths supplied by a create-world request.
- An unknown pack/version returns a deterministic non-success error before a world row is created.
- The public request may select an available ID/version, but cannot supply/override the trusted manifest, digest, assignments, canonical mapping, source identity, or trust policy.
- Catalog reload/replacement is a deployment operation. Existing worlds remain pinned to their exact catalog version and digest; no implicit update or rewrite is allowed.

The storage schema currently records pack ID/version but no catalog digest. A future implementation must add the pin through a reviewed migration or an explicitly justified equivalent immutable record. Do not silently repurpose an unrelated field.

### 11.2 createWorld() validation order

Required order for a future implementation:

1. Validate the request shape and reject unknown fields.
2. Resolve exactly one installed catalog entry by (world_pack_id, world_pack_version).
3. Validate that entry against the selected, supported World Pack schema/conformance contract. If the complete contract is not implemented, reject packs requiring unsupported fields; do not claim conformance from partial schema checks.
4. Compute/verify the canonical content digest against the exact bytes being consumed.
5. Validate all pack-local references and assignment declarations without writing canonical world state.
6. Prepare the complete bootstrap plan and detect duplicate IDs, unresolved references, conflicting writes, unsupported rules, and invalid assignment rules.
7. Commit world identity/pin plus the planned initial canonical records and author_initial assignment effects through one Core-owned transaction/commit boundary.
8. Return success only after durable commit. A failure at any step before commit leaves no partially initialized world or assignment.

Do not create the world first and then asynchronously populate assignments. That would expose a valid-looking but incomplete world. If current persistence cannot make the complete bootstrap atomic, the first implementation must either add a reviewed transaction primitive or explicitly split world creation into a non-usable staging state that cannot be read or dispatched; do not improvise partial activation.

### 11.3 Canonical mapping and assignment rules

A pack uses stable pack-local references, not runtime database IDs or display names. For each initial assignment, the pack contract must identify:
- stable assignment ID unique within the immutable pack version;
- pack-local subject reference;
- source item/proposition reference that resolves to a canonical item created or validated in the same target world;
- explicit assignment-rule ID and version;
- acquisition kind fixed to author_initial for this first slice.

The trusted bootstrap adapter resolves local references to canonical IDs. It must reject:
- missing or ambiguous subject/item references;
- references that resolve only in another world;
- a source item that is not part of the trusted pack/bootstrap plan;
- duplicate assignment IDs with identical or conflicting content;
- assignment declarations supplied only by the caller rather than the installed pack;
- unsupported rule versions or implicit “all facts are known to all NPCs” behavior.

A world-level fact and a subject-level assignment are separate concepts. Creating a fact must never automatically assign it to every subject.

### 11.4 Atomicity, replay and idempotency

The transaction boundary must cover the world pin, bootstrap entities/facts and all initial-assignment effects as one unit. Either all are durable or none are. Do not use a second database/table as an independent authority.

The operation needs a stable idempotency identity derived from the trusted catalog entry and bootstrap operation, not from an arbitrary caller-supplied provenance field. Repeating the same operation must not duplicate entities, facts, events or assignments. Reusing the same identity with different canonical content must fail with a conflict and no partial writes.

Each assignment must be represented in the reviewed Core event/validity lifecycle described above. A digest or catalog pin does not substitute for event validity, and rollback/replay behavior must be demonstrated against current-main lifecycle code before assignment writes are enabled.

### 11.5 Version pin and migration policy

- The created world records the exact pack ID, version and digest used for bootstrap.
- Installing a newer catalog version does not change existing worlds.
- A missing old version after deployment must not cause silent fallback to the newest version. Startup must either retain the required immutable artifact or mark the world unavailable/non-ready with an explicit error.
- Changing a world's pinned pack is a separate migration proposal with dry-run, compatibility checks, conflict handling, revision/audit evidence and rollback/replay semantics. It is not part of initial bootstrap.
- Replaying historical events must use the historical pinned contract where required; a current catalog entry must not reinterpret old effects silently.

### 11.6 Minimum acceptance test matrix

| Test | Setup/action | Required result |
|---|---|---|
| Unknown pack | Request ID absent from deployment catalog | Rejected before world creation; no world/event/entity/fact rows |
| Unknown version | Known ID, absent version | Rejected; no fallback to another version |
| Duplicate catalog key | Two entries with same ID/version | Catalog fails closed; no arbitrary winner |
| Digest mismatch | Trusted entry points to bytes that differ from declared digest | Resolution/bootstrap rejected; no writes |
| Request override | Caller supplies manifest, digest, assignment or trust metadata | Unknown fields rejected; installed catalog remains the only source |
| Invalid pack contract | Unsupported schema version/operator/field | Rejected before durable writes |
| Missing subject/item | Assignment points to unresolved pack-local ref | Entire bootstrap rejected atomically |
| Cross-world mapping | Reference exists only in another world | Rejected; no cross-world assignment |
| Partial failure | Inject failure after planning / during commit | No partial active world or assignments |
| Exact replay | Retry identical bootstrap operation | Idempotent result; no duplicate records/effects |
| Conflicting replay | Same idempotency identity, changed trusted content | Conflict; no mutation |
| Catalog replacement | Install newer version after world creation | Existing world stays pinned to old exact version/digest |
| Old version unavailable | Restart without the pinned immutable artifact | Explicit non-ready/unavailable result; never silently use latest |
| Fact without assignment | Create a canonical fact without an assignment declaration | NPC acquisition read does not return it as acquired |
| Independent support | Two valid assignments support the same subject/item; invalidate one | Remaining valid support remains active |
| Rollback/replay | Roll back bootstrap/assignment event and rebuild projection | Assignment status matches Core validity; no ghost acquisition |
| Client provenance forgery | Caller invents source/rule/version fields | Rejected or ignored only where contract explicitly permits; never accepted as authority |
| Read boundary | Assigned and restricted items coexist | Assignment alone does not bypass the separate #140/#264/#356 disclosure gate |

These are acceptance requirements, not tests that have already been run. Any implementation report must identify the exact commit/head and show the results of the actual tests.

### 11.7 Stop/go criteria for the first runtime PR

GO for implementation planning only after Core review accepts:
- the deployment catalog trust boundary and immutable version retention;
- the complete pack schema/validation contract;
- the canonical pack-local mapping contract;
- the transaction/event boundary and idempotency semantics;
- the migration and failure-state behavior.

NO-GO for acquisition writes or Memory → NPC until exact-head tests prove the matrix above to the extent implemented, and separate disclosure approval is recorded. Catalog validation alone is not evidence that a subject has permission to receive a fact. The imported kind remains unsupported in this slice.

## 11. Current-main bootstrap boundary: concrete code-mapped plan

**Purpose:** turn the catalog recommendation into a reviewable implementation sequence grounded in existing code. This is still a proposal; it does not authorize runtime changes.

### 12.1 Existing path and exact limit

- `src/api/server.js`: the admin-gated `POST /v1/worlds` route delegates to `engine.createWorld(...)`. Admin authentication protects the operation but does not establish that the caller's arbitrary pack ID/version corresponds to trusted installed pack bytes.
- `src/application/engine.js`: `LogicEngine.createWorld(x)` validates the request's world identity, pack ID/version and game time, then delegates to `store.createWorld(...)`. It does not resolve a pack, validate a complete pack payload, or prepare subject-specific initial assignments.
- `src/storage/sqlite-store.js`: `SQLiteStore.createWorld(w)` owns the current world-row creation and audit entry inside `store.tx(...)`. The `worlds` schema records `world_pack_id` and `world_pack_version`; it does not record a trusted catalog digest or immutable artifact reference.
- `docs/04-world-pack-format.md`: explicitly labels the format proposed/partial and says there is no complete production loader or full conformance-validation path.

Implication: do not place catalog resolution only in the HTTP handler; callers can also reach application/storage code in tests or other internal paths. The application boundary must receive a trusted catalog dependency, and storage must persist the pin atomically with world creation. Conversely, storage should not parse pack files or independently decide source trust.

### 12.2 Proposed ownership split

1. **Deployment/catalog loader (outside request data):** reads only deployment-configured local artifacts; validates duplicate `(world_pack_id, version)` entries, immutable version identity, canonical bytes and digest. No catalog mutation route in the first slice.
2. **Application bootstrap planner:** resolves the requested ID/version from that loaded catalog, validates the complete supported contract, maps stable pack-local references, and creates a side-effect-free bootstrap plan. The planner must not accept a caller-provided replacement manifest or assignment list.
3. **Core persistence transaction:** rechecks world ID uniqueness and any required revision/idempotency conditions, then commits the world pin and the complete approved bootstrap effects under the existing Core-owned transaction/event lifecycle. If the current event API cannot express the bootstrap effects in that transaction, stop and submit the smallest transaction/effect extension for review.
4. **Readiness/activation:** a world becomes usable only after the entire bootstrap commit succeeds. Do not return an active world after writing only its world row. If staging is required, staging must be an explicit persisted non-ready state that every read/dispatch path rejects until activation.
5. **Future assignment projection:** derive subject-specific acquisition from approved valid Core effects. Do not infer assignment from a pack fact, channel declaration, manifest entry, or the existence of a canonical fact.

### 12.3 Transaction design constraint

`SQLiteStore.tx(...)` is a reusable local SQLite transaction primitive, and `createWorld` already uses it for world creation. That is useful groundwork, but it does not prove that a multi-record pack bootstrap can currently be committed through one supported Core event/effect path. The implementation review must identify the exact existing transaction and canonical event-commit methods that would accept the full plan. If the only way to populate the pack is multiple public API calls after world creation, that path does not satisfy atomic bootstrap and must not be used as a substitute.

Do not add an independent acquisition table as an authority, a parallel event log, or a second revision counter. A derived projection is acceptable only after the event/effect representation and rebuild semantics are reviewed and implemented against Core's existing event validity lifecycle.

### 12.4 Proposed catalog and pin contract

Deployment catalog entry, conceptual shape only:

```text
CatalogEntry
  world_pack_id: stable namespaced ID
  version: immutable exact version string
  schema_version: explicitly supported contract version
  content_digest: Core-computed SHA-256 over canonical pack bytes
  artifact: validated immutable bytes or a deployment-controlled immutable reference
```

The catalog location/configuration is the trust root; SHA-256 alone is not authenticity. If deployment supports signed artifacts later, signature verification is a separate trust mechanism and must define the trusted key source, rotation/revocation and exact signed bytes.

The world record must pin `(world_pack_id, version, content_digest)` as part of the creation transaction. A request can select a catalog entry but cannot supply its digest as authority. Existing worlds must never silently resolve against a newer version. If the pinned artifact is missing, report the world as unavailable/non-ready rather than substituting the latest entry.

### 12.5 Assignment payload and canonical references

World Pack assignment declarations should use stable local references, for example `subject_ref`, `item_ref`, `assignment_id`, and `assignment_rule_id + assignment_rule_version`. These names are illustrative, not an approved schema. The final schema must specify strict field allowlists, size/depth bounds, duplicate rules, reference semantics and compatibility version.

Before any write, the planner must resolve every local reference exactly once and verify that both subject and source item belong to the intended target-world bootstrap plan. Display names are never keys. An assignment references a source proposition/item; it does not assert that the proposition is true, and it does not grant unrestricted disclosure.

### 12.6 Implementation gates and evidence

Gate A — design approval: agree catalog trust root, immutable artifact retention, complete World Pack schema and assignment reference semantics.

Gate B — persistence proof: point to the exact Core commit/event transaction that can atomically create the world pin and all required canonical records; demonstrate rollback on injected failure and deterministic replay. If unavailable, implement and review the minimal Core-owned extension before assignment writes.

Gate C — runtime slice: add catalog loading/resolution and strict validation behind a non-production default; no generic client-supplied assignment endpoint. `imported` remains rejected.

Gate D — tests: unknown ID/version; duplicate catalog identity; digest mismatch; request override; invalid schema; unresolved/ambiguous/cross-world refs; duplicate IDs; transaction failure after each planned write; exact replay; conflicting replay; catalog replacement; missing historical artifact; no implicit subject assignment from a fact; rollback/replay; disclosure-gate isolation.

Gate E — readiness: only after exact-head CI and the existing #140/#264/#356 gates pass may anyone separately consider production wiring. Passing catalog tests alone does not authorize Memory → NPC.

### 12.7 Current recommendation

Do not begin the runtime implementation yet. The next review should decide Gate A and name the owner for the World Pack schema/conformance contract. Once that is approved, the first coding PR should implement catalog resolution plus world pinning only, with no acquisition writes; the subsequent PR can add `author_initial` assignments after the atomic Core effect/event representation is approved. Keep `imported` and Memory → NPC disabled.


## 12. Decision after exact current-main transaction-path inspection

**Decision recommendation: reuse the existing Core SQLite transaction and canonical event path; do not introduce a second transaction system, acquisition database, or parallel journal.** This narrows the persistence question, but it is not yet proof of an implemented acquisition lifecycle.

### 12.1 What the code establishes

- `LogicEngine.createWorld(x)` delegates to `SQLiteStore.createWorld(...)`.
- `SQLiteStore.createWorld(w)` executes its world-row insert and `world.created` audit write inside `this.tx(...)`.
- `LogicEngine.commitEvent(...)` prepares and validates an event, then delegates to `SQLiteStore.commit(...)`.
- `SQLiteStore.commit(...)` also uses `this.tx(...)`; `SQLiteStore.tx(...)` uses a nested SAVEPOINT when a transaction is already active.
- Therefore, a synchronous Core-owned bootstrap coordinator can be designed to open one outer `store.tx(...)`, call world creation and then the reviewed canonical event commit path inside it, and roll back the whole operation if any nested step throws. This is a viable candidate using existing primitives, not a tested guarantee yet.
- The outer transaction must also preserve the store's coordinator/accepted-head finalization semantics. The implementation test must cover the configured accepted-head mode, not just an in-memory SQLite fixture.

### 12.2 What remains unsupported

- `createWorld` currently persists only the world ID, pack ID/version, time and its audit record. It does not resolve a trusted catalog entry or persist a digest pin.
- Current canonical event effects include entity and fact operations, but there is no reviewed acquisition effect that ties a specific subject to a source item under an acquisition rule and source-validity lifecycle.
- A `fact.set` event cannot stand in for a subject assignment. The existing event path is a suitable lifecycle boundary to extend, not evidence that acquisition semantics already exist.
- The World Pack schema/conformance contract and deployment catalog loader remain absent. Transaction reuse does not solve source authority.

### 12.3 Chosen implementation order

1. **Contract first:** define a deliberately small, strict World Pack v1 subset for bootstrap. Reject unsupported fields/features; do not claim full conformance with the unfinished general format. The deployment-controlled catalog is the trust root; the request selects only an installed immutable ID/version.
2. **Catalog + pin PR:** add read-only deployment catalog loading, strict validation, canonical digest calculation and a reviewed schema migration to persist the exact digest with the world. No initial-knowledge assignment writes in this PR. Keep the catalog loader outside HTTP request-controlled paths.
3. **Atomicity proof in that PR:** use the outer Core transaction candidate described above. Add a failure-injection test after world creation and after each bootstrap write; assert that world row, audit, events, projections and pinned catalog identity all roll back together. Test exact replay and conflicting world IDs. Test with accepted-head/coordinator mode enabled where that mode is supported.
4. **Acquisition representation PR:** only after source authority is accepted, add the smallest explicit Core acquisition effect and its validation, persistence, projection rebuild, invalidation and rollback/replay behavior. The effect must carry a canonical subject and source item reference plus a versioned rule identity; caller-supplied provenance is never authoritative.
5. **Read path and disclosure:** derive acquisition at the existing snapshot cursor, then separately satisfy #140/#264/#356 before any Memory → NPC integration. Keep `imported` unsupported until a distinct trusted importer/origin contract exists.

### 12.4 Stop/go result

- **GO for a narrowly scoped design/implementation PR:** catalog contract and exact version/digest pinning, with no acquisition writes.
- **NO-GO for acquisition writes:** until the effect and validity lifecycle are implemented and tested on the current head.
- **NO-GO for Memory → NPC:** until acquisition read tests and the separate disclosure gates pass.

This decision replaces an open-ended “add a transaction primitive if needed” question with a testable reuse-first plan. If the outer-transaction proof fails because of accepted-head or coordinator semantics, stop and propose the smallest Core-owned extension; do not work around it with multiple independently committed API calls.
