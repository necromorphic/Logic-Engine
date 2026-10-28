# Typed Position Contract — Draft for Core and TimeEngine Review

**Status:** DRAFT — READY FOR CORE/TIMEENGINE REVIEW; NOT APPROVED FOR IMPLEMENTATION  
**Date:** 2026-10-28  
**Authority:** Core decision for issue #351: A — permit contract preparation only  
**Scope:** Documentation and source audit only. No runtime, schema, API, event, adapter, storage, Memory, or NPC changes are authorized.

**Safety gates:** Production `NO-GO`; ST-01–ST-16 `NOT TESTED / NOT PASSED`; Memory → NPC `DISABLED / FAIL-CLOSED`.

## 1. Purpose and evidence rules

This draft defines the proposed contract for a derived, read-only 3D position view. It must be reviewed by Core and TimeEngine before any implementation decision.

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

### 2.3 Identity and provenance envelope

A confirmed derived record must conceptually carry:

```ts
type PositionRecordV1 = {
  worldId: string;
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
  source: {
    kind: "event" | "snapshot";
    source_id: string;
    state_id?: string;
    world_revision: number;
    commit_sequence: number;
    game_time_coordinate?: number;
    confirmed_time_boundary_id?: string;
    world_pack_id: string;
    world_pack_version: string;
    canonical_manifest_digest?: string;
    canonical_entity_type_schema_digest?: string;
    spatial_contract_id: "position-v1";
  };
};
```

This is a **design sketch only**. Field names and availability must be matched to actual Core and TimeEngine contracts. In particular, this draft does not assert that a `state_id`, confirmed boundary ID, immutable schema digest, or historical schema lookup currently exists. A field may not be fabricated to satisfy the shape. If required provenance cannot be obtained and verified, the status cannot be `CONFIRMED`.

Do not combine a state from one revision with events from another revision. The current read methods are separately callable; their combined atomicity is not established by their names.

## 3. Position status semantics

| Status | Normative meaning | Required behavior |
|---|---|---|
| `UNKNOWN` | There is not enough confirmed evidence to determine the position or its absence. | Do not return coordinates; do not infer absence. |
| `CONFLICT` | Two or more applicable, confirmed sources disagree and no approved deterministic rule resolves the conflict. | Do not choose one source silently; withhold coordinates. |
| `STALE` | The source markers changed, the result no longer matches the current confirmed state, or freshness cannot be revalidated. | Invalidate the derived result; re-read/recompute only from a newly confirmed boundary. |
| `ABSENT` | The current confirmed state explicitly records that this entity has no position. | Return no coordinates. Do not use `(0,0,0)`. |
| `UNSUPPORTED` | The entity type, schema, coordinate frame, or source form is outside the supported contract. | Fail closed; do not reinterpret as v1. |
| `CONFIRMED` | Identity, schema, source provenance, position value, and temporal binding have all been verified against one consistent Core boundary and an approved TimeEngine boundary. | Coordinates may be exposed only to an independently authorized consumer. This status does not grant NPC perception or knowledge. |

Status precedence proposal: if evidence is unsupported, return `UNSUPPORTED`; if source consistency is lost, return `STALE`; if confirmed evidence conflicts, return `CONFLICT`; if an explicit position removal is confirmed, return `ABSENT`; if evidence is insufficient, return `UNKNOWN`; use `CONFIRMED` only after all proof obligations pass. **Core must approve this precedence**; it is not an existing runtime behavior.

No status may be encoded as a default coordinate. A partial XYZ tuple is never a position.

## 4. Entity lifecycle and position removal

1. Removing a position attribute is not equivalent to destroying the entity.
2. `ABSENT` requires an explicit, valid removal/absence event or equivalent authoritative source semantics. A missing field in an incomplete snapshot is not proof of removal.
3. Destroying an entity terminates its identity. Its prior position must not be reused as current.
4. Reuse of the same `entity_id` in the same world is prohibited unless a separately approved incarnation model defines a new identity.
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

The API source exposes:
- `GET .../state` through `engine.getState(worldId)`;
- `GET .../events` through `engine.getEvents(worldId, include_invalid)`, where invalid events are included only when `include_invalid=true`.

The proposed feasibility check may call `getState(worldId)` and `getEvents(worldId, false)`, as authorized by Core. These are read operations; they do not themselves prove that the pair forms one atomic snapshot.

Core source/docs distinguish:
- `world_revision`: revision of canonical world state;
- `commit_sequence`: per-world committed event order/cursor, distinct from revision and game time;
- game-time coordinate: temporal coordinate, not a unique history cursor.

The existing documentation explicitly warns that `world_revision + commit_sequence` identifies a Core snapshot boundary, not a universal source-change journal. The spatial model must not infer freshness from `commit_sequence` alone.

### 6.2 Required read protocol (proposed; not implemented by this draft)

1. Read a candidate state and record its world identity, `world_revision`, and `commit_sequence`.
2. Read valid events for that same world.
3. Verify every event used belongs to that world and has valid status and verifiable source identity.
4. Re-read the state cursor and compare it with the initial cursor.
5. If the cursor changed, or if state/event history cannot be shown to correspond to the same boundary, discard the candidate and return `STALE`/non-ready.
6. Do not expose a partial result. Do not write anything back to Core.

This double-read check is only a possible feasibility technique. It does not prove atomicity against every concurrent transaction or rollback interleaving. Core must identify an authoritative consistent-read primitive or demonstrate through tests that the permitted methods can meet the required guarantee. No new API is authorized here.

### 6.3 TimeEngine boundary

A historical position may be reconstructed only at a confirmed temporal boundary whose mapping to Core history is authoritative. Arbitrary interpolation inside an unconfirmed segment is out of scope.

TimeEngine must define or confirm:
- the authoritative boundary record/identifier;
- mapping to `world_revision` and `commit_sequence`;
- event ordering when game-time coordinates are equal;
- behavior on rollback and segment invalidation;
- deterministic rebuild behavior;
- restart recovery;
- recovery against an older database backup.

Core event order must come from confirmed `commit_sequence`, not from game time or array order. The repository documents `commit_sequence` as per-world and distinct from `world_revision` and game time, but the inspected evidence does not establish TimeEngine's full confirmed-boundary mapping or older-backup guarantees.

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

**Execution status at preparation time:** no tests were run as part of this documentation/source-audit task. “Existing test” means a source file or regression case was identified, not that it passed in the current run.

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

## 11. Review gate

This draft is ready to be reviewed by Core and TimeEngine because it states a proposed contract and makes gaps explicit. It is not a final approval and not an implementation plan.

No runtime/schema/API/event/adapter/storage changes are requested or authorized by this document.

**Status:** READY FOR CORE/TIMEENGINE REVIEW  
**Production:** NO-GO  
**ST-01–ST-16:** NOT TESTED / NOT PASSED  
**Memory → NPC:** DISABLED / FAIL-CLOSED
