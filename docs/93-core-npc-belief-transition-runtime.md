# Core-Owned NPC Belief Transition Runtime

**Status:** implementation candidate on PR #838; internal-only and not production-enabled. No prompt dispatch or NPC knowledge HTTP route is added.

## Ownership

- Core remains authoritative for world truth, acquisition records, world snapshot, commit/rollback, and persistent belief-transition history.
- `readNpcKnowledge()` supplies only actor-assigned, active acquisition records.
- The runtime-wired Core context resolver derives `world_id` from the active Host conversation → world binding and derives `actor_id` from the adapter's active actor bindings in that world. Exactly one active, non-destroyed actor must resolve; zero or multiple active actors deny. Request-supplied world/actor labels are only checked as selectors against this result and never establish authority.
- The current actor-binding schema is adapter+world scoped, not conversation scoped. Therefore multiple active actors for one adapter/world are deliberately unsupported by this resolver until a separately approved conversation-scoped actor-binding contract exists.
- A separate runtime-wired synchronous visibility authorizer must approve each acquisition for the same conversation, adapter, actor, recipient, purpose, world revision, and commit sequence. It additionally requires the acquisition provenance reference and digest to match the trusted source registry for the world's exact World Pack version before the item can enter a model-facing context.
- Lane A decisions carry a Core-issued policy tuple: process-scoped `authority_id`, monotonic `generation`, and deterministic `snapshot_fingerprint`. The fingerprint pins configured adapter IDs, the Lane A recipient/purpose allowlists, and the exact trusted initial-source registry. It is not supplied by Host or model input.
- The model proposes a stance; it cannot add acquisition evidence, authorize access, change canonical facts, or commit world effects. The current Core API does not expose an NPC-authored canonical world-mutation capability; any future world change remains a proposal to the existing authorized Core commit path.

## Runtime path

1. Read actor-scoped Core acquisitions at an exact current snapshot. The reader probes one item beyond the configured limit; if the acquisition window is truncated, belief-context preparation and belief-state reconciliation fail closed rather than assuming the unseen remainder contains no conflicting evidence.
2. Apply per-acquisition visibility decisions. Denied items are omitted; malformed, unbound, or failing decisions abort context preparation. Each decision is bound to the same Host conversation, adapter and recipient (`model`) as the read request, as well as actor, purpose and snapshot. If any acquisition for the proposed proposition is withheld, the reducer rejects that belief update without exposing the hidden value or identifying which source was withheld.
3. Validate every proposed evidence reference against the visible acquisition set.
4. Require both support and contradiction references when the proposal marks an unresolved conflict. Contradictory evidence cannot be forced into a winning stance by this reducer.
5. Recheck world revision and commit sequence immediately before returning the context. After the acquisition query, Core also resolves the Host conversation/actor binding again, reruns the trusted read authorizer, and verifies that `authority_id`, `generation`, and `snapshot_fingerprint` are unchanged. A binding revocation that does not advance the world cursor therefore cannot pass on the strength of the snapshot check alone.
6. After per-acquisition visibility evaluation, context preparation revalidates the same binding, read authorization, and policy tuple again. Each visibility decision must carry the exact tuple captured by the read. A malformed, changed, denied, or unavailable decision aborts context preparation.
7. Immediately before the canonical write, `recordNpcBeliefTransition()` reruns the actor-scoped read and every per-acquisition visibility check **inside the Core SQLite write transaction**. The final prepared transition and policy tuple must match preflight. The transaction's `BEGIN IMMEDIATE` boundary serializes the final authorization with Core binding mutations on the same database; the nested canonical commit still checks expected world revision and commit sequence.
8. Persist an accepted transition as a typed `npc.belief.transition` effect inside the canonical Core event, including the exact policy authority tuple used for the final write authorization. The tuple is validated as a closed three-field record. The SQLite table is a derived projection rebuilt from valid canonical event effects; it is not the only copy of transition data. Generic event callers cannot forge this privileged effect.
9. `getNpcBeliefState()` returns the latest valid belief transition only after per-acquisition visibility checks and a final binding/read-authorization recheck. If the proposition's current evidence is withheld, it returns a non-disclosing `unavailable` result with no stance or value. Source rollback/revocation makes support `unsupported` or `partially_supported`; it does not silently rewrite the character's stance or delete its history, and invalidated acquisition IDs are not exposed.

## API contract (internal Core methods only)

- `prepareNpcBeliefContext(readRequest, proposal, currentBelief?)` returns a validated, actor/snapshot-bound context. It requires both trusted read and visibility authorizers. It is not registered as HTTP.
- `recordNpcBeliefTransition(input)` validates evidence, reruns read and per-acquisition visibility authorization inside the Core write transaction, persists only an unchanged validated transition and policy tuple, and requires an idempotency key plus the exact pre-transition revision and commit sequence. The policy tuple participates in the idempotency request hash; replay under another generation is not treated as the same operation.
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
- Host conversation/actor binding revoked during acquisition read: post-read revalidation rejects the result even if world revision and commit sequence did not change.
- Visibility or binding revoked during context preparation: the final context-boundary recheck rejects the context.
- Visibility or binding revoked before the belief write transaction: the in-transaction final authorization rejects the transition before persistence.
- The Core-local final write check is serialized with Core database binding/source mutations by the same SQLite write transaction. It does not serialize an external policy authority, the separate Provider database, Host session state, or outbound network dispatch. No cross-store policy-version fence, final Gateway dispatch-start, or zero-egress guarantee is claimed.
- Actor and Host conversation binding create/rebind/revoke operations advance the policy generation only after a successful Core transaction. The corresponding HTTP binding mutation routes require the separate admin credential; each revoke also writes its existing Core audit entry. A process restart creates a new authority ID, invalidating snapshots from the previous process.
- This authority is process-scoped. It does not provide a shared generation writer across multiple independent Core processes or cross-store serialization with Memory Provider. A multi-process deployment must remain NON_READY until a shared durable authority is separately designed and tested. Production Memory→NPC remains disabled.
- Source invalidation: preserve transition history; mark support as unsupported/partial rather than auto-correcting the belief.
- Replayed idempotency key with identical request: return the existing transition. Reuse with different request: reject.
- Projection deletion/rebuild: reconstruct transition rows from canonical event effects. Rolling back the transition event removes it from the rebuilt projection; rolling back source evidence leaves valid belief history and reports reduced support.
- Accessor-backed or proxy-backed model input fails closed before executing getters or proxy traps.

## Boundaries still not enabled

This is the Core transition and context-preparation seam only. `src/index.js` now wires the read and visibility authorizers from the persistent Core store, configured adapter IDs, and trusted source registry. Both checks require active Core Host conversation and actor bindings; visibility also requires exact trusted source provenance. Missing or revoked bindings and unknown provenance deny or withhold the acquisition. The read request carries `conversation_id`, but this value is still input to an internal Core method, not proof of an authenticated Host session. The method is not exposed over HTTP; any future caller must derive adapter identity from the authenticated adapter token and conversation identity from the authenticated SillyTavern session. No production NPC model receiver, context serializer, or SillyTavern Memory dispatch is wired. No model prompt is sent here. Independent Core/security review and end-to-end Host/Provider egress verification remain mandatory before Memory → NPC can be enabled.
