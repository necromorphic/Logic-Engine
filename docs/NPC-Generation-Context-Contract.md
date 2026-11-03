# NPC Generation Context Builder / Receiver Contract

**Status:** Core-composed generation-context candidate; Host model-dispatch integration and production enablement remain disabled.

## Purpose

Convert two separately authorized Core evidence envelopes into one immutable, request-scoped generation context. Lane A and Lane B remain separate collections with separate purpose and authorization metadata. The builder never writes canonical facts, resolves conflicts, creates beliefs, or dispatches to a model.

## Trust boundary

`createNpcGenerationContextBuilder` is composed inside Core with five deployment-owned callbacks:

- `resolveScope(requestMetadata)`: derive the authenticated World, Actor, conversation, adapter, recipient, purpose and current Core snapshot. The request metadata contains only `request_id`, `generation_id`, and `generation_type`.
- `readLaneA(scope)`: perform the Core Lane A read and per-acquisition visibility authorization; return only a complete, visibility-filtered Lane A envelope.
- `readLaneB(scope)`: invoke the authenticated Host/Core Memory retrieval path and wrap its exact Consumer result with the scope resolved from the verified Host assertion.
- `revalidateEvidence(scope, envelopes)`: recheck Lane A per-acquisition visibility/currentness and Lane B Provider grants/source versions after assembly. Lane B should use the Consumer's fresh revalidation seam, not trust the prepared candidates.
- `revalidateScope(scope)`: re-read active bindings and the Core snapshot after both reads.

The builder does not accept caller-supplied World, Actor, conversation, adapter, records, fields, or authorization references. A callback failure, non-ready lane, malformed envelope, stale cursor, incomplete read, mismatched scope, or changed binding returns a content-free `non_ready` result.

The Core runtime composition is implemented in `src/application/npc-generation-context-runtime.js` and is created only for an adapter with a configured real `MemoryNpcConsumer` plus both deployment-wired Core read and per-acquisition visibility authorizers. It obtains scope from the branded Host assertion context and re-resolves the active Core conversation and Actor bindings. Lane A calls `LogicEngine.readNpcKnowledge()`, then invokes the deployment-wired per-acquisition visibility authorizer and includes only allowed acquisitions with their individual decision references. A truncated acquisition read is non-ready. Lane B calls the adapter-pinned `MemoryNpcConsumer.retrieveForNpc()`; the final build fence calls `revalidateForFinalDispatch()` and compares the fresh result with the prepared result.

The runtime is composed inside the configured adapter and remains an internal Core capability. It is deliberately not exposed as an HTTP response yet: serializing the context across the Host boundary would destroy the builder-issued object identity required by the receiver, and returning it before the Gateway's dispatch-start fence would create a stale-context handoff. The existing `/v1/host/memory-npc/retrieve` contract is unchanged. Host/Gateway must agree on an opaque, request-bound receiver handoff before this context can leave Core.

## Lane contracts

| Lane | Source | Purpose | Admission/currentness |
|---|---|---|---|
| A | Core canonical knowledge acquisitions | `npc_turn_context` | Core read authorization plus per-acquisition visibility authorization; complete acquisition window; source-event provenance and acquisition version checks |
| B | SQLite Memory Provider through Core MemoryNpcConsumer | Core `npc_turn_context`; Provider `npc_decision` | Core envelope, exact record/version and authorization generation, canonical source lineage/version, current Provider index/reconciliation and final grant checks |

The lanes are never merged into a common evidence array. Lane A items remain acquisitions. Lane B candidates retain their evidence assessment (`unassessed`, `supported`, `disputed`, `insufficient`). None of these labels is rewritten as canonical truth or a confirmed belief. Disputed/insufficient evidence remains attributed evidence; Core owns conflict resolution and belief transitions.

Withheld Lane A records are omitted by the trusted Core visibility callback. Revoked/stale/unavailable Lane B records produce a non-ready Consumer envelope and block context construction; they are not silently treated as absence.

## Immutable context

The generated `npc-generation-context/v1` object binds:

- request ID and generation ID/type;
- World, Actor, conversation, adapter, recipient and fixed generation purpose;
- exact Core `world_revision` + `commit_sequence`;
- separately frozen `lanes.lane_a` and `lanes.lane_b` payloads.

Input data is copied into plain immutable data. Proxies, accessors, sparse/extended arrays, cycles, non-finite numbers, malformed identities, duplicate evidence identities, and unexpected envelope fields fail closed. Contexts are branded by object identity in a private WeakMap owned by the issuing Builder instance; only the Receiver created by that same Builder can accept them. A different adapter/runtime cannot accept another Builder's context, even if request IDs and scope values happen to match. Serializing/cloning one does not preserve receiver eligibility.

## Receiver

`createNpcGenerationContextReceiver` is a future dispatch seam only. It accepts only a context issued by the builder, for the exact same request/generation IDs and current World/Actor/conversation/adapter/snapshot. Each issued context is a one-shot capability: the Builder shares replay state across all Receivers it creates, and a second or concurrent receipt fails closed even when it names the same request. The Receiver consumes the context capability before asynchronous revalidation so concurrent calls cannot both pass. It requires trusted evidence revalidation before accepting. It returns an acceptance receipt; it does not send prompts, create a transport lease, or bypass the Host dispatch-start/sole-egress contract.

After a successful receipt, the same Receiver can mint an opaque in-process dispatch handoff. The handoff is an empty frozen object branded in a private WeakMap; it contains no serialized context and cannot be recreated from a copied object or request metadata. Minting requires the exact successful receipt and exact request/generation binding. The handoff can be consumed once, synchronously, for that same request/generation. The trusted Gateway obtains the original immutable context only by consuming this token. A failed cross-request consume does not transfer or consume the token. The Core runtime exposes these operations as `issueDispatchHandoff(accepted, request)` and `consumeDispatchHandoff(handoff, request)`.

This resolves only the async Receiver → sync in-process handoff shape. It is not itself dispatch authorization: the Gateway must still revalidate both lanes synchronously under the same shared Coordinator/revocation-ordering boundary as durable `DISPATCH_STARTED`, and must bind the token to the exact Host request/response lifecycle.

## Gateway compatibility review — 3 Nov 2026

The current Gateway candidates are not yet compatible with this Builder/Receiver contract. This is an integration blocker, not permission to flatten the context or serialize it across the Host boundary.

- The managed Final-Send adapter candidate in #855 separates an asynchronous `prepare(request, response)` step from a synchronous `dispatch(args)` step. Its `resolveProtectedMemory(request, preparedHostContext)` callback must return synchronously. The current NPC `build()` and `receive()` methods are asynchronous; the adapter currently has no slot for a builder-issued context or its receiver.
- The current `MemoryDispatchGateway.dispatchProtectedRequest()` performs synchronous Core/Provider evidence reads while holding the shared Coordinator and then synchronously starts the transport. Its input is a Lane-B-shaped `sources/candidates` projection. It does not accept the Lane A acquisition envelope, preserve the Builder-issued object identity, or invoke this NPC Receiver.
- The Extension Gateway staging candidate in #871 uses an HTTP Host → Core path. A JSON round-trip cannot carry the private WeakMap brand or preserve object identity. Its successful Memory retrieval test is not a generation-context handoff and is not evidence of protected model dispatch.

### Required integration contract

Before enabling the path, Host/Gateway/Core must agree on all of the following:

1. Async preparation builds the context inside the authenticated Core process and binds it to the exact Host request object, request ID, generation ID/type, World, Actor, conversation and adapter. The context itself never becomes browser-controlled or a JSON payload.
2. The Final-Send adapter passes the exact issued context object to the Gateway receiver for that same request. Missing, cloned, serialized, replayed or cross-request contexts fail closed.
3. Dispatch-start performs current Lane A visibility/acquisition checks and Lane B record/grant/source checks under the same revocation-ordering authority as durable `DISPATCH_STARTED`. A preflight check followed by an unlocked transport is insufficient.
4. The dispatch contract preserves Lane A and Lane B as separate inputs. A Lane-B-only `sources/candidates` projection cannot stand in for the full NPC context.
5. The first response write remains blocked until Core final-response revalidation succeeds. No browser-side callback or post-response check can substitute for this.

The NPC Receiver remains asynchronous for trusted scope and evidence revalidation. The added opaque handoff separates that asynchronous preflight from the synchronous dispatch-start call without awaiting inside the Gateway's critical section. The remaining integration requirement is a synchronous, trusted dual-lane freshness adapter that the Gateway invokes while it owns the shared Coordinator, before writing `DISPATCH_STARTED` and synchronously starting transport. The Gateway must reject a handoff unless the request, generation, World, Actor, conversation, adapter and purpose all match the prepared Host request. Do not call the async Receiver from a synchronous dispatch callback, do not hold a synchronous SQLite transaction across `await`, and do not weaken either lane's freshness checks to make the interfaces fit.

Until this integration exists and is covered by revoke-before-dispatch, revoke-during-inference, cross-request replay, cross-Actor isolation, and response-suppression tests, the NPC context remains a Core-side candidate only and protected Memory → NPC dispatch stays disabled.

## Explicit non-goals

- No Lane A/Lane B source or authorization unification.
- No evidence-to-canonical-world-truth promotion.
- No conflict resolution or belief transition.
- No model transport, final-send, or dispatch lease.
- No production Memory → NPC enablement.
