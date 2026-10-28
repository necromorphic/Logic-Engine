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
| S7 | Field of view and line-of-sight approximation | Helps distinguish physically visible from occluded | Existing synthetic prototype | Requires explicit lighting and complete blocker inventory; not actual noticing |
| S8 | Auditory perception | Allows sound to cross some spaces while walls/doors attenuate it | **Implemented in isolated synthetic research module** | Requires explicit source level, listener threshold, and per-door open/closed attenuation; estimates audibility only, not actual hearing or noticing |
| S9 | Actual noticing, recognition, and knowledge acquisition | Separates objective world facts from what each NPC believes | **Planned, separate workstream** | Requires dedicated observer/knowledge contract; no Memory/NPC integration implied |
| S10 | Scene changes and stale prediction invalidation | A changed door/obstacle/action should invalidate affected forecasts | **Implemented in isolated synthetic research module** | Caller must declare complete dependencies; no Core event/rollback integration |
| S11 | Dynamic movement and synchronized trajectory collision | Supports interceptions, missed encounters, and timing | Existing synthetic prototype | Constant velocity and conservative AABB intervals only |
| S12 | Navigation costs, route choice, and constraints | Supports shortest/safer/accessible route decisions | Planned | Build on room/door graph; costs and character constraints must be explicit |
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
- model navigation cost, acceleration, turning, dynamic obstacles, or physical collision response.

The context text is an adapter output for the LLM, not a canonical record and not a grant of access to memory.

## Delivery order

### Phase A — isolated research foundation
- [x] Rooms, zones, containment, door graph, conservative reachability.
- [x] Compact text context with explicit unknowns and epistemic limits.
- [x] Add immutable synthetic scene revision diffing and declared-dependency freshness checks.
- [ ] Add scenario traces across two immutable scene boundaries and test invalidation across event/rollback boundaries.
- [x] Add auditory propagation as a separate result from visibility, using explicit sound levels and door attenuation.
- [ ] Add deterministic route costs and explicit traversal constraints.
- [ ] Add scenario-based evaluation for multi-NPC scenes (ambush, doorway, sound behind a wall, out-of-room NPC).

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
