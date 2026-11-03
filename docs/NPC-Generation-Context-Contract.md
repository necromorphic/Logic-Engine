# NPC Generation Context Builder / Receiver Contract

**Status:** Core-composed generation-context candidate; Host model-dispatch integration and production enablement remain disabled.

## Purpose

Convert two separately authorized Core evidence envelopes into one immutable, request-scoped generation context for a specific NPC and generation request. Lane A and Lane B remain distinct: Lane A contains Core-authorized knowledge acquisitions; Lane B contains Provider-backed Memory evidence with Core purpose `npc_turn_context` and Provider purpose `npc_decision`. The lanes are never merged. Every admitted Lane B candidate additionally carries `source_kind=canonical_entity` and the exact Core-owned `source_version` token read from `getSnapshot(..., { includeSourceVersions: true })` at the same world/commit snapshot. Missing, inactive, duplicate, malformed, or snapshot-mismatched source-version rows make Lane B non-ready. This lineage is mandatory because the Gateway's Provider reader validates source versions independently at dispatch-start; the world snapshot cursor alone is not source lineage.

## Trust boundary

`createNpcGenerationContextBuilder` is composed inside Core with five deployment-owned callbacks:

- `resolveScope(requestMetadata)`: derive the authenticated World, Actor, conversation, adapter, recipient, purpose and current Core snapshot. The request metadata contains only `request_id`, `generation_id`, and `generation_type`.
- `readLaneA(scope)`: perform the Core Lane A read and per-acquisition visibility authorization; return only a complete, visibility-filtered Lane A envelope.
- `readLaneB(scope)`: invoke the authenticated Host/Core Memory retrieval path and wrap its exact Consumer result with the scope resolved from the verified Host assertion.
- `revalidateEvidence(scope, envelopes)`: recheck Lane A per-acquisition visibility/currentness and Lane B Provider grants/source versions after assembly. Lane B should use the Consumer's fresh revalidation seam, not trust the prepared candidates.
- `revalidateScope(scope)`: re-read active bindings and the Core snapshot after both reads.

The builder does not accept caller-supplied World, Actor, conversation, adapter, records, fields, or authorization references. A callback failure, non-ready lane, malformed envelope, stale cursor, incomplete read, mismatched scope, or changed binding returns a content-free `non_ready` result.

The Core runtime composition is implemented in `src/application/npc-generation-context-runtime.js` and is created only for an adapter with a configured real `MemoryNpcConsumer` plus both deployment-wired Core read and per-acquisition visibility authorizers. It obtains scope from the branded Host assertion context and re-resolves the active Core conversation and Actor bindings. Lane A calls `LogicEngine.readNpcKnowledge()`, then invokes the deployment-wired per-acquisition visibility authorizer and includes only allowed acquisitions with their individual decision references. A truncated acquisition read is non-ready. Lane B calls the adapter-pinned `MemoryNpcConsumer.retrieveForNpc()`; the final build fence calls `revalidateForFinalDispatch()` and compares the fresh result with the prepared result.

The runtime is composed inside the configured adapter and remains an internal Core capability. It is deliberately not exposed as an HTTP response: serializing the context across the Host boundary would destroy the builder-issued object identity required by the Receiver. The existing `/v1/host/memory-npc/retrieve` contract is unchanged. The in-process opaque handoff and Host request/response bridge are now implemented in this block; the actual Final-Send plugin must still compose the runtime and Gateway in the same trusted server process and consume the bridge before dispatch-start. The current #855 bootstrap does not yet do so.

## Lane contracts

| Lane | Source | Purpose | Admission/currentness |
|---|---|---|---|
| A | Core canonical knowledge acquisitions | `npc_turn_context` | Core read authorization plus per-acquisition visibility authorization; complete acquisition window; source-event provenance and acquisition version checks |
| B | SQLite Memory Provider through Core MemoryNpcConsumer | Core `npc_turn_context`; Provider `npc_decision` | Core envelope, exact record/version and authorization generation, canonical source lineage/version, current Provider index/reconciliation and final grant checks |

The lanes are never merged into a common evidence array. Lane A items remain acquisitions. Lane B candidates retain their evidence assessment (`unassessed`, `supported`, `disputed`, `insufficient`); when the admission envelope includes `epistemic_kind` or `evidence_assessment`, each value must exactly match the corresponding candidate, otherwise the entire Lane B envelope is non-ready. None of these labels is rewritten as canonical truth or a confirmed belief. Disputed/insufficient evidence remains attributed evidence; Core owns conflict resolution and belief transitions.

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

After a successful receipt, the same Receiver can mint an opaque in-process dispatch handoff. The handoff is an empty frozen object branded in a private WeakMap; it contains no serialized context and cannot be recreated from a copied object or request metadata. Minting requires the exact successful receipt and the exact same request metadata object used for build/receive; matching copied IDs are insufficient. The handoff can be consumed once, synchronously, only with that same request object. The trusted Gateway obtains the original immutable context only by consuming this token. A failed cross-request consume does not transfer or consume the token. The Core runtime exposes `prepareForDispatch(request)` as the Host `prepare()` entry point: it performs async build, async Receiver acceptance, and handoff minting, returning only `{ status, handoff, reason }` (never the context or either lane payload). `createNpcGenerationContextHostBridge()` now binds that handoff to the exact SillyTavern request and response objects in a private WeakMap. Its async `prepare(hostRequest, hostResponse)` stores the exact request-metadata object and handoff; its synchronous `consume(hostRequest, hostResponse)` is one-shot and returns the immutable context, the Lane-B-only Provider projection, and a closure for the synchronous Lane A dispatch fence. Wrong request/response objects, clones, duplicate preparation, and replay fail closed. The lower-level `build()`, `receive()`, and `issueDispatchHandoff()` methods remain available for tests/composition. The Gateway uses `consumeDispatchHandoff(handoff, request)` synchronously at dispatch. After handoff consumption, `getLaneBDispatchEvidence(context, request)` returns only a Lane-B-scoped Provider projection (`sources` and the exact source-version-bearing `candidates` required by the dispatch reader). It rejects contexts not accepted by this runtime and does not include Lane A. The Core runtime also exposes `revalidateLaneAForDispatch(context, request)`, a synchronous check restricted to contexts previously returned by that runtime's own handoff consumer. This check re-resolves the authenticated World/Actor/conversation/snapshot and re-reads Lane A plus every per-acquisition visibility decision. It is intended to run inside the Gateway's shared-Coordinator dispatch-start critical section; it does not validate Lane B.

This resolves only the async Receiver → sync in-process handoff shape. It is not itself dispatch authorization: the Gateway must still revalidate both lanes synchronously under the same shared Coordinator/revocation-ordering boundary as durable `DISPATCH_STARTED`, and must bind the token to the exact Host request/response lifecycle.

## Gateway compatibility review — 3 Nov 2026

The current Gateway candidates are not yet compatible with this Builder/Receiver contract. This is an integration blocker, not permission to flatten the context or serialize it across the Host boundary.

- The managed Final-Send adapter candidate in #855 separates asynchronous `prepare(request, response)` from synchronous `dispatch(args)`. The NPC runtime now provides an opaque handoff that can be minted after async build/receive during preparation and consumed synchronously during dispatch. The adapter and Gateway still need to carry and consume this token for the exact prepared Host request.
- The current `MemoryDispatchGateway.dispatchProtectedRequest()` performs synchronous Core/Provider evidence reads while holding the shared Coordinator and then synchronously starts the transport. Its input is a Lane-B-shaped `sources/candidates` projection. It does not accept the immutable NPC context, preserve the Builder-issued object identity, or invoke this NPC Receiver.
- The Gateway currently accepts one `purpose` value for both Core and Provider readers, but this contract intentionally keeps `core_purpose=npc_turn_context` separate from `provider_purpose=npc_decision`. The dispatch ledger and both reader calls must preserve the two purpose namespaces independently; passing one purpose to both lanes is incorrect.
- The current Gateway normalizers reject empty `sources`/`candidates`. A complete-empty Lane B can coexist with valid Lane A acquisitions; the Gateway must define this case explicitly and must not fabricate a Provider source or downgrade the request to an unprotected native send.
- The Extension Gateway staging candidate in #871 uses an HTTP Host → Core path. A JSON round-trip cannot carry the private WeakMap brand or preserve object identity. Its successful Memory retrieval test is not a generation-context handoff and is not evidence of protected model dispatch.

### Required integration contract

Before enabling the path, Host/Gateway/Core must agree on all of the following:

1. Async preparation invokes `prepareForDispatch()` in the same trusted in-process composition as the Gateway and binds it to the exact Host request object, request ID, generation ID/type, World, Actor, conversation and adapter. The Host adapter must retain the exact request-metadata object alongside the handoff in a private WeakMap keyed by the original Host request; dispatch must retrieve and reuse that same metadata object. The context itself never becomes browser-controlled or a JSON payload.
2. The Final-Send adapter passes the opaque handoff plus the exact retained request-metadata object to the Gateway receiver for that same Host request. Missing, cloned, serialized, replayed or cross-request handoffs/metadata fail closed.
3. Dispatch-start consumes the exact in-process handoff, obtains the immutable NPC context, performs the synchronous Core Lane A visibility/acquisition check and the independent Lane B record/grant/source-version check under the same revocation-ordering authority as durable `DISPATCH_STARTED`, and records `core_purpose` and `provider_purpose` separately. A preflight check followed by an unlocked transport is insufficient.
4. The dispatch contract preserves Lane A and Lane B as separate inputs. A Lane-B-only `sources/candidates` projection cannot stand in for the full NPC context.
5. The first response write remains blocked until Core final-response revalidation succeeds. No browser-side callback or post-response check can substitute for this.

The NPC Receiver remains asynchronous for trusted scope and evidence revalidation. The added opaque handoff separates that asynchronous preflight from the synchronous dispatch-start call without awaiting inside the Gateway's critical section. The Core runtime now supplies the synchronous Lane A portion through `revalidateLaneAForDispatch()`. The remaining Gateway integration must invoke that check and its own synchronous Lane B admission/grant/source-lineage verifier while it owns the shared Coordinator, before writing `DISPATCH_STARTED` and synchronously starting transport. The Gateway must reject a handoff unless the request, generation, World, Actor, conversation, adapter and purpose all match the prepared Host request. Do not call the async Receiver from a synchronous dispatch callback, do not hold a synchronous SQLite transaction across `await`, and do not weaken either lane's freshness checks to make the interfaces fit.

Until this integration exists and is covered by revoke-before-dispatch, revoke-during-inference, cross-request replay, cross-Actor isolation, and response-suppression tests, the NPC context remains a Core-side candidate only and protected Memory → NPC dispatch stays disabled.

## Explicit non-goals

- No Lane A/Lane B source or authorization unification.
- No evidence-to-canonical-world-truth promotion.
- No conflict resolution or belief transition.
- No model transport, final-send, or dispatch lease.
- No production Memory → NPC enablement.
