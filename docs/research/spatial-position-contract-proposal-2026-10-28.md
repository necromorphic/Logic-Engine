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

The permission to continue documentation-only drafting has already been granted. The remaining decisions are:

1. **Spatial/Product owner:** define the initial supported spatial scope and provide a rationale for dimensionality, coordinate frame(s), axes/handedness, units or discrete scale, and position anchor. If these requirements are not available, explicitly defer the choices and keep all unsupported positions unknown.
2. **Core owner:** confirm the exact existing committed evidence and coherent read boundary that a future derived projection may consume. If the current seam cannot prove the needed guarantees, record BLOCKED / NO APPROVED SEAM rather than adding an API or adapter in this task.
3. **Core owner:** specify the minimum identity/lifecycle guarantee needed to prevent cross-world contamination and position inheritance after deletion/recreation. Do not assume entity ID alone is sufficient without source evidence.
4. **Core + Time owner:** define the supported relationship between a committed Core state boundary and the existing TimeEngine game-time coordinate. Until the mapping is proven, historical reconstruction and interpolation remain unsupported.
5. **Core owner:** confirm how rollback/rebuild invalidates dependent derived results and what evidence is required to claim a result is fresh.
6. **Core owner:** retain explicit unknown, stale, conflict, and malformed/unsupported outcomes; do not resolve conflict heuristically.
7. **Architecture gate:** only after the above decisions and exact-SHA verification, decide whether to open a separate implementation request. This proposal does not authorize that implementation.

## 8. Safety and release gates

- Core remains the sole owner of canonical world state.
- TimeEngine remains the owner of game-time semantics.
- No production spatial integration is authorized.
- No new schema, API, event type/field, adapter, persistent projection, or runtime behavior is authorized.
- Spatial data does not prove that an NPC observed an event or knows/believes a fact.
- Memory→NPC remains `DISABLED / FAIL-CLOSED`.
- No ST-01–ST-16 test is reported as passed without actual execution.
- Any unresolved identity, provenance, frame, unit, temporal, or conflict question blocks treating a position as supported.

## 9. Core review — 2026-10-28

**Disposition: CONDITIONAL APPROVAL for the documentation contract direction; NOT approval of a production contract or implementation.**

### Core-owned decisions

1. **Canonical authority:** Core remains the sole authority for committed world state. A spatial position is not canonical merely because it appears in an entity attribute, event label, proposal, uncommitted effect, or derived projection.
2. **Minimum evidence rule:** Until a typed spatial source is separately approved and actually available, the Core answer to “where is this entity?” is **unknown / unsupported**, not a guessed interpretation of generic data.
3. **State boundary:** Any future derived result must be tied to a coherent, world-scoped Core state boundary. The existing composite marker `(world_revision, commit_sequence)` must be treated as a pair, not as interchangeable counters. The exact marker and read-consistency guarantee must be taken from the approved existing read path; this review does not create a new cursor or API.
4. **Time is separate:** Core revision/commit sequence does not substitute for TimeEngine's game-time coordinate. A historical spatial answer is unsupported unless the source provides a proven mapping to both the requested temporal point and the committed state boundary. Do not interpolate between boundaries by default.
5. **Rollback and rebuild:** Any derived spatial result that depends on invalidated source evidence must be invalidated or deterministically rebuilt. If that cannot be demonstrated using an approved seam, the result must remain stale/unknown and the consumer must fail closed.
6. **Provenance and conflicts:** A supported result must retain verifiable links to committed, still-valid source evidence. Missing, malformed, unsupported, stale, or conflicting evidence must not be collapsed into a supported position. No last-write-wins or arrival-order choice is approved by this review.
7. **No authority escalation:** This contract grants no observation, knowledge, belief, or disclosure authority to NPCs and does not change Memory→NPC, which remains DISABLED / FAIL-CLOSED.

These decisions align with the bounded existing-read experiment described in PR #529. That experiment validates only its source-read/replay/freshness boundary; it does **not** prove spatial semantics or authorize production integration.

### Decisions not owned by Core

Core does **not** select product-level spatial semantics without an explicit spatial/product requirement and supporting evidence. The following remain decision-needed: initial dimensionality (2D/3D), coordinate frame(s), axes and handedness, units/discrete scale, position anchor, whether local frames are needed, and whether entity IDs require an incarnation/generation distinction. Do not pick these from convention or from sample values. If the product scope cannot justify a choice, keep it open and do not treat positions as supported.

### Required revision before this proposal can be called decision-ready

- Replace the first requested decision in §7 (“confirm that a position contract may be developed as a documentation-only proposal”) with the Core decisions above; that permission has already been granted and is no longer the open question.
- Keep the product/spatial choices explicitly open until their owner supplies requirements.
- Before any implementation request, cite the exact current-main source and tests that establish the composite-marker/read consistency and rollback/rebuild guarantees, and record the executed verification output at the exact tested SHA. Existing PR #529 results may be cited only for the bounded experiment and its stated limits.
- Do not describe the draft as an approved contract, and do not start runtime/schema/API/event/adapter work under this approval.

## 10. Core source review and decision — 2026-10-28

**Decision: the existing bounded read seam is acceptable for future read-only investigation; a supported spatial position contract and production implementation remain BLOCKED.**

### Evidence checked on current `main`

- `src/storage/sqlite-store.js`, blob `c528805d40d77ac23c3adae866c97d9b97b606e8`: `readSnapshot()` reads the world revision, commit cursor and selected rows inside one SQLite read transaction. Its contract warns that returned data is raw internal data, not actor-authorized or model-safe.
- `src/application/engine.js`, blob `dcb8b84e54b29e8697f14eb7e709cc6e0cd65a13`: `getSnapshot()` delegates to `readSnapshot()`. Do not substitute `getState()` for this bounded read contract.
- `tests/snapshot-read.test.js`, blob `df92d1b88da2a5780f36cbce5358264e2661a9f0`: test source covers bounded world-scoped reads, a coherent SQLite read view under a concurrent/uncommitted writer, and rollback where `world_revision` changes while `commit_sequence` does not.
- `docs/architecture/core-source-authority-audit.md`, blob `cb3c58b2290f2f33c6d81c40975ca61805c3f8e6`: records the composite cursor as a freshness marker, not a source journal.
- `docs/13-event-type-contract.md`, blob `6bd40bd7afa9ecdc8f5e6a55ac1b830237352311`: event type is descriptive metadata, not authority or provenance.

This was source/test review only; **I did not execute tests during this review and do not claim a fresh CI pass**.

### Core decisions

1. **Read seam:** future read-only work may use `getSnapshot/readSnapshot`, retaining the complete pair `(world_revision, commit_sequence)`. This does not establish spatial meaning or authorize a new API.
2. **Freshness:** commit sequence alone is insufficient. Rollback may change world revision without increasing commit sequence.
3. **Derived/cache policy:** no persistent or cached spatial projection is approved. Until invalidation/rebuild for that projection is implemented and tested, recompute from the current snapshot or return unknown/stale.
4. **Position authority:** no typed, committed spatial source was established. Generic attributes, event labels and model-generated values are not proof. Core must return unknown/unsupported.
5. **Time:** Core revision/cursor is not game time. Historical position and interpolation are unsupported without a proven TimeEngine mapping.
6. **Entity lifecycle:** current evidence does not establish an incarnation/generation guarantee for delete-and-recreate identity reuse. Do not assume continuity.
7. **Disclosure:** no observation or NPC knowledge authority is granted. Memory→NPC remains `DISABLED / FAIL-CLOSED`.

### Explicitly unresolved (not guessable from current source)

The repository does not determine 2D vs 3D, axes/handedness, units/discrete scale, position anchor, local-frame support, or entity incarnation semantics. These require explicit spatial/product requirements. Until a typed committed source and these semantics are approved, no position may be treated as supported.

### Gate before any implementation proposal

A separate implementation request may be considered only after: (a) product semantics are defined; (b) typed source, provenance and lifecycle are identified; (c) Core/TimeEngine temporal binding is specified; and (d) tests are executed at an exact SHA for snapshot binding, rollback/rebuild and spatial validation. No runtime, schema, API, event, adapter, cache, or Memory/NPC change is approved here.
