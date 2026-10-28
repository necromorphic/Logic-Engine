# Multi-Person Spatial Scene — Initial Research Prototype

**Date:** 2026-10-28  
**Status:** Isolated research prototype; not production spatial reasoning.  
**Branch:** `research/spatial-scene-multiperson-2026-10-28`  
**Safety:** No production Core, schema, API, persistence, Host, Memory, or NPC integration. Memory → NPC remains **DISABLED / FAIL-CLOSED**.

## Goal

Run a small deterministic scene with multiple synthetic entities and answer a narrow set of questions at one explicitly named synthetic boundary:

- Which entity origins are within another entity's range and forward field of view?
- Does a declared axis-aligned blocker intersect the observer-to-target segment?
- How do those results change after a caller-declared movement into a new synthetic scene boundary?
- Does vertical separation change the 3D distance?

## What is implemented

Module: `experiments/spatial-scene-lab/spatial-scene.js`

- Deterministic pairwise visibility for every ordered observer/target pair.
- Explicit orientation vectors, field-of-view half-angle, maximum distance and lighting state.
- Segment-vs-axis-aligned-box occlusion.
- Optional target body volumes sampled at nine points, distinguishing FULL, PARTIAL and NONE visibility in the synthetic model.
- Conservative swept-body collision checks against AABB blockers and other declared entity bodies (Minkowski-expanded boxes; no mesh/physics engine).
- Optional explicit maximum-speed and maximum-turn-rate checks during movement; speed/turn limits require a positive duration and otherwise fail closed.
- Constant-velocity prediction to a caller-declared future synthetic boundary, only when every entity supplies explicit velocity.
- Mandatory declaration that the synthetic occluder inventory is complete; otherwise the scene is UNKNOWN.
- Synthetic movement that returns a new scene snapshot and recomputes visibility without mutating the input.
- Fail-closed handling of missing/non-finite coordinates, duplicate IDs, invalid orientation/range, unknown entities, uncertain lighting and incomplete geometry inventory.

Test file: `tests/spatial-scene-multiperson-feasibility.test.js`

## Interpretation limits

This is a geometry experiment, not a physics engine or NPC cognition system.

- Positions are synthetic fixture data, not typed, schema-verified Core positions.
- Entities without a `body` field remain point targets. When `body` is supplied, visibility samples the center and eight corners of an axis-aligned body volume; this is an approximation, not exact pixel/mesh visibility.
- Orientation is an explicit vector supplied by the test fixture; gaze, attention, hearing, noticing, knowledge and memory are not inferred.
- Blockers are axis-aligned boxes. Movement rejects point paths intersecting blockers, but there is no body-radius collision, sliding, navigation, moving obstacles, doors, transparent surfaces, portals or destructible environments.
- Future position uses constant-velocity straight-line extrapolation for at most 60 synthetic seconds. It does not model acceleration, turns, collisions, stopping, or response to other entities; predicted visibility is not a guarantee of actual future visibility.
- The caller must declare the full scene state at each synthetic boundary. The movement helper does not establish canonical game time, event validity or Core cursor provenance.
- `CONFIRMED` means only that the computation is valid inside this synthetic model. It is not a production evidence status.

## Initial acceptance scenarios

| Scenario | Expected |
|---|---|
| Three entities in one scene | Stable ordered observer/target results |
| Elevated target | Z affects Euclidean distance and range |
| Wall between observer and target | Visibility blocked |
| Entity moves around a wall | New snapshot recalculates visibility |
| Target body partly behind low cover | PARTIAL visibility from body sample points |
| Movement segment crosses a wall | Movement rejected without mutating input |
| Multiple entities have explicit velocity | Constant-velocity future positions computed at a new boundary |
| Lighting unknown/dark | Visibility UNKNOWN, never guessed |
| Occluder inventory incomplete | Whole scene UNKNOWN |
| Missing Z, duplicate ID or unknown mover | Fail closed |

## Next safe increments

1. Add a small scenario trace showing positions, blockers, visibility changes and reasons across two synthetic boundaries.
2. Extend movement to body-volume collision and stop/turn constraints without pretending it is a full physics engine.
3. Only after the synthetic harness is stable, study a read-only bridge to canonical Core state. That bridge remains blocked until typed World Pack schema identity and temporal provenance are demonstrable.
4. Keep production runtime and Memory → NPC unchanged.


## Latest research increment

The movement helper checks declared body extents along the entire path rather than only the entity origin. It rejects overlap with another entity's declared body, and can enforce caller-supplied `motion.maxSpeed` and `motion.maxTurnRateRadiansPerSecond` when a positive `durationSeconds` is supplied. These checks use conservative axis-aligned bounds; they do not simulate animation, acceleration, turning arcs, body rotation, dynamic collision response, or continuous physics. A multi-person trace test exercises occlusion, movement, and visibility rediscovery across named synthetic boundaries.
