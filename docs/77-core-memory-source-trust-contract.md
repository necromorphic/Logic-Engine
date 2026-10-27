# Core contract: Memory source trust and freshness

**Owner:** Core (Issue #140).  
**Status:** Core contract decision for existing in-repository canonical sources; external/Memory-owned source verification remains blocked where the runtime has no authoritative binding/version proof.  
**Scope:** Contract and executable acceptance coverage only. This document does not add a Memory API, universal source schema, source registry, outbox, cursor, or production Memory→NPC consumer.

## 1. Canonical source authority

A source is authoritative only when it resolves to an existing Core-owned record in the same canonical world and the relevant runtime operation validates that record's current status.

- **Event source:** the existing canonical `world_events.event_id`, scoped by `world_id`. Existing `READS_SOURCE` causal links must resolve to a valid event in that world at commit time. A caller-supplied ID, generation label, manifest membership, or Memory-local locator is not proof by itself.
- **Entity source:** the existing canonical `entity_id` and its current Core projection. Identity-level references do not prove that any particular attribute is authorized for a recipient.
- **Claim/fact source:** the existing canonical `fact_id` and current fact projection. The runtime validates that a `READS_CLAIM` target has at least one valid source in the same world. This does not make a Memory copy of the claim authoritative.
- **Anything else:** if no existing Core-owned binding and validity check can resolve the source, classify it as **UNVERIFIABLE** for source-dependent use and withhold it. Do not manufacture a universal source identity field to normalize unlike source kinds.

Core canonical identity and validity are not interchangeable with a Host conversation binding. The latter maps an authenticated adapter-scoped Host conversation to a world; it does not prove Host inventory completeness, Memory source provenance, source freshness, or dispatch authorization.

## 2. Version and freshness

There is no approved universal source-version field.

- For an event, the existing canonical identity is `(world_id, event_id)`; its current `validity` must be checked. The event's `commit_sequence` records its place in the append history, not its current validity.
- For entity/fact reads, use the current canonical projection and the existing snapshot cursor `(world_revision, commit_sequence)` where the runtime read contract requires it.
- A source-dependent consumer must not infer freshness from `commit_sequence` alone. It must revalidate the source-specific current state at the trusted read boundary. A cursor is a snapshot guard, not a substitute for a source identity/version contract.
- The current repository does not expose an authoritative source-version/reconciliation contract for arbitrary Memory-owned records or external Host inventory. Such records remain unverifiable for protected source-dependent use until their owning blocks provide evidence and a compatible contract.

## 3. Change, deletion, rollback and reconciliation

Canonical updates are represented by Core events and current projections. A canonical rollback changes affected event validity and increments `world_revision`; it does **not** append a new canonical event, so `commit_sequence` can remain unchanged. Rollback also invalidates downstream events whose recorded dependencies require the retracted source.

Therefore:
1. Revalidate source validity/projection at use time.
2. Treat a changed `world_revision` as stale even if `commit_sequence` is unchanged.
3. Reject stale/retracted/invalidated/unresolvable sources; do not fall back to cached Memory text or an older projection.
4. A durable change feed, outbox, polling cursor, or reconciliation store is **not approved** by this contract. Selection requires Memory/NPC to specify the concrete consumer operation, source classes, acceptable staleness bound, retraction semantics, and restart/recovery requirements. Until then, there is no claim of automatic or bounded reconciliation for Memory-owned copies.

## 4. Recipient and field disclosure

The existing `AuthorizedReadService` is the narrow field-level policy seam. Its field policy must be trusted application configuration and must explicitly return `true` for each field for the bound actor, recipient, and purpose. A missing, throwing, or non-`true` decision denies disclosure. The shipped entry point remains self-identity-only unless a trusted policy is explicitly configured; this contract does not configure or broaden it.

- The decision context is bound to the authenticated adapter/actor and includes recipient and purpose. A target's existence is not itself permission to read it.
- Only explicitly allowed fields may be returned. No raw event history, audit payload, denied value, snippet, count, or diagnostic detail may be used as a fallback disclosure path.
- Denial/unavailability uses the existing generic `READ_NOT_AVAILABLE` response (HTTP 404) where the authorized-read service applies. Stale snapshot uses the existing `STALE_AUTHORIZED_READ_SNAPSHOT` conflict (HTTP 409). Do not reveal target IDs or content in a denial.
- Internal trusted methods such as `getSnapshot`, `getState`, `getEvents`, and `getAudit` are not recipient authorization boundaries and must not be exposed as substitutes for authorized reads.

## 5. Transaction and revocation boundary

- Core canonical event, projection, rollback, and associated audit changes are committed within the existing Core store transaction. A successful rollback updates validity, rebuilds projections, increments `world_revision`, and records rollback/audit state within that transaction.
- The authorized-read service rechecks actor binding and canonical snapshot after policy evaluation. This narrows in-process time-of-check/time-of-use races; it is **not** a cross-process atomic lease and does not serialize a separate Memory store or outbound provider dispatch.
- Revocation that wins before the read's final recheck must prevent content return. The current implementation does not prove an atomic cross-store transaction between Core and Memory, nor a serialized final-dispatch boundary. Do not claim either guarantee.
- A Memory-owned store may persist its own records, but no atomicity with Core events/audit is implied. Core owns canonical event semantics and read authorization; Memory owns its independent persistence/reconciliation mechanism; NPC owns its consumer's requested fields/purpose and must not consume unverified candidates; Host/Adapter owns stable Host identity and complete lifecycle/inventory evidence; Deployment/Security owns process/storage isolation and restore-resistant authority.

## 6. Acceptance status

The existing tests in `tests/authorized-read-service.test.js`, `tests/authorized-read-api.test.js`, and the rollback suite cover individual boundaries. The added `tests/memory-source-trust-contract.test.js` exercises the important combined regression: source retraction can leave `commit_sequence` unchanged, while revision/source validity still makes stale reads fail and invalidates dependent events.

This is not acceptance for production Memory→NPC. That requires source-specific Memory linkage/version evidence, a selected reconciliation/recovery contract, real-path non-disclosure and revocation tests at the actual consumer boundary, and the separately owned Host/Deployment gates. Until those pass, production Memory→NPC remains **DISABLED / FAIL-CLOSED**.
