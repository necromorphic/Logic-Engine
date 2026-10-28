# Spatial/Temporal Runtime Implementation Roadmap — 2026-10-28

**Status:** Research proposal for owner review only — NOT approved for implementation  
**Scope:** Dependency order and decision gates for a future World Pack typed-spatial implementation. Documentation only.  
**Safety:** Production remains **NO-GO**. Memory → NPC remains **DISABLED / FAIL-CLOSED**. No runtime, schema, API, event, storage, adapter, Host, Memory, or NPC behavior is changed by this document.

## Executive decision

Do not start by adding a spatial query or a position field. First make the *meaning and provenance of a position durable and verifiable*. A query layer built before that would turn generic attributes into apparently authoritative facts.

The current direction is World Pack-owned typed spatial attributes, validated at the canonical Core commit boundary. Existing source evidence does not demonstrate that this validation, immutable schema pinning, or historical schema resolution is implemented.

## Dependency order

`World Pack identity and loader`
→ `canonical schema identity`
→ `canonical commit validation`
→ `lifecycle and historical replay`
→ `temporal evidence and snapshot freshness`
→ `read-only spatial query contract`
→ `Host exposure review`
→ `Memory/NPC review (separate approval)`

A later stage must not be treated as ready while an earlier stage is unresolved.

## Stage 0 — Freeze the acceptance contract

**Deliverable:** Owner-reviewed normative contract, not code.

Keep the selected position semantics from the typed-spatial contract revision 2:
- X = logical east, Y = logical north, Z = up; right-handed frame.
- Abstract logical units; entity-origin anchor.
- Frame instance scoped to one world; no implicit transforms, interpolation, extrapolation, or narrative inference.
- Unsupported or unproven spatial evidence returns a non-confirmed status.

**Open decision:** Which JSON Schema validator/version and vocabulary are supported by the repository? Custom `spatial_semantics` metadata is not enforcement unless the selected validator and loader explicitly consume it.

**Exit condition:** Core/World Pack owners accept the schema vocabulary, canonicalization rules, and fail-closed error behavior. No implementation before this decision.

## Stage 1 — Establish a trusted World Pack loading boundary

**Known source boundary:** `schemas/world-pack-manifest.schema.json` requires `entity_types[].type_id` and `attributes_schema`, but constrains `attributes_schema` only to an object. The current `LogicEngine.createWorld()` path requires `world_pack_id` and `world_pack_version`; the store persists those identifiers. Current `package.json` declares no runtime dependencies, and bounded code searches did not find an AJV/JSON-Schema validator or a `loadWorldPack`, `registerWorldPack`, or `validateWorldPackManifest` path demonstrating that the corresponding manifest content is loaded, validated, and bound to world creation. This is a bounded repository finding, not proof that no external loader exists.

**Required design:**
1. Identify the single authoritative manifest ingestion/registration path and every alternate import, migration, repair, and reload path.
2. Validate the complete manifest with one explicitly pinned validator and supported schema dialect.
3. Reject duplicate `type_id` values and malformed or unsupported schema features.
4. Produce a canonical manifest representation and stable digest; define canonicalization precisely (UTF-8, deterministic object-key ordering, number representation, and treatment of arrays).
5. Bind the loaded immutable pack version to the exact canonical content. Same pack ID/version with different content is a version-immutability violation, not an in-place update.
6. Make loader failure visible as non-ready; never fall back to an unvalidated or latest schema silently.

**Exit condition:** Every path that makes a pack available produces the same verified identity, or refuses to make it available.

## Stage 2 — Pin schema identity to canonical world state

The proposed spatial schema identity is:
`(world_pack_id, world_pack_version, canonical_manifest_digest, canonical_entity_type_schema_digest, spatial_contract_id)`.

The current world row stores pack ID/version; those fields alone do not prove which schema bytes were used. Before choosing storage changes, owners must decide:
- Where immutable pack manifests and digests live, and their retention/deletion rules.
- Whether the world row pins the manifest digest directly or references an immutable registry record.
- How existing worlds with no verified digest are handled (recommended: spatial status remains UNKNOWN until explicitly migrated/re-pinned).
- How restore from an older database backup is detected. A digest stored only inside the same restorable database does not independently prove that the database is the newest accepted state.

**Exit condition:** A world can resolve its exact historical schema identity after restart and replay; missing or mismatched identity fails closed.

## Stage 3 — Put validation at the canonical commit boundary

The source audit identifies `SQLiteStore.commit()` and `commitSegment()` as central write paths. The typed-spatial contract chooses the storage-backed canonical transaction as the authoritative gate; this is a target design, not existing behavior.

The gate must:
- Resolve the entity type against the world's pinned pack version exactly (byte-for-byte type ID; no aliases or fallback).
- Validate the *full resulting attribute state*, not just an incoming patch.
- Validate create, update, upsert, delete, and any operation that can alter spatial interpretation.
- Reject unsupported schema features rather than partially validating.
- Ensure segment writes cannot partially commit if any spatially relevant event fails.
- Ensure idempotent replay returns only the original result for the same request identity/hash; a retry must not be reinterpreted under a different schema.

**Exit condition:** No canonical writer can accept a spatial claim outside the same gate. Alternate writers that cannot prove this leave spatial state unsupported.

## Stage 4 — Make entity continuity and replay schema-aware

The current entity projection is keyed by `(world_id, entity_id)`; existing create/tombstone guards narrow ordinary ID reuse, but they do not by themselves prove spatial continuity across all import, rebuild, restore, or migration paths.

Required design:
- Preserve lifecycle identity across create/update/delete and replay; decide whether a durable incarnation ID is required before implementation.
- Bind each accepted spatial state to the schema identity under which it was accepted.
- Rebuild from canonical valid events in commit-sequence order using the schema identity historically associated with each event, never silently the newest pack schema.
- Rollback/retraction must invalidate dependent spatial results and recompute only from still-valid evidence.
- If historical schema or lifecycle evidence is missing, the affected spatial state is UNKNOWN, not reconstructed by guesswork.

**Exit condition:** Rebuild, rollback, and restore cannot silently change the meaning of an old position.

## Stage 5 — Define the temporal evidence envelope

A position is not a complete spatial fact without a trustworthy state/time boundary.

Required envelope for any future spatial read:
- `world_id` and entity identity/lifecycle;
- typed position value and schema identity/digest;
- canonical Core snapshot marker (revision and commit sequence remain distinct);
- explicit TimeEngine/game-time coordinate and its authority/version;
- validity/freshness status and relevant source-event provenance.

Do not substitute wall-clock timestamps for game time. Do not assume that Core's revision/sequence pair alone proves that every external source or schema registry is current. If temporal mapping, schema provenance, or snapshot consistency is missing, return UNKNOWN/STALE as applicable.

**Exit condition:** A read can explain exactly which accepted state and time boundary it represents and why it is still current.

## Stage 6 — Specify read-only spatial queries

Only after Stages 0–5 are accepted should the query surface be specified. Initial scope should be deliberately small:
- exact position lookup for one entity;
- same-world coordinate comparison only;
- no pathfinding, collision, visibility, reachability, inferred movement, or cross-frame transforms in v1;
- no NPC-facing prose in the Core result.

Every result must include evidence/status. Suggested non-confirming states are `UNKNOWN`, `STALE`, `CONFLICT`, `ABSENT`, and `UNSUPPORTED`; final names and transitions require owner review. A query must never promote a generic `attributes.position` object into a confirmed position.

**Exit condition:** Query semantics, failure states, and provenance fields are reviewed independently from any Host or NPC integration.

## Stage 7 — Keep Host, Memory, and NPC as separate gates

A correct world position does not prove an NPC perceived it, was told it, remembers it, or is allowed to use it. The world-state result must not be injected into NPC context as a shortcut.

Required future reviews:
1. Host/Adapter read-only exposure and authorization.
2. Separate Memory policy review for whether and how spatial evidence may be stored.
3. Separate NPC-boundary review for perception/knowledge and permitted use.
4. Explicit owner approval before any Memory → NPC path is enabled.

Until all separate gates are approved, Memory → NPC stays disabled and fail-closed.

## Existing seam findings — what can and cannot be reused

The current repository evidence supports a *read-only research path*, not a production spatial source:

- `LogicEngine.getState()`, `getSnapshot()`, and `getEvents()` expose existing application-level reads. The bounded feasibility work in issue #351 reports a bracketed `getState → getEvents → getState` protocol for checking snapshot consistency. This does not create typed position semantics.
- `SQLiteStore.commit()` is the canonical event transaction; `commitSegment()` routes segment members through `commit()` and rebuilds projections; `rollback()` invalidates dependent events and rebuilds existing projections. The audited store has no demonstrated typed spatial schema gate.
- Core's world and event markers are distinct: `world_revision`, `commit_sequence`, and game-time coordinate cannot substitute for each other. Rollback may change revision without consuming a new commit sequence.
- TimeEngine uses canonical integer millisecond game-time coordinates and persists operation/segment recovery data. The operation's latest `result.last_segment` records a composite result including the final commit sequence, while historical segment mapping requires resolving stored segment event IDs against canonical event history. A dedicated typed list of every confirmed segment-to-Core cursor is not exposed by the inspected operation projection.
- The existing `tests/spatial-temporal-cursor-feasibility.test.js` provides a bounded positive result: it reconstructs per-segment cursors from persisted segment event IDs after restart and verifies that rollback invalidates an affected boundary and leaves the operation checkpoint stale. It does **not** establish universal mapping across every possible intervening write, equal-time event ordering, all recovery paths, or coordinated old-backup restore. Treat it as partial test evidence, not a general cursor contract.

These findings align with the current blocker recorded in [Issue #351](https://github.com/necromorphic/Logic-Engine/issues/351): the process/authority question has been resolved by delegated coordinator authority, but the technical gates remain open. The required work is now evidence closure, not another duplicate read/replay harness.

### Restore/anti-rollback boundary

The current main branch includes [tests/memory-provider-coordinated-restore.characterization.test.js](https://github.com/necromorphic/Logic-Engine/blob/main/tests/memory-provider-coordinated-restore.characterization.test.js). Its test is explicitly named to characterize that a coordinated restore of the Core and Provider databases is undetectable by current snapshot markers alone. The fixture demonstrates that after restoring matching older database copies, both the entity state and the stored revision/commit-sequence markers can agree with each other again. This is test-source evidence of a known limitation; this pass did not execute the test.

The current [coordinator-lock.js](https://github.com/necromorphic/Logic-Engine/blob/main/src/storage/coordinator-lock.js) is only a lock primitive, but `main` also contains optional Core-side accepted-head client wiring. The separate authority service/store is still a draft candidate in [PR #480](https://github.com/necromorphic/Logic-Engine/pull/480), and the dedicated authority storage ACL candidate is [PR #469](https://github.com/necromorphic/Logic-Engine/pull/469); neither is merged. Thus the correct blocker is not “no design exists”, but “service, deployment, ACL/backup separation, and adversarial restore evidence are not yet accepted”. A digest stored only inside the restored Core database cannot by itself prove that it is the newest accepted state.

## Representation choice — current disposition

The existing research report compares in-memory projection, persisted rebuildable projection, scene/episode records, snapshots/checkpoints, and a hybrid. The practical disposition is:

| Representation | Disposition now | Reason |
|---|---|---|
| In-memory derived spatial projection | Not sufficient as the authoritative durable result | Restart loses it; deterministic reconstruction still needs a typed committed source |
| Persisted, rebuildable spatial projection | Candidate only; not approved | Best fit with current Core rebuild pattern, but schema identity, lifecycle, rollback and read boundary remain unproven |
| Scene/episode records | Complementary evidence only | Preserve source occurrence/provenance; cannot replace canonical event history or prove NPC knowledge |
| Spatial snapshots/checkpoints | Optimization only after deterministic replay is established | A checkpoint without a verified schema and exact Core/time anchor can preserve stale or misinterpreted state |
| Hybrid | Long-term option, not selected | Most complete lineage but adds reconciliation complexity before the base contract exists |

**Current recommendation:** do not choose a storage layout or introduce a new projection yet. First close typed source/schema identity and temporal cursor mapping. A persisted rebuildable projection can be reconsidered only after those gates have owner-reviewed evidence.

## Closure checklist — what "complete" means for this task

The architecture/research task is not complete merely because a document exists or generic replay tests pass. It is complete only when each line has an exact evidence reference and the status is honestly recorded:

- [ ] World Pack loader/registration and every canonical writer, import, migration, repair, restore path are inventoried; unreviewed paths are explicitly listed.
- [ ] Supported validator/version and schema dialect are identified; full spatial post-state validation and custom semantic metadata behavior are proven.
- [ ] Exact immutable World Pack manifest/type-schema identity and historical resolution are specified without assuming a digest stored in the same old-restorable database proves newest state.
- [ ] Entity deletion/tombstone/recreation identity and replay semantics are closed for every path.
- [x] Basic TimeEngine segment boundary reconstruction after restart and rollback invalidation have a research-only test in main (`tests/spatial-temporal-cursor-feasibility.test.js`, lines 42–113 and 116–176); [ ] equal-time order, intervening writes, alternate recovery paths, and old-backup recovery are not closed by that test.
- [ ] Rollback/rebuild guarantees ensure no spatial result survives invalidated source evidence.
- [ ] Unknown/stale/conflict/absent/unsupported statuses and provenance are defined without converting generic attributes or narrative output into spatial facts.
- [ ] Core and TimeEngine evidence is independently separated in the report; any not-run tests remain NOT RUN and any unapproved runtime contract remains blocked.
- [ ] Separate Host, Memory and NPC reviews remain downstream gates; no NPC admission or Memory→NPC activation is inferred.

The first five technical items are still blockers. Until they close, the research can become more precise, but the spatial contract cannot honestly be declared implementation-ready.

## Required handoff links

- Original bounded architecture/feasibility task: [Issue #350](https://github.com/necromorphic/Logic-Engine/issues/350).
- Current spatial task and acceptance criteria: [Issue #351](https://github.com/necromorphic/Logic-Engine/issues/351).
- Portfolio owner / shared register / release-gate tracking: [Issue #252](https://github.com/necromorphic/Logic-Engine/issues/252).
- Core authority boundary: [Issue #262](https://github.com/necromorphic/Logic-Engine/issues/262).
- TimeEngine / Process Manager boundary: [Issue #243](https://github.com/necromorphic/Logic-Engine/issues/243).
- Independent review request: [Issue #630](https://github.com/necromorphic/Logic-Engine/issues/630).

## Traceability to the parent task

The parent task is [Issue #351](https://github.com/necromorphic/Logic-Engine/issues/351). This table prevents documentation progress from being mistaken for runtime readiness.

| Parent-task requirement | Existing evidence / artifact | Disposition |
|---|---|---|
| A1. Read Core/Time/knowledge boundaries | [Core boundary Issue #262](https://github.com/necromorphic/Logic-Engine/issues/262), [Time/Process Issue #243](https://github.com/necromorphic/Logic-Engine/issues/243), [knowledge/narrative boundaries](https://github.com/necromorphic/Logic-Engine/blob/main/docs/07-knowledge-and-narrative-boundaries.md) | Reviewed as design/source context; no second clock, Core, or process scheduler proposed |
| A2–A4. Identify current paths and evidence classes | [Spatial/Temporal evidence report](https://github.com/necromorphic/Logic-Engine/blob/main/docs/research/spatial-temporal-world-model-evidence-2026-10-26.md), [canonical writer inventory](https://github.com/necromorphic/Logic-Engine/blob/main/docs/research/spatial-canonical-writer-inventory-2026-10-28.md) | Existing Core read/commit/rebuild and TimeEngine primitives are documented; typed spatial source and full historical time/cursor mapping remain unproven |
| B. Define minimal spatial model and epistemic states | [Typed spatial contract revision 2](https://github.com/necromorphic/Logic-Engine/blob/main/docs/research/world-pack-typed-spatial-attributes-contract-2026-10-28.md) | Semantics direction is documented, but contract approval remains blocked on runtime guarantees; do not treat the proposal as implemented |
| C. Compare representations | [Evidence report §3](https://github.com/necromorphic/Logic-Engine/blob/main/docs/research/spatial-temporal-world-model-evidence-2026-10-26.md) and the disposition table above | Comparison exists; no storage/projection option is authorized for implementation |
| D. Bounded read/replay feasibility | Issue #351 records an earlier source-boundary feasibility result and exact CI details; this pass did not rerun tests | Use the canonical report, do not duplicate its harness. Prior test evidence applies only to its recorded exact SHA and does not establish typed position semantics |
| Position v1 axis/frame meaning | Coordinator decision recorded in [Issue #351](https://github.com/necromorphic/Logic-Engine/issues/351#issuecomment-6464413177) and typed spatial contract revision 2 | +X logical east, +Y logical north, +Z up; right-handed ENU; logical units; entity-origin; frame convention world-enu-logical-v1 scoped by world identity |
| Required technical gates | [Issue #351 delegated-authority decision](https://github.com/necromorphic/Logic-Engine/issues/351#issuecomment-6465647345) | Process/authority question resolved. Technical blockers remain: canonical typed validation across writers, immutable/historical schema identity, complete lifecycle/replay/restore coverage, and proving the limits of TimeEngine-boundary ↔ Core cursor reconstruction beyond the existing bounded restart/rollback test |
| Production and consumer boundaries | Issue #351 and [knowledge/narrative boundaries](https://github.com/necromorphic/Logic-Engine/blob/main/docs/07-knowledge-and-narrative-boundaries.md) | Production NO-GO; Memory → NPC DISABLED / FAIL-CLOSED; no NPC knowledge or disclosure is inferred from world position |

### Why the parent task cannot yet be marked complete

The remaining blockers require new, verifiable technical evidence and explicit implementation authorization, not more explanatory prose. In the current authorized scope, I can finish source mapping and the architecture proposal, but I must not silently implement a new schema validator, digest registry, canonical commit gate, spatial projection, or TimeEngine cursor mechanism. Those would be runtime/schema/storage changes explicitly excluded by the task's current authorization.

## Proposed blocker-resolution design (for independent review)

This section proposes a concrete resolution rather than leaving the blockers as an unranked list. It is still a proposal and is not authorization to implement.

### Decision R1 — Complete and verify the existing accepted-head authority path; fail closed meanwhile

**Correction after inspecting the current main source and related PRs:** do not describe accepted-head authority as wholly absent. The current `main` version of `src/storage/sqlite-store.js` already has an optional Core client integration using `src/security/accepted-head-client-sync.js`, including enrollment checks, monotonic head comparison, pending-operation recovery, schema/change-set digesting, and fail-closed errors. The integration is gated by `LOGIC_ENGINE_ACCEPTED_HEAD_REQUIRED` and authority connection configuration.

However, the authority service/store is still in draft [PR #480](https://github.com/necromorphic/Logic-Engine/pull/480), and the separate authority storage ACL candidate remains draft [PR #469](https://github.com/necromorphic/Logic-Engine/pull/469). The PR #480 description explicitly excludes service installation, secret provisioning, OS ACL deployment, and production configuration. Therefore the mechanism is **partially wired in source, not proven deployed or restore-resistant on the target machine**.

**Recommendation:** reuse this existing design rather than inventing a parallel ledger. Keep production/non-ready gates closed until the existing authority path is completed and independently accepted.

Minimum closure evidence:
1. Confirm the authority service implementation and state machine are approved, integrated, and pinned to an exact reviewed commit.
2. Prove the authority DB and its backups/sidecars are outside the Core/Provider restore domain, with effective OS ACLs and service identities validated on the target PC.
3. Exercise Core and Provider enrollment, monotonic advance, pending-operation crash recovery, authority outage, token separation, and restore of Core alone, Provider alone, and both stores together.
4. Show that a restored local DB whose head is behind or ahead of the independent authority becomes non-ready and cannot silently re-enroll or lower the accepted head.
5. Define operator recovery for a genuinely lost or replaced authority DB; no automatic reset or re-enrollment without a reviewed approval record.
6. Bind spatial readiness to successful accepted-head health **and** the spatial schema/cursor checks. Accepted-head continuity alone does not validate World Pack identity or typed position semantics.

**Trade-off:** this is a smaller path than building a new authority, but it is not closed by the presence of client code or by hosted CI alone. Until service deployment, ACL, backup isolation, and adversarial restore evidence exist, treat anti-rollback as `NOT PROVEN` and spatial reads as `NON_READY` where continuity cannot be established.

### Decision R2 — Make schema identity immutable and resolvable before spatial validation

**Recommendation:** a World Pack is a content-addressed immutable artifact. A human-readable pack ID/version is not its identity.

Proposed identity tuple:
`(world_pack_id, world_pack_version, canonical_manifest_sha256, canonical_entity_type_schema_sha256, spatial_contract_id)`.

Required protocol:
1. A single loader validates the complete manifest using a pinned validator and schema dialect.
2. Canonicalization is specified and tested before digesting; digest algorithm and canonicalization version are recorded.
3. Loader rejects same ID/version with different canonical bytes; no in-place mutation of a published pack.
4. World creation pins the manifest digest, not only pack ID/version.
5. Historical replay resolves the exact digest that applied at event acceptance. Missing artifact or digest mismatch means `UNSUPPORTED`/world `NON_READY`, not fallback to latest.
6. Legacy worlds with no digest remain spatially `UNKNOWN` until explicitly repinned through a reviewed migration.

**Trade-off:** this needs a runtime/schema/storage change and a pinned validator dependency, so it cannot be implemented under the current docs-only authorization. Independent review should challenge the canonicalization scheme and whether the artifact registry belongs in repository artifacts or a dedicated immutable registry.

### Decision R3 — Treat canonical Core commit as the only spatial acceptance gate

**Recommendation:** validate the full post-state for each affected entity inside the same canonical transaction that commits the event. Validation must use the schema digest pinned to that world, not caller-provided schema and not the latest pack.

The gate must cover direct commits, segment commits, imports, migrations, repairs, replay/rebuild and any alternate writer. If an alternate path cannot run the same gate, it must not produce confirmed spatial state.

For patch-style updates, construct the complete resulting attribute state first and validate it; validating only incoming fields can let malformed pre-existing values survive. Segment processing is all-or-nothing for spatially relevant state. A retry must reuse the original idempotency result and schema identity.

**Trade-off:** this is the most important runtime boundary, but it must not be implemented until R2 defines what schema is authoritative and every canonical write path is enumerated.

### Decision R4 — Reconstruct each boundary from the existing atomic segment record first

**Correction after reviewing the actual current seam:** the current SQLite implementation updates the TimeEngine operation checkpoint/result and commits the segment in the same store transaction. The existing research test also reconstructs each segment boundary after restart from persisted `segments_json` event IDs and canonical `world_events`. Therefore, a new two-phase cross-store receipt is **not justified by the currently inspected path** and should not be the default proposal.

**Recommendation:** first reuse the existing atomic record and derive a boundary cursor without adding a new table, event field, or public API:
1. Read each persisted segment's coordinate and stable event IDs from `time_advance_operations.segments_json`.
2. Resolve the segment's final event by exact `(world_id, event_id)` in canonical `world_events`.
3. Require the event to exist, be valid, and have `game_time_coordinate === segment.coordinate`.
4. Derive the Core cursor from the canonical event's `committed_revision` and `commit_sequence`; verify the derived values agree with the segment commit result / world markers where those are persisted.
5. If any event is missing, invalidated, mismatched, or cannot be resolved, do not treat that segment boundary as confirmed. Rebuild/re-evaluate from valid canonical history or return UNKNOWN/NON_READY.
6. After rollback, re-check event validity and compare the operation checkpoint to the current world marker; a completed historical operation record is not automatically the current world state.

**Evidence already present:** `tests/spatial-temporal-cursor-feasibility.test.js:42–113` characterizes reconstruction after restart; lines 116–176 characterize rollback invalidation and stale checkpoint detection. This is test-source evidence; the tests were not run during this pass.

**Remaining gap:** this bounded test does not cover equal-time ordering across non-TimeEngine canonical writes, all intervening-write interleavings, every interruption/recovery path, or coordinated old-backup restore. Those are explicit follow-up evidence gaps, not grounds to invent a second cursor mechanism.

**Fallback only if independent review finds the existing atomic seam insufficient:** define the smallest additional receipt or contract change with Core/Time owners. Any new cursor field/API/schema remains unapproved and out of scope until that review.

### Smallest safe implementation slice after review

Do not start with a spatial projection. After the owner accepts R1–R4 and explicitly authorizes code changes, implement in this order:
1. Validator + immutable World Pack artifact identity.
2. Pin identity during world creation and reject unresolved legacy packs for spatial use.
3. Canonical commit gate for typed spatial post-state.
4. Validate the existing persisted segment-event → canonical event → Core composite-cursor reconstruction; add a new receipt only if independent review proves the existing atomic seam insufficient.
5. Fail-closed restore/recovery gate.
6. Only then a read-only exact-position query with provenance.

This sequence intentionally postpones NPC integration and any inference-heavy spatial feature.

## Evidence matrix (current reviewed main baseline)

**Repository base SHA:** `9f6e46ec1a397989253f2142e43292a2a1297c89` (the exact base SHA of this draft PR). File blob SHAs below identify the retrieved file contents; they are not commit SHAs.

| Claim | Exact source / lines | File blob SHA | Evidence class | Result / decision impact |
|---|---|---|---|---|
| World creation accepts pack ID/version but the inspected path does not show manifest resolution | `src/application/engine.js:451–485` (`createWorld`); `src/storage/sqlite-store.js:687+` (`createWorld`) | engine `dcb8b84e54b29e8697f14eb7e709cc6e0cd65a13`; store `80cbc54fb174a8074088ee9234524e401b7dbb68` | code-verified, bounded | World Pack identity is currently represented by ID/version at this seam; immutable manifest digest/history is not established here |
| Manifest only constrains `attributes_schema` to an object | `schemas/world-pack-manifest.schema.json:117–124` | `73b59694280ebf4e6c5affd98a41c09e4da6031c` | code-verified | Typed spatial semantics are not enforced by this manifest fragment alone |
| No runtime validator dependency declared in package manifest | `package.json:1–17` | `c9d6652d87cf90ff3b945cfa32c1957d83428cbd` | code-verified, bounded | No validator dependency is declared; bounded searches did not locate an in-repo loader/validator path. External loaders are not ruled out |
| Canonical read seams exist | `src/application/engine.js:486–488`; `src/storage/sqlite-store.js:814+` (`readSnapshot`), `1057+` (`state`), `1090+` (`events`) | engine `dcb8b84e54b29e8697f14eb7e709cc6e0cd65a13`; store `80cbc54fb174a8074088ee9234524e401b7dbb68` | code-verified | Existing state/snapshot/event reads can support a research projection, but do not define typed position semantics |
| Segment commit and rollback are store-owned | `src/application/engine.js:670–705, 1224`; `src/storage/sqlite-store.js:1353+` (`commit`), `1580+` (`commitSegment`), `2078+` (`rollback`) | engine `dcb8b84e54b29e8697f14eb7e709cc6e0cd65a13`; store `80cbc54fb174a8074088ee9234524e401b7dbb68` | code-verified | Any future spatial acceptance must not bypass these canonical mutation/rebuild paths |
| Coordinator DB is a lock primitive; accepted-head client integration exists but external authority deployment is not established | `src/storage/coordinator-lock.js:4–9, 52+`; `src/storage/sqlite-store.js:20–25, 347–365, 688–710, 752–805`; `src/security/accepted-head-client-sync.js` | coordinator `7df7121bdbbf71d8171759dbdcd2ca6626130014`; store `0c45e73020d69726946a01e5c7e39ea4c4a7fdd4`; client `97b0352c0e0ad8a1a52701e0c1c6108b4600ba51` | code-verified, bounded; external service/ACL still draft | Do not build a parallel ledger. Verify draft authority service PR #480, ACL PR #469, target-PC deployment and coordinated restore behavior before claiming anti-rollback closure |
| Segment commit and TimeEngine operation checkpoint update share the inspected transaction path | `src/storage/sqlite-store.js:1730–1860` (segment processing and operation checkpoint/result update) | `80cbc54fb174a8074088ee9234524e401b7dbb68` | code-verified, bounded | Prefer deriving the boundary cursor from existing segment event IDs and canonical events before proposing a new receipt/table |
| Basic TimeEngine boundary mapping survives restart | `tests/spatial-temporal-cursor-feasibility.test.js:42–113` | `422b6dbc8dc132c27d285aa883eb9a45ef4727f6` | test-source verified; execution status not checked in this pass | Reconstructs each segment boundary from final segment event ID and canonical event row |
| Rollback invalidates affected historical boundary; operation checkpoint becomes stale | `tests/spatial-temporal-cursor-feasibility.test.js:116–176` | `422b6dbc8dc132c27d285aa883eb9a45ef4727f6` | test-source verified; execution status not checked in this pass | Consumers must revalidate event validity and world markers; old completed operation data is not automatically current |
| Coordinated Core+Provider restore can re-agree on old markers | `tests/memory-provider-coordinated-restore.characterization.test.js:10–146` | `9d8ba4571bfd2b46b81734aeeb5c0838142b1828` | test-source verified; execution status not checked in this pass | DB-local markers alone do not detect a consistent old restore |
| Typed position acceptance is absent from the reviewed contract path | `src/storage/sqlite-store.js:1580+` plus schema above; see PR #620 test for generic `attributes.position` behavior | store `80cbc54fb174a8074088ee9234524e401b7dbb68` | partial/source + prior exact-head CI | A generic position attribute is not verified spatial evidence; one canonical post-state gate is still a proposed seam |

### Failure/test matrix

| Failure mode / invariant | Existing evidence | Current status |
|---|---|---|
| Rejected/uncommitted proposal must not alter spatial projection | No spatial projection exists to exercise; no production contract | NOT IMPLEMENTED / NOT TESTED |
| Duplicate/idempotent input must not duplicate spatial effect | Core idempotency exists, but no typed spatial effect/projection contract | PARTIAL; spatial behavior not tested |
| Missing/conflicting position must remain unknown/conflict | No typed position runtime exists | NOT IMPLEMENTED / NOT TESTED |
| Basic segment boundary reconstruction after restart | Test source lines 42–113 | Test present; CI/execution not checked during this pass |
| Rollback invalidates affected segment boundary | Test source lines 116–176 | Test present; CI/execution not checked during this pass |
| Coordinated old Core+Provider restore | Test source lines 10–146 | Test present; CI/execution not checked during this pass |
| Equal-time ordering, intervening non-TimeEngine writes, every alternate restore/recovery path | No complete evidence in this pass | BLOCKED / NOT PROVEN |
| World Pack schema digest and historical replay | No executable loader/digest path found in bounded search | BLOCKED / NO APPROVED SEAM |
| Full spatial post-state validation across all canonical writers | No runtime spatial gate demonstrated | BLOCKED / NO APPROVED SEAM |

No tests were executed by this pass. Prior branch CI results cited elsewhere apply only to their exact recorded commit SHAs and must not be generalized to the current main baseline.

## Current blockers and next concrete decisions

| Priority | Decision / evidence needed | Why it blocks progress |
|---|---|---|
| P0 | Identify and pin the supported schema validator/dialect and custom spatial metadata vocabulary | Without it, typed semantics are descriptive only |
| P0 | Identify the authoritative World Pack loader/registration path and alternate writers | Cannot guarantee one immutable pack identity |
| P0 | Choose digest canonicalization and immutable registry/storage authority | Cannot prove which schema defined an accepted position |
| P1 | Decide handling of legacy worlds without schema digests | Prevents silently treating old generic attributes as typed facts |
| P1 | Decide durable entity-incarnation semantics across replay/restore | Prevents ID continuity assumptions from overstating evidence |
| P1 | Specify event-to-schema provenance and rollback/rebuild behavior | Prevents historical reinterpretation |
| P2 | Define temporal envelope and read-only query response | Depends on trusted schema and commit evidence |
| P3 | Review Host, Memory, and NPC separately | Not part of Core spatial correctness |

## What this roadmap does not claim

- It does not claim that the loader, digest registry, spatial validation gate, or spatial query API exists.
- It does not authorize production changes or migration.
- It does not mark the spatial contract approved.
- It does not authorize Host, Memory, or NPC integration.
- It does not change the current production NO-GO or Memory → NPC DISABLED / FAIL-CLOSED decisions.
