# NPC autonomous intention selector — isolated slice

## Purpose

This NPC-owned helper adds one small, executable step toward NPC independence: choosing a next intention from explicitly supplied goals and action candidates.

## Implemented behavior

- Considers only active goals.
- Requires each candidate action to be explicitly allowed and have its preconditions marked satisfied.
- Retains a supplied current intention while it remains eligible, unless a strictly higher-priority goal has an eligible action.
- When replanning is necessary, selects by goal priority (higher first), then action cost (lower first), then stable lexical IDs.
- Returns only a goal ID and action ID, not narrative text or world mutations.
- Returns `no_eligible_action` when nothing is eligible and `non_ready` for malformed or ambiguous input.
- Includes deterministic unit tests for selection, eligibility gates, tie-breaking, current-intention continuity, invalidation/replanning, malformed input, and no input mutation.

## Hard limits

This is a pure selector, not a complete autonomous NPC runtime.

- It does not create goals, infer motives, generate candidate actions, or validate the truth of supplied preconditions.
- It does not execute actions, change the world, schedule future turns, or run when the player is absent.
- It does not persist plans or guarantee continuity across requests/restarts; continuity works only when the caller supplies the previous intention again.
- It does not access Memory or infer NPC knowledge from retrieval.
- It does not define or modify a shared schema, Core contract, Host API, Personality, or Relationships.

The caller must supply trustworthy NPC-local inputs. Any real-world action still requires the existing owner-approved execution path. Continuous off-screen activity requires an approved scheduler/orchestrator integration outside this module; this PR does not claim that capability exists.

## Integration status

**Isolated / not wired into production orchestration.** The helper can be tested independently. It must not be described as autonomous runtime behavior until a supported caller supplies goal/action candidates and a separately approved execution/scheduling path exists.
