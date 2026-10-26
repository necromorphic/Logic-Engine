# Core proposal: serialized memory disclosure and model dispatch gate

**Status: proposal only — not an approved runtime contract.**  
**Owner:** Core for canonical-state and authorization boundary; Host/Adapter for the actual outbound dispatch integration; Memory Provider for grants, source inventory/reconciliation, and revocation semantics; Product/Security for the disclosure/transport policy.

## Problem statement

The current `AuthorizedReadService` is a narrow, fail-closed field-read boundary. It validates actor binding, recipient, purpose, field policy, and a Core snapshot, then rechecks binding and the composite Core cursor. That reduces in-process TOCTOU exposure but does not control the later SillyTavern outbound request.

The current application entry point wires `SQLiteStore`, `LogicEngine`, and the API server; it does not wire a production Memory→NPC disclosure/dispatch coordinator. A read result is not a dispatch authorization, and `world_revision + commit_sequence` is a snapshot cursor, not a source journal. Rollback may change source validity without increasing `commit_sequence`.

Therefore the production Memory→NPC path remains **DISABLED / FAIL-CLOSED**.

## Decision proposed

Use one **serialized disclosure/dispatch authority** that owns the ordering between:
1. source/grant invalidation becoming effective;
2. the final authorization decision for one exact outbound request;
3. the durable declaration that dispatch has started;
4. handing the request to the outbound transport.

A preflight boolean, signed token, short-lived lease, or second read followed by an independent Host `fetch` is not sufficient by itself: revocation can occur after the check and before the transport call.

### Preferred topology: centralized model egress on the PC

Because the intended deployment keeps Logic-Engine processing on the PC while SillyTavern is the phone UI, the strongest topology is to route model-bound requests that may contain protected Memory through a PC-side egress gateway. The phone Host submits a request to that gateway; it does not independently send protected context to the model provider. The gateway becomes the sole outbound transport owner for this protected route.

This is a proposed topology change, not a statement about the current deployment. It requires Product/Security approval for API-key placement, transport authentication, logging, request retention, provider compatibility, and failure behavior. If credentials or model requests must remain on the phone and Host sends directly to a provider, strict cross-process ordering with PC-side Core/Provider state is **not guaranteed** by a Core-only change.

## Required serialization invariant

Every operation that can affect disclosure eligibility must participate in the same serialization order as dispatch-start. This includes:
- Provider grant creation, revocation, and readiness/reconciliation changes;
- Core source mutation, destruction, rollback/retraction, and status changes relevant to the requested source;
- policy denial or actor/recipient binding invalidation;
- dispatch authorization and dispatch-start.

No relevant writer may bypass this authority. If Core or Provider can mutate state independently while a dispatch is being authorized, the gate cannot claim a linearizable result. If the existing ownership/storage boundaries cannot provide this invariant, remain fail-closed rather than claiming atomicity.

The serialization point is the durable **dispatch-start decision**, recorded before the gateway hands any request bytes to the network transport. If a revoke/deny/invalidation is ordered before dispatch-start, the request must produce **zero outbound requests**. If dispatch-start is ordered first, the request is considered in flight; later revocation cannot recall bytes already handed to the transport. A crash after durable dispatch-start but before network handoff may conservatively count as started; retries must not silently create a second disclosure.

## Request binding and validation

For each outbound request, the gate must bind and validate:
- authenticated adapter identity (not a caller-supplied label alone);
- actor/subject, world, recipient, and purpose;
- the exact canonical Core entity IDs and requested fields that may be disclosed;
- exact source versions for the supported source type;
- current Core world cursor plus each entity's authoritative current revision/status;
- Provider grant and readiness/reconciliation state;
- a complete source inventory/reconciliation result for the declared scope;
- the exact outbound request identity and route being authorized.

Only the currently evidenced direct `canonical_entity` mapping is a candidate: a canonical-decimal Provider `source_version` must match the exact Core entity's current `updated_revision`, with world/entity/status checks. This does **not** authorize other source types. Missing identity/version, destroyed or unknown source, mismatch, stale cursor, rollback/retraction ambiguity, revoked grant, incomplete inventory, unavailable authority, or restart ambiguity must deny disclosure.

Do not treat Provider `record_version`, Provider `source_version`, Core `updated_revision`, and Core `(world_revision, commit_sequence)` as interchangeable.

## End-to-end flow (conceptual, not an API/schema)

1. Host prepares the request but sends protected-context requests only to the PC gateway.
2. Gateway authenticates the adapter and fixes the exact recipient, purpose, source set, fields, and outbound route. The request cannot widen its source set after authorization.
3. The serialized authority checks Core currentness/status, field policy, Provider grants, and complete reconciliation/readiness.
4. If any state is unknown or unavailable, it denies without revealing source content, snippets, counts, or diagnostic details to the caller.
5. Under the same serialization authority, the gateway orders dispatch-start against all revocations and source invalidations.
6. Only a winning dispatch-start may invoke the network transport, exactly once for that request identity. No other Host route may bypass this gate for protected context.
7. Audit records contain minimum non-content metadata needed to prove decisions and replay ordering; raw prompts, memory text, snippets, and secrets are not retained by default.
8. On restart, unresolved dispatches and stale readiness are treated as unknown and fail closed until reconciled. Backup restore must not resurrect revoked grants or old source versions.

This sequence is a behavioral contract sketch. It deliberately does not prescribe a new public API, database schema, outbox, cursor, or token format before owners approve the design.

## Alternatives considered

### A. Host-local preflight check, then direct provider fetch — reject for production
Simple, but Core/Provider revocation can race with the phone's later fetch. A second check only narrows the race. A token/lease is insufficient unless the actual dispatcher and every revocation share the same serialization/fencing authority.

### B. PC-side check, phone-side direct fetch — reject as an atomicity claim
A PC check cannot serialize the phone's transport handoff over an unreliable LAN/bridge. A lost acknowledgement or partition leaves the authority unable to know whether bytes were sent.

### C. PC-side serialized egress gateway — preferred candidate
Makes the same component responsible for the final gate and outbound transport. It still requires all relevant invalidations to participate in its serialization order, authenticated phone-to-gateway requests, explicit secret handling, and a verified single route. If that ownership cannot be enforced, it is not production-ready.

## Ownership and prerequisites

| Work | Owner | Required outcome |
|---|---|---|
| Canonical source revision/status and rollback behavior | Core | Exact current source checks; rollback/retraction regression evidence |
| Grant, source inventory, reconciliation, revocation semantics | Memory Provider | Durable and restart-safe authoritative state; no fixture-only callbacks as authority |
| Host request capture and removal of direct bypass on the protected route | Host/Adapter | Pinned real route routes through gateway; complete route inventory |
| Gateway ordering and sole transport ownership | Core + Host/Adapter | Revoke-before-start gives zero egress; start-before-revoke is classified in-flight |
| Product/security decisions | Product/Security | Approve egress topology, key placement, retention, audit and in-flight revocation semantics |

## Acceptance tests required before enabling production

1. Current authorized source and current grant: exactly one outbound request.
2. Denied field, unknown source type, missing source, stale revision, destroyed source, rollback/retraction, mismatched source version: zero outbound requests.
3. Revoked grant, stale/incomplete inventory, reconciliation not ready, unavailable coordinator, invalid actor binding: zero outbound requests.
4. Deterministic barrier race: revoke wins before dispatch-start → zero transport calls; dispatch-start wins first → exactly one in-flight transport call and explicit outcome.
5. Core rollback where `commit_sequence` is unchanged but `world_revision` changes: stale/retracted source is rejected.
6. Process restart, crash between dispatch-start and transport handoff, retry, database restore, and stale backup: no duplicate disclosure and no resurrection of revoked grants.
7. Enumerate every pinned Host route capable of sending protected context; only the audited gateway route may dispatch. Any bypass fails the release gate.
8. Assert non-disclosure in response bodies and diagnostics: no protected content, snippets, counts, or source-existence oracle on denial.
9. Confirm raw prompt retention is off by default and secrets are excluded from audit.
10. Negative tests prove no egress when any required authority or reconciliation dependency is missing.

## Explicit non-goals

- No production Memory→NPC wiring in this proposal.
- No new runtime API/schema/store/outbox/cursor or guessed Provider contract.
- No modification to the existing SillyTavern vectorization / remote vector storage patch.
- No claim that Core alone can atomically revoke bytes already handed to an external network.
- No production enablement until the cross-owner contract is approved and real-path acceptance tests pass.


## Evidence checkpoint — current owner state (26 Oct 2026)

This checkpoint distinguishes newly demonstrated narrow paths from the still-blocking production requirements.

- **Core rollback/currentness:** Core PR #355 exact-head Runtime CI passed on commit `54bdcc59d66a110be1f9c77c43efee22cda33c74`: `npm test` 602/602 and recalculation harness 8/8. It covers R1→R2→rollback for both attribute update and entity deletion, including restored `updated_revision`, unchanged `commit_sequence`, advancing `world_revision`, and stale-cursor rejection. CI: https://github.com/necromorphic/Logic-Engine/actions/runs/40309904999.
- **Host baseline transport harness:** Host PR #361 (merged as `e220fe6fe3f216825af6362d2115a6a53d2a0968`) pins SillyTavern `06bde939fb1e9c4c8d8641d810f0a916b5bce127`, passes 7/7 source assertions, and demonstrates one server-side Chat Completions request reaching a recording fake provider. This is a bounded baseline handler test, not full ST/browser/Android coverage and not a deny/revocation/zero-egress proof. Details: https://github.com/necromorphic/Logic-Engine/issues/258#issuecomment-6414086193.
- **Host inventory:** Host issue #258 reports no existing authoritative complete active + historical/deleted inventory with missed-change, rollback, and replay detection. Therefore full inventory remains NON_READY.
- **Provider:** Provider issue #181 reports no Provider-owned serialized dispatch seam. Provider-local grants and reconciliation are hardened and tested, but they cannot serialize their separate SQLite writes with Core writes and the Host network handoff.
- **Core:** The source-authority audit and cross-block contract-path matrix are now recorded in this PR. The approved source-version mapping remains limited to `canonical_entity`; injected fixture callbacks are not production authority.

**Result:** the baseline request path is now more concrete, but no shared serialization boundary spans Provider revocation, Core source invalidation, and final outbound transport. The proposed PC-side egress gateway still requires owner approval and implementation. Production Memory→NPC remains `DISABLED / FAIL-CLOSED`.

## Product/Security policy decision — delegated Coordinator defaults (26 Oct 2026)

The policy defaults are recorded in [`docs/security/product-security-protected-memory-disclosure-policy.md`](../security/product-security-protected-memory-disclosure-policy.md).

For design review, the Coordinator approves the PC-side egress gateway as the required topology for protected Memory-bearing requests; provider credentials for those routes stay on the PC; unsupported routes and gateway failures fail closed; raw prompts, Memory payloads, raw Host messages, derived Host summaries, secrets, and provider keys are not durably retained or logged; minimal content-free audit metadata has a 30-day default retention; and ambiguous post-dispatch-start transport outcomes are not automatically retried.

This resolves the **policy-default** questions under the user's delegated Coordinator authority. It does not establish independent human Product/Security sign-off, implement a gateway, authorize a new API/schema, or establish that all send paths are covered. The existing PC/Provider/Host boundaries still do not provide a shared serialization point. The policy is approved for contract/design review only; production Memory→NPC remains **DISABLED / FAIL-CLOSED**.
