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

## Lifecycle guarantees implemented

- Preflight checks the exact ST version, source-file fingerprints, patch artifact digest, and `git apply --check`.
- Every modified source file is backed up before apply; a durable transaction journal is written before mutation.
- Verify checks exact post-patch hashes for modified and created files.
- Read-only inspection re-hashes installed files and backups, checks the complete backup set, and rejects an active journal. It is not a signed runtime attestation or anti-rollback freshness proof.
- Rollback/uninstall restores only files matching known manager-owned hashes and preserves unknown user edits.
- Install/update/delete lifecycle hooks invoke the manager from the native ST server route. A rollback conflict blocks Extension deletion.
- Crash recovery processes the journal before the next operation; ambiguous locks and source states fail closed.

Manager state and backups are stored under `.logic-engine-patch-manager/` inside the ST root.

## Current patch coverage

The pinned patch currently instruments five native generation handler families:

1. `POST /api/backends/chat-completions/generate` — one handler containing 25 pinned provider-source families (13 dedicated senders plus the generic sender families).
2. `POST /api/backends/text-completions/generate`.
3. `POST /api/backends/kobold/generate`.
4. `POST /api/novelai/generate` (text generation only; image generation is not included).
5. `POST /api/horde/generate-text`.

The patch wraps each handler in request-scoped AsyncLocalStorage, routes generation fetches through the shared hook, and intercepts Express response writes. Model-list and other non-generation fetches outside those request contexts remain native. Abort requests are excluded from generation dispatch.

The adapter maps all 25 Chat Completions source keys to the Core sender registry and accepts the route-aware `resolveSenderRoute(request, hostRoute)` contract shared with #855. It also requires asynchronous `prepare(request, response)` before any native sender executes. Preparation validates the authenticated ST user/session, rejects browser-supplied protected-Memory marker fields, and can call a trusted `prepareHostContext` callback. The resulting server-owned context is passed only to the synchronous `resolveProtectedMemory(request, hostContext)` resolver. Unknown sender families are permitted only when the trusted Host classifier explicitly returns `null`; protected or indeterminate classifications are denied before transport.

The #855 root server plugin now registers a fail-closed adapter implementing the same preparation and route-aware sender-resolution contract. That adapter preserves ordinary native generation while protected Memory remains disabled; it does not expose `authorizeResponseWrite` and therefore is not a protected-dispatch adapter. The five-route coverage described above comes from this #844 patch, not from the narrower managed patch in #855.

## Evidence on current branch

At HEAD `131a1d6c81110209cb82f8ddbe2056a0a4c7d6e4` (CI still running):

- The preceding exact-source audit passed Patch Manager preflight, install, installed-file verification, Node syntax checks, real-handler fake-provider integration, and uninstall/rollback on pinned SillyTavern 1.19.0 (HEAD `83ddbf5d3aa6d6089219b9317947821d2376a549`).
- The real-handler harness exercised one request through each of the five native handler families and measured exactly one fake-provider request and one Gateway dispatch per request. It also exercised the Kobold post-handoff failure path and verified no retry.
- Adapter tests cover the full 25-source route map, unknown-route denial, terminal response tombstones, and the separately routed generation families.
- Gateway integration tests cover sender-family dispatch, durable dispatch-start ordering, revalidation, revoke/policy rotation, streaming release, replay denial, and crash recovery. These are Logic-Engine-side tests, not a live deployment attestation.

Previous passing pinned-source audit: https://github.com/necromorphic/Logic-Engine/actions/runs/41408750484

Current Hook/adapter contract audit: https://github.com/necromorphic/Logic-Engine/actions/runs/41410030407

## Production blockers — do not enable protected Memory

1. **The #855 registration is fail-closed only.** The #855 server-plugin entrypoint registers a Host adapter at ST startup and keeps ordinary unprotected generation available. It does not create protected Memory context or call Core Gateway. The #844 patch used alone, without the #855 registration entrypoint, still returns `503 LOGIC_ENGINE_FINAL_SEND_ADAPTER_UNAVAILABLE`.
2. **No real deployment-owned Core/Provider binding exists.** The adapter still needs trusted server-side identity/context resolution, the actual Core `MemoryDispatchGateway` instance, synchronous Core/Provider evidence readers, accepted-head authority configuration, and the shared Coordinator path. The browser must not provide these authorities.
3. **Live revoke-at-egress proof is still required.** Gateway tests cover final response revalidation and synchronous writes under the Coordinator. The pinned fake-provider harness uses a fake Gateway; it does not prove a live revoke race against production Core/Provider stores at the actual ST response write.
4. **Crash/restart and upstream call-count evidence is currently test-harness evidence.** Production process restart and provider-side request-count attestations are not available from the CI harness.
5. **Patch Manager ownership is not yet consolidated with #855.** #844 currently carries the multi-file patch/lifecycle manager, while #855 carries a separate startup manager that patches the same SillyTavern generation source. Their patch ownership, state directories, backup manifests, and restore procedures must not be run independently against one ST tree. The intended integration is one manager owner (the #855 server-plugin bootstrap) installing/verifying the #844 five-route Hook artifact, with one backup/journal/rollback authority. Until that consolidation is implemented and tested, do not install both implementations and do not mark either PR merge-ready.

For a protected adapter, the Gateway performs post-inference revalidation and the ST response wrapper invokes `authorizeResponseWrite` synchronously for each write and final end. The #855 fail-closed adapter does not claim this capability because it never inserts protected Memory. The full deployed proof remains blocked by items 1–3.

The patch manager is deployment plumbing, not an authorization authority. Core Security Gateway remains the sole Memory authorization authority. No merge, production activation, or Memory → NPC enablement is authorized by this document.

## Tests

```sh
node --test tests/sillytavern-patch-manager.test.js tests/sillytavern-final-send-patch-artifact.test.js
```

The exact pinned-source CI job additionally installs the patch, checks all modified JavaScript files, runs the patched native-handler fake-provider harness, and uninstalls the patch. Always verify the final commit's CI before deployment.
