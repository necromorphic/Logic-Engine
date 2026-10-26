# Core decision: restore-resistant accepted-head authority

**Status:** Core security contract for implementation planning; no runtime authority exists by virtue of this document.  
**Owner:** Core for acceptance semantics; Deployment/Security for operating the independent authority.  
**Related:** #140, #181, #264; Core characterization PR #388; Provider ledger PR #389; dispatch gate plan.

## Decision

Core will not treat world_revision + commit_sequence, a Provider-local digest ledger, a Host-local journal, or agreement between the current Core and Provider databases as proof against coordinated rollback. The passing characterization in #388 demonstrates that restoring both databases to a previously matching pair can make an old source appear current under the present markers.

Protected Memory readiness requires a restore-resistant accepted-head authority that is outside the joint Core+Provider database restore domain. Core owns the policy that consumes that authority and the rule that a missing, stale, conflicting, or unreachable checkpoint leaves the protected path NON_READY. Deployment/Security owns provisioning, isolation, durability, backup/restore boundaries, and operational recovery of the authority.

## Authority boundary

The authority must satisfy all of the following before it can be used:

1. **Independent restore domain:** it is not stored only in either Core or Provider SQLite, Host IndexedDB/localStorage, or a backup set that is routinely restored together with those stores.
2. **Authenticated writer and reader:** only the designated trusted coordinator/deployment component can advance accepted state; Core and Provider callers cannot assert acceptance by passing their own boolean or digest.
3. **Monotonic accepted generation:** an older generation cannot overwrite a newer accepted generation through retry, stale replay, restart, or ordinary restore.
4. **Identity-bound acceptance:** accepted state is bound to the Core-authorized world assignment and the Host conversation identity plus the complete accepted inventory's immutable version identities, active selections, and tombstones. The authority must not infer the binding from a caller-supplied world_id.
5. **Atomic acceptance:** either the complete snapshot is accepted as one generation or none of it is. Partial writes and verifier errors cannot publish READY.
6. **No raw prompt/message text:** the checkpoint stores only the minimum identifiers, digests, generations, and status needed to detect rollback and reconcile lifecycle state. No raw Memory or Host message content is needed.
7. **Unavailable means NON_READY:** timeout, authentication failure, unavailable authority, malformed response, generation regression, conflicting accepted head, or uncertain recovery cannot fall back to local Core/Provider agreement.
8. **Explicit restore/re-enrollment:** restoring Core or Provider data requires reconciliation against the current independent accepted head. Restoring an old pair does not reset the authority. If authority itself was restored or its lineage is uncertain, protected use remains disabled until a separately authorized recovery procedure re-establishes trust.

This is a trust-boundary contract, not a decision to use a particular network protocol, table, file format, API name, or vendor. Those choices require a deployment threat model and a separately reviewed implementation proposal. A second SQLite file on the same ordinary backup path is not automatically an independent authority.

## Core consumption rules

- Before a Provider snapshot can be considered current, Core/Provider reconciliation must compare its source identity, inventory generation, active pointers, and tombstones with the accepted head supplied by the independent authority.
- A boolean verifyInventorySnapshot callback is insufficient unless its implementation and trust boundary are identified and tested. Test-only callbacks are never production authority.
- A Core revision cursor is not a substitute for the accepted head. Rollback can invalidate a source without incrementing the cursor.
- A result admitted to NPC context is not dispatch authorization. The current accepted head, source/access validity, and scope must be revalidated at the approved final serialization point before durable dispatch-start.
- If revocation or invalidation is ordered before dispatch-start, there must be zero outbound transport calls. If dispatch-start wins first, the operation is in-flight and bytes already sent cannot be recalled; retry after ambiguous send is prohibited unless a separately approved idempotency protocol proves safety.
- No protected dispatch is permitted while the authority is missing, stale, conflicted, or in recovery.

## Required verification matrix

The implementation must use real file-backed stores and the actual authority implementation, not a test-only callback, for at least these cases:

| Scenario | Required result |
|---|---|
| Normal inventory advances and authority accepts new generation | Current generation can reconcile; prior generation is rejected |
| Replay old active selection with unchanged identities/digests | NON_READY; no protected admission or dispatch |
| Core-only restore | Reconcile against current authority; stale state cannot become READY |
| Provider-only restore | Reconcile against current authority; stale state cannot become READY |
| Coordinated Core+Provider restore | Old matching pair is rejected against independent accepted head |
| Authority unavailable or authentication fails | NON_READY; zero outbound transport |
| Concurrent inventory mutation during verification | No mixed-generation READY publication |
| Tombstone or access revocation races with reconciliation | Incomplete/uncertain state remains NON_READY |
| Restart/replay after successful acceptance | Same accepted generation is recoverable without rolling back head |
| Explicit authorized restore/re-enrollment | New accepted generation is recorded; audit and recovery procedure are exercised |
| Authority restore/lineage uncertain | Protected use remains disabled until trust is re-established |
| Revocation before dispatch-start | Zero outbound transport calls |
| Unknown/unreviewed route or direct phone egress | Protected request is not sent |

## Ownership and exit criteria

- **Core:** define canonical binding consumption, require accepted-head freshness before protected admission, and integrate final revalidation with the actual dispatch serialization point after the contract is approved.
- **Deployment/Security:** implement and operate an authority outside the joint restore domain; document threat model, identity, access control, durability, independent backup/restore, monitoring, and authorized recovery.
- **Host/Adapter:** provide complete pinned-source inventory and lifecycle changes; Host cannot declare its own snapshot authoritative or complete.
- **Memory Provider:** reconcile local records/index/readiness/revocation against the accepted inventory and fail closed on uncertainty.
- **Joint acceptance:** real Core+Provider stores, actual authority, pinned Host persistence evidence, and no-egress dispatch-race tests all pass on exact commits.

No schema/API/runtime behavior is introduced here. The contract does not claim an authority currently exists. Until the independent authority and its consumers are implemented and verified, coordinated restore remains an open blocker and production Memory→NPC remains **DISABLED / FAIL-CLOSED**.
