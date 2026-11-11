# Root Inventory — local-first implementation gate

**Branch:** `integration/host-core-v1`  
**Status:** BLOCKED ON HOST INVENTORY COMPLETENESS / LIFECYCLE EVIDENCE  
**Date:** 2026-11-11  
**Architecture decision:** [Local-first deployment and trust boundary](113-local-first-deployment-and-trust-boundary.md)

## Decision context

Logic-Engine is a local engine. A VPS, cloud database, or remote accepted-head service is not required. Core and Memory Provider use Logic-Engine-owned local SQLite storage. The repository's accepted-head authority is a local loopback service with its own SQLite database; it is not an external service.

The local accepted-head service protects Core/Provider mutation consistency and can detect a partial or coordinated Core+Provider restore only while its own accepted state is preserved outside that restore. It does not protect against a full-device rollback that also restores the authority database. The project explicitly does not claim that guarantee.

This decision does not remove the Host inventory completeness requirement. Host inventory completeness, Core/Provider accepted-head consistency, and final outbound dispatch authorization are separate gates.

## Current verified state

1. The user ran `tests/host-source-inventory.test.js` on Windows PowerShell / Node.js 22.18.0: 17 passed, 0 failed, 1 skipped. The suite includes the audited Windows VSS point-in-time snapshot path. It validates a bounded scanner candidate, not an authoritative production inventory.
2. The scanner's own disposition remains `DOUBLE_SCAN_CANDIDATE` / `NON_AUTHORITATIVE`.
3. `src/index.js` constructs `HostVersionDigestLedger` with `verifyInventorySnapshot: async () => false`. This is an intentional production deny-only gate. It must not be replaced by a permissive callback or a test fixture.
4. `HostLifecycleJournal` stores append-only root inventory baseline/delta records and validates signed attestations. These records do not independently prove complete coverage of all supported SillyTavern data and lifecycle paths.
5. `ENGINE_HOST_ROOT_IDENTITIES` is a deployment-owned allowlist for adapter, installation, account, root and pinned source-manifest digest. It is identity configuration, not proof that the complete Host source inventory was captured.
6. A signed HMAC attestation under an adapter secret proves possession of that shared secret. It does not prove inventory completeness or protect against compromise of the local host.
7. The local accepted-head service in `scripts/security/run-accepted-head-authority.js` maintains separate Core and Provider heads. It does not currently attest the complete Host inventory and must not be described as doing so.

## Why the production gate remains closed

The scanner is still non-authoritative and the production verifier is deny-only. The missing proof is not a remote server. The missing proof is a complete, pinned Host inventory/lifecycle contract and a production verifier that consumes that exact evidence safely.

Known Host coverage gaps must be closed or explicitly excluded from the product guarantee, including unsupported destructive/import/restore operations, branch/copy lineage, pre-enrollment history, external filesystem changes, and any extension/plugin route that can mutate relevant data outside the audited lifecycle.

Therefore do not:
- change the production verifier from deny-only to allow without a real completeness verifier and exact integration tests;
- treat the current VSS snapshot, source-manifest pin, local journal hash chain, or HMAC alone as proof of complete inventory;
- promote `DOUBLE_SCAN_CANDIDATE` to `READY`;
- claim protection against full-device rollback or local-administrator compromise;
- add a mandatory VPS, cloud database, or remote authority as a prerequisite;
- enable Memory → NPC.

## Smallest safe next implementation block

1. Freeze the supported SillyTavern source roots and lifecycle operations for the pinned build. For every operation, identify the authoritative persisted source, mutation route, identity/lineage effect, and how unsupported paths fail closed.
2. Complete the Host inventory envelope so it represents the supported set atomically and binds it to the authenticated installation/account/root and Core conversation/world binding.
3. Implement the production verifier only against that complete contract. It must reject partial scans, missing roots, stale or conflicting generations, malformed identities, incomplete lifecycle evidence, and verifier errors.
4. Use the existing local accepted-head service only for the Core/Provider mutation and partial-restore guarantees it actually provides. Keep its database outside routine Core/Provider backups, under a separate local service identity/ACL, and document recovery. Do not claim it detects a full-device rollback that includes its database.
5. Prove that the pinned SillyTavern production composition routes protected Memory disclosure through the approved Gateway and final revalidation before the sole model transport. Host inventory readiness alone is not dispatch authorization.
6. Add file-backed tests for complete/incomplete inventory, stale replay, mutation during scan, restart/recovery, local authority outage/mismatch, and zero-egress denial. Run the exact Windows Host/Core/SQLite/Gateway acceptance path on one exact candidate.

## Acceptance and release conditions

- Host inventory: complete for the declared supported surface, or unsupported paths explicitly rejected and documented.
- Core/Provider consistency: local accepted-head protocol passes its real file-backed restart, mutation, pending-operation, and partial-restore tests.
- Recovery: the authority database and Core/Provider databases have explicit local backup/restore rules; uncertain authority lineage remains NON_READY.
- Final dispatch: revocation or readiness loss before durable dispatch-start produces zero outbound calls; the actual pinned Host route cannot bypass the Gateway.
- Full-device rollback and local-administrator compromise remain outside the stated guarantee unless a separate hardware-backed trust design is approved.

Until the Host inventory, authorization, lifecycle, and sole-egress gates pass, production Memory → NPC remains **DISABLED / FAIL-CLOSED**. This is a product safety gate, not a reason to provision external infrastructure.
