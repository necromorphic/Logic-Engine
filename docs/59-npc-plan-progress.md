# NPC plan progress — isolated slice

## Implemented

This pure reducer applies a caller-reported result to a caller-supplied ordered NPC plan:
- successful active step completes and activates the next pending step;
- successful final step completes the plan;
- a blocked active step pauses the plan;
- an explicit unblock resumes the same step;
- an explicit abandon makes the plan terminal.

Invalid/out-of-order events, malformed plans, and attempts to change terminal plans fail closed. The reducer returns a new value and does not mutate its input.

## Limits

The caller remains responsible for establishing that a step really succeeded, was blocked, or became unblocked. This module does not execute actions, authenticate outcomes, create goals or plans, persist state, schedule off-screen work, or mutate world state. It does not connect to Host, Core, Memory, Personality, or Relationships and introduces no shared schema.

This provides deterministic plan progression, not autonomous runtime execution. A production caller and an approved scheduler/execution path remain required.
