# Core-Owned NPC Belief Transition Runtime

**Status:** current-main port candidate in draft integration work. Not production-enabled. No prompt dispatch or HTTP route is added.

## Ownership

- Core remains authoritative for world truth, acquisition records, world snapshot, commit/rollback, and persistent belief-transition history.
- `readNpcKnowledge()` supplies only actor-assigned, active acquisition records.
- A deployment-owned synchronous authorizer approves the actor/purpose/snapshot read.
- A separate deployment-owned synchronous visibility authorizer must approve each acquisition for the exact adapter, actor, recipient, purpose, world revision, and commit sequence before it can enter a model-facing context.
- The model proposes a stance; it cannot add acquisition evidence, authorize access, change canonical facts, or commit world effects. The current Core API does not expose an NPC-authored canonical world-mutation capability; any future world change remains a proposal to the existing authorized Core commit path.

## Runtime path

1. Read actor-scoped Core acquisitions at an exact current snapshot. The reader probes one item beyond the configured limit; if the acquisition window is truncated, belief-context preparation and belief-state reconciliation fail closed rather than assuming the unseen remainder contains no conflicting evidence.
2. Apply per-acquisition visibility decisions. Denied items are omitted; malformed, unbound, or failing decisions abort context preparation. Each decision is bound to the same adapter and recipient (`model`) as the read request, as well as actor, purpose and snapshot. If any acquisition for the proposed proposition is withheld, the reducer rejects that belief update without exposing the hidden value or identifying which source was withheld.
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

The model-facing context uses `belief_stance_class` (`believed`, `suspected`, or `conflicted`) only to summarize the resulting stance. It is deliberately not named `epistemic_status`: a belief stance is not the epistemic class of its source evidence.

**Epistemic-source limitation:** the current Core acquisition reader returns canonical acquired fact values and provenance, but it does not carry the Memory classes `confirmed`, `unconfirmed_report`, `suspicion`, `inference`, `rumor`, or `unknown`. No mapping from Memory metadata into Core acquisition/belief events is implemented or approved in this candidate. Do not infer `confirmed` merely from a successful acquisition read, and do not use this context seam to promote a Memory report, rumor, or inference. End-to-end R3 remains partial until the source classification is explicitly represented and validated at the owning boundary.

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

This is the Core transition and context-preparation seam only. The read authorizer and per-acquisition visibility authorizer are deployment-injected; `src/index.js` does not configure them, so the application remains fail-closed by default. The read and visibility requests now carry adapter and recipient fields, but those fields remain caller-supplied and do not authenticate a Host session. The deployment authorizer must bind them to trusted Host/session state; no explicit Host-session identifier or verified Host binding is implemented. No production NPC model receiver, context serializer, or SillyTavern Memory dispatch is wired. No model prompt is sent here. Independent Core/security review and end-to-end Host/Provider egress verification remain mandatory before Memory → NPC can be enabled.
