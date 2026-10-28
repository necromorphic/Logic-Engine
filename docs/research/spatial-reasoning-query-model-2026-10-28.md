# Spatial Reasoning Query Model — Research Draft

**Date:** 2026-10-28  
**Status:** Research proposal only; not an approved runtime contract  
**Scope:** Define what “3D reasoning” means above canonical world data, which questions can be answered from which evidence, and how ambiguity must be represented.  
**No authorization:** No Core/TimeEngine runtime, schema, API, event, adapter, storage, Host, Memory, or NPC changes. Production remains NO-GO; Memory → NPC remains DISABLED / FAIL-CLOSED.

## 1. Purpose

The spatial/temporal model should answer explicit questions about a world state, not merely store triples of coordinates. A query result is valid only when the inputs are drawn from one coherent, world-scoped, confirmed Core state and the requested operation's required spatial semantics are present.

This document complements, rather than replaces:
- [World Pack typed spatial attributes contract](world-pack-typed-spatial-attributes-contract-2026-10-28.md), which proposes the typed position source and validation boundary.
- [Spatial position independent review](spatial-position-contract-independent-review-2026-10-28.md), which lists provenance, schema, lifecycle and temporal blockers.
- [Spatial/Temporal evidence report PR #529](https://github.com/necromorphic/Logic-Engine/pull/529), which documents the bounded read-only feasibility path and its limits.

The design direction is World Pack-owned typed semantics, Core-owned canonical state/commit, and TimeEngine-owned temporal progression. A spatial projection is derived/read-only; it does not become a second authority for world state.

## 2. Reasoning layers

| Layer | Input evidence | Operations it can support in principle | It cannot establish by itself |
|---|---|---|---|
| L0 — entity/state inventory | Coherent Core state, entity identity/status | Which entities are present in the selected state; whether a typed position is available | Any location from a name, narrative, generic attribute or missing field |
| L1 — point position | Confirmed typed `position-v1` in the agreed frame | Exact coordinates; axis-aligned relative comparisons; point-to-point distance and displacement | Physical size, collision, containment, visibility, reachable path |
| L2 — temporal change | Confirmed positions at two supported Core/TimeEngine boundaries | Displacement vector; distance travelled between samples as a lower bound only when justified by the contract; “position changed” | Actual path, speed, continuous motion, teleportation, intermediate positions |
| L3 — orientation | Separately typed and validated orientation with explicit representation/convention | Facing direction; orientation comparison; relative bearing when all conventions are known | Body shape, gaze/attention, line of sight, pose or perception |
| L4 — pose/geometry | Typed pose plus shape/extent/geometry definitions | Occupied volume approximation, geometric intersection and collision tests if the geometry model is approved | Collision physics, animation, articulation or physical realism beyond the supplied model |
| L5 — spatial environment | Typed rooms/regions/obstacles/portals/nav graph in the same frame and version | Containment, adjacency, occlusion, route planning, reachability | Unrecorded doors, moving obstacles, physical accessibility, sensory knowledge |
| L6 — observer-relative result | Spatial state plus explicit observer capabilities, occlusion and perception rules | Whether an observer could have line of sight under the model's assumptions | Whether an NPC actually noticed, understood, remembered or knows something |

L0–L1 are the first useful target. L2 requires temporal boundary mapping. L3–L5 need separate typed contracts; they must not be inferred from position. L6 is not an authorization to create NPC memories and remains outside Memory → NPC.

## 3. Query catalog and minimum evidence

### 3.1 Queries supportable from position alone, once position-v1 is implemented and approved

| Query | Deterministic definition | Minimum evidence | Result limit |
|---|---|---|---|
| `position(entity, boundary)` | Return the one confirmed position for the entity at the exact supported boundary | Typed position, schema identity, entity continuity, coherent Core marker and boundary mapping | UNKNOWN if the position or exact boundary cannot be proven |
| `distance(A, B, boundary)` | Euclidean point distance: `sqrt((Ax-Bx)^2+(Ay-By)^2+(Az-Bz)^2)` | Two confirmed positions in the same world, frame, units and boundary | Distance between entity origins, not between object surfaces |
| `relative_delta(A, B, boundary)` | Vector `B - A` | Same as distance | Vector direction is coordinate-frame-relative, not a natural-language direction until frame axes are fixed |
| `axis_relation(A, B, axis, boundary)` | Compare the two coordinate values on a named axis | Same as distance; axis must be X, Y or Z | “North/east/above” labels only after the frame convention is approved and applied |
| `nearest(entity, candidate_set, boundary)` | Rank confirmed point distances; preserve equal-distance ties | Confirmed source position and complete, explicitly scoped candidate set | Cannot claim “nearest in the world” if the candidate inventory is incomplete or filtered without saying so |

For this project, the documented convention is +X = logical east, +Y = logical north, +Z = up; right-handed ENU, abstract logical units, entity-origin anchor, frame ID `world-enu-logical-v1` scoped by world identity. This is recorded in draft PR #565, not yet independent contract approval.

### 3.2 Queries requiring additional typed semantics

| Query | Additional evidence required | Must not be guessed from |
|---|---|---|
| `moved(A, boundary_1, boundary_2)` | Two confirmed positions and an approved temporal boundary-to-Core-cursor mapping | Event text, differing timestamps alone, unconfirmed scheduler plans |
| `movement_vector(A, t1, t2)` | Same as above | A single position, orientation, or a presumed straight path |
| `speed(A, t1, t2)` | Approved time units/interval semantics, comparable position samples, explicit rule for displacement vs path length | Logical distance alone or wall-clock elapsed time |
| `orientation(A, boundary)` / `facing(A, B)` | Typed orientation representation, frame, axis/order, units, normalization and anchor semantics | Position delta unless the contract explicitly defines orientation from it |
| `pose(A, boundary)` | Typed pose schema, reference frame and required components | Position or orientation alone |
| `inside(A, region)` | Region geometry and boundary/inclusion convention in same frame | Names such as “in the office” or proximity |
| `intersects(A, B)` / `collides(A, B)` | Shape/extent definitions, geometry semantics, collision rule and same boundary | Point distance alone |
| `line_of_sight(A, B)` | Observer/target geometry plus complete relevant occluder set and visibility rules | Position alone |
| `reachable(A, B)` / `route(A, B)` | Navigation graph or approved obstacle/path model, traversal constraints and current obstacle state | Straight-line distance or absence of a known obstacle |
| `observed_by(NPC, event)` / `knows(NPC, fact)` | Independent observer acquisition and Memory/NPC authorization contracts | World-side location, line of sight, or a spatial snapshot alone |

### 3.3 Boundary rule

Historical queries are supported only at a boundary for which the implementation can prove the exact mapping to a Core composite marker. An arbitrary game-time coordinate is not automatically a reconstructable world state. Do not interpolate or extrapolate between samples in v1. If multiple commits share a game-time coordinate, use the exact approved commit cursor; a time-only query that cannot identify the intended boundary is ambiguous.

### 3.4 Entity continuity: confirmed source-level guard, spatial proof still incomplete

A read-only review of Core at `main` source revision `80cbc54fb174a8074088ee9234524e401b7dbb68` found existing entity identity safeguards:

- `entity.create` rejects an identity already present, including a destroyed tombstone (`ENTITY_ALREADY_EXISTS`).
- `entity.upsert` rejects a destroyed identity (`ENTITY_TOMBSTONE_REUSE`).
- Projection rebuild validates valid event history and rejects identity reuse or resurrection after a tombstone (`ENTITY_HISTORY_ID_REUSE`, `ENTITY_HISTORY_TOMBSTONE_REUSE`).
- The documented safe path after terminal destruction is a new `entity_id`, unless the destroying event is itself validly retracted/rolled back through Core's canonical event lifecycle.

This narrows the spatial lifecycle risk: the current canonical Core path already prevents ordinary reuse of a destroyed entity ID. It does **not** prove spatial continuity by itself. A confirmed spatial point still needs typed position provenance, exact schema identity, a supported temporal boundary, and a coherent current marker. Generic attributes on an entity remain untyped. These safeguards were inspected in source; this paragraph does not claim a new test was run.

## 4. Result contract for reasoning

The result state is as important as the computed value. Proposed statuses:

- `CONFIRMED`: required evidence is typed, schema-resolved, coherent, current for the requested boundary, and sufficient for this exact operation.
- `UNKNOWN`: required evidence is missing or the requested boundary cannot be resolved.
- `CONFLICT`: multiple incompatible valid claims remain and no approved resolution rule selects one.
- `STALE`: the Core marker changed during the read, or the result no longer matches the requested current marker.
- `ABSENT`: an authoritative source explicitly establishes that the requested property is unset/removed. A missing field in a partial snapshot is not proof of absence.
- `UNSUPPORTED`: the operation requires a semantic type or geometry model not implemented/approved for the selected world/schema.

No fallback to `(0,0,0)`, latest-looking record, nearest schema version, natural-language guess, or model-generated coordinate is allowed. A successful computation does not upgrade weak input evidence: for example, a numerically valid distance between two UNKNOWN positions is not a confirmed distance.

Every returned result should retain, at minimum, the requested world and boundary, the Core marker used (`world_revision`, `commit_sequence`, game-time coordinate where available), source entity IDs, relevant source event IDs where applicable, exact schema identity, operation/version, and status. These are logical requirements only; this document does not prescribe new runtime fields.

## 5. Deterministic evaluation rules

1. Bind every query to one world identity and one explicit state/boundary.
2. Read only canonical accepted evidence through the already-approved read-only feasibility seam. Do not write derived spatial results into Core.
3. Validate the pre/post state markers around the read. If markers differ, discard the whole candidate result and retry or return STALE.
4. Use `commit_sequence` for canonical commit order; do not substitute game-time order.
5. Reject cross-world, mixed-frame, mixed-unit, unresolved-schema, destroyed-identity, or stale inputs.
6. Treat the candidate set as part of query meaning. A nearest result over a bounded list must say that the list was bounded; it is not a world-wide nearest result.
7. Preserve ties. Deterministic presentation may sort tied IDs for stable output, but must not pretend one tied entity is uniquely nearer.
8. Do not infer a path from endpoints, collision from points, containment from names, or NPC knowledge from world state.
9. Keep the projection disposable and in-memory for the approved feasibility experiment. No persistence, new API, schema, event or consumer integration is authorized here.
10. On rollback/rebuild, never reuse a previously derived result without revalidating its source marker and validity lineage.

## 6. Acceptance scenarios for the reasoning layer

These are proposed scenario IDs for a future test-only harness; they are NOT executed tests and do not replace POS-01–POS-25 or ST-01–ST-16.

| ID | Scenario | Expected outcome |
|---|---|---|
| SRQ-01 | Two confirmed points, same world/frame/units/boundary | Deterministic Euclidean point distance and delta |
| SRQ-02 | One position lacks X, Y or Z | Write rejected if enforced; otherwise query UNKNOWN/UNSUPPORTED; never fill missing axis with zero |
| SRQ-03 | One point comes from a different world/frame/unit set | Reject as UNSUPPORTED/UNKNOWN; no implicit transform |
| SRQ-04 | Two equally near candidates | Return a tie set; stable presentation order only |
| SRQ-05 | Candidate inventory is bounded/incomplete | Result explicitly scoped; no “nearest in world” claim |
| SRQ-06 | Marker changes between state/event reads | Discard candidate result; STALE or bounded retry |
| SRQ-07 | Two confirmed boundaries show different positions | Position changed/displacement may be computed; no path or teleport claim |
| SRQ-08 | Same game-time coordinate has multiple commits | Resolve by exact approved cursor or return ambiguous/UNKNOWN |
| SRQ-09 | Historical schema digest cannot be resolved | UNSUPPORTED/UNKNOWN; no current-schema reinterpretation |
| SRQ-10 | Entity was destroyed and ID later appears again without approved incarnation proof | Do not inherit old position; UNKNOWN/UNSUPPORTED |
| SRQ-11 | Points are close but no shape/extent is available | Distance is available; collision is UNSUPPORTED |
| SRQ-12 | Position lies near a named room but room geometry is absent | Containment is UNSUPPORTED; no inference from prose/name |
| SRQ-13 | Straight segment between endpoints crosses an unknown obstacle region | Reachability/line-of-sight UNKNOWN/UNSUPPORTED |
| SRQ-14 | Rollback invalidates a source event | Rebuild/recompute; no stale derived result |
| SRQ-15 | NPC requests spatial fact through Memory/NPC | Existing deny/fail-closed boundary remains unchanged |
| SRQ-16 | Same accepted event history rebuilt after process restart | Same derived result for same supported boundary and schema evidence, or fail closed if evidence cannot be reconstructed |
| SRQ-17 | Attempt to reuse a destroyed entity ID or rebuild valid history with ID reuse | Canonical Core rejects the reuse; spatial consumer still requires typed position provenance and exact boundary evidence |

## 7. What can be done next without a contract approval

### Read-only work that can continue
- Build a small disposable test-only evaluator over actual `getState(worldId)` and `getEvents(worldId, false)` outputs, using the already documented bracketed marker protocol.
- First validate inventory, point positions and simple vector arithmetic only where a real typed position source is present. Current generic `attributes_json` is not such a source.
- Use synthetic fixtures strictly as algorithm tests, clearly separated from claims about real Core data.
- Compare outputs across deterministic rebuild/restart and marker changes; do not write to Core.
- Record the exact source revision and test command/results before claiming anything passed.

### Work that remains blocked
- Reading generic attributes as spatial facts.
- Adding or changing Core/runtime/schema/API/event/adapter/storage behavior.
- Declaring position-v1, movement, orientation or pose implemented.
- Historical arbitrary-time queries without exact boundary mapping.
- Collision, containment, visibility or pathfinding without their typed geometry/environment models.
- Any Memory → NPC disclosure or acquisition path.
- Production integration.

## 8. Current disposition

**GO:** continue architecture research, source/test inspection, and isolated read-only or synthetic feasibility experiments within the already approved boundary.  
**NO-GO:** implementation and production integration.

The next concrete feasibility target is **position inventory + deterministic point-distance queries over confirmed position-v1 inputs**. If the current canonical state contains no typed, schema-verified position values, the honest result is that the query algorithm can be tested synthetically, while the real-data path remains blocked on typed-source enforcement and schema/temporal provenance.
