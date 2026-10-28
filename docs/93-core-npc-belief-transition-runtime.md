# Core-Owned NPC Belief Transition Runtime

**Status:** implementation candidate in draft PR #670, with canonical-event persistence follow-up in PR #673. Not production-enabled. No prompt dispatch or HTTP route is added.

## Ownership

- Core remains authoritative for world truth, acquisition records, world snapshot, commit/rollback, and persistent belief-transition history.
- `readNpcKnowledge()` supplies only actor-assigned, active acquisition records.
- A deployment-owned synchronous authorizer approves the actor/purpose/snapshot read.
- A separate deployment-owned synchronous visibility authorizer must approve each acquisition for the exact actor, purpose, world revision, and commit sequence before it can enter a model-facing context.
- The model proposes a stance; it cannot add acquisition evidence, authorize access, change canonical facts, or commit world effects.

## Runtime path

1. Read actor-scoped Core acquisitions at an exact current snapshot. The reader probes one item beyond the configured limit; if the acquisition window is truncated, belief-context preparation and belief-state reconciliation fail closed rather than assuming the unseen remainder contains no conflicting evidence.
2. Apply per-acquisition visibility decisions. Denied items are omitted; malformed, unbound, or failing decisions abort context preparation. If any acquisition for the proposed proposition is withheld, the reducer rejects that belief update without exposing the hidden value or identifying which source was withheld.
3. Validate every proposed evidence reference against the visible acquisition set.
4. Require both support and contradiction references when the proposal marks an unresolved conflict. Contradictory evidence cannot be forced into a winning stance by this reducer.
5. Recheck world revision and commit sequence immediately before returning the context.
6. Persist an accepted transition through `recordNpcBeliefTransition()` as a typed `npc.belief.transition` effect inside the canonical Core event. The SQLite table is a derived projection rebuilt from valid canonical event effects; it is not the only copy of transition data. Generic event callers cannot forge this privileged effect.
7. `getNpcBeliefState()` returns the latest valid transition only after per-acquisition visibility checks. If the proposition's current evidence is withheld, it returns a non-disclosing `unavailable` result with no stance or value. Source rollback/revocation makes support `unsupported` or `partially_supported`; it does not silently rewrite the character's stance or delete its history, and invalidated acquisition IDs are not exposed.

## API contract (internal Core methods only)

- `prepareNpcBeliefContext(readRequest, proposal, currentBelief?)` returns a validated, actor/snapshot-bound context. It requires both trusted read and visibility authorizers. It is not registered as HTTP.
- `recordNpcBeliefTransition(input)` validates evidence again, persists the transition, and requires an idempotency key plus the exact pre-transition revision and commit sequence.
- `getNpcBeliefState(input)` reads the latest valid belief transition and reports current evidence support.

A proposal identifies both a canonical proposition reference (subject + predicate, or fact ID where no subject reference exists) and the explicit `proposition_value`. The reducer verifies that cited evidence belongs to that proposition and that every currently visible acquisition for the proposition is accounted for. Evidence matching the value supports the proposition; evidence with another value contradicts it. A conflict cannot be hidden by omitting the conflicting acquisition.

Belief stances are qualitative: `believes_true`, `believes_false`, `suspects_true`, `suspects_false`, and `unresolved_conflict`. Numeric confidence is intentionally absent.

## Failure behavior

- Missing visibility authorizer: no context.
- Visibility authorizer error, accessor-backed decision, or malformed decision: no context.
- Actor, purpose, snapshot, or evidence mismatch: reject.
- Retrieved or unacquired evidence: reject.
- Conflicting evidence with a non-conflict stance: reject.
- Stale snapshot: reject and require a fresh read.
- Source invalidation: preserve transition history; mark support as unsupported/partial rather than auto-correcting the belief.
- Replayed idempotency key with identical request: return the existing transition. Reuse with different request: reject.
- Projection deletion/rebuild: reconstruct transition rows from canonical event effects. Rolling back the transition event removes it from the rebuilt projection; rolling back source evidence leaves valid belief history and reports reduced support.
- Accessor-backed or proxy-backed model input fails closed before executing getters or proxy traps.

## Boundaries still not enabled

This is the Core transition and context-preparation seam only. It does not prove that a production NPC model receiver or SillyTavern Memory dispatch is wired to it. No model prompt is sent here. Independent review and end-to-end Host/Provider egress verification remain mandatory before Memory → NPC can be enabled.
