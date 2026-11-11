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
3. `verifyPinnedSillyTavernMutationCoverage` proves that 89 reviewed route declarations and their expected middleware names exist in the pinned source. It hashes those source files. It does **not** execute the routes or prove that the middleware creates durable mutation receipts.
4. The current ST middleware seams (`createHostUnsupportedMutationGuard`, `createHostBulkMutationGuard`, `createHostLifecycleSaveGuard`, and `createHostAccountMutationMiddleware`) deliberately delegate to `next()`. Native ST operations continue; they are not blocked by Host and do not by themselves produce runtime-acceptance evidence.
5. The inventory diagnostics response includes `UNVERIFIED_MUTATION_RUNTIME_ACCEPTANCE`, but that response-only blocker was not consumed by the generation authentication gate. A valid-looking Core root attestation could therefore have been treated as sufficient by the gate despite the missing runtime acceptance evidence. This gap is now closed in the generation gate by a separate mandatory runtime-verifier check.
6. `src/index.js` constructs `HostVersionDigestLedger` with `verifyInventorySnapshot: async () => false`. This is an intentional production deny-only gate. It must not be replaced by a permissive callback or a test fixture.
7. `HostLifecycleJournal` stores append-only root inventory baseline/delta records and validates signed attestations. These records do not independently prove complete coverage of all supported SillyTavern data and lifecycle paths.
8. `ENGINE_HOST_ROOT_IDENTITIES` is a deployment-owned allowlist for adapter, installation, account, root and pinned source-manifest digest. It is identity configuration, not proof that the complete Host source inventory was captured.
9. A signed HMAC attestation under an adapter secret proves possession of that shared secret. It does not prove inventory completeness or protect against compromise of the local host.
10. The local accepted-head service in `scripts/security/run-accepted-head-authority.js` maintains separate Core and Provider heads. It does not currently attest the complete Host inventory and must not be described as doing so.

## Why the production gate remains closed

The scanner is still non-authoritative and the production Host inventory/runtime-acceptance gate remains fail-closed. The embedded runtime now verifies terminal mutation-event HMACs against the adapter token using the same shared signer as the Host proxy. This repairs the receipt-signature contract for the already-supported message lifecycle operations; it does not prove coverage of the other pinned ST mutation routes. Static route coverage is not runtime acceptance. The missing proof remains a complete, pinned Host inventory/lifecycle contract, operation-specific durable receipts or equivalent verified runtime evidence for every supported route, and a production verifier that consumes that exact evidence safely.

Known Host coverage gaps must be closed or explicitly excluded from the product guarantee, including unsupported destructive/import/restore operations, branch/copy lineage, pre-enrollment history, external filesystem changes, and any extension/plugin route that can mutate relevant data outside the audited lifecycle.

Therefore do not:
- change the production verifier from deny-only to allow without a real completeness verifier and exact integration tests;
- treat the current VSS snapshot, source-manifest pin, local journal hash chain, or HMAC alone as proof of complete inventory;
- promote `DOUBLE_SCAN_CANDIDATE` to `READY`;
- claim protection against full-device rollback or local-administrator compromise;
- add a mandatory VPS, cloud database, or remote authority as a prerequisite;
- enable Memory → NPC.

## Smallest safe next implementation block

1. Implement the operation-specific runtime acceptance evidence for the frozen SillyTavern mutation surface. The verifier must be production-composed, bound to the exact pinned source, current VSS snapshot, source manifest and mutation-route manifest, and must reject missing, stale or mismatched evidence. Until it exists, Host generation authentication must return `HOST_MUTATION_RUNTIME_ACCEPTANCE_UNVERIFIED` before Core root attestation or context resolution.
2. Freeze the supported SillyTavern source roots and lifecycle operations for the pinned build. For every operation, identify the authoritative persisted source, mutation route, identity/lineage effect, and how unsupported paths fail closed.
3. Complete the Host inventory envelope so it represents the supported set atomically and binds it to the authenticated installation/account/root and Core conversation/world binding.
4. Implement the production verifier only against that complete contract. It must reject partial scans, missing roots, stale or conflicting generations, malformed identities, incomplete lifecycle evidence, and verifier errors.
5. Use the existing local accepted-head service only for the Core/Provider mutation and partial-restore guarantees it actually provides. Keep its database outside routine Core/Provider backups, under a separate local service identity/ACL, and document recovery. Do not claim it detects a full-device rollback that includes its database.
6. Prove that the pinned SillyTavern production composition routes protected Memory disclosure through the approved Gateway and final revalidation before the sole model transport. Host inventory readiness alone is not dispatch authorization.
7. Add file-backed tests for complete/incomplete inventory, stale replay, mutation during scan, restart/recovery, local authority outage/mismatch, and zero-egress denial. Run the exact Windows Host/Core/SQLite/Gateway acceptance path on one exact candidate.

## Current receipt-backed mutation boundary

The Host/Core terminal receipt contract now includes `rename-chat` in addition to the eight existing message lifecycle operations. A rename receipt is valid only when the same logical conversation, file identity and content bytes remain intact; only its locator/path may change, with no unrelated root/source or backup changes. The ST patch, Host proxy allowlist, server receipt store and Core journal allowlist must stay aligned.

The static 89-route mutation inventory is not equivalent to 89 operation-specific receipts. The production Patch Manager manifest v2.0.0 now declares the ordered Final-Send, lifecycle-hooks and root-mutation-guards artifacts as one transaction. The latter two patch files remain in the legacy `host-adapter/prototype/patches/` directory, but they are production inputs referenced by the manifest. CI applied the complete bundle to the pinned ST commit and passed install, backup inspection, verification and uninstall with all 44 source files restored and all six created files removed. This proves the installer bundle, not that a user's existing ST process has been upgraded or that runtime acceptance is enabled. Only these nine operations currently have the narrow terminal receipt contract: `create-message`, `message-send`, `message-receive`, `create-swipe`, `select-swipe`, `delete-swipe`, `delete-message`, `edit-message`, `rename-chat`. Other ST mutation routes remain unsupported for authoritative generation acceptance. The account-mutation receipt store has recovery checks in production composition but its prepare/commit protocol is not yet connected around native account mutation routes; do not count those routes as receipt-backed.

## Acceptance and release conditions

- Host inventory: complete for the declared supported surface, or unsupported paths explicitly rejected and documented.
- Core/Provider consistency: local accepted-head protocol passes its real file-backed restart, mutation, pending-operation, and partial-restore tests.
- Recovery: the authority database and Core/Provider databases have explicit local backup/restore rules; uncertain authority lineage remains NON_READY.
- Final dispatch: revocation or readiness loss before durable dispatch-start produces zero outbound calls; the actual pinned Host route cannot bypass the Gateway.
- Full-device rollback and local-administrator compromise remain outside the stated guarantee unless a separate hardware-backed trust design is approved.

Until the Host inventory, authorization, lifecycle, and sole-egress gates pass, production Memory → NPC remains **DISABLED / FAIL-CLOSED**. This is a product safety gate, not a reason to provision external infrastructure.
