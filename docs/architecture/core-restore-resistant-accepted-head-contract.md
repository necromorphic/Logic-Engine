# Core decision: local accepted-head consistency and restore boundary

**Status:** DECIDED — local-first accepted-head; full-device anti-rollback is out of scope  
**Owner:** Core for acceptance semantics; local deployment owner for service identity, ACL, backup, and recovery  
**Related:** #140, #181, #264; [local-first deployment decision](../113-local-first-deployment-and-trust-boundary.md)

## Decision

Logic-Engine remains a local engine. Protected Memory operations do not require a VPS, cloud database, or remote authority.

The repository's accepted-head implementation is a separate local loopback service with its own file-backed SQLite database. Core and Provider mutation domains use authenticated clients and the shared Coordinator ordering boundary. The authority database must be protected by a separate local service identity/ACL and excluded from routine Core/Provider restore operations.

This boundary can detect a Core-only or Provider-only restore, and a coordinated Core+Provider restore, only while the authority's accepted state remains newer and is not restored with those stores. A full-device/system-image rollback that also restores the authority database, local-administrator compromise, or device compromise is not covered. The product must not claim full-device anti-rollback or tamper-proof monotonicity.

## Authority boundary

1. **Local and separate:** authority state is stored outside the Core and Provider SQLite files and is not included in their routine backup/restore set. It remains on the local device and is not an external trust anchor.
2. **Authenticated writer and reader:** only designated local Core/Provider/Gateway identities can perform their respective authority operations; Core and Provider cannot assert acceptance by passing a boolean or digest.
3. **Monotonic accepted generation:** an older generation cannot overwrite a newer accepted generation through retry, stale replay, restart, or ordinary restore while the authority database itself remains current.
4. **Identity-bound acceptance:** accepted state is bound to the installation and mutation domain. Host conversation/world/actor identity and source authorization remain separately checked by their owning Core/Host contracts.
5. **Atomic acceptance:** either a complete mutation checkpoint is accepted as one operation or none of it is. Partial writes and verifier errors cannot publish READY.
6. **No raw prompt/message text:** the checkpoint stores only the minimum identifiers, digests, generations, and status needed for mutation consistency and recovery.
7. **Unavailable means NON_READY:** timeout, authentication failure, unavailable authority, malformed response, generation regression, conflicting accepted head, or uncertain recovery cannot fall back to local Core/Provider agreement.
8. **Explicit recovery:** restoring Core or Provider data requires reconciliation against the still-current local authority head. If the authority database was also restored or its lineage is uncertain, the system cannot infer the newer head; protected use remains disabled until a separately reviewed local recovery/re-enrollment procedure establishes a trusted baseline.

A separate SQLite file alone is not an isolation guarantee. The local service identity, filesystem ACLs, backup selection, restore workflow, and recovery evidence must preserve the authority state independently of ordinary Core/Provider restore. This remains a local operational boundary, not protection from a privileged local administrator or full-device rollback.

## Core consumption rules

- Core and Provider mutations covered by accepted-head enforcement must participate in the shared Coordinator order and advance/finalize their domain head through the authenticated local service.
- A boolean `verifyInventorySnapshot` callback is insufficient unless its implementation and trust boundary are identified and tested. Test-only callbacks are never production authority.
- A Core revision cursor is not a substitute for the accepted head. Rollback can invalidate a source without incrementing the cursor.
- The current accepted-head service tracks Core and Provider mutation domains. It does **not** establish complete SillyTavern Host inventory, Host lifecycle coverage, or source-manifest completeness.
- A Host inventory result admitted for reconciliation is not dispatch authorization. Current source/access validity and scope must be revalidated at the approved final serialization point before durable dispatch-start.
- If revocation or invalidation is ordered before dispatch-start, there must be zero outbound transport calls. If dispatch-start wins first, the operation is in-flight and bytes already sent cannot be recalled; retry after ambiguous send is prohibited unless a separately approved idempotency protocol proves safety.
- No protected dispatch is permitted while the local authority is missing, stale, conflicted, or in recovery, or while the Host inventory/final-send gates remain NON_READY.

## Required verification matrix

Use real file-backed Core and Provider stores and the actual local authority implementation, not a test-only callback.

| Scenario | Required result |
|---|---|
| Normal Core/Provider mutation advances accepted head | Mutation commits only with the matching authority operation |
| Exact operation replay | Idempotent; no duplicate mutation |
| Conflicting replay or stale head | Reject; remain NON_READY |
| Core-only restore while authority remains current | Detect mismatch; no protected admission/dispatch |
| Provider-only restore while authority remains current | Detect mismatch; no protected admission/dispatch |
| Coordinated Core+Provider restore while authority remains current | Detect mismatch; no protected admission/dispatch |
| Restore also rolls back authority database | NOT GUARANTEED by this local architecture; require explicit recovery and do not claim anti-rollback |
| Authority unavailable or authentication fails | NON_READY; zero protected outbound transport |
| Concurrent mutation during verification/dispatch | Shared Coordinator prevents mixed-generation dispatch |
| Pending operation after crash/restart | Exact checkpoint recovery only; mismatch remains NON_READY |
| Explicit reviewed local restore/re-enrollment | New baseline is audited; no silent acceptance of arbitrary backup |
| Revocation before dispatch-start | Zero outbound transport calls |
| Unknown/unreviewed route or direct model egress bypass | Protected request is not sent |

## Ownership and exit criteria

- **Core:** enforce accepted-head semantics for Core mutations and consume current Provider/Core evidence at protected admission and final dispatch.
- **Local deployment:** run the loopback authority under a separate local identity; protect its database with ACLs; exclude it from routine Core/Provider restore sets; document backup, restore, and explicit recovery. No remote service is required.
- **Host/Adapter:** provide complete pinned-source inventory and lifecycle changes. Host cannot declare its own snapshot complete or authoritative.
- **Memory Provider:** reconcile local records/index/readiness/revocation against current Core/Provider state and fail closed on uncertainty.
- **Joint acceptance:** real Core+Provider stores, actual local authority, pinned Host persistence evidence, and no-egress dispatch-race tests pass on exact commits.

The local authority does not make the whole machine tamper-proof. No schema/API/runtime behavior is introduced by this decision. Until Host inventory completeness, authorization, and the actual sole-egress path are implemented and verified, production Memory→NPC remains **DISABLED / FAIL-CLOSED**.
