# Managed SillyTavern Final-Send Hook

**Target:** SillyTavern 1.19.0, source commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.  
**Deployment boundary:** local source-level patch to the installed SillyTavern copy. The SillyTavern upstream repository is not modified.  
**Security authority:** Core Security Gateway only. Host Adapter supplies trusted server context; it does not authorize disclosure.  
**State:** Patch Manager prototype integrated into the Logic-Engine server-plugin entrypoint. Memory → NPC remains `DISABLED / FAIL-CLOSED`.

## Deployment model

Install the Logic-Engine repository as a SillyTavern server plugin directory:

`SillyTavern/plugins/logic-engine/`

The repository-root `index.mjs` is the server-plugin entrypoint. During SillyTavern startup, the plugin:

1. resolves the SillyTavern installation root from its own plugin directory;
2. verifies package version and SHA-256 digests of the pinned plugin loader, server bootstrap, startup router, and native chat-completions endpoint;
3. atomically installs the managed hook file and exact route wrapper;
4. dynamically imports the installed hook and registers the server-side Host Adapter before SillyTavern starts accepting requests;
5. exposes a private `GET /api/plugins/logic-engine/final-send/status` diagnostic containing only patch/gateway/readiness states.

No reverse proxy, Provider Relay, extra API port, provider Base URL override, or alternative backend connector is created.

## Patch Manager contract

- Exact build pin: package version plus four source-file hashes; unknown builds are rejected.
- Exact anchors: every source transformation must match once. Missing or duplicated anchors fail before writes.
- State: backups and a manifest are stored under the Logic-Engine plugin's `data/final-send-patch`, outside SillyTavern's `src`.
- Concurrency: exclusive lock directory prevents simultaneous apply/restore.
- Crash recovery: a durable pending record is written before changing Host files. Startup either finishes recognizing a committed install or restores the exact preimage.
- Atomic replacement: each changed file is written to a same-directory temporary file, flushed, and renamed into place.
- Idempotency: repeat startup verifies the installed patch bytes and does not reapply transformations.
- Drift: changed Host source, hook, backup, or manifest is rejected. The manager never overwrites unknown local edits.
- Restore: only the exact manager-installed bytes may be removed; the original endpoint is restored byte-for-byte.
- Upstream: only the installed working copy is modified. No SillyTavern upstream file or repository is changed.

## Final-Send coverage

The managed patch changes the native `src/endpoints/backends/chat-completions.js` module only:

- the endpoint's `node-fetch` binding becomes a request-scoped Final-Send Hook;
- the native response forwarder is wrapped so a protected streaming response is not written twice;
- the complete native `POST /api/backends/chat-completions/generate` handler runs inside the authenticated Host generation context;
- all provider-specific and generic sender branches in that handler use the module's shared fetch binding, so every provider send is routed through the Hook; model-list and other non-generation fetches outside the request context remain native;
- unknown sender values, missing adapter registration, duplicate transport attempts, and failed Host preparation fail closed;
- the first protected streaming response write remains controlled by the Core Gateway's final revalidation callback.

The 25 sender-family registry in Core is the acceptance inventory. The disabled CometAPI branch does not send and remains non-sendable. Text Completion, Kobold, NovelAI, Horde, image generation, TTS, embeddings, and arbitrary extension routes are not part of this protected chat-completion context contract; protected Memory must not be inserted into those paths.

## Current implementation boundary

The root plugin now uses the shared `SillyTavernPatchManager` from `scripts/sillytavern-patch-manager.mjs` as the sole patch owner. It calls `manager.execute('update')` at server-plugin startup, then registers the fail-closed Host Adapter against the installed Hook. The native Extension lifecycle Hook uses the same manager implementation and the same `.logic-engine-patch-manager/` state, lock, journal, backup set, and rollback procedure. The former independent `host-adapter/patch-manager` implementation has been removed. Startup detects state from the former `plugins/logic-engine/data/final-send-patch` manager and refuses an automatic migration; restore that legacy patch with the pre-consolidation plugin version before upgrading. This prevents two managers' backup formats from being mixed.

The root plugin registers a fail-closed Host Adapter that:
- validates that the native request carries SillyTavern's authenticated user/session context;
- rejects browser-supplied reserved Memory marker fields;
- resolves only the pinned 25 sender-family mapping;
- passes ordinary non-Memory chat requests to SillyTavern's original native fetch;
- does not create or inject Memory context and does not authorize protected dispatch.

The fail-closed adapter's `resolveSenderRoute(request, hostRoute)` accepts the shared route-aware Hook signature and maps the four additional route identifiers used by the broader Final-Send contract (`text-completions`, `kobold`, `novelai-text`, `horde-text`). This is interface compatibility only: this PR's own managed patch still wraps Chat Completions only. Those four routes are intercepted only when the broader #844 patch is installed. The #844 Hook also supports an optional `authorizeResponseWrite` capability; this fail-closed adapter does not expose it because it never inserts protected Memory or claims a Core release authorization.

The production Core Gateway + real Provider consumer is not yet registered as the dispatch adapter. Therefore this patch proves the managed native interception seam and preserves ordinary generation while protected Memory remains disabled. It does not claim P0.4 E2E completion or production Memory→NPC readiness.

## Verification

Run:

```sh
node --test host-adapter/patch-manager/manager.test.mjs
```

The dedicated GitHub workflow checks the exact pinned SillyTavern source on Linux and Windows. Tests cover install, idempotent startup, update, repair, uninstall, byte-exact restore, source drift refusal, and refusal to overwrite local edits.

Live acceptance still requires a real SillyTavern process with the Logic-Engine plugin installed, actual provider requests across sender families, exact upstream call counts, revoke-before-dispatch zero-egress, revoke-during-inference response suppression, restart recovery, and confirmation that the installed plugin's authenticated Host Adapter calls the in-process Core Gateway. Until then, protected Memory stays disabled.
