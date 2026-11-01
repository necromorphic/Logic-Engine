# SillyTavern Final-Send Patch Manager

**Status:** implementation in progress; local deployment only.  
**Pinned host:** SillyTavern 1.19.0, source commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.

## Deployment entrypoint

The Logic-Engine deployment entrypoint installs the pinned local ST patch, including a server-side bridge in ST's existing `/api/extensions/install`, `/api/extensions/update`, and `/api/extensions/delete` handlers. Once this bootstrap is present, installing/updating/deleting the Logic-Engine Extension through SillyTavern's normal Extensions UI automatically invokes Patch Manager inside the existing ST server process. No extra process or API endpoint is created.

The deployment entrypoint is also available for initial bootstrap and repair:

```powershell
$env:LOGIC_ENGINE_SILLYTAVERN_ROOT = "C:\path\to\SillyTavern"
npm run install:extension
```

Or run the manager lifecycle directly:

```powershell
node scripts/sillytavern-patch-manager.mjs preflight --st-root "C:\path\to\SillyTavern"
node scripts/sillytavern-patch-manager.mjs install --st-root "C:\path\to\SillyTavern"
node scripts/sillytavern-patch-manager.mjs verify --st-root "C:\path\to\SillyTavern"
node scripts/sillytavern-patch-manager.mjs repair --st-root "C:\path\to\SillyTavern"
node scripts/sillytavern-patch-manager.mjs update --st-root "C:\path\to\SillyTavern"
node scripts/sillytavern-patch-manager.mjs uninstall --st-root "C:\path\to\SillyTavern"
```

The manager runs either in the existing Logic-Engine deployment process or is dynamically imported by the already-patched native ST extension-management route after a trusted server-side clone/update. It is not a resident service, ST Server Companion, API server, relay, or alternate provider connector.

The browser-side ST manifest hooks are not trusted to perform filesystem changes. The local source patch adds the server-side invocation at the native extension lifecycle boundary. The server route passes only its own sanitized, server-derived `extensionPath`; the Hook checks the exact Logic-Engine manifest marker before loading the manager from that cloned repository.

## Lifecycle guarantees implemented

- **Preflight:** checks exact ST version, pinned source revision identity through SHA-256 fingerprints, patch artifact hash, all audited native route/loader files, and `git apply --check`.
- **Backup:** copies every source file that the patch changes into `.logic-engine-patch-manager/backups/<transaction-id>/` before applying.
- **Apply:** records a durable transaction journal before invoking `git apply`.
- **Verify:** verifies exact post-patch hashes for modified and newly created files.
- **Rollback / Uninstall:** restores only files still matching the exact known patched hash (or known pre-patch hash during interrupted recovery); refuses to overwrite unknown user edits.
- **Update:** the native ST `/api/extensions/update` handler invokes the manager after Git pull; it verifies the installed patch version and, when a newer manifest is supplied, rolls back the owned patch and installs the new pinned artifact.
- **Extension delete:** the native ST `/api/extensions/delete` handler invokes `uninstall` before deleting the Extension directory. A rollback conflict blocks deletion so the recovery code and artifacts remain available.
- **Extension install:** the native ST `/api/extensions/install` handler invokes `install` after cloning and validating the Extension manifest but before returning success. If Patch Manager fails, the cloned Extension directory is retained for recovery instead of being removed with its transaction artifacts.
- **Repair:** rolls back the manager-owned patch and reapplies it from a verified baseline.
- **Crash recovery:** a journal is recovered before the next operation. Stale lock files are reclaimed only when the recorded process is provably absent; malformed/ambiguous locks deny.
- **Fail-closed:** any source/version/hash mismatch, patch conflict, backup-integrity failure, ambiguous lock, or user modification returns `DENY_FAIL_CLOSED`.

Manager state and backups live under the SillyTavern root in `.logic-engine-patch-manager/`. No user data or provider configuration is copied or modified.

## Current patch content

The pinned patch:
- wraps the native `POST /api/backends/chat-completions/generate` handler in request-scoped AsyncLocalStorage context;
- replaces the module's `node-fetch` binding with a hook-aware wrapper, covering the 13 early-return provider senders and the generic fallback within that module;
- wraps the first streaming response-forward call so the registered adapter can perform the Gateway-controlled write and prevent a duplicate legacy write;
- adds `src/logic-engine-final-send-hook.js` with a single adapter registration point.

The adapter is required before the native Chat Completions generation handler can run. Missing adapter registration rejects the route with `LOGIC_ENGINE_FINAL_SEND_ADAPTER_UNAVAILABLE`; it does not fall back to direct provider fetch. Calls to model-list and other non-generation functions in the module remain on native fetch because they run outside the generation context.

The sender map is pinned to the actual `CHAT_COMPLETION_SOURCES` keys/values from ST 1.19.0. ST's `COMETAPI` source is intentionally rejected because the Core Gateway sender registry does not admit it; an unknown or newly introduced provider cannot silently fall through.

## Important incomplete integration gates

This is not yet production-ready and must not be treated as a completed protected dispatch integration:

1. The Logic-Engine server-side Extension adapter has not yet been implemented/registered against a production Core Gateway instance. The patch deliberately fails closed until that trusted adapter exists.
2. The current Gateway's synchronous evidence readers, Coordinator and Core policy authority must be connected to the real deployment-owned Core/Provider state without introducing a browser-to-Core call, separate API port, relay, or second authorization authority.
3. The patch currently instruments the Chat Completions generation module only. Text Completion, Kobold, NovelAI and Horde are separately routed and are not in the current protected sender registry. They remain outside the protected Memory contract and must not receive protected Memory until separately admitted and covered.
4. The local lifecycle bridge must be bootstrapped once by the Logic-Engine deployment entrypoint. After that bootstrap, the patched native ST server routes invoke Patch Manager automatically during the normal Extension install/update/delete operations. The browser-side lifecycle hooks are not used for filesystem access. The lifecycle Hook verifies the exact HTTPS origin `github.com/necromorphic/Logic-Engine` before importing the manager from the cloned Extension.

The patch manager is a deployment mechanism, not an authorization mechanism. Core Security Gateway remains the sole authority. No API port, Provider Relay, Provider Base URL substitution, Browser/ST-to-Core request, or separate ST Server Companion is introduced.

## Tests

```sh
node --test tests/sillytavern-patch-manager.test.js tests/sillytavern-final-send-patch-artifact.test.js
```

The tests exercise lifecycle operations, rollback conflict preservation, unknown-source denial, repair, patch/manifest integrity, and pinned route coverage. Exact-source apply and Node syntax checks were performed against the supplied SillyTavern 1.19.0 archive before committing the patch artifact. CI results must be checked on the exact final commit before deployment.
