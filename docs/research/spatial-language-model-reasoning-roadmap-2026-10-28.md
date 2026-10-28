# Spatial Reasoning for Text-First NPC Simulation — Roadmap

**Date:** 2026-10-28  
**Status:** Research roadmap and isolated synthetic implementation; not an approved production contract.  
**Purpose:** Give a chat-based language model a compact, evidence-grounded model of space and time. This is not a rendering or graphics project.

## Product goal

The spatial layer should help a language model narrate physically and causally coherent scenes. It answers bounded questions, then provides short, plain-language facts to the model. It does not write the scene or replace character personality, dialogue, emotion, or interpretation.

**Interaction boundary:** the model proposes an action or describes intended movement; a future approved runtime would validate it; only a canonical accepted result could update world state. This research prototype does not connect to that runtime.

## Architecture for a text-first scene

1. **Synthetic/canonical world model:** positions, rooms, zones, doors, obstacles, orientation, and time boundary. The current experiment uses synthetic fixtures only.
2. **Deterministic spatial evaluator:** containment, distance, route feasibility, visibility, and bounded movement checks, each only when required evidence exists.
3. **Perception and knowledge are separate:** being nearby or having line of sight does not mean an NPC noticed, heard, recognized, understood, remembered, or knows a fact.
4. **LLM context adapter:** convert only relevant confirmed results into a compact text block; preserve UNKNOWN/CONFLICT; never dump the entire geometry model into every prompt.
5. **Narration:** the LLM uses those facts to write natural prose. It cannot promote its own proposal into canonical state.

## Planned capabilities and disposition

| ID | Capability | Why it matters in a chat visual novel | Current status | Dependency / guard |
|---|---|---|---|---|
| S1 | Typed position, frame, units, schema identity, entity incarnation | Prevents coordinates from unrelated worlds/frames being mixed | **BLOCKED at production boundary** | Core/World Pack/TimeEngine owner review; no inferred positions |
| S2 | Point distance, relative vector, nearest entity with ties | Supports “near”, “behind”, “farther”, and deterministic proximity | Research contracts/tests exist; production source remains unapproved | Complete candidate inventory and coherent exact boundary |
| S3 | Rooms, zones, doors and containment | Gives the LLM meaningful place labels instead of raw coordinates | **Implemented in isolated synthetic research module** | AABB toy model only; no production schema/API |
| S4 | Door-aware room route/reachability | Stops the model assuming it can pass through closed doors | **Implemented in isolated synthetic research module** | Graph of explicitly declared doors; unknown door state fails closed |
| S5 | Compact language-model scene context | Translates structured results into useful prompt facts | **Implemented in isolated synthetic research module** | Synthetic-only marker; does not assert visibility or knowledge |
| S6 | Geometry/obstacles and body-volume movement | Prevents impossible movement through walls or other bodies | Existing synthetic prototype; conservative AABB approximation | No full physics, body rotation, sliding, or collision response |
| S7 | Field of view and line-of-sight approximation | Helps distinguish physically visible from occluded | Existing synthetic prototype; target-body result is based on nine sample rays | Requires explicit lighting and complete blocker inventory; sampled rays cannot prove continuous full-body visibility; not actual noticing |
| S8 | Auditory perception | Allows sound to cross some spaces while walls/doors attenuate it | **Implemented in isolated synthetic research module** | Requires explicit source level, listener threshold, and per-door open/closed attenuation; estimates audibility only, not actual hearing or noticing |
| S9 | Actual noticing, recognition, and knowledge acquisition | Separates objective world facts from what each NPC believes | **Planned, separate workstream** | Requires dedicated observer/knowledge contract; no Memory/NPC integration implied |
| S10 | Scene changes and stale prediction invalidation | A changed door/obstacle/action should invalidate affected forecasts | **Implemented in isolated synthetic research module** | Caller must declare complete dependencies; no Core event/rollback integration |
| S11 | Dynamic movement and synchronized trajectory collision | Supports interceptions, missed encounters, and timing | Existing synthetic prototype | Constant velocity and conservative AABB intervals only |
| S12 | Navigation costs, route choice, and constraints | Supports explicit cost-based route ranking | **Implemented in isolated synthetic research module** | Explicit per-door traversal costs and forbidden-door/max-cost constraints; unknown doors can leave optimality UNKNOWN; not real travel time or safety |
| S13 | Event-to-spatial-action proposals | Lets the LLM suggest “walks to the window” without authoring truth | Planned architecture direction | No action accepted without future approved validator and canonical commit |
| S14 | Per-NPC world models / different beliefs | NPCs can have different, incomplete, or mistaken information | Planned; not part of current prototype | Objective state and individual beliefs must remain separate; Memory → NPC remains disabled |
| S15 | Optional articulated body / richer geometry | Useful for close combat and fine-grained interactions | Deferred | Only if use cases justify complexity; not needed for ordinary dialogue |
| S16 | Renderer / 3D graphics | Not required for text-based reasoning | **Out of scope** | Do not build unless a separate visual product requirement appears |

## Implemented first slice: synthetic rooms, zones, doors

New research module: `experiments/spatial-scene-lab/spatial-topology.js`.

It can:
- assign a synthetic entity position to one declared zone and parent room;
- return UNKNOWN if the position fits no zone or CONFLICT if zones overlap;
- validate that zone bounds fit inside the declared parent room;
- find a deterministic room path through explicitly open doors;
- treat closed doors as barriers and unknown door states as uncertainty when they could change reachability;
- emit a compact text context for one observer, with room/zone labels and explicit door states.

It cannot:
- prove that positions came from canonical Core state;
- infer visibility, sound, attention, recognition, knowledge, or memory;
- model doors as precise physical geometry or verify that a body fits through a doorway;
- model acceleration, turning, dynamic obstacles, or physical collision response. Navigation cost is only a sum of explicit synthetic door costs, not real travel time or safety.

The context text is an adapter output for the LLM, not a canonical record and not a grant of access to memory.

## Delivery order

### Phase A — isolated research foundation
- [x] Rooms, zones, containment, door graph, conservative reachability.
- [x] Compact text context with explicit unknowns and epistemic limits.
- [x] Add immutable synthetic scene revision diffing and declared-dependency freshness checks.
- [x] Add synthetic scenario traces across two immutable scene boundaries (door state → route/sound change → dependent prediction invalidation).
- [ ] Test invalidation across actual event/restart/rollback boundaries; production evidence remains unavailable.
- [x] Add auditory propagation as a separate result from visibility, using explicit sound levels and door attenuation.
- [x] Add deterministic route costs and explicit traversal constraints (synthetic weighted routes; unknown-state doors preserve uncertainty).
- [x] Add scenario-based evaluation for multi-NPC scenes (doorway, sound behind a door, out-of-room NPC, wall occlusion, movement across scene boundaries); ambush behavior remains outside this geometry-only model.

### Phase B — evidence and contracts
- [ ] Close typed position/frame/schema identity and entity-incarnation requirements with named Core/World Pack/TimeEngine review.
- [ ] Prove exact boundary provenance, rollback/restart behavior, and stale-result handling.
- [ ] Define operation-level evidence/status contract and LLM-context minimization.
- [ ] Independent review of the text adapter and unknown/conflict handling.

### Phase C — optional approved runtime integration
**NO-GO until separate approval of the exact diff.**
- [ ] Read-only bridge over the already approved Core feasibility seam.
- [ ] No new persistent fields, API, schema, event, store, cursor, adapter hooks, or Memory/NPC wiring without explicit approval.
- [ ] Any future action proposal must be validated before canonical commit.
- [ ] Memory → NPC remains DISABLED / FAIL-CLOSED unless its separate gates are approved and proven.

## Test plan for the isolated module

The tests cover unique containment, unmapped areas, overlapping zones, invalid zone bounds, open/closed/unknown door states, deterministic route selection, compact LLM context, and fail-closed invalid inputs. These tests validate only the synthetic algorithm. They do not establish production spatial capability.

## Safety and evidence rules

- No default coordinates and no natural-language guessing.
- Never treat missing geometry as proof that no obstacle exists.
- Unknown or conflicting location/door evidence must remain explicit.
- Geometric location does not imply visibility, hearing, noticing, recognition, knowledge, or memory.
- Synthetic `CONFIRMED` means valid only inside the synthetic fixture model.
- Do not count a draft PR or passing synthetic test as production integration.
- Production spatial reasoning remains NO-GO pending required owner reviews and source/temporal evidence.
- Memory → NPC remains DISABLED / FAIL-CLOSED.

### Second research increment: sound propagation

New module: `experiments/spatial-scene-lab/spatial-sound.js`. It estimates whether a sound could exceed a listener's explicit hearing threshold, using explicitly supplied source sound level and open/closed door attenuation. Unknown door states return UNKNOWN if they could change audibility. This does not establish that an NPC actually heard, noticed, understood, recognized, or remembers the sound. The attenuation values are synthetic inputs, not universal physical constants.

### Third research increment: scene revision and prediction freshness

New module: `experiments/spatial-scene-lab/spatial-revisions.js`. It compares two complete synthetic snapshots with the same world ID and increasing revision numbers, and reports changed dependency keys for entities, rooms, zones, and doors. A prediction can declare the keys it depends on; if one changes, the result is STALE. Missing or malformed revision/prediction metadata returns UNKNOWN. A result with no changed declared dependency is only `FRESH_WITH_RESPECT_TO_DECLARED_DEPENDENCIES`, not proof that the dependency list is complete. This module does not subscribe to events and does not prove restart, rollback, or production state provenance.

### Fourth research increment: cross-boundary scenario traces

New test: `tests/spatial-scene-traces.test.js`. The synthetic trace changes one door from open to closed across two immutable revisions and checks that room reachability and sound audibility change, while a prediction that declared the door as a dependency becomes STALE. A second trace changes a listener position and shows that a door-only prediction remains fresh only relative to its declared dependency. These are synthetic algorithm checks, not event-sourcing or production rollback evidence.


### Fifth research increment: weighted room routes

New module: `experiments/spatial-scene-lab/spatial-navigation.js`. It ranks simple room paths by the sum of explicit positive per-door traversal costs, supports explicit forbidden doors and a maximum total cost, and rejects missing costs or invalid constraints. Unknown-state doors are not traversed; when they could affect the result, route optimality remains UNKNOWN. These costs are synthetic ranking weights, not measured travel time, accessibility, or safety. No action is selected or committed, and production integration remains NO-GO.


### Fifth research increment — route costs and scene-boundary traces

The route-cost module now ranks simple room paths by explicit positive per-door costs and supports forbidden-door and maximum-cost constraints. A scene trace checks that closing a door changes the selected cheapest route and marks a prediction stale when its declared door dependency changes. A second trace ensures an unknown-state shortcut prevents a confirmed optimality claim. These are bounded synthetic tests only; costs do not represent physical time, accessibility, or safety.


### Sixth research increment — multi-NPC visibility and movement traces

The multi-person scenario tests now cover a runner occluded by a wall, visibility changing after a movement into a new synthetic boundary, movement rejected when its body path intersects a wall, and UNKNOWN visibility when lighting or the blocker inventory is unresolved. These checks report geometry only; they do not infer noticing, attention, intent, or awareness. The movement model remains a conservative AABB approximation.


### Seventh research increment — explicit limits of sampled body visibility

Target-body visibility uses nine sample rays (center plus corners). Result extents are named `SAMPLED_ALL`, `SAMPLED_PARTIAL`, or `SAMPLED_NONE` so the output does not imply continuous geometric coverage. Duplicate or empty blocker IDs now invalidate the synthetic scene rather than being silently accepted. This remains a simplified research approximation, not a production perception contract.


## 2026-10-29 — trajectory versus static blockers

The isolated scene lab now exposes `detectTrajectoryBlockerIntersections`. It sweeps each entity's declared AABB body along its explicit constant-velocity path for a bounded horizon and reports possible time intervals against static blockers. The sweep expands blocker bounds by the entity body extents, sorts results deterministically, and fails closed when any entity lacks explicit velocity or the horizon is invalid. It does not model moving blockers, acceleration, turning, collision response, or production state. Tests cover a direct wall intersection, vertical separation, body extents, missing motion, and invalid horizon.
