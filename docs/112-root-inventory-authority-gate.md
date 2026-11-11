# Root Inventory Authority — implementation gate

**Branch:** `integration/host-core-v1`  
**Status:** BLOCKED ON TRUST-BOUNDARY DECISION / DEPLOYMENT AUTHORITY  
**Date:** 2026-11-11

## Current verified state

1. `tests/host-source-inventory.test.js` ran on Windows PowerShell / Node.js 22.18.0: 17 passed, 0 failed, 1 skipped. The suite includes the audited Windows VSS point-in-time snapshot path. It validates a bounded scanner candidate, not an authoritative production inventory.
2. The scanner's own disposition remains `DOUBLE_SCAN_CANDIDATE` / `NON_AUTHORITATIVE`.
3. `src/index.js` constructs `HostVersionDigestLedger` with `verifyInventorySnapshot: async () => false`. This is an intentional production deny-only gate. It must not be replaced by a permissive callback or a test fixture.
4. `HostLifecycleJournal` stores append-only root inventory baseline/delta records and validates signed attestations. Its root inventory endpoints remain review-only unless the trusted authority checks succeed.
5. `ENGINE_HOST_ROOT_IDENTITIES` is a deployment-owned allowlist for adapter, installation, account, root and pinned source-manifest digest. It is identity configuration, not by itself an independent monotonic accepted-head authority.
6. A signed HMAC attestation under an adapter secret proves possession of that shared secret. It does not, by itself, prove that the signer is outside the Host/Core joint restore domain or that an old Host+Core+Provider backup cannot roll the entire state back together.

## Why implementation must stop at this boundary

The accepted-head contract in `docs/architecture/core-restore-resistant-accepted-head-contract.md` explicitly requires an independent authority outside the joint Host/Core/Provider restore domain. It must maintain a monotonic accepted generation/head and support independent backup, restore, access control, monitoring and authorized recovery.

No such deployed authority endpoint, durable service, trust anchor, operational owner or recovery procedure is currently identified in the repository configuration. Implementing a local SQLite table, another HMAC callback, or a boolean verifier inside Core would only create a second copy inside the same trust/restore domain and would falsely label the inventory authoritative.

Therefore do not:
- change the production verifier from deny-only to allow;
- treat the current VSS snapshot, source-manifest pin, local journal hash chain or HMAC alone as independent accepted-head authority;
- promote `DOUBLE_SCAN_CANDIDATE` to `READY`;
- enable Memory → NPC.

## Smallest safe next implementation block

After a deployment-owned independent authority is selected and provisioned:

1. Define its authenticated request/response contract for `(adapter_id, installation_id, account_id, root_id, inventory_sequence, inventory_head_sha256, source_manifest_sha256, lifecycle_sequence, lifecycle_head_sha256)`.
2. The authority atomically accepts only a complete, strictly increasing generation; exact replay is idempotent, conflicting replay and rollback are rejected.
3. Core reads and verifies the accepted head through an authenticated client; unavailable, stale, conflicting, malformed or unauthenticated responses remain NON_READY.
4. Core's `verifyInventorySnapshot` implementation compares the complete submitted snapshot against that authority's accepted head. It must not trust caller-provided `complete=true`, a local journal head, or the attestation's own digest.
5. Add file-backed integration tests using the real authority implementation for normal advancement, stale replay, Core-only restore, Provider-only restore, coordinated restore, authority outage, concurrent mutation, restart and explicit recovery.
6. Re-run the exact Windows Host Source Inventory + Host/Core/SQLite E2E sequence on one exact candidate and retain independent evidence.

## Required deployment input

Implementation cannot be completed safely until the deployment provides:
- the selected authority service/process and its operational owner;
- proof that its storage and backups are outside the Host/Core/Provider joint restore domain;
- its endpoint or local IPC boundary and authentication/trust-anchor mechanism;
- durability/backup/restore and monotonic-generation guarantees;
- an authorized recovery procedure.

Until then the correct implementation is to preserve the fail-closed production gate. This is a dependency blocker, not a failing test.
