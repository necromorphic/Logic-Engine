# Draft: Typed Spatial Position Contract — for Core review

**Status:** PROPOSAL ONLY — NOT AN APPROVED CONTRACT  
**Date:** 2026-10-28  
**Related work:** Issue #351; draft PR #529; Core decision recorded in [Issue #351](https://github.com/necromorphic/Logic-Engine/issues/351#issuecomment-6454837732)

## 1. Purpose and decision boundary

This document prepares a reviewable proposal for the minimum semantics of an entity position. It does not define a production schema, API, event type, adapter, storage layout, or runtime behavior. No implementation is authorized by this document.

The current source review found generic entity attributes and committed event/effect records, but did not establish a typed, committed spatial source that defines coordinate frame, units, position anchor, and temporal validity. Generic `attributes_json` and `event_type` are not spatial proof. Existing read/replay tests verify a bounded source boundary, not spatial semantics.

The contract must be approved by Core before any later implementation task is opened. Unresolved choices below must remain explicit; consumers must not infer answers from sample values or naming conventions.

## 2. Required semantic definition

A position value can be treated as supported only when its meaning and provenance are unambiguous for a particular entity and world at a supported state boundary.

The contract proposal must define:

1. **World and entity identity**
   - The world/session scope to which the entity belongs.
   - How the position is bound to the entity's stable identity.
   - Behavior for missing, removed, recreated, or identity-conflicted entities.
   - Whether any entity incarnation/generation distinction is needed; this remains undecided.

2. **Coordinate frame**
   - Whether coordinates are world-relative, local to a named parent/frame, or support more than one frame.
   - The frame's origin, axis names and directions, and handedness.
   - If local frames are supported, how the frame/parent identity and any required transform are evidenced.
   - No default frame may be inferred from a field name or coordinate tuple.

3. **Dimension and units**
   - The supported dimensionality for the initial contract.
   - The unit or discrete scale for each dimension, conversion rules if any, precision, and valid numeric domain.
   - Whether fractional, negative, or out-of-range values are valid.
   - Metric units and abstract/logical units are alternatives for owner review, not current assumptions.

4. **Position anchor**
   - What point the position denotes: for example, entity origin, foot/contact point, centre, or another explicitly defined anchor.
   - Whether different entity types may use different anchors, and if so how the anchor is identified.
   - A position must not silently mix anchors.

5. **Temporal binding and freshness**
   - Which committed Core state/revision/cursor the value describes.
   - How it relates to an existing TimeEngine-confirmed temporal coordinate or boundary, where such a mapping is actually supported.
   - Whether the value is a point observation, a state valid until superseded, or another explicitly defined temporal form.
   - Rules for stale detection, concurrent changes, rollback, rebuild, and unsupported temporal combinations.
   - Core revision/cursor and game-time coordinate are different concepts; neither may substitute for the other without an approved mapping.

6. **Provenance and authority**
   - Which committed source/effect establishes the position and how that evidence is referenced.
   - How rejected, uncommitted, invalidated, or conflicting evidence is excluded.
   - Whether source authority differs by source type and which owner approves that authority.
   - A cursor establishes a freshness boundary only to the extent guaranteed by Core; it does not by itself establish the meaning or truth of coordinates.

7. **Unknown and conflict behavior**
   - Distinguish at minimum: absent/unknown, stale, conflicting, malformed/unsupported, and supported.
   - State whether partial coordinates are representable or must remain unknown.
   - Conflicting evidence must not be resolved by arrival order, arbitrary priority, or a guessed interpolation unless a separate approved rule explicitly authorizes it.
   - Failure to validate provenance, identity, frame, units, or temporal binding must fail closed to non-position / unknown.

## 3. Open choices for Core review

These are questions, not implicit defaults.

| Decision | Candidate directions | Required decision criterion |
|---|---|---|
| Initial dimensionality | 3D-only; a typed 3D model with explicitly bounded lower-dimensional use | Must fit the approved logical-space scope without inventing coordinate semantics |
| Frame model | One world frame; named world and local frames | Must identify origin/axes and avoid implicit transforms |
| Units | One canonical metric unit; explicit logical/discrete units; another justified choice | Values must be comparable only when units match or an approved conversion exists |
| Position anchor | One universal anchor; explicit anchor by entity class | Must prevent incompatible anchors from being compared as if equivalent |
| Validity model | Point-in-state; valid-until-superseded; other bounded rule | Must define freshness and invalidation under commit and rollback |
| Evidence binding | Direct reference to committed evidence; another Core-approved proof reference | Must be reproducible and verifiable against authoritative Core state |
| Entity lifecycle | Entity ID alone within world; ID plus an incarnation/generation rule | Must prevent position from leaking across delete/recreate boundaries |
| Conflict policy | Preserve conflict/unknown; owner-approved deterministic precedence where justified | Must not silently pick a position without an authority rule |

The proposal should recommend a minimal choice only after the repository evidence and Core ownership constraints support it. If evidence cannot select among candidates, the document must leave the decision open for Core.

## 4. Non-goals and explicit exclusions

This position proposal does not approve or define:
- movement paths, transition semantics, continuity, speed, or teleportation;
- orientation, angle units, reference frames, or normalization;
- pose composition or validity;
- reconstruction of arbitrary positions inside a TimeEngine segment;
- automatic interpolation or extrapolation;
- scene completeness, line of sight, observation, NPC knowledge, or belief;
- persisted spatial projections, new tables, public APIs, runtime receivers, event fields/types, or adapters;
- any Memory Provider, Host, NPC, vectorization, or Memory→NPC change.

These require separate evidence and decisions. Spatial output remains a derived interpretation and cannot become canonical world state.

## 5. Minimum review and verification matrix

These are proposed acceptance cases for a later contract implementation. They are not claimed to have run, and passing synthetic fixtures would verify only the stated contract mechanics—not establish that production sources provide spatial evidence.

| Case | Expected contract behavior |
|---|---|
| No position evidence | Position remains unknown |
| Generic attribute happens to contain `x/y/z` | Not accepted as typed evidence without an approved mapping |
| Unknown coordinate frame or unit | Unsupported/unknown; no comparison or conversion |
| Entity belongs to another world | Reject binding; never cross-contaminate worlds |
| Entity missing or removed | No current position unless an approved lifecycle rule establishes otherwise |
| Entity deleted and recreated with reused ID | Must not inherit old position unless identity semantics explicitly prove continuity |
| Evidence comes from rejected/uncommitted change | Excluded |
| Source event is invalidated by rollback | Any conclusion depending only on it becomes stale/invalid |
| Core state changes during source read | Reject inconsistent batch; do not publish a mixed-state result |
| Conflicting positions without approved authority rule | Preserve conflict/unknown; do not choose heuristically |
| Malformed or partial coordinate value | Apply explicit validation rule; fail closed if unsupported |
| Unsupported TimeEngine/Core boundary combination | Refuse reconstruction rather than interpolate |
| Same evidence replayed twice | No semantic duplication; deterministic result |
| NPC or Memory consumer requests position | This contract grants no NPC disclosure or observation authority |

ST-01–ST-16 remain NOT TESTED / NOT PASSED unless implemented and actually executed with recorded commands and output.

## 6. Evidence boundary

Current research recorded in PR #529 identifies these existing paths:
- `src/storage/sqlite-store.js`: generic entity `attributes_json` and event/effect metadata.
- `src/application/engine.js`: existing bounded read methods `getState`, `getSnapshot`, and `getEvents`.
- `src/core/rules.js`: generic effect validation, not a typed spatial contract.
- `docs/13-event-type-contract.md`: `event_type` is descriptive metadata, not authority.
- `docs/07-knowledge-and-narrative-boundaries.md`: spatial semantics are an investigation, not an implemented typed contract.

These are the evidence boundaries of the current research, not a claim that every repository path has been exhaustively searched. The PR #529 read/replay/freshness spike does not prove coordinate semantics.

## 7. Decisions requested

Core review is requested on the following, in order:

1. Confirm that a position contract may be developed as a documentation-only proposal within the constraints above.
2. Select or request evidence for the initial dimensionality, coordinate frame model, units, and position anchor.
3. Decide the minimum identity/lifecycle and temporal-validity guarantees needed before a position can be considered supported.
4. Identify the authoritative evidence/provenance form available in Core, or state that the required source does not yet exist.
5. Approve explicit unknown/stale/conflict behavior.
6. Confirm whether the proposal is ready for a separate implementation request after these decisions; this document itself grants no implementation permission.

## 8. Safety and release gates

- Core remains the sole owner of canonical world state.
- TimeEngine remains the owner of game-time semantics.
- No production spatial integration is authorized.
- No new schema, API, event type/field, adapter, persistent projection, or runtime behavior is authorized.
- Spatial data does not prove that an NPC observed an event or knows/believes a fact.
- Memory→NPC remains `DISABLED / FAIL-CLOSED`.
- No ST-01–ST-16 test is reported as passed without actual execution.
- Any unresolved identity, provenance, frame, unit, temporal, or conflict question blocks treating a position as supported.
