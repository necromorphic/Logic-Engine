# World Pack Typed Spatial Attributes Contract — Revision 2

**Status:** DOCUMENTATION REVISION FOR RE-REVIEW ONLY — NOT APPROVED FOR IMPLEMENTATION  
**Date:** 2026-10-28  
**Supersedes:** Revision 1 in PR #548  
**Scope:** Architecture contract only. No production code, schema, API, event, adapter, persistence, projection, runtime, Host, Memory, or NPC changes are authorized.  
**Safety:** Memory → NPC remains **DISABLED / FAIL-CLOSED**. Production implementation remains **NO-GO**.

## 1. Decision retained from revision 1

World Pack-owned typed spatial attributes remain the selected design direction. Core is the authority for canonical world state; World Pack declares type-specific attribute semantics; a spatial result is derived only from accepted canonical state and verifiable schema/temporal provenance.

Approved v1 position semantics retained and completed by coordinator decision:

- exactly three coordinates: numeric X, Y, Z;
- one world-relative, right-handed coordinate frame;
- **+X is the logical eastward axis, +Y is the logical northward axis, and +Z is up** (right-handed ENU convention);
- eastward/northward are axis labels for the fictional/logical world frame, not geodetic coordinates or claims about physical metres;
- units are abstract logical units, not metres or another physical unit;
- position denotes the declared entity origin, distinct from the world's origin;
- canonical frame convention identifier: `world-enu-logical-v1`; the frame instance is scoped by world identity, conceptually `(world_id, "world-enu-logical-v1")`. Equal convention IDs do not make coordinates from different worlds comparable;
- no local frames, transforms, implicit scale, interpolation, or extrapolation;
- no inference from narrative/model output or generic attributes.

This coordinator decision closes the v1 axis naming and frame-convention questions without adding a runtime field, API, schema, or storage mechanism. The exact serialization/placement of this metadata remains subject to the existing schema-validator and World Pack evidence gates below. Runtime guarantees absent from the current code remain BLOCKED.

## 2. Evidence boundary and source audit

The following are source findings, not proof of spatial enforcement:

- `schemas/world-pack-manifest.schema.json` defines `entity_types[]`; each type has `type_id` and `attributes_schema`, but `attributes_schema` is only constrained as an object. See `$defs.typeDefinition` and its `attributes_schema` property.
- `src/core/rules.js`, `validateEffects` (around lines 205 onward in the audited source), checks supported effect fields and that entity `attributes` is an object. It does not bind the entity to a World Pack schema or validate typed spatial fields.
- `src/storage/sqlite-store.js`, `commit()` (around line 1283), reads the world and checks revision/cursor and entity-effect preconditions, but the audited body does not resolve a World Pack schema or call `validateEffects`.
- `commitSegment()` (around line 1507) opens a transaction, calls `commit()` for each event with deferred rebuild, rebuilds, then records segment replay. Nested `tx()` calls participate in the existing transaction depth. The implementation's actual transaction behavior must be rechecked at the exact candidate code revision before implementation.
- `rebuild()` (around line 2215) replays valid events ordered by `commit_sequence`; entity create/upsert share an upsert projection path, update merges attribute patches/removals, and delete writes a destroyed tombstone with empty attributes.
- Entity projection identity is currently keyed by `(world_id, entity_id)`; the audited code does not establish a distinct durable incarnation identity for a delete/recreate lifecycle.
- World rows contain `world_pack_id` and `world_pack_version`, but those columns alone do not prove immutable schema content is resolved or pinned by the canonical commit path.
- `docs/57-core-evaluation-recalculation-boundary.md` states that `world_revision + commit_sequence` identifies a Core snapshot boundary, not a universal source-change journal. `docs/07-knowledge-and-narrative-boundaries.md` assigns temporal progression to Time/TimeEngine and canonical state/commit to Core.

Source links: [rules.js](https://github.com/necromorphic/Logic-Engine/blob/main/src/core/rules.js), [sqlite-store.js](https://github.com/necromorphic/Logic-Engine/blob/main/src/storage/sqlite-store.js), [World Pack manifest schema](https://github.com/necromorphic/Logic-Engine/blob/main/schemas/world-pack-manifest.schema.json), [Core evaluation boundary](https://github.com/necromorphic/Logic-Engine/blob/main/docs/57-core-evaluation-recalculation-boundary.md), [TimeEngine boundary](https://github.com/necromorphic/Logic-Engine/blob/main/docs/07-knowledge-and-narrative-boundaries.md).

## 3. Normative World Pack schema identity

### 3.1 Exact type resolution

For a world pinned to World Pack `(world_pack_id, world_pack_version)`, Core MUST resolve an entity's `entity_type` to exactly one `entity_types[]` entry whose `type_id` equals that value byte-for-byte. No case folding, aliases, fuzzy matching, global fallback, or inference is allowed.

Zero matches, multiple matches, malformed definitions, or a type not declared in the pinned pack produce `UNKNOWN / SCHEMA_UNRESOLVED`; a write that attempts to assert or change spatial state MUST be rejected. Non-spatial writes to legacy/non-spatial entity types remain subject to existing Core behavior only if they do not claim spatial evidence.

### 3.2 Immutable identity

A schema identity for spatial interpretation is the tuple:

`(world_pack_id, world_pack_version, canonical_manifest_digest, canonical_entity_type_schema_digest, spatial_contract_id)`

The digest input MUST be canonicalized deterministically; object-key order and transport formatting MUST NOT change the digest. Reusing the same pack/version with changed canonical content is a version-immutability violation and MUST be rejected. A content change requires a new pack version. The spatial contract identifier for this revision is `position-v1`.

This is a normative requirement, **not a claim that the current runtime stores or verifies these digests**. The current audited world row stores pack ID/version only. The exact canonicalization algorithm, digest storage/evidence location, and migration of existing pack registrations require an owner decision before implementation; until then the schema identity is not proven and the spatial result is UNKNOWN.

### 3.3 Typed position and semantic metadata

A spatial field is supported only when the pinned entity-type `attributes_schema` explicitly declares the field and its semantic metadata. The accepted declaration MUST express:

- object with exactly `x`, `y`, `z`;
- all three required, numeric, finite values; no booleans, strings, nulls, arrays, missing coordinates, or unknown members;
- `spatial_semantics.contract = "position-v1"`;
- `frame = "world-enu-logical-v1"`, `handedness = "right"`, `x_axis = "+east"`, `y_axis = "+north"`, `up_axis = "+z"`, `units = "logical"`, `anchor = "entity-origin"`;
- the frame instance is interpreted only within the same `world_id`; cross-world coordinate comparison is unsupported.

No semantic default is inferred from an omitted field. Unsupported or contradictory metadata fails closed. The actual JSON Schema vocabulary/placement for `spatial_semantics` MUST be chosen to be accepted by the pinned schema validator; custom metadata MUST NOT be treated as validated merely because it is present in a JSON object. Until a validator and loader demonstrably consume this declaration, spatial status is UNKNOWN.

Other typed attributes are validated against the same exact pinned entity-type `attributes_schema` using the repository's supported schema-validation capability. No claim is made that the current bounded validators implement full JSON Schema 2020-12. If a schema feature is unsupported, the affected write is rejected rather than partially validated.

## 4. One authoritative spatial-validation boundary

### 4.1 Normative rule

The single authoritative spatial validation gate MUST execute inside the canonical Core commit transaction, before any event becomes accepted/valid and before canonical state/projections can be treated as committed. It MUST validate the full spatially relevant post-state, not only the incoming patch, against the pinned schema identity and current entity lifecycle.

This contract chooses the storage-backed canonical commit transaction as the non-bypassable acceptance boundary because the audited store exposes both direct `commit()` and `commitSegment()`, and the latter delegates each event to `commit()`. This is a contract choice for future implementation; current code does **not** yet enforce it.

The gate MUST be shared by all canonical write paths. A caller-side-only validation is insufficient. A new writer or alternate commit route is prohibited unless it enters the same gate.

### 4.2 Write-path matrix

| Path | Required enforcement | Current evidence / disposition |
|---|---|---|
| Ordinary event commit | Validate every entity create/update/upsert/delete spatial transition in the canonical `commit()` transaction before acceptance | `commit()` currently lacks World Pack spatial resolution; **not implemented** |
| Segment commit | Each segment event passes the same `commit()` gate; all segment effects and final rebuild are one transaction, or the contract must explicitly downgrade to per-event atomicity | `commitSegment()` wraps calls in `tx()`; nested transaction behavior suggests one SQLite transaction, but exact rollback-on-mid-segment failure requires an exact-head regression test; **not yet proven by this audit** |
| Replay/idempotent retry | Return the recorded result only for the exact same request identity/hash; never reinterpret a replay as a new spatial write. Conflicting key/hash is rejected | Existing replay/idempotency path exists; spatial provenance binding is **not implemented** |
| Projection rebuild/replay | Rebuild only from canonical events whose schema/contract evidence can be verified; replay in `commit_sequence` order under the exact historical schema identity | `rebuild()` replays valid events but does not currently revalidate spatial schema identity; **not implemented** |
| Rollback/retraction followed by rebuild | Invalidate every spatial result depending on invalidated events and rebuild only from still-valid canonical events; no stale projection may be served as current | Existing validity and rollback mechanisms exist, but spatial dependency invalidation is **not established** |
| Any alternate importer, migration, repair, or direct store writer | Must use the same gate or leave spatial status UNKNOWN and refuse to mark the result supported | Complete route inventory is **not established**; implementation cannot proceed until audited |

### 4.3 Failure and atomicity

If any spatially relevant effect in an ordinary commit fails validation, the entire canonical event/commit MUST be rejected; no part of that event may become valid, update the entity projection, advance the accepted spatial state, or be exposed as a supported position.

For a segment, the required target contract is all-or-nothing: if any event fails spatial validation, the whole segment, its event rows, projection changes, replay/idempotency record, and revision/sequence advancement MUST roll back together. The current implementation appears to wrap the segment in an outer `tx()`, but this guarantee is **not counted as confirmed** until tests demonstrate rollback after failure at the first, middle, and final segment positions, including failure during rebuild. If those tests fail, the segment path remains BLOCKED; no partial-segment behavior may be silently accepted as equivalent.

A failure MUST use the repository's approved error taxonomy; this document does not invent an error code. Failed or interrupted operations leave the spatial result UNKNOWN until a fresh coherent Core snapshot is obtained.

## 5. Entity lifecycle and identity continuity

Normative choice: **if continuity of an entity incarnation cannot be proved from canonical evidence, position is UNKNOWN.** The contract does not authorize ID reuse as identity continuity and does not introduce a new incarnation field in this documentation-only stage.

- `entity.create` is allowed only for a never-before-used entity ID in that world, consistent with the current create-ID reuse rejection.
- `entity.update` may modify only the existing live incarnation. It MUST NOT revive a destroyed tombstone.
- `entity.upsert` MUST NOT recreate or revive a destroyed ID, nor inherit any attributes or position from the prior tombstone. If current upsert behavior cannot distinguish a new incarnation safely, a tombstoned ID's upsert is rejected and position remains UNKNOWN.
- `entity.delete` creates a terminal tombstone for that identity. The deleted position is no longer a usable current position.
- Replay/rebuild MUST preserve this rule. Matching IDs, matching attributes, matching narrative, or event order alone do not prove that a new incarnation is the old one.

A separate durable incarnation identifier may later be proposed, but it requires an explicit architecture decision and changes to canonical evidence/storage. Until then, reuse after deletion is prohibited for spatially supported entities.

## 6. TimeEngine and state boundary

Three values remain distinct:

- `world_revision`: Core world-state revision;
- `commit_sequence`: monotonic order of accepted events within the world, used to order commits including events with equal game time;
- game-time coordinate: TimeEngine-owned in-world temporal coordinate.

Neither revision nor sequence is game time. Game time alone is not a unique state selector.

A spatial result MUST be bound to a coherent Core snapshot, including `(world_revision, commit_sequence)` where the current read contract supplies both, and to an exact confirmed TimeEngine boundary for historical/game-time queries. When multiple commits share the same game-time coordinate, the state order is `commit_sequence`; a query specifying only game time MUST NOT choose an arbitrary event or silently choose first/last. It returns UNKNOWN unless an existing TimeEngine contract supplies the exact boundary/selection rule.

If a time-advance operation is pending, interrupted, has an unknown outcome, or its confirmed boundary cannot be mapped to the Core snapshot, return UNKNOWN. Following rollback, any time-to-state mapping or derived result depending on invalidated events is invalidated and must be recomputed from confirmed surviving evidence. Do not interpolate or extrapolate.

The audited architecture assigns clock progression/triggers to TimeEngine and canonical state/commit to Core, but the inspected sources do not establish the exact durable link needed for every historical game-time query. The mapping contract and evidence source require Core + TimeEngine owner confirmation. No new clock, timestamp, scheduler, journal, or temporal persistence mechanism is authorized here.

## 7. Replay, rebuild, rollback, and historical schema

Initial commit and subsequent replay/rebuild MUST produce the same spatial status and value when given the same canonical event history, same validity/rollback state, same immutable schema identity, and same `position-v1` contract.

- Each event that asserts or changes spatial state must have verifiable evidence identifying the exact schema/contract under which it was accepted.
- Replay MUST use that historical schema identity, never the currently installed version by default.
- If historical schema content or validation evidence is missing, corrupt, ambiguous, or no longer available, the event may remain in history but MUST NOT yield a supported spatial value; return `UNKNOWN / HISTORICAL_SCHEMA_UNAVAILABLE`.
- A schema version change cannot reinterpret older events. Rebuild must either resolve the exact old schema identity or mark the dependent spatial result UNKNOWN.
- Rollback invalidates derived spatial results whose source events or required schema/time evidence were invalidated. Stale cached/projection results MUST NOT be returned as current.
- Restart and rebuild equivalence is a required future test, not a current guarantee.

The existing canonical event format/store has not been shown to persist the complete schema digest and validation evidence required above. Where that evidence cannot be represented by existing fields without ambiguity, an owner must separately approve a persistence/event-contract change before implementation. This documentation-only PR does not make that change.

## 8. Partial updates, deletion, and backward compatibility

| Input/history | Normative behavior |
|---|---|
| Old World Pack has no typed spatial declaration | Pack remains usable under existing non-spatial behavior; spatial status is `UNKNOWN / UNSUPPORTED`. |
| Generic `attributes.position`, `coordinates`, `location`, or similar fields without explicit typed declaration | Never spatial evidence; do not infer or coerce. |
| Old event's source schema is unavailable | Preserve event history; spatial status `UNKNOWN / HISTORICAL_SCHEMA_UNAVAILABLE`; no reinterpretation under current schema. |
| Schema migration | Requires a new immutable pack version and explicit migration rule/evidence. No automatic migration. |
| Version rollback | Restore the exact old schema identity if available; otherwise spatial status UNKNOWN. Do not relabel old data as valid under another version. |
| Partial update omits spatial field | Preserve current value only if the entity incarnation and full pre-state are verified under the same schema and the patch semantics mean “unchanged”; never fill missing coordinates from defaults. |
| Update provides only some of X/Y/Z | Reject the entire commit. |
| Explicit removal of spatial field via `remove_attributes` | Removal is allowed only as an explicit typed-schema-valid state transition; after commit, position becomes `UNKNOWN / POSITION_ABSENT`, not the old position. |
| Update changes schema/type or semantic metadata | Reject unless an explicit reviewed migration transition exists; no in-place reinterpretation. |
| Delete/tombstone | Position becomes UNKNOWN immediately; no later entity may inherit it. |
| Conflicting spatial evidence | Return `UNKNOWN / CONFLICT`; no arrival-order winner. |

A legacy migration must enumerate the source field, source schema/version, conversion rule, validation evidence, and resulting immutable pack version. Generic field names alone are not migration evidence.

## 9. Spatial result statuses

| Status | Meaning | Example causes |
|---|---|---|
| `SUPPORTED` | Complete validated position for a proven current incarnation at a coherent, confirmed state/time boundary | Exact schema and provenance verified; valid finite X/Y/Z |
| `UNKNOWN / POSITION_ABSENT` | No current typed position exists | Explicit removal; never declared |
| `UNKNOWN / UNSUPPORTED` | Entity type or legacy pack has no supported spatial declaration | Untyped legacy entity |
| `UNKNOWN / SCHEMA_UNRESOLVED` | Schema/type absent, ambiguous, invalid, unsupported, or not resolvable | Zero/multiple `type_id` matches |
| `UNKNOWN / SCHEMA_IDENTITY_UNPROVEN` | Pack/version exists but immutable content identity is not verified | Missing digest or changed content under same version |
| `UNKNOWN / INVALID_VALUE` | Spatial value is malformed or semantically invalid | Partial triple, string coordinate, non-finite number, unsupported frame |
| `UNKNOWN / IDENTITY_UNPROVEN` | Entity incarnation continuity cannot be proven | Tombstone reuse or ambiguous upsert |
| `UNKNOWN / HISTORICAL_SCHEMA_UNAVAILABLE` | Original schema/validation evidence is unavailable | Old event replay without source schema |
| `UNKNOWN / TIME_BOUNDARY_UNCONFIRMED` | Core state cannot be tied to a confirmed TimeEngine boundary | Pending/interrupted time operation; ambiguous game-time query |
| `UNKNOWN / STALE_SNAPSHOT` | Snapshot markers disagree or source state changed | Mixed revision/sequence or stale projection |
| `UNKNOWN / ROLLBACK_INVALIDATED` | Required source event/evidence was retracted or rolled back | Dependent event invalidated |
| `UNKNOWN / CONFLICT` | Valid evidence conflicts and no approved deterministic resolution exists | Competing committed positions |
| `REJECTED` | Proposed canonical write fails validation; no new spatial state is accepted | Bad schema/value, illegal tombstone reuse, partial coordinates |

`UNKNOWN` is not origin, zero, empty, or permission to infer. `REJECTED` describes the attempted write; after rejection, the previously committed state is usable only if its own currentness and provenance remain verified.

## 10. Acceptance matrix for future implementation

These are required future checks. They are **NOT RUN / NOT PASSED** by this documentation change.

| Test | Positive/negative criterion | Required evidence |
|---|---|---|
| Valid typed position | Accept only exact typed finite X/Y/Z and supported semantics | Test through canonical commit gate |
| Untyped generic `position` / `coordinates` | Never becomes spatial evidence | Negative commit/read test |
| Missing/unknown/ambiguous type schema | Reject spatial write; result UNKNOWN | Tests for zero and multiple matches |
| Same pack/version with changed content | Reject immutable identity violation | Digest/version immutability test |
| Unsupported `spatial_semantics` or unsupported validator keyword | Reject; no silent partial validation | Real loader + validator tests |
| Partial triple, unknown key, string/boolean/null/array/NaN/infinity | Reject entire commit | Boundary tests for each malformed form |
| Ordinary commit and alternate direct writer | No bypass around canonical gate | Route inventory plus negative bypass test |
| Segment first/middle/final event failure | No segment effects, projection, idempotency result, revision/sequence advance survive | Transaction rollback tests |
| Rebuild failure | No partially rebuilt spatial projection is served | Failure injection and recovery test |
| Replay same key/hash | Same recorded result; no re-interpretation | Idempotency test |
| Replay key with different request | Reject conflict | Negative replay test |
| Create/update/upsert/delete | Lifecycle rules preserved; deleted position not usable | Event lifecycle matrix |
| Upsert of tombstoned ID | Reject; no inherited position | Regression test |
| Partial update leaves field unchanged | Preserve only under proven same incarnation/schema and explicit patch semantics | Positive + stale-precondition tests |
| Explicit position removal | Commit removal; return POSITION_ABSENT | Removal test |
| Historical schema missing | UNKNOWN, never current-schema reinterpretation | Replay with missing old schema fixture |
| Same history commit vs rebuild/restart | Identical result under same schema evidence | Deterministic replay comparison |
| Rollback | All dependent spatial results invalidated | Rollback/rebuild test |
| Equal game-time commits | Ordered by commit_sequence; time-only ambiguous query UNKNOWN | TimeEngine/Core integration test |
| Pending/interrupted TimeEngine operation | UNKNOWN until confirmed mapping restored | Failure/recovery integration test |
| Cross-world or mixed snapshot markers | Reject/UNKNOWN | Negative snapshot tests |
| Memory/NPC consumer requests position | No new disclosure/integration path | Verify existing disabled/fail-closed gate remains unchanged |

## 11. Six review blockers mapped to this revision

| Blocker from review | Revision 2 disposition | Section | What is actually closed vs still required |
|---|---|---|---|
| 1. No single non-bypassable validation/commit boundary; segment/rebuild routes unclear | Normative canonical transaction gate; write-path matrix; all-or-nothing segment target | §4 | **Design rule closed for re-review. Runtime guarantee open:** gate absent; segment atomicity needs exact-head failure tests and route inventory. |
| 2. World Pack schema identity/type resolution not immutable | Exact `entity_type == type_id` rule, immutable tuple and fail-closed cases | §3 | **Semantic rule closed for re-review. Runtime guarantee open:** current code does not resolve/store/verify the full identity/digest. Digest canonicalization/evidence location needs owner approval. |
| 3. Delete/recreate can reuse ID and inherit position through upsert/rebuild | Unknown if continuity unproven; prohibit tombstone reuse for spatially supported entities | §5, §8 | **Safe fallback selected. Runtime enforcement open:** current projection key lacks incarnation identity; upsert/rebuild must be changed and tested before implementation can pass. |
| 4. No proven Core state ↔ confirmed TimeEngine boundary | Separate revision/sequence/game time; equal-time order; ambiguous/pending/rollback mapping returns UNKNOWN | §6 | **Fail-closed behavior defined. Mapping itself remains open:** Core + TimeEngine owner must identify existing durable confirmation evidence. No new mechanism authorized. |
| 5. Replay/rebuild/rollback can reinterpret old events or serve stale results | Historical schema identity/evidence required; no fallback to current schema; invalidation rules | §7, §8, §9 | **Determinism rule closed for re-review. Runtime guarantee open:** current events/store have not been shown to carry sufficient schema evidence or spatial invalidation. |
| 6. Schema semantics, transaction rejection, legacy compatibility and partial updates were underspecified | Validator requirements, statuses, whole-event rejection, segment atomicity target, legacy/update/removal matrix | §3.3, §4.3, §8, §9, §10 | **Normative outcomes closed for re-review. Runtime guarantee open:** schema validator capability, transaction tests, and migration/evidence mechanism require proof; no existing tests are claimed. |

## 12. Open architecture-owner decisions

These questions cannot be solved by prose alone and remain explicit pre-implementation gates:

1. **Schema digest canonicalization and evidence location:** approve the deterministic canonicalization algorithm and where exact historical manifest/type-schema digest plus validation contract identity can be verified. Existing world pack ID/version fields are insufficient by themselves.
2. **TimeEngine confirmation contract:** identify the existing authoritative record/operation that proves a game-time boundary is complete and maps it to Core `(world_revision, commit_sequence)`; define how same-game-time queries name a boundary. Do not create a new clock or journal implicitly.
3. **Segment transaction guarantee:** confirm by exact-head tests that the outer SQLite transaction rolls back all event, projection, revision/sequence, and idempotency changes after any mid-segment or rebuild failure.
4. **Schema validator support:** identify the actual runtime validator and confirm it validates the required schema dialect and rejects unsupported keywords/custom metadata rather than silently ignoring them.
5. **Migration policy:** approve whether legacy entities remain non-spatial indefinitely or may be migrated only through a new pack version with explicit evidence. No automatic backfill.
6. **Incarnation model:** this revision selects prohibition of tombstoned-ID reuse for supported spatial entities. If the product requires reuse, the architecture owner must separately approve a durable incarnation identity and its event/storage/replay changes; do not weaken this contract by inference.
7. **Canonical route inventory:** confirm all direct, segment, replay, rebuild, migration, repair, and import writers enter the same gate. The current source audit is bounded and does not prove exhaustiveness.

Until these decisions are recorded and required code/tests exist, spatial production implementation remains **BLOCK / NO-GO**.

## 13. Re-review gate and explicit non-claims

This revision records a coordinator decision on the previously open v1 axis/frame convention and is ready for a second architectural review. It is not approval of the missing runtime guarantees or implementation authorization.

- No production code or runtime behavior was changed by this revision.
- No ST-01–ST-16 or new acceptance test is claimed to have run.
- A green CI result, if any, is not evidence that the architecture guarantees above are implemented.
- Memory → NPC remains **DISABLED / FAIL-CLOSED**.
- Production implementation remains **NO-GO** until Core and TimeEngine owners resolve the open decisions, the real write paths and transaction guarantees are verified, and a separate implementation scope is approved.
