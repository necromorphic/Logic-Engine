# Core-Owned NPC Belief Transition Runtime

**Status:** implementation candidate in draft PR #667. Not production-enabled. No prompt dispatch or HTTP route is added.

## Ownership

- Core remains authoritative for world truth, acquisition records, world snapshot, commit/rollback, and persistent belief-transition history.
- `readNpcKnowledge()` supplies only actor-assigned, active acquisition records.
- A deployment-owned synchronous authorizer approves the actor/purpose/snapshot read.
- A separate deployment-owned synchronous visibility authorizer must approve each acquisition for the exact actor, purpose, world revision, and commit sequence before it can enter a model-facing context.
- The model proposes a stance; it cannot add acquisition evidence, authorize access, change canonical facts, or commit world effects.

## Runtime path

1. Read actor-scoped Core acquisitions at an exact current snapshot.
2. Apply per-acquisition visibility decisions. Denied items are omitted; malformed, unbound, or failing decisions abort context preparation.
3. Validate every proposed evidence reference against the visible acquisition set.
4. Require both support and contradiction references when the proposal marks an unresolved conflict. Contradictory evidence cannot be forced into a winning stance by this reducer.
5. Recheck world revision and commit sequence immediately before returning the context.
6. Persist an accepted transition through `recordNpcBeliefTransition()` as a no-effect canonical Core event plus a Core-owned SQLite projection row. The row is linked to the event and is filtered out if that transition event is rolled back.
7. `getNpcBeliefState()` returns the latest valid transition and compares its evidence references with current actor acquisitions. Source rollback/revocation makes support `unsupported` or `partially_supported`; it does not silently rewrite the character's stance or delete its history.

## API contract (internal Core methods only)

- `prepareNpcBeliefContext(readRequest, proposal, currentBelief?)` returns a validated, actor/snapshot-bound context. It requires both trusted read and visibility authorizers. It is not registered as HTTP.
- `recordNpcBeliefTransition(input)` validates evidence again, persists the transition, and requires an idempotency key plus the exact pre-transition revision and commit sequence.
- `getNpcBeliefState(input)` reads the latest valid belief transition and reports current evidence support.

Belief stances are qualitative: `believes_true`, `believes_false`, `suspects_true`, `suspects_false`, and `unresolved_conflict`. Numeric confidence is intentionally absent.

## Failure behavior

- Missing visibility authorizer: no context.
- Visibility authorizer error or malformed decision: no context.
- Actor, purpose, snapshot, or evidence mismatch: reject.
- Retrieved or unacquired evidence: reject.
- Conflicting evidence with a non-conflict stance: reject.
- Stale snapshot: reject and require a fresh read.
- Source invalidation: preserve transition history; mark support as unsupported/partial rather than auto-correcting the belief.
- Replayed idempotency key with identical request: return the existing transition. Reuse with different request: reject.

## Boundaries still not enabled

This is the Core transition and context-preparation seam only. It does not prove that a production NPC model receiver or SillyTavern Memory dispatch is wired to it. No model prompt is sent here. Independent review and end-to-end Host/Provider egress verification remain mandatory before Memory → NPC can be enabled.
