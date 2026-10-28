# Core Read → NPC Epistemic Event Adapter

**Status:** draft implementation; stacked on the Core-owned reader PR.  
**Purpose:** convert an authorized Core knowledge read into explicit NPC-local receipt/evidence events without deciding belief state.

## Behavior

- Calls the internal Core reader first; adapter method does not accept caller-supplied read results.
- Produces one `information_received` event per acquired item, preserving source reference and digest.
- Produces `evidence_admitted` only when a deployment-owned exact mapping explicitly binds that `fact_id` to a proposition and polarity.
- Stable evidence references derive from world, NPC, acquisition, and fact identity.
- Duplicate or malformed mappings fail during engine setup; malformed reads fail closed.
- Does not create `belief_updated` events. Belief revision remains a separate explicit decision under NPC-local revision rules.

## Trust and limits

The mapping list is deployment-owned configuration, not prompt or request data. The adapter itself is not an HTTP endpoint and does not dispatch to the model. It prepares typed reducer events only; a future lifecycle owner must apply and persist those events with idempotency, invalidation, and rollback semantics before this can be considered a complete integration.

A mapping means “this canonical fact is eligible to be considered evidence for this proposition with this polarity.” It does not mean the NPC automatically believes it, must disclose it, or should use it for every action. No free-text inference is performed.

Memory → NPC remains **DISABLED / FAIL-CLOSED**. This PR does not merge its dependency, modify `main`, or enable prompt injection or production dispatch.

Acceptance requires the full Runtime suite, recalculation oracle, and NPC boundary tests to pass on the exact merged PR head.
