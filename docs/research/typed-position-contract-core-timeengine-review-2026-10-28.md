# Typed Position Contract — Revised Draft after Coordinator Review

**Status:** DRAFT — READY FOR CONTRACT REVISION; NOT APPROVED FOR IMPLEMENTATION REVIEW  
**Date:** 2026-10-28  
**Authority:** Core decision for issue #351: A — permit contract preparation only  
**Scope:** Documentation and source audit only. No runtime, schema, API, event, adapter, storage, Memory, or NPC changes are authorized.

**Safety gates:** Production `NO-GO`; ST-01–ST-16 `NOT TESTED / NOT PASSED`; Memory → NPC `DISABLED / FAIL-CLOSED`.

## 1. Purpose and evidence rules

This draft defines a proposed contract for a derived, read-only 3D position view. The coordinator review dated 2026-10-28 found it **READY FOR CONTRACT REVISION**, not approved for implementation review. The review is a source-based coordinator assessment, not two separate owner-authored approvals. This revision records the known blockers and keeps unproven properties explicitly unresolved.

This document distinguishes:
- **Source-confirmed:** visible in the inspected Logic-Engine source or repository documentation.
- **Test evidence:** a named test exists; this draft does not claim it passed unless a run result is explicitly recorded.
- **Unverified requirement:** required by the contract but not demonstrated by the inspected runtime.
- **Owner decision:** requires explicit confirmation from Core or TimeEngine.

A field's presence in generic entity attributes, an event, or a World Pack manifest does not itself establish spatial meaning. Narrative or model output is never position evidence.

## 2. Proposed typed position

### 2.1 Position value

The conceptual value is:

```ts
type PositionV1 = {
  x: finite number;
  y: finite number;
  z: finite number;
};
```

This is a conceptual contract shape, not an existing API type or accepted runtime payload. A confirmed value requires exactly all three finite numeric coordinates. Reject booleans, strings, nulls, arrays, non-finite numbers, missing coordinates, and undeclared extra members.

### 2.2 Coordinate frame

The v1 semantics carried forward from the existing World Pack spatial contract proposal are:

- Three-dimensional, world-relative position.
- Right-handed coordinate frame.
- `+Z` points upward.
- Units are abstract logical units, not metres or another physical unit.
- Position refers to the declared `entity-origin`.
- No implicit scale, local frames, transforms, interpolation, or extrapolation.

**Open decision:** the source decision does not yet specify the direction of `+X` and `+Y`, the origin convention beyond the entity anchor, or the canonical coordinate-frame identifier. Therefore v1 must not transform or compare positions across coordinate frames until Core approves those details. The final contract must define `coordinate_frame_id`, axis orientation, origin convention, and compatibility rules.

Position is distinct from orientation, pose, and movement. Coordinates alone prove none of those concepts.

### 2.3 Identity and provenance variants

The record must not force event-backed and snapshot-backed provenance into one shape. These are conceptual design sketches only; they are not existing API types.

```ts
type CoreCursorV1 = {
  worldId: string;
  world_revision: number;
  commit_sequence: number;
};

type SnapshotPositionSourceV1 = {
  kind: "snapshot";
  cursor: CoreCursorV1;
  state_id?: string; // include only if the actual snapshot provides it
};

type EventPositionSourceV1 = {
  kind: "event";
  cursor: CoreCursorV1;
  source_id: string; // exact canonical event identifier, if present
  game_time_coordinate?: number;
};

type PositionRecordV1 = {
  entity_id: string;
  status:
    | "UNKNOWN"
    | "CONFLICT"
    | "STALE"
    | "ABSENT"
    | "UNSUPPORTED"
    | "CONFIRMED";
  position?: PositionV1;
  coordinate_frame_id?: string;
  source: SnapshotPositionSourceV1 | EventPositionSourceV1;
  schema_identity?: {
    world_pack_id: string;
    world_pack_version: string;
    canonical_manifest_digest?: string;
    canonical_entity_type_schema_digest?: string;
    spatial_contract_id: "position-v1";
  };
  // A TimeEngine boundary field may be added only after its durable
  // identity and mapping to the Core cursor are established.
};
```

Do not synthesize identifiers or fill unavailable fields merely to satisfy the sketch. The exact event ID, snapshot state ID, and schema digest fields must be used only if they exist and can be verified. The proposed schema identity tuple is not an implemented guarantee.

**Core finding:** `Engine.getSnapshot(id, request)` delegates to `store.readSnapshot`; `SQLiteStore.readSnapshot` reads the selected snapshot data in a SQLite read transaction and carries the world revision and commit cursor. This is a source-confirmed snapshot read path. It does not by itself establish that a separately fetched event list belongs to the same atomic boundary.

**Required separation:** Core consistency/freshness and TimeEngine temporal confirmation are independent proof obligations. A snapshot does not itself prove a confirmed TimeEngine boundary; a time coordinate does not identify a unique Core history cursor.

## 3. Position status semantics

| Status | Normative meaning | Required behavior |
|---|---|---|
| `UNKNOWN` | There is not enough confirmed evidence to determine the position or its absence. | Do not return coordinates; do not infer absence. |
| `CONFLICT` | Two or more applicable, confirmed sources disagree and no approved deterministic rule resolves the conflict. | Do not choose one source silently; withhold coordinates. |
| `STALE` | The source markers changed, the result no longer matches the current confirmed state, or freshness cannot be revalidated. | Invalidate the derived result; re-read/recompute only from a newly confirmed boundary. |
| `ABSENT` | The current confirmed state explicitly records that this entity has no position. | Return no coordinates. Do not use `(0,0,0)`. |
| `UNSUPPORTED` | The entity type, schema, coordinate frame, or source form is outside the supported contract. | Fail closed; do not reinterpret as v1. |
| `CONFIRMED` | Identity, schema, source provenance, position value, and temporal binding have all been verified against one consistent Core boundary and an approved TimeEngine boundary. | Coordinates may be exposed only to an independently authorized consumer. This status does not grant NPC perception or knowledge. |

Status precedence is **unapproved and unresolved**. The order shown in earlier drafts must not be treated as a Core guarantee. Keep all six labels as candidate vocabulary only; the contract cannot choose a precedence where multiple conditions apply until Core explicitly decides it. Regardless of precedence, `CONFIRMED` is forbidden unless every required identity, schema, source-consistency, and temporal-binding proof is available.

No status may be encoded as a default coordinate. A partial XYZ tuple is never a position.

## 4. Entity lifecycle and position removal

1. Removing a position attribute is not equivalent to destroying the entity.
2. `ABSENT` requires an explicit, valid removal/absence event or equivalent authoritative source semantics. A missing field in an incomplete snapshot is not proof of removal.
3. A confirmed destroy/tombstone means the prior position must not be reused as current.
4. The current evidence does not prove an immutable incarnation identity or complete no-reuse coverage across every writer/import/migration/recovery path. Treat ID reuse as a blocker; do not present the broader prohibition as an existing runtime guarantee. Any exception requires a separately approved incarnation model.
5. A tombstoned entity must not be revived by replay, rebuild, or an `entity.upsert`.
6. If lifecycle continuity cannot be proven, position status is `UNKNOWN` or `UNSUPPORTED`, not inherited from the old incarnation.

### Source evidence

The current Logic-Engine `main` contains a Core-side tombstone guard merged through PR #554. Its documented scope is to reject `entity.upsert` against a currently destroyed entity and to preflight valid history during rebuild; regression coverage was added for direct commit, rebuild, and atomic segment rollback. This closes one identity defect only. It does not establish an immutable incarnation identifier, spatial schema validation, or all-writer-path coverage. The current projection identity is documented as `(world_id, entity_id)`.

The existence of regression tests is not itself a claim that all current CI jobs passed in this review.

## 5. World Pack schema binding

A position is supported only if the entity type explicitly declares a supported typed position field in the exact World Pack schema pinned to that world.

The existing revision-2 World Pack contract proposes the immutable spatial schema identity:

`(world_pack_id, world_pack_version, canonical_manifest_digest, canonical_entity_type_schema_digest, spatial_contract_id)`

with `spatial_contract_id = "position-v1"`.

This tuple is a normative proposal, not an implemented runtime guarantee. The inspected world row contains `world_pack_id` and `world_pack_version`; those values alone do not prove immutable schema content, digest verification, or historical schema recovery.

Rules:
- Resolve `entity_type` to exactly one `type_id` in the pinned pack.
- No aliases, case-folding, fuzzy matching, global fallback, or automatic use of the latest schema.
- Unknown, ambiguous, malformed, incompatible, or unrecoverable schema means `UNKNOWN`/`UNSUPPORTED`; writes that claim spatial state must be rejected at the eventual approved canonical validation boundary.
- Replay/rebuild must use the same historical schema identity that governed the accepted event. It must not reinterpret old events under a newer schema.
- The exact digest canonicalization, storage location, schema-validator capabilities, and migration behavior require Core owner decisions.

## 6. Core read boundary and temporal binding

### 6.1 Existing read surface

The reviewed source confirms this Core snapshot path:
- `Engine.getSnapshot(id, request)` delegates to `store.readSnapshot`;
- `SQLiteStore.readSnapshot` reads selected data inside a SQLite read transaction and carries the world revision and commit cursor.

The API also exposes:
- `engine.getState(worldId)`;
- `engine.getEvents(worldId, include_invalid)`, with invalid events included only when explicitly requested.

The snapshot path is the preferred candidate for a consistent Core read because its selected data is read in a transaction. Do not assume that a separate `getEvents(worldId, false)` result is atomically paired with that snapshot. A single snapshot read also does not automatically provide the full event history or a TimeEngine confirmation.

Core source/docs distinguish:
- `world_revision`: revision of canonical world state;
- `commit_sequence`: per-world committed event order/cursor, distinct from revision and game time;
- game-time coordinate: temporal coordinate, not a unique history cursor.

The reviewed documentation notes that rollback can advance `world_revision` without advancing `commit_sequence`; therefore the cursor alone is insufficient to establish freshness. The pair is a Core snapshot marker, not a universal source-change journal.

### 6.2 Core read-boundary contract (proposed; not implemented by this draft)

1. Prefer one `getSnapshot`/underlying `readSnapshot` result when it contains the data needed for the query; preserve its returned Core markers as one unit.
2. If event history is also needed, do not silently combine a separately fetched event list with the snapshot. Establish an authoritative shared boundary or use a marker-check protocol only after its behavior is demonstrated for concurrent commit, rollback, and rebuild.
3. Treat a changed `world_revision` or `commit_sequence`, a failed boundary comparison, missing provenance, or an event list that cannot be tied to the snapshot as non-ready. Do not publish coordinates as `CONFIRMED`.
4. A double-read of state around an event read is a candidate feasibility check, not proof of atomicity under every concurrent transaction or rollback interleaving.
5. Do not write derived spatial data back to Core. No new API or storage mechanism is authorized by this documentation revision.

The contract must not assert a stronger consistency guarantee than the source and tests demonstrate. The reviewed source establishes a transactional snapshot read path; it does not establish atomicity between that snapshot and separately fetched events.

### 6.3 TimeEngine boundary

The reviewed source confirms that canonical TimeEngine coordinates are safe-integer milliseconds relative to the configured world epoch (`src/time/model.js`). The scheduler's `compareTriggers` orders due-work triggers by `due_coordinate`, then `trigger_id`. This is a deterministic tie-break for **due-work trigger planning only**; it is not proof of a global canonical order for all world events or commits.

A historical position may be reconstructed only if a confirmed temporal boundary can be tied authoritatively to the exact Core history being read. The following are not established by the reviewed model/planner source:
- a durable `confirmed_time_boundary_id`;
- a mapping from a confirmed time boundary to the exact pair `world_revision` + `commit_sequence`;
- a global ordering rule for all events sharing the same game-time coordinate;
- complete rollback/segment-invalidation, restart, deterministic replay, and older-backup recovery guarantees.

Accordingly:
- Do not require `confirmed_time_boundary_id` as though it were an existing field.
- Do not use game time, trigger ID, array order, or due-work trigger order as a substitute for Core event order.
- Do not claim historical reconstruction or rollback/restart recovery until a durable operation/segment source and current-head test evidence support the claim.
- Until the boundary-to-Core-cursor relationship is established, temporal binding is an unresolved blocker and the position cannot be `CONFIRMED`.

These are evidence limits, not a claim that TimeEngine lacks every such capability; the reviewed evidence did not prove them.

## 7. Rollback, rebuild, restart, and stale-result invalidation

A derived spatial view is in-memory, read-only, and disposable. It must never become a second canonical source of truth.

- Bind every computed result to the exact verified world, state cursor, source events, schema identity, and temporal boundary.
- Any detected source cursor change, rollback, validity change, schema mismatch, or failed reconciliation invalidates affected results.
- Rebuild must deterministically derive the same result from the same accepted event history and same immutable schema identity.
- A rebuild error must not publish a partial derived view.
- Restart recovery must rebuild from authoritative Core evidence; cached derived results alone cannot prove position.
- If rollback/rebuild changes which events are valid, the old projection must not remain eligible for use.
- If historical schema or temporal boundary cannot be recovered, return non-ready/unknown rather than reinterpret history.

These are required contract properties. They are not asserted as fully implemented for a spatial projection.

## 8. Test and evidence matrix

**Execution status:** no tests were run for the coordinator review or this documentation revision. No test is marked PASS. The matrix below uses IDs T01–T18; the coordinator report also references POS-01–POS-25 from an earlier version. These ID sets are not assumed to map one-to-one. Do not mark any case passed without exact current-head run evidence. “Existing test” means a source file or regression case was identified, not that it passed in the current run.

| ID | Scenario / input | Expected result | Existing evidence | Status |
|---|---|---|---|---|
| T01 | Same world, same accepted state and schema read repeatedly | Deterministic identical derived result | Core has projection/rebuild tests generally; no spatial determinism test identified | NOT RUN; spatial test not identified |
| T02 | Read state and events while another commit changes the world | Candidate discarded if cursor/boundary mismatch | Existing cursor checks appear in application flows; no proof that the pair of these reads is atomic | NOT RUN; atomicity unproven |
| T03 | Two different world IDs with similar entity IDs/coordinates | No cross-world data leakage | World-scoped store/API methods exist; no spatial isolation test identified | NOT RUN |
| T04 | Missing, ambiguous, changed, or unavailable World Pack schema | No confirmed position; spatial writes rejected at approved boundary | Revision-2 contract describes requirements; manifest currently declares generic `attributes_schema` object | NOT RUN; runtime gate unproven |
| T05 | Position contains only X/Y or has non-finite/non-numeric coordinate | Reject as typed position; never fill missing axis | Generic effect validation exists; no typed spatial validation identified | NOT RUN; spatial validator absent/unproven |
| T06 | Two confirmed sources disagree | `CONFLICT`, no coordinate chosen silently | No spatial conflict resolver/test identified | NOT RUN |
| T07 | Explicit position removal vs field missing from partial snapshot | Explicit removal → `ABSENT`; incomplete snapshot → `UNKNOWN` | Entity update supports attribute patch/removal in generic projection; spatial semantics not implemented | NOT RUN |
| T08 | Destroy entity, then `entity.upsert` same ID | Reject; old position not inherited | PR #554 merged; tombstone guard and regression tests exist for direct commit | Test exists; current run NOT RUN |
| T09 | Replay/rebuild history attempts tombstoned-ID reuse | Rebuild fails closed before publishing altered projection | PR #554 merged; rebuild preflight regression coverage exists | Test exists; current run NOT RUN |
| T10 | Segment has valid event followed by tombstone reuse | Entire segment rolls back atomically | PR #554 added atomic segment rollback test | Test exists; current run NOT RUN |
| T11 | Events have equal game-time coordinates but distinct commit order | Use confirmed commit order; no sorting by game time | Core schema stores `commit_sequence`; time-segment tests exist; TimeEngine mapping not confirmed | NOT RUN for spatial path |
| T12 | Rollback invalidates a source event after position derivation | Derived result invalidated; no stale result returned | Core rollback/event validity mechanisms exist; no spatial cache exists/test identified | NOT RUN |
| T13 | Restart with unchanged accepted history and schema identity | Rebuild yields same result; no cache-only trust | General persistence/rebuild paths exist; spatial restart test not identified | NOT RUN |
| T14 | Rebuild fails midway | No partial derived spatial view becomes available | Core rebuild is a projection rebuild; spatial model is not implemented | NOT RUN |
| T15 | Query inside an unconfirmed temporal segment | Unsupported/non-ready; no interpolation | Explicitly prohibited by Core decision | NOT RUN |
| T16 | Restore older database backup lacking schema/boundary evidence | No confirmed position until provenance is reconciled | No sufficient evidence found for TimeEngine/backup mapping | NOT RUN; owner evidence required |
| T17 | Entity ID is reused after deletion through any writer/import/migration path | Reject or return non-confirmed; no old-position inheritance | Tombstone guard covers known Core paths in PR #554; complete writer-path inventory not established here | NOT RUN; path coverage unproven |
| T18 | State cursor changes after computation but before consumer use | Mark `STALE`; do not publish | Existing app flows use cursor rechecks; no spatial consumer exists | NOT RUN |

### Test reporting rule

No row above is marked PASS. The tombstone cases have identified regression tests, but this task did not execute the test suite or independently inspect current CI results. Before any implementation decision, run the relevant existing tests against the exact candidate commit and add spatial-specific tests under a separately authorized implementation task.

## 9. Source findings by confidence

### A. Confirmed by inspected source/docs

1. The Logic-Engine exposes `getState(worldId)` and `getEvents(worldId, include_invalid)`; the API passes `include_invalid=true` only when explicitly requested. Therefore `getEvents(worldId, false)` is the intended valid-events read.
2. Event records include `commit_sequence`, `committed_revision`, game time, and game-time coordinate fields in the inspected commit path.
3. Core documentation distinguishes `world_revision`, `commit_sequence`, and game time, and warns that a snapshot cursor is not a universal source-version journal.
4. World Pack manifest schema declares `entity_types[]` with `type_id` and `attributes_schema`, but `attributes_schema` is generic at the inspected schema boundary.
5. `validateEffects` validates generic effect shape/attributes, not spatial semantics against a pinned World Pack schema.
6. The inspected `commit()` body checks canonical commit preconditions but does not itself resolve a World Pack entity schema or demonstrate spatial validation.
7. `commitSegment()` commits segment events through the Core store and rebuild path.
8. Rebuild replays valid events in `commit_sequence` order.
9. PR #554 is merged to main and documents a tombstone reuse guard plus regression cases for commit, rebuild, and segment rollback.
10. The architecture docs assign temporal progression/boundary semantics to Time/TimeEngine and canonical state/commit to Core.

### B. Requires confirmation from Core or TimeEngine

1. Whether the two permitted read methods can produce or verify one consistent boundary under concurrent commits, rollback, and rebuild.
2. Exact canonical identity and storage/recovery for immutable World Pack schema content/digests.
3. The authoritative TimeEngine confirmed-boundary record and mapping to Core cursors.
4. Equal-game-time ordering across Core and TimeEngine records.
5. Restart and old-backup restoration guarantees.
6. The authoritative event/source representation for explicit position removal.
7. Complete coverage of entity identity rules across import, migration, recovery, direct writers, and replay.
8. Canonical +X/+Y axes, coordinate-frame identifier, and origin convention.
9. Approved precedence among status outcomes where more than one condition applies.

### C. Not implemented or not evidenced by this audit

1. A production typed spatial validator bound to an immutable World Pack schema.
2. Runtime storage and verification of canonical manifest/schema digests.
3. A spatial read-only projection with source provenance and stale-result invalidation.
4. Spatial conflict detection/resolution.
5. Spatial-specific atomicity, replay, rollback, restart, and concurrency tests.
6. A durable entity incarnation identifier distinct from `entity_id`.
7. An established API contract for the TimeEngine confirmed boundary and historical reconstruction.
8. Any permission to pass spatial results to Memory or NPC.

## 10. Open questions for review

### Core
1. What exact method/path provides one authoritative consistent read, or can `getState` + `getEvents` be proven sufficient without changing APIs?
2. Where is the immutable World Pack manifest/type-schema digest recorded and how is it recovered historically?
3. What canonical event shape distinguishes explicit position removal from an incomplete/partial update?
4. Is entity ID reuse forbidden globally per world across all write/import/migration/recovery paths, and what test inventory proves it?
5. Which JSON Schema draft/features does the actual validator support, and how will spatial metadata be validated rather than merely stored?
6. Which exact source marker changes on rollback or event invalidation, and how does a consumer detect it?
7. What are the approved `+X`/`+Y` orientations, coordinate-frame ID, and origin convention?

### TimeEngine
1. What record is authoritative evidence of a confirmed time boundary?
2. How does that record map to the exact Core `world_revision` and `commit_sequence`?
3. What happens when multiple events share the same game-time coordinate?
4. How are boundary identities invalidated/replaced after rollback or segment failure?
5. What deterministic replay guarantees exist after process restart?
6. How does restoring an older database backup reconcile time-boundary records with Core history?
7. Are arbitrary historical queries within a segment explicitly unsupported, and how is that enforced by the contract?

## 11. Coordinator revision gate

The coordinator's source-based review disposition is **READY FOR CONTRACT REVISION**. This revised draft incorporates the documented distinctions and blockers:

- Use the transactional Core snapshot read path as the candidate consistent-read primitive; do not assume a separately fetched event list is atomically paired with it.
- Keep event-backed and snapshot-backed provenance separate; never fabricate IDs or digests.
- Treat the TimeEngine confirmed-boundary identity and mapping to the Core composite cursor as unresolved.
- Scope deterministic equal-time ordering to due-work trigger planning only.
- Treat World Pack immutable/historical schema identity, global entity incarnation coverage, status precedence, rollback/restart, and old-backup recovery as unproven until evidenced or separately decided.
- Preserve test statuses as NOT RUN unless exact run evidence is attached.

This is still a documentation proposal. It is not contract approval, implementation approval, or an implementation plan. The coordinator assessment is not represented as two independent owner-authored approvals.

No runtime/schema/API/event/adapter/storage changes are requested or authorized by this document.

**Status:** READY FOR CONTRACT REVISION  
**Production:** NO-GO  
**ST-01–ST-16:** NOT TESTED / NOT PASSED  
**Memory → NPC:** DISABLED / FAIL-CLOSED
