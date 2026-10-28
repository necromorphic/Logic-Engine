# Core-owned knowledge acquisition contract (design only)

**Status:** proposed contract for coordinator decision; documentation only.  
**Scope:** define the smallest Core-owned fact needed to distinguish “an NPC could access a source” from “an NPC actually acquired information from that source.”  
**Explicit exclusions:** no runtime/API/schema/storage changes; no dispatcher, scheduler, worker, plan reconciliation, or Memory → NPC activation. Memory → NPC remains **DISABLED / FAIL-CLOSED** and Host remains **NON_READY**.

## 1. Problem the contract solves

Source lineage proves where a Memory record claims to come from. A read grant proves a particular read may be allowed. Neither, alone or together, proves that a particular actor actually received and acquired the information.

Core must not infer acquisition from:
- a Memory record existing or being indexed;
- a source being readable or authorized;
- a retrieval candidate being returned;
- an NPC being present in a conversation or simulation tick;
- a model mentioning a fact in generated text;
- a source cursor being current.

## 2. Contract statement

A **Knowledge Acquisition** is a Core-owned, attributable record that an identified in-world actor acquired a bounded information item from a specific, validated source through a named acquisition event.

The record is valid only if all required bindings are present and mutually consistent:

| Field (logical, not a proposed storage schema) | Required meaning |
|---|---|
| world_id | The canonical world in which the actor exists. |
| actor_entity_id | The canonical actor that acquired the information; must resolve to an eligible entity at the acquisition point. |
| information_ref | A stable reference to the bounded information item acquired. It must not itself grant access to undisclosed content. |
| source_ref | The exact source identity and source kind; lineage must be validated by the source-owning authority. |
| source_version | The exact source version/cursor validated at acquisition time, not “latest” inferred later. |
| acquisition_kind | A closed, documented category describing the mechanism that delivered the information (for example, direct observation, explicit communication, or authorized read). Unknown kinds are rejected. |
| acquisition_event_ref | The authoritative event or operation that caused acquisition; a passive retrieval result is insufficient. |
| core_cursor | The composite Core cursor (world_revision, commit_sequence) observed for the canonical decision. Neither component may be substituted for the pair. |
| recorded_at | Audit time, not a substitute for causal ordering or the Core cursor. |

This table specifies semantic obligations only. It does not authorize adding columns, tables, endpoints, or a new event type.

## 3. Authority and ownership

- **Core owns:** actor/world binding, canonical actor eligibility, acquisition decision, causal event reference, Core cursor, and the authoritative decision whether acquisition exists.
- **Source owner (currently Memory Provider for Memory records) owns:** source identity, source version/lineage validation, and whether the referenced source item exists in its own inventory.
- **Host/Adapter owns:** authenticated external caller identity and transport/session facts. It cannot declare that an NPC acquired knowledge merely because a request was sent.
- **NPC/model owns no authority:** generated text is not evidence of acquisition and cannot create or backdate an acquisition record.
- **Memory Provider does not own acquisition:** indexing, retrieval, grants, and lineage are inputs to Core's decision, not proof that the actor acquired the information.

## 4. Required decision rules

1. **Explicit cause:** acquisition must point to an authoritative event/operation that actually delivered the information to the actor. Candidate generation alone does not qualify.
2. **Exact source version:** validate the source identity and exact version through a trusted source-owner validator. Unknown, unavailable, stale, or ambiguous validation denies acquisition.
3. **Actor binding:** resolve the actor through the Core-owned binding/identity path; binding establishes identity only and does not grant information access.
4. **Bounded information:** record only the information item/reference and the minimum provenance required. Do not copy unrestricted source text into the acquisition contract by default.
5. **Purpose and recipient:** any disclosure needed to deliver the information must independently pass the existing trusted field/purpose/recipient authorization boundary. Acquisition does not bypass disclosure policy.
6. **One coherent Core view:** the decision must be tied to one Core composite cursor. If relevant canonical state changes during validation, retry under a defined bounded policy or deny; never silently combine different snapshots.
7. **No implicit inheritance:** an actor's acquisition does not automatically transfer to another actor, a group, a replacement entity incarnation, or a later world.
8. **No model self-attestation:** a model response cannot establish that delivery occurred, that the actor perceived it, or that source validation succeeded.
9. **Fail closed:** missing fields, unsupported acquisition kinds, unavailable validators, invalid source versions, ambiguous actor identity, or missing causal evidence produce no acquisition.
10. **Revocation is separate:** revoking future access does not rewrite history. Whether previously acquired knowledge persists, is forgotten, or is restricted is a separate explicit policy; the contract must not decide that implicitly.

## 5. Minimal lifecycle

1. A trusted Core-owned operation identifies the actor, information reference, source reference/version, and acquisition cause.
2. The source owner validates the exact source version and lineage.
3. Core validates actor binding/eligibility, applicable disclosure authorization, and the canonical cursor.
4. Core accepts or denies the acquisition decision. Acceptance must be attributable to the causing event/operation and the composite cursor.
5. A consumer may use only accepted acquisition facts, subject to current disclosure/recipient policy. No consumer may infer acquisition from raw Memory results.
6. Rollback/rebuild must preserve the distinction between a valid acquisition cause and an invalidated cause. If the acquisition's causal support is invalidated, the acquisition cannot remain silently authoritative; exact rollback semantics must be specified against Core's existing event lifecycle before implementation.

The lifecycle is a logical contract, not a proposal to add a dispatcher, scheduler, worker, or new storage path.

## 6. Acceptance criteria (KAC)

- **KAC-01 — Actor attribution:** every accepted acquisition names one canonical actor and world.
- **KAC-02 — Binding is not permission:** a valid actor binding alone cannot create or authorize acquisition.
- **KAC-03 — Explicit cause:** every accepted acquisition references an authoritative delivery/acquisition event; retrieval alone is denied.
- **KAC-04 — Source lineage:** source identity, kind, and exact version are validated by a trusted source-owner boundary.
- **KAC-05 — No fabricated versions:** absent, unknown, stale, or unavailable source versions fail closed.
- **KAC-06 — Bounded information:** acquisition refers to a bounded item; it does not imply access to the whole source or conversation.
- **KAC-07 — Disclosure remains separate:** a valid acquisition does not override recipient, purpose, or field-level disclosure controls.
- **KAC-08 — Composite cursor:** acceptance is bound to (world_revision, commit_sequence) from one coherent Core view.
- **KAC-09 — TOCTOU handling:** a relevant state/binding change between validation and decision cannot yield an accepted stale acquisition.
- **KAC-10 — No cross-actor inheritance:** another actor cannot reuse the acquisition without its own qualifying cause.
- **KAC-11 — Incarnation safety:** a destroyed/replaced entity incarnation cannot inherit acquisition by reusing a human-readable identifier.
- **KAC-12 — Model output is not evidence:** generated text or model self-report cannot create acquisition facts.
- **KAC-13 — Causal invalidation:** rollback/rebuild cannot leave an acquisition authoritative when its required cause is invalid.
- **KAC-14 — Revocation semantics explicit:** access revocation and forgetting/retention of previously acquired knowledge are separate, explicit decisions.
- **KAC-15 — Fail-closed consumer:** any consumer receiving absent, invalid, or unverifiable acquisition state denies the knowledge-dependent action.

## 7. Decisions still required before implementation

These are deliberate design gates, not invitations to invent runtime mechanisms now:

1. Which existing Core lifecycle operation can serve as the authoritative acquisition cause without introducing a dispatcher or new event type?
2. What existing canonical representation, if any, can hold the accepted acquisition fact and survive rollback/rebuild correctly?
3. How are entity incarnations represented across every supported writer/replay/rebuild path?
4. What precise transaction/ordering boundary covers source validation and Core acceptance when Provider and Core use separate database connections?
5. Which bounded information-reference format is safe without copying raw source text?
6. What policy applies to knowledge already acquired when source access is later revoked?
7. Which tests can prove these properties on exact current main, rather than only through fixture callbacks?

Until these questions are answered against the existing lifecycle, this document is a contract proposal only. Do not implement a new schema, event, API, worker, or Memory → NPC wiring as an assumed consequence.

## 8. Current disposition

**Design:** proposed, ready for coordinator review.  
**Runtime implementation:** not authorized by this document.  
**Memory → NPC:** **DISABLED / FAIL-CLOSED**.  
**Host:** **NON_READY**.
