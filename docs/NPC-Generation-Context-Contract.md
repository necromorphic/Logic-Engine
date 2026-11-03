# NPC Generation Context Builder / Receiver Contract

**Status:** implementation candidate; no model dispatch or production enablement.

## Purpose

Convert two separately authorized Core evidence envelopes into one immutable, request-scoped generation context. Lane A and Lane B remain separate collections with separate purpose and authorization metadata. The builder never writes canonical facts, resolves conflicts, creates beliefs, or dispatches to a model.

## Trust boundary

`createNpcGenerationContextBuilder` is composed inside Core with four deployment-owned callbacks:

- `resolveScope(requestMetadata)`: derive the authenticated World, Actor, conversation, adapter, recipient, purpose and current Core snapshot. The request metadata contains only `request_id`, `generation_id`, and `generation_type`.
- `readLaneA(scope)`: perform the Core Lane A read and per-acquisition visibility authorization; return only a complete, visibility-filtered Lane A envelope.
- `readLaneB(scope)`: invoke the authenticated Host/Core Memory retrieval path and wrap its exact Consumer result with the scope resolved from the verified Host assertion.
- `revalidateScope(scope)`: re-read active bindings and the Core snapshot after both reads.

The builder does not accept caller-supplied World, Actor, conversation, adapter, records, fields, or authorization references. A callback failure, non-ready lane, malformed envelope, stale cursor, incomplete read, mismatched scope, or changed binding returns a content-free `non_ready` result.

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

Input data is copied into plain immutable data. Proxies, accessors, sparse/extended arrays, cycles, non-finite numbers, malformed identities, duplicate evidence identities, and unexpected envelope fields fail closed. Contexts are branded by object identity in a private WeakMap; serializing/cloning one does not preserve receiver eligibility.

## Receiver

`createNpcGenerationContextReceiver` is a future dispatch seam only. It accepts only a context issued by the builder, for the exact same request/generation IDs and current World/Actor/conversation/adapter/snapshot. It returns an acceptance result; it does not send prompts, create a transport lease, or bypass the Host dispatch-start/sole-egress contract.

## Explicit non-goals

- No Lane A/Lane B source or authorization unification.
- No evidence-to-canonical-world-truth promotion.
- No conflict resolution or belief transition.
- No model transport, final-send, or dispatch lease.
- No production Memory → NPC enablement.
