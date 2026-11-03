# SillyTavern Final-Send Patch Manager

**Status:** source patch and local lifecycle manager implemented; production Host/Core/Provider binding is NOT READY. Do not enable protected Memory dispatch.  
**Pinned host:** SillyTavern 1.19.0, source commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.

## Deployment entrypoint

The Logic-Engine deployment entrypoint installs a pinned local patch into the installed SillyTavern tree. The patch adds server-side calls to the existing `/api/extensions/install`, `/api/extensions/update`, and `/api/extensions/delete` handlers. These calls invoke Patch Manager inside the existing ST process; they do not create a new HTTP endpoint or resident process.

Initial bootstrap and repair:

```powershell
$env:LOGIC_ENGINE_SILLYTAVERN_ROOT = "C:\path\to\SillyTavern"
npm run install:extension
```

Direct lifecycle commands:

```powershell
node scripts/sillytavern-patch-manager.mjs preflight --st-root "C:\path\to\SillyTavern"
node scripts/sillytavern-patch-manager.mjs install --st-root "C:\path\to\SillyTavern"
node scripts/sillytavern-patch-manager.mjs verify --st-root "C:\path\to\SillyTavern"
node scripts/sillytavern-patch-manager.mjs repair --st-root "C:\path\to\SillyTavern"
node scripts/sillytavern-patch-manager.mjs update --st-root "C:\path\to\SillyTavern"
node scripts/sillytavern-patch-manager.mjs uninstall --st-root "C:\path\to\SillyTavern"
```

The native lifecycle Hook accepts only the server-derived Extension path, checks the exact manifest marker, validates the canonical HTTPS GitHub origin, and dynamically imports Patch Manager from that Extension. The browser-side Extension is not trusted to perform filesystem operations.

The server-plugin `init()` runs after SillyTavern has imported its native generation routers. It therefore performs read-only verification only; it never applies or updates the source patch during startup. The patch must be installed by the deployment entrypoint or Extension lifecycle before a SillyTavern restart. If the exact patch and backups are not already verified, plugin startup refuses adapter registration and requires a restart after repair. Normal server shutdown does not uninstall the patch; only the explicit Extension delete lifecycle restores the original Host files.

## Lifecycle guarantees implemented

- Preflight checks the exact ST version, source-file fingerprints, patch artifact digest, and `git apply --check`.
- Every modified source file is backed up before apply; a durable transaction journal is written before mutation.
- Verify checks exact post-patch hashes for modified and created files.
- Read-only inspection re-hashes installed files and backups, checks the complete backup set, and rejects an active journal. It is not a signed runtime attestation or anti-rollback freshness proof.
- Rollback/uninstall restores only files matching known manager-owned hashes and preserves unknown user edits.
- Install/update/delete lifecycle hooks invoke the manager from the native ST server route. A rollback conflict blocks Extension deletion.
- Crash recovery processes the journal before the next operation; ambiguous locks and source states fail closed.

Manager state, transaction journal and byte-exact backups are stored under `data/logic-engine/final-send-patch/` inside the ST data tree, outside the removable Extension directory. Restore uses a durable transaction journal and fsync-backed atomic replacement; interrupted restore is replayed idempotently on the next manager operation. Directory fsync is used where the platform supports it; unexpected I/O failures abort and leave recovery state intact.

## Current patch coverage

The pinned patch currently instruments five native generation handler families:

1. `POST /api/backends/chat-completions/generate` — one handler containing 26 pinned provider-source identities (13 dedicated senders plus 13 identities through the generic sender).
2. `POST /api/backends/text-completions/generate`.
3. `POST /api/backends/kobold/generate`.
4. `POST /api/novelai/generate` (text generation only; image generation is not included).
5. `POST /api/horde/generate-text`. This handler is instrumented but protected Memory is denied before task creation: Horde returns the actual model output later through `POST /api/horde/task-status`, which has no durable protected-task receipt or Gateway final-send binding. `/api/horde/cancel-task` is control-only.

The patch wraps each handler in request-scoped AsyncLocalStorage, routes generation fetches through the shared hook, and intercepts Express response writes. Model-list and other non-generation fetches outside those request contexts remain native. Abort requests are excluded from generation dispatch.

The adapter maps all 26 Chat Completions source keys (including CometAPI) plus three synchronous text-generation routes (`text-completions`, `kobold`, `novelai-text`) to the 29-entry Core sender registry. Horde text remains unregistered for protected Memory because its asynchronous `/task-status` route returns the actual model output outside the originating request context and accepts the route-aware `resolveSenderRoute(request, hostRoute)` contract shared with #855. It also requires asynchronous `prepare(request, response)` before any native sender executes. Preparation validates the authenticated ST user/session, rejects browser-supplied protected-Memory marker fields, and can call a trusted `prepareHostContext` callback. The resulting server-owned context is passed only to the synchronous `resolveProtectedMemory(request, hostContext)` resolver. Unknown sender families are permitted only when the trusted Host classifier explicitly returns `null`; protected or indeterminate classifications are denied before transport.

The #855 root server plugin now registers a fail-closed adapter implementing the same preparation and route-aware sender-resolution contract. That adapter preserves ordinary native generation while protected Memory remains disabled; it does not expose `authorizeResponseWrite` and therefore is not a protected-dispatch adapter. The five-route coverage described above comes from this #844 patch, not from the narrower managed patch in #855.

## Evidence on current branch

- The exact-pinned-source audit previously passed Patch Manager preflight, install, installed-file verification, syntax checks, real-handler fake-provider integration, and uninstall/rollback on SillyTavern 1.19.0.
- The real-handler harness exercises all five native text-generation handlers, one provider request per handler, Chat Completions streaming, terminal Kobold retry suppression, and now a simulated Provider revoke immediately before the actual Express `response.end()`.
- Adapter tests cover all 29 sender identities, unknown-route denial, terminal response tombstones, one protected dispatch per Express response, and the separately routed generation families.
- Gateway tests cover durable dispatch-start, revoke races, final-write authorization, streaming chunk suppression, replay denial, and crash/restart recovery.
- Patch Manager tests now cover durable backups outside the Extension directory and recovery after interruption during restore.

The current branch has new code and regression tests beyond the last completed source-audit run. Exact-head Runtime, Memory Provider and pinned-source audit results are tracked on [PR #844](https://github.com/necromorphic/Logic-Engine/pull/844); do not reuse an earlier commit's CI result as evidence for the current HEAD.

## Production blockers — do not enable protected Memory

1. **The #855 registration is fail-closed only.** The #855 server-plugin entrypoint registers a Host adapter at ST startup and keeps ordinary unprotected generation available. It does not create protected Memory context or call Core Gateway. The #844 patch used alone, without the #855 registration entrypoint, still returns `503 LOGIC_ENGINE_FINAL_SEND_ADAPTER_UNAVAILABLE`.
2. **No real deployment-owned Core/Provider binding exists.** The adapter still needs trusted server-side identity/context resolution, the actual Core `MemoryDispatchGateway` instance, synchronous Core/Provider evidence readers, accepted-head authority configuration, and the shared Coordinator path. The browser must not provide these authorities.
3. **Live revoke-at-egress proof is still required.** Gateway tests cover final response revalidation and synchronous writes under the Coordinator. The pinned fake-provider harness uses a fake Gateway; it does not prove a live revoke race against production Core/Provider stores at the actual ST response write.
4. **Crash/restart and upstream call-count evidence is currently test-harness evidence.** Production process restart and provider-side request-count attestations are not available from the CI harness.
5. **Production bootstrap remains fail-closed.** #855's root server-plugin entrypoint imports the same `scripts/sillytavern-patch-manager.mjs` manager and owns startup registration; its current adapter is deliberately fail-closed and does not supply the real Core Gateway or NPC Context Receiver. #844 carries the multi-route patch, 29-entry sender registry, Gateway adapter and updated durable manager. The #868 standalone manager was a refactor scoped to the Chat Completions endpoint; its durable-state/restore requirements have been ported into the multi-route manager rather than replacing the five-route patch. The remaining consolidation is to compose #855's single startup entrypoint with #844's updated manager/adapter and the #870 Host/Core receiver, then prove one owner and one installed patch on a live ST process.

For a protected adapter, the Gateway performs post-inference revalidation and the ST response wrapper invokes `authorizeResponseWrite` synchronously for each write and final end. The #855 fail-closed adapter does not claim this capability because it never inserts protected Memory. The full deployed proof remains blocked by items 1–3.

The patch manager is deployment plumbing, not an authorization authority. Core Security Gateway remains the sole Memory authorization authority. No merge, production activation, or Memory → NPC enablement is authorized by this document.

## Tests

```sh
node --test tests/sillytavern-patch-manager.test.js tests/sillytavern-final-send-patch-artifact.test.js
```

The exact pinned-source CI job additionally installs the patch, checks all modified JavaScript files, runs the patched native-handler fake-provider harness, and uninstalls the patch. Always verify the final commit's CI before deployment.
