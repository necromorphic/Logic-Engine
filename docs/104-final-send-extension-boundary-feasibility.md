# Final-Send Hook feasibility under the approved Logic-Engine Extension boundary

**Audit date:** 2026-11-01  
**Host:** SillyTavern 1.19.0, pinned source commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`  
**Scope:** feasibility only; no ST upstream edits, provider replacement, relay, extra API port, Base URL override, browser-to-Core call, or alternative backend connector.

## Executive finding

The approved requirements cannot currently be implemented as a security-enforcing final-send boundary using only the supported SillyTavern Extension mechanisms available in 1.19.0.

This is not because the browser Extension API lacks useful callbacks. It has prompt and generation lifecycle callbacks. The blocker is their placement and trust boundary:

- client Extension callbacks run in the browser and do not own the server's provider transport;
- the server plugin API gives a plugin a private Express Router mounted under `/api/plugins/{id}`, not the Express application or a hook into existing native routes;
- native generation dispatch occurs in existing server endpoints and then in multiple provider-specific sender functions;
- Core's synchronous dispatch-start must surround the actual outbound transport invocation while the shared Coordinator lease is held. A browser-side or authorize-then-send callback cannot provide that property.

The repository contains review-only ST patch artifacts and source-audit tooling, but no operational Patch Manager implementation that can install and maintain a server-side hook through supported Extension APIs. A Patch Manager can distribute/manage an Extension package; that does not grant it a supported capability to splice code into native ST server routes.

**Disposition:** Gateway implementation remains useful and authoritative, but the production Host final-send hook is not installed or wired. Protected Memory generation must remain disabled/fail-closed.

## 1. Client Extension interception points checked

### 1.1 Prompt-preparation events

Pinned source declares:

- `GENERATE_AFTER_COMBINE_PROMPTS` — `public/scripts/events.js:56-58`; emitted from generation preparation at `public/script.js:4031` and `5243`.
- `GENERATE_AFTER_DATA` — `public/scripts/events.js:58`; emitted at `public/script.js:5318`.
- `CHAT_COMPLETION_PROMPT_READY` — `public/scripts/events.js:65`; emitted from `public/scripts/openai.js:1619`.
- `CHAT_COMPLETION_SETTINGS_READY` — `public/scripts/events.js:64`; emitted from `public/scripts/openai.js:3146`, immediately before the OpenAI-compatible browser fetch at lines 3148-3154.
- `TEXT_COMPLETION_SETTINGS_READY` — `public/scripts/events.js:63`; emitted from `public/scripts/textgen-settings.js:1847`.

These are preparation/parameter hooks, not final transport gates. They are not common to every backend path. They do not receive a trusted server-derived world/actor binding, do not invoke Core's in-process Gateway transport capability, and cannot prevent another client/server route from sending the same protected request without the callback.

### 1.2 Generation lifecycle events

`GENERATION_STARTED`, `GENERATION_STOPPED`, and `GENERATION_ENDED` are declared at `public/scripts/events.js:23-25`; `GENERATION_STARTED` is emitted at `public/script.js:4299`.

These describe UI/generation lifecycle. They do not bracket the actual upstream provider call in a way that is common to every backend sender, nor do they provide a synchronous transport-start callback under the Core Coordinator lease. They are also client-originated and therefore cannot authenticate Host session, installation, conversation, world, or actor authority.

### 1.3 Browser fetch interception

A Logic-Engine Extension could replace/wrap browser `fetch` and observe selected same-origin requests. This was evaluated as a possible installation mechanism, not accepted as a security boundary.

It cannot guarantee complete coverage because:
- it controls only fetch calls made through that browser global in that page context;
- another script can retain/use a fetch reference or use another transport path;
- server-side routes and provider sender fetches execute in Node, outside the browser global;
- custom extensions, native server callers, and other generation families can bypass the wrapper;
- it cannot hold Core's process-local Coordinator lease around a provider fetch executed by the ST server;
- intercepting the response in the browser is too late to prevent the server from releasing protected bytes to the Host/browser.

Therefore it cannot provide zero-egress on deny/revoke or FINAL RESPONSE REVALIDATION before Host response release.

## 2. Server Extension and plugin mechanisms checked

### 2.1 Server plugin route API

Pinned `src/plugin-loader.js:213-223`:
- creates a fresh `express.Router()` for each plugin;
- calls `init(router)`;
- mounts only that router at `/api/plugins/{id}`.

The plugin is not passed the Express app, existing native routers, or an insertion point before native route registration. A plugin-owned endpoint is a new route, not interception of a native route.

### 2.2 Registration order

Pinned `src/server-startup.js:44` imports the native Chat Completions router; `src/server-startup.js:180` mounts it at `/api/backends/chat-completions`. Plugin loading is performed later by `src/server-main.js:313` (the startup module has already installed the native routers).

The server plugin API therefore has no supported registration point that can wrap the already-mounted native generation handler or its response writer.

### 2.3 Authentication middleware does not solve interception

Pinned `src/server-main.js:248` installs `requireLoginMiddleware` before `setupPrivateEndpoints(app)` at line 278. This gives ordinary authenticated-user protection to native private routes. It does not create the missing Gateway hook, trusted Logic-Engine actor/world binding, synchronous dispatch-start, or final-response revalidation.

### 2.4 Unsupported alternatives rejected

- Patching Express internals, router stacks, or global server `fetch` from a plugin: not a supported Extension contract; load-order and internal-structure dependent.
- Adding a plugin endpoint and telling the browser to use it: creates a new route and does not protect existing native routes; it would also make the plugin endpoint an alternate connector.
- Client fetch monkey-patching: bypassable and outside the server transport/Coordinator process boundary.
- Provider Base URL substitution, relay, reverse proxy, extra Core API port, or moving transport into Core: explicitly excluded by the approved requirements.
- Modifying ST native source as part of an Extension: not an Extension API operation and outside the current approved integration constraint.

## 3. Concrete native generation routes not protected by the Extension API

The following are native ST request routes/call sites in the pinned source. They remain reachable without a Logic-Engine server-side final-send gate.

| ST route / call site | Source entry point | Egress path and limitation |
|---|---|---|
| `POST /api/backends/chat-completions/generate` | `public/scripts/openai.js:3138-3154`; server `src/endpoints/backends/chat-completions.js:2242` | Server dispatch has 13 early-return provider sender branches at lines 2259-2272 (Claude, AI21, MakerSuite, Vertex AI, Mistral, Cohere, DeepSeek, AIMLAPI, xAI, Chutes, MiniMax, ElectronHub, Azure OpenAI). Each sender owns its outbound request path; the generic OpenAI-compatible fetch is a separate later branch. Guarding only the generic fetch or route entry misses sender-level transport-start and response release. |
| `POST /api/backends/text-completions/generate` | `public/script.js:6125-6131`, streaming helper in `public/scripts/textgen-settings.js`; server `src/endpoints/backends/text-completions.js:272` | Native Text Completion path; server-side provider-specific dispatch and outbound fetch. Not covered by the Chat Completion settings event. |
| `POST /api/backends/kobold/generate` | `public/script.js:6174-6176`; streaming helper `public/scripts/kai-settings.js:229+`; server `src/endpoints/backends/kobold.js:11` | Server-side Kobold/KoboldCpp transport. The endpoint forwards to the configured local Kobold API; no Core Gateway callback exists at its actual outbound initiation. |
| `POST /api/novelai/generate` | `public/script.js:6180-6181`; streaming helper `public/scripts/nai-settings.js:741+`; server `src/endpoints/novelai.js:167` | Native NovelAI transport; separate server endpoint and outbound request. |
| `POST /api/horde/generate-text` | `public/scripts/horde.js:221-225` | Horde generation submission is a separate browser request followed by task polling. It bypasses the Chat Completions route and its settings event. |

The generic non-streaming dispatcher is `sendGenerationRequest()` at `public/script.js:6116-6138`; streaming is a separate dispatcher at lines 6147-6164. OpenAI, Horde, TextGen, NovelAI, and Kobold do not share one universal client send call. Streaming uses additional backend-specific functions and must be included in any complete transport inventory.

The above is the protected text-generation route family inventory. Image generation, speech/TTS, embeddings, translation, and arbitrary third-party Extension routes are separate operations and are not claimed to be covered by this list. If protected Memory content is ever allowed into those request bodies, they need their own explicit scope and egress inventory; no implicit exclusion is safe.

## 4. Why Patch Manager cannot currently install/service the approved hook

Repository inspection of current `main` found:
- review-only pinned-ST patch artifacts under `host-adapter/prototype/patches/`;
- patch applicability/lint/test workflows;
- source audit and lifecycle bridge prototypes;
- no production Patch Manager module, Extension entrypoint, install/update/uninstall lifecycle, pinned-host compatibility registry, rollback mechanism, or runtime proof that a managed hook is active at every native egress site.

The existing ST Extension loader can install/load Extension scripts and styles (for example `public/scripts/extensions.js:628-643`) and the server plugin loader can mount a plugin-owned router. Neither API exposes a supported native-route interception or source-file mutation capability.

Consequently, a Patch Manager implemented only as a supported Logic-Engine Extension could:
- install and update the Logic-Engine client/server Extension package;
- verify ST version/build identity and report compatibility;
- manage Extension-owned assets, configuration, diagnostics and rollback of its own files.

It could not, without leaving the supported Extension boundary:
- modify the already-registered native Express routes;
- insert a synchronous dispatch-start callback into every provider sender;
- gate the first server response write on Core FINAL RESPONSE REVALIDATION;
- prove that a new/changed native provider sender has not bypassed the hook.

A manager that silently edits `src/endpoints/**`, patches Express internals, or rewrites native server modules would no longer be operating exclusively through supported Extension mechanisms. Calling that operation "Patch Manager installation" does not change its technical or approval boundary.

## 5. Core Gateway requirements and the process-boundary failure

The Logic-Engine Gateway's critical operation is not merely "authorize, then tell ST to send". It must durably commit `DISPATCH_STARTED`, invoke the actual outbound transport synchronously while holding the shared Coordinator lease, and release the lease before awaiting network I/O. This linearizes dispatch-start against Core/Provider revoke and mutation.

A browser Extension cannot invoke an in-process server transport capability. A plugin-owned HTTP endpoint that calls Core and then returns an allow/deny result to ST also cannot hold Core's lease while ST later starts its provider fetch. The actual provider fetch must be invoked from the same trusted Gateway/Coordinator process boundary, or by a supported ST server hook that can call that boundary synchronously. The existing ST 1.19.0 Extension/plugin contract exposes neither.

FINAL RESPONSE REVALIDATION has the corresponding response-side requirement: the first Host response write must be suppressed until revalidation succeeds. A browser callback or client-side response wrapper cannot stop the native server route from having already written response bytes to the browser.

## 6. Minimum deviation required (not selected or authorized here)

Under all five current requirements, there is no supported implementation path in ST 1.19.0.

The smallest technical relaxation that preserves the rest of the approved architecture would be to allow Patch Manager to apply and maintain a **local, pinned, source-level ST server patch** to the deployed ST 1.19.0 installation, while leaving the upstream repository untouched. The patch would add one supported Host-side final-send integration seam and route every native provider sender/response-release path through the Logic-Engine Gateway callback. Core would remain the sole authorization authority; no relay, alternate connector, new API port, Base URL substitution, or browser-to-Core path is needed.

That option changes requirement 2 (Extension mechanisms exclusively) for the narrow act of installing/maintaining the local server hook. It does not require changing requirement 1 (upstream remains unchanged). It would also introduce new security obligations:
- Patch Manager must pin exact ST source/build hashes, apply atomically, verify every expected hunk and refuse unknown builds;
- it must detect drift and fail closed rather than partially apply;
- install/update/uninstall/rollback must be transactional and auditable;
- a source-level inventory test must fail when a new sender/fetch/response-write path is added without Gateway mapping;
- every supported provider and streaming mode must prove zero upstream calls on deny/revoke, synchronous dispatch-start under the shared lease, and no Host response release before final revalidation;
- patch failure, missing hook, hash mismatch, or unsupported ST build must disable protected generation.

This is an identification of the minimum technical deviation, not a recommendation or a change to the approved architecture. No such patch has been applied to ST and no authorization is inferred.

## 7. Final disposition

- Supported client Extension hooks: **insufficient** for final-send security.
- Supported server plugin router: **insufficient**; private plugin namespace only.
- Existing native generation routes: **not protected by the Logic-Engine Gateway**.
- Patch Manager via Extension APIs: **cannot install the required native server hook**.
- Core Security Gateway: remains the only authorization authority; its implemented dispatch primitive is not yet wired to ST's real upstream transport.
- Production Memory → NPC: **DISABLED / FAIL-CLOSED**.
- PR #844: remain Draft; do not merge or enable protected generation based on Gateway unit/integration tests alone.

No architecture change has been made or assumed.


## 8. Follow-up: authorized local source patch and implementation started (2026-11-01)

The owner has explicitly authorized a managed local source-level patch of the installed SillyTavern tree, with upstream unchanged. This authorization is treated as settled; no repeat approval is required.

Implementation added on the PR branch:

- `host-adapter/patches/sillytavern-1.19.0-final-send.patch`: pinned patch wraps all five text-generation handlers: Chat Completions, Text Completions, Kobold, NovelAI text, and Horde text. It also changes the existing `src/endpoints/extensions.js` install/update/delete handlers and adds request-scoped Final-Send and server-side Extension lifecycle Hook modules under ST `src/`.
- `host-adapter/patches/sillytavern-1.19.0-final-send.manifest.json`: exact ST version/commit and SHA-256 fingerprints for the patch, all audited generation/loader source files, patched target, and created Hook module.
- `scripts/sillytavern-patch-manager.mjs`: deployment-side Preflight, Backup, Apply, Verify, Rollback, Update, Repair, Uninstall and journal recovery. It refuses unknown source revisions, symlinks, stale/ambiguous locks, corrupted backups, patch conflicts, and rollback over user modifications.
- `scripts/install-logic-engine-extension.mjs` plus `npm run install:extension`: one-time deployment bootstrap installs the local patch and its server-side lifecycle bridge. After bootstrap, the normal SillyTavern Extension install/update/delete endpoints invoke Patch Manager inside the existing ST server process.
- `host-adapter/sillytavern-final-send-adapter.mjs`: server-side adapter factory maps 26 Chat Completions provider source families plus three synchronous text-generation sender families (29 registered sender identities total); Horde text is deliberately excluded because its async result is returned through a separate task-status route, rejects unknown protected senders, and forwards the actual native transport capability to the Core Gateway helper.
- `host-adapter/protected-memory-final-send.mjs`: accepts the request-scoped native transport capability so the Gateway's dispatch-start can surround the actual ST provider transport.
- root `manifest.json` marks the Logic-Engine Extension for the managed lifecycle; the server Hook accepts only the exact HTTPS origin `github.com/necromorphic/Logic-Engine` before dynamically importing Patch Manager from the cloned Extension.
- tests cover manager lifecycle/conflict preservation, patch manifest integrity, native ST lifecycle wiring, trusted-origin pinning and adapter-to-Gateway transport mapping.

The patch wraps the five native text-generation handlers and their module-local `node-fetch` bindings. The Chat Completions route covers its 13 dedicated provider senders and the generic OpenAI-compatible branch; the separate Text Completions, Kobold, NovelAI text, and Horde text handlers each enter the same request-scoped Hook with an explicit route identity. The pinned real-handler harness currently verifies one upstream request and one Gateway handoff per route, including Chat Completions streaming. This is bounded evidence for the exercised source paths, not proof for arbitrary third-party senders or unrelated image/audio operations.

### Explicitly not claimed complete

- The ST Hook module intentionally rejects generation while no trusted server-side adapter is registered. There is no direct-fetch fallback when the Hook is active but its adapter is missing.
- The adapter factory exists, but a production bootstrap that supplies the real Core `MemoryDispatchGateway`, trusted Host session/world/actor resolver, Core policy/evidence readers, and Provider evidence readers has not yet been wired. No Browser/ST-to-Core request or extra API port is added to compensate.
- Three synchronous separate text-generation routes are explicitly registered for protected Memory (`text-completions`, `kobold`, `novelai-text`). The managed patch also wraps Horde's `/generate-text` handler, but protected requests are denied before task creation because the actual result is returned later by the unbound `/task-status` route. This does not enroll image generation, speech/TTS, embeddings, translation, or arbitrary third-party Extension routes; those remain outside the protected route inventory and must fail closed if protected Memory is ever presented to them.
- ST's browser manifest hooks are client-side and cannot write server files. This implementation does not use them for patching: the one-time Logic-Engine deployment bootstrap patches the existing native ST extension-management server route, which then invokes Patch Manager automatically after cloning the marked Logic-Engine Extension and on its update/delete lifecycle. The server route passes its own sanitized server-side extension path; no new route or API port is added.

The pinned-source CI audit has applied the patch to an exact checkout of ST commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`, run Patch Manager preflight/install/verify/uninstall, syntax-checked all five generation modules and both created Hook modules, and run the patched real-handler fake-provider harness. The latest exact-head audit passed. Runtime and Memory Provider workflows for that head were cancelled/pending at the time of this update. This is source/applicability and fake-provider evidence only, not live ST runtime or production Core/Provider authorization evidence.

**Safety:** upstream ST remains untouched; no relay, alternate connector, Base URL replacement, new API port, direct Browser/ST-to-Core call, or separate ST Server Companion has been added. Memory → NPC remains `DISABLED / FAIL-CLOSED` until the trusted adapter bootstrap and end-to-end route/streaming tests are complete.
