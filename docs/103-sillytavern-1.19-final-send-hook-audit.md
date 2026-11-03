# SillyTavern 1.19.0 final-send hook audit

**Audit date:** 2026-11-01  
**Pinned release:** user-supplied `SillyTavern-release.zip` (package release 1.19.0)  
**Logic-Engine Gateway under audit:** `44e4dcac66a8325c17f0298d9a4a0c254b25d2db`  
**Historical constraint at audit time:** no SillyTavern source modification and no replacement of its configured provider. On 2026-11-01 the owner explicitly authorized a managed local source-level patch of the installed SillyTavern tree while keeping upstream unchanged. The audit's native-hook findings remain valid; PR #844 now implements the approved local patch path.

## Decision

The supplied SillyTavern 1.19.0 server-plugin API cannot provide the required unbypassable interception of the native chat-completion final-send and response path. This is a demonstrated integration blocker, not an unfinished implementation detail that can be repaired inside a normal server plugin.

Accordingly, PR #844's Gateway primitive can be tested and hardened, but the complete end-to-end Final-send acceptance gate cannot be marked closed under the current Host constraints. Do not activate protected Memory, do not describe the client extension or a plugin-owned endpoint as covering native generation, and do not merge on the strength of helper-level route tests.

## Reproducible source evidence

The archive was inspected directly. The following SHA-256 hashes identify the exact source files audited:

| File | SHA-256 |
|---|---|
| `src/plugin-loader.js` | `994cbfde97c4ef3a2e2a8078e005e61698ded61a52741cad1efe049ee2bedee9` |
| `src/server-main.js` | `567d8a9d52e70816e74f119409933f2b42ad03132d7ef01f8db3ae145c2fe7bf` |
| `src/server-startup.js` | `646bee9eefa67ed62d2f2157aef88872145b90e6d4c4c32490ad4e1792f9c0ba` |
| `src/endpoints/backends/chat-completions.js` | `53f429859efcfb29dd8becfebf7ff0ae49256ea795a0c81c320930fab5a407e7` |

Relevant source locations (1-based line numbers):

- `src/plugin-loader.js:40`: `loadPlugins(app, pluginsPath)` is the plugin-loader entry point.
- `src/plugin-loader.js:214-216`: each plugin receives a newly-created `express.Router()`, and initialization is called as `init(router)`. The plugin is not passed the Express application.
- `src/plugin-loader.js:222`: the only documented mount performed by the loader is `app.use('/api/plugins/{id}', router)`.
- `src/server-startup.js:44,180`: the native chat-completions router is imported and mounted at `/api/backends/chat-completions`.
- `src/endpoints/backends/chat-completions.js:2242`: the native `POST /generate` handler is registered on that router.
- `src/server-main.js:313`: `loadPlugins(app, pluginsDirectory)` is called during server initialization after the startup module has installed the native routers.

The plugin loader therefore offers a plugin-owned route namespace, not an application middleware hook or a registration point before the native generation handler. A plugin cannot use the documented API to wrap every native sender's provider call and corresponding response write.

## Why the apparent workarounds are rejected

1. **Client extension hook / fetch monkey-patch:** browser-side and user-controlled. It cannot establish server-side authorization or prevent direct calls to the native route.
2. **Plugin endpoint used by the extension:** protects only calls intentionally sent to that endpoint. It does not intercept native `/api/backends/chat-completions/generate` requests.
3. **Monkey-patching Express internals, module cache, or global fetch:** unsupported runtime coupling, order-sensitive, and not a supported extension contract. It would create a new security-critical integration surface without a stable lifecycle guarantee.
4. **Reverse proxy / configured custom provider:** can create a server-side choke point, but changes the provider transport/configuration and is outside the approved constraint.
5. **Unmanaged/manual SillyTavern source editing:** is not permitted. The owner separately authorized only a managed, pinned local source patch on 2026-11-01; that implementation is tracked in #844 and `host-adapter/PATCH-MANAGER.md`.

None of these alternatives may be silently substituted for the approved architecture.

## Final-send implementation evidence retained in Logic-Engine

At the audited Gateway head:

- one logical protected generation route and one authoritative 26-family sender registry are validated by Gateway;
- a request-scoped in-process transport capability is required; serialized JSON cannot supply it;
- durable `DISPATCH_STARTED` is committed before the synchronous transport handoff;
- the shared Coordinator lease serializes dispatch-start with revocation;
- ambiguous handoff, transport, and crash outcomes become `UNKNOWN` and block replay;
- FINAL RESPONSE REVALIDATION reacquires the same Coordinator lease, rechecks accepted Core/Provider heads, exact evidence, candidates, and `authority_id + generation + fingerprint`;
- streaming's first Host response write is invoked synchronously only after successful final revalidation while the lease is held;
- integration tests exercise all 26 sender-family identifiers and assert one upstream handoff per request, alongside revoke-during-inference, stream ordering, and crash/restart replay-block tests.

These prove the Gateway/helper contract. They do **not** prove native SillyTavern call-site interception, because no supported native hook exists in the inspected release.

## Acceptance status

| Requirement | Status |
|---|---|
| Unified Gateway primitive | Implemented |
| Protected sender-family registry (26) | Implemented and integration-tested at the Gateway boundary |
| Synchronous dispatch-start before transport handoff | Implemented |
| Shared Coordinator lease with revoke ordering | Implemented in the Gateway primitive |
| Final response revalidation before Host release | Implemented in the Gateway primitive |
| Ambiguous crash/restart recovery and replay blocking | Implemented in the Gateway primitive |
| Actual upstream call count | Asserted by Gateway integration tests (one handoff per family test) |
| Native ST route interception for all provider senders | Implemented by the authorized managed patch across five native text-generation handlers; exact-head CI and live production evidence remain separate gates |
| Real authenticated ST Host Adapter bound to session / installation / conversation / world / actor | **Not wired** |
| Deployment-owned Core evidence reader and real policy fingerprint | **Not wired** |
| End-to-end proof through actual ST native generation | **Not available; must not be claimed** |

## Required decision to resume end-to-end closure

At least one project constraint must change, explicitly and in writing:

- SillyTavern accepts and exposes a supported server-side generation middleware/hook that runs before every provider dispatch and before response release; or
- the project authorizes a maintained SillyTavern source patch/fork; or
- the project authorizes a server-side reverse-proxy/provider transport boundary.

Until then, keep PR #844 Draft and Memory → NPC `DISABLED / FAIL-CLOSED`. No code-only change inside the Logic-Engine repository can honestly close the missing native Host boundary while all three alternatives remain disallowed.
