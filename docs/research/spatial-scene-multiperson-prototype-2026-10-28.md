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
- Mandatory declaration that the synthetic occluder inventory is complete; otherwise the scene is UNKNOWN.
- Synthetic movement that returns a new scene snapshot and recomputes visibility without mutating the input.
- Fail-closed handling of missing/non-finite coordinates, duplicate IDs, invalid orientation/range, unknown entities, uncertain lighting and incomplete geometry inventory.

Test file: `tests/spatial-scene-multiperson-feasibility.test.js`

## Interpretation limits

This is a geometry experiment, not a physics engine or NPC cognition system.

- Positions are synthetic fixture data, not typed, schema-verified Core positions.
- A target is represented by its origin point, not a body volume; partial-body visibility is not modeled.
- Orientation is an explicit vector supplied by the test fixture; gaze, attention, hearing, noticing, knowledge and memory are not inferred.
- Blockers are axis-aligned boxes. Doors, transparent surfaces, moving obstacles, portals, navigation, collision and destructible environments are not modeled.
- The caller must declare the full scene state at each synthetic boundary. The movement helper does not establish canonical game time, event validity or Core cursor provenance.
- `CONFIRMED` means only that the computation is valid inside this synthetic model. It is not a production evidence status.

## Initial acceptance scenarios

| Scenario | Expected |
|---|---|
| Three entities in one scene | Stable ordered observer/target results |
| Elevated target | Z affects Euclidean distance and range |
| Wall between observer and target | Visibility blocked |
| Entity moves around a wall | New snapshot recalculates visibility |
| Lighting unknown/dark | Visibility UNKNOWN, never guessed |
| Occluder inventory incomplete | Whole scene UNKNOWN |
| Missing Z, duplicate ID or unknown mover | Fail closed |

## Next safe increments

1. Run the focused tests and full project suite on the exact branch head.
2. Add a small scenario trace showing positions, blockers, visibility changes and reasons across two synthetic boundaries.
3. Only after the synthetic harness is stable, study a read-only bridge to canonical Core state. That bridge remains blocked until typed World Pack schema identity and temporal provenance are demonstrable.
4. Keep production runtime and Memory → NPC unchanged.
