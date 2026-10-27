# NPC goal lifecycle — isolated slice

## Purpose

This helper validates explicit lifecycle transitions for NPC-local goals. It complements the intention selector but does not create goals or decide when events are true.

## Transitions

- `active → blocked` via caller-proposed `block`
- `blocked → active` via caller-proposed `unblock`
- `active|blocked → completed` via caller-proposed `complete`
- `active|blocked → abandoned` via caller-proposed `abandon`

Completed and abandoned goals are terminal. Invalid transitions fail closed. Input values are not mutated.

## Boundary

The caller must provide the goal and an event it has independently established. This helper does not authenticate events, evaluate world conditions, persist changes, schedule the NPC, or execute actions. It introduces no shared schema and is not connected to Core, Memory, Host, Personality, or Relationships.
