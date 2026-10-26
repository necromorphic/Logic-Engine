# Core decision: final Memory disclosure and model-dispatch contract

**Decision owner:** Core  
**Decision date:** 26 Oct 2026  
**Status:** Core semantics are decided below; cross-owner implementation acceptance and production proof remain outstanding. This is not a callable runtime API and does not enable production Memory→NPC.

## 1. Core decision

A protected Memory-derived payload may be sent to a model only through one PC-side serialized egress authority that both (a) makes the final disclosure decision and durably orders dispatch-start, and (b) owns the only outbound transport for that protected request.

A standalone Core `allow`, a preflight read, a token/lease detached from the transport, or a PC check followed by a phone-side direct provider call is not authorization to dispatch. The existing `AuthorizedReadService` remains a bounded in-process source/field-read seam; it is not the final-dispatch gate.

This is the required target architecture for the current phone-UI / PC-processing deployment. It is a contract decision, not a claim that the gateway or the shared ordering already exists.

## 2. Linearization and ordering rule

There must be one enforceable serialization order for all state changes that can make a pending disclosure invalid and the durable dispatch-start decision. Relevant operations include:

- Core canonical source changes, status changes, destruction, rollback/retraction, and policy/binding invalidation;
- Provider query/record grant changes, revocation, source-lineage changes, reconciliation/inventory readiness changes, and recovery/restore transitions;
- the final decision and durable dispatch-start for the exact outbound request.

The ordering point is the durable dispatch-start decision. The gateway must not hand protected request bytes to the network before that decision is durably committed.

- If any relevant denial, revocation, source invalidation, or readiness loss is ordered first, the request is denied and the protected outbound transport invocation count is **zero**.
- If dispatch-start is durably ordered first, the request is in-flight. Later revocation cannot recall bytes already handed to an external transport. The system must not silently resend on timeout, lost acknowledgement, crash, or restart.
- If ordering cannot be established, an authority is unavailable, or the result is ambiguous, fail closed. An ambiguous already-started request remains in-flight/unknown until resolved under an explicitly approved retry policy.
- A duplicate request identity cannot create a second protected disclosure. Reuse of the same identity with a different payload or binding is rejected.
- No relevant writer may bypass the serialization authority. If a Core or Provider writer can commit independently without participating in the same order, the atomicity claim is false and protected dispatch remains disabled.

A process-local mutex is insufficient if a writer or the gateway can run in another process. Sequentially checking Core then Provider, or Provider then Core, is also insufficient. Existing separate SQLite transactions do not by themselves create a cross-store serialization boundary.

## 3. Request binding required for every dispatch

The final decision must apply to one immutable, exact request and must not be reusable for a later or modified request. Before dispatch-start, the authority must bind and validate all of the following using authenticated identities and owner-approved existing contracts:

1. Authenticated Host/adapter instance and actor binding; caller-supplied labels alone are not identity proof.
2. Exact world, subject/actor, recipient/model route, and purpose.
3. Exact protected source-record identities and Provider record versions used for this request.
4. Exact source type, source identity, and source version for each protected source.
5. Exact fields/content manifest or an equivalently strong binding to the protected bytes that will be sent. Any post-decision mutation of the payload invalidates the decision.
6. Current Core source state and policy decision at the serialization point.
7. Current Provider grants and complete, current reconciliation/inventory readiness for the relevant scope.
8. A unique request identity with durable duplicate/conflict handling and explicit crash/retry semantics.
9. The exact outbound route and payload that the gateway itself will send.

The contract does not prescribe a public endpoint, payload schema, table, outbox, cursor, token format, or new store. Those implementation details require a separate design freeze grounded in the actual owners' persistence and transport paths. They must not be guessed in adapter code.

## 4. Core-owned source authority

For direct `canonical_entity` records only, the approved source-version mapping is:

- Provider `source_version` is the canonical decimal string of the exact current Core entity's non-negative `updated_revision`;
- compare it for exact equality with the entity returned by `LogicEngine.getSnapshot(worldId, { entityIds: [source_entity_id] })`;
- require exact world/entity binding and an explicitly valid status; absent, destroyed, unknown, malformed, mismatched, or unavailable source state denies;
- revalidate the Core snapshot cursor `(world_revision, commit_sequence)` as a stale-snapshot detector, but never treat it as a source journal or as a substitute for the per-entity version check.

Provider `record_version`, Provider `source_version`, Core `updated_revision`, and Core `(world_revision, commit_sequence)` are distinct values with distinct meanings. The approved mapping does not authorize derived summaries or other source types, prove complete inventory, prove historical lineage, or establish end-to-end dispatch atomicity.

Rollback may restore an earlier entity revision while `commit_sequence` remains unchanged. The final decision must reject a record pinned to the rolled-back revision. Core's rollback/read-currentness regressions are covered by draft PR [#368](https://github.com/necromorphic/Logic-Engine/pull/368), exact head `9fc6d7ca107993b97798406376f79252539ddfcc`, Runtime CI [#40314713771](https://github.com/necromorphic/Logic-Engine/actions/runs/40314713771): `npm test` 625/625; recalculation oracle 8/8. This is Core regression evidence, not a production egress proof.

## 5. Failure and disclosure behavior

The decision is fail-closed if any required fact is false, missing, stale, partial, conflicting, unavailable, or unverifiable. This includes unknown source type; absent or destroyed source; version mismatch; rollback/retraction ambiguity; missing or revoked grant; incomplete or stale inventory/reconciliation; invalid actor binding; denied field/purpose/recipient; unknown request identity; unavailable serialization authority; and ambiguous recovery state.

Denial responses and diagnostics must not disclose protected source text, snippets, source counts, source-existence oracles, prompts, API keys, or other secrets. Audit evidence may contain only the minimum non-content metadata needed to prove ordering and correlate a request. Raw prompt/content retention is off by default.

No positive fixture callback, candidate label, index-ready flag, successful retrieval, NPC admission result, or test-only helper counts as production authority.

## 6. Owner obligations

- **Core:** provide the current canonical source/status/revision predicate and field/purpose/actor policy; ensure every relevant Core mutation/invalidation participates in the agreed ordering; retain rollback regression coverage.
- **Memory Provider:** provide durable grant/revocation and reconciliation/readiness state; establish authoritative inventory completeness and lineage for the supported scope; ensure all relevant Provider writers participate in the same ordering. Provider-local SQLite checks alone do not serialize with Core or network dispatch.
- **Host/Adapter:** route every protected outbound request through the PC-side gateway; enumerate the exact pinned Host routes and prove there is no direct-provider, extension, retry, regenerate, continuation, or alternate-backend bypass for protected content. Host remains UI/capture owner; it must not become a second Memory Provider.
- **Product/Security:** decide provider-key placement, phone-to-PC authentication, minimum audit metadata, retention, timeout/cancellation behavior, and the explicit treatment of in-flight/ambiguous requests and manual retries.
- **Joint implementation owners:** select and implement the concrete shared serialization mechanism, including crash durability and restore behavior. The chosen mechanism must be enforceable by all relevant writers, not merely documented.

These obligations allocate implementation responsibility; they do not let one owner assert another owner's authority or mark an unimplemented boundary as passed.

## 7. Required acceptance evidence

Before protected Memory can be enabled in production, exact-head tests using real persistence writers and the pinned Host transport must prove:

1. Valid current source + valid grants + complete reconciliation produces exactly one outbound call.
2. Denied actor/field/purpose/recipient, unknown source type, missing/destroyed source, stale or mismatched source version, and rollback/retraction produce zero calls.
3. Provider revocation/readiness loss ordered before dispatch-start produces zero calls.
4. Dispatch-start ordered before revocation is durably classified in-flight and cannot cause a duplicate disclosure after retry/restart.
5. Duplicate request identity is idempotent; conflicting reuse is rejected.
6. Core and Provider unavailability, partial inventory, stale reconciliation, and unknown serialization state produce zero calls.
7. Crash before dispatch-start, crash after dispatch-start but before handoff, lost acknowledgement after handoff, restart, and stale-backup restore follow the stated fail-closed/no-duplicate rules.
8. Every protected Host route reaches the sole gateway; any bypass blocks release.
9. Denial/error responses and logs contain no protected content or secrets.
10. Existing SillyTavern vectorization and the separate remote vector-store patch remain unchanged.

Tests must record the exact Core, Provider, and Host SHAs, deterministic barrier ordering, observed outbound-call count, durable final state, and CI URL. Sleeps, pure helper tests, fixture-positive validators, and baseline fake-provider success are not sufficient for the race/zero-egress claims.

## 8. Current disposition

**Core semantics: DECIDED. Cross-owner implementation contract: NOT YET ACCEPTED. Production egress: NOT IMPLEMENTED/NOT PROVEN.**

The present code has no approved serialized dispatch seam: `AuthorizedReadService` does not own outbound transport; Provider writes use separate persistence boundaries; the pinned Host baseline test is not a universal final-send gate; Host has reported no authoritative complete active + historical/deleted source inventory. Therefore production Memory→NPC remains **`DISABLED / FAIL-CLOSED`**.

Next implementation work is to map the actual Core and Provider writers onto one enforceable serialization mechanism and route protected transport through the PC gateway, then add deterministic race/crash/restore tests. If any relevant writer cannot participate, do not weaken the invariant; retain fail-closed behavior and revise the storage/ownership design before runtime implementation.

The existing SillyTavern vectorization and remote-store patch are explicitly out of scope and must not be changed by this contract.
