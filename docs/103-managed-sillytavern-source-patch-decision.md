# ADR 103 — Managed SillyTavern source patch for Final-Send

**Status:** Accepted for the pinned SillyTavern 1.19.0 deployment candidate only.  
**Date:** 2026-11-02  
**Supersedes:** the blanket no-source-modification deployment conclusion in documents 101 and 102, only within the bounded scope below.  
**Implementation:** Logic-Engine PR #855; not production-ready until its acceptance gates pass.

## Context

The inspected SillyTavern 1.19.0 extension APIs do not provide a supported server-side interception point around every native provider sender and the final response path. A client extension or ordinary server-plugin route cannot prove control of native provider egress. The prior non-invasive-only constraint therefore leaves the requested native final-send security boundary unavailable.

## Decision

For the exact pinned SillyTavern source revision `06bde939fb1e9c4c8d8641d810f0a916b5bce127` (package version 1.19.0), accept a local managed source patch as a deployment exception.

The exception is limited to:
- the exact package version, commit, and pinned source hashes encoded by Patch Manager;
- the exact native chat-completions generation endpoint and hook payload reviewed in PR #855;
- installation only after preflight verifies all pinned files and exact patch anchors;
- byte-exact backup before mutation, atomic writes, post-write hash verification, and fail-closed refusal on any unknown version, source drift, hook drift, or user edit;
- durable state and backup outside both the removable Logic-Engine plugin directory and SillyTavern `src`;
- crash-recoverable install and restore/uninstall transactions;
- exact byte restoration on uninstall; no automatic clobbering of drifted/user-edited files.

No reverse proxy, Provider Relay, alternate model connector, Base URL override, or upstream SillyTavern repository modification is authorized by this ADR.

## Security requirements and accepted risk

This approach changes local upstream application code and therefore carries a larger maintenance and supply-chain risk than a supported extension hook. That risk is accepted only for a single pinned revision and is controlled by exact hashes, reviewed transforms, external backup, fail-closed behavior, explicit recovery journaling, and CI on Windows and Linux.

Patch Manager is not permitted to silently adapt to a new SillyTavern release. A version or hash change must stop installation/update and require a separately reviewed target revision and new test evidence. User modifications must be preserved; conflicts must stop without overwrite.

The patch is not itself authorization. Core remains the sole Memory authorization authority. The Host Adapter must supply authenticated server-side context. The in-process Gateway must enforce pre-egress authorization, durable dispatch-start, shared revoke ordering, no retry on ambiguous outcomes, and final response revalidation. The ordinary fail-closed adapter does not create protected Memory context.

## Backup and recovery contract

- State root is `<SillyTavern>/data/logic-engine/final-send-patch`, outside `plugins/logic-engine` and `src`.
- Backup bytes and manifest must survive removal/replacement of the Logic-Engine plugin directory.
- Restore/uninstall writes a durable `restore-pending.json` journal before changing the endpoint or hook.
- Startup and explicit restore must idempotently finish a journaled restore only when endpoint, hook, manifest, and backup hashes match the journal.
- Any unexpected bytes, missing/invalid backup, path escape, or manifest mismatch fails closed and preserves the conflicting files for manual investigation.
- Tests must inject interruption before endpoint restore, after endpoint restore, and after hook removal/before manifest cleanup, and must prove restart recovery.

## Activation gates

This ADR does not authorize production Memory → NPC activation or merge by itself. The following remain required:
1. Patch Manager install/verify/update/repair/uninstall and crash recovery pass on Windows and Linux.
2. Backup survives plugin removal and restore remains possible.
3. Every protected native route is proven covered on the exact pinned ST build.
4. Durable `DISPATCH_STARTED`, shared Coordinator lease, revoke race, final revalidation, crash recovery, and no-retry are proven through the real Host/Gateway path.
5. Live SillyTavern tests prove upstream call-count and zero-egress on denied/revoked requests.
6. CI and review are green on the exact candidate HEAD.

Until every gate passes, the deployment is **NON_READY** and Memory → NPC remains **DISABLED / FAIL-CLOSED**.
