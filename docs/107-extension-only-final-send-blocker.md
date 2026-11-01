# Extension-only Final-Send feasibility — SillyTavern 1.19.0

**Disposition:** BLOCKED under the currently approved constraints; protected generation remains `DISABLED / FAIL-CLOSED`.  
**Pinned Host:** SillyTavern 1.19.0, commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.  
**Scope:** verify whether supported Logic-Engine Extension mechanisms can install and operate the approved Final-Send Hook. This document does not change the architecture.

## Approved responsibility split

`SillyTavern → untrusted Client Extension → Extension Gateway → Authenticated Host Adapter → Core Security Gateway`

- **Client Extension:** untrusted UI/request-envelope producer.
- **Extension Gateway:** sole ST-facing ingress; bounded envelope validation and routing only. It does not authenticate sessions, assign World/Actor, authorize, access Memory/NPC/Mechanics, send AI requests, or implement Final-Send Hook.
- **Authenticated Host Adapter:** authenticates the actual ST session, establishes installation/account/conversation identity, obtains the canonical World/Actor binding from Core-owned binding resolution, and signs that complete identity context. It does not authorize Memory disclosure; Core re-resolves the bindings.
- **Core Security Gateway:** sole authorization authority, including dispatch-start and final-response revalidation.
- **Final-Send Hook:** Extension-owned interception/adaptation point, installed and maintained by Patch Manager. It is not an authorization authority or a Provider Relay.

## Verified SillyTavern extension limits

### Client Extension API

The pinned client exposes prompt/generation preparation callbacks such as:

- `GENERATE_AFTER_COMBINE_PROMPTS`
- `GENERATE_AFTER_DATA`
- `CHAT_COMPLETION_PROMPT_READY`
- `CHAT_COMPLETION_SETTINGS_READY`
- `TEXT_COMPLETION_SETTINGS_READY`
- generation lifecycle events (`GENERATION_STARTED`, `GENERATION_STOPPED`, `GENERATION_ENDED`)

These are browser-side preparation/UI callbacks. They do not own the Node provider transport, cannot hold Core's in-process Coordinator lease around the actual outbound call, and cannot suppress the server's first response write until Core final-response revalidation succeeds. Browser `fetch` wrapping is bypassable and does not cover server-side provider calls.

### Server Extension API

Pinned `src/plugin-loader.js:213-223` creates a fresh Express Router for each plugin and mounts it only under `/api/plugins/{id}`. The plugin is not given the Express application or native route stack.

Pinned startup order mounts native generation routers in `src/server-startup.js` (Chat Completions at line 180); plugins are loaded later by `src/server-main.js:313`. The supported plugin API therefore provides its own routes, not a supported middleware insertion point into existing native generation routes or response writers.

## Native generation routes left outside the Gateway

| Native route | Pinned source | Coverage gap |
|---|---|---|
| `POST /api/backends/chat-completions/generate` | `src/endpoints/backends/chat-completions.js:2242` | 13 provider-specific early-return sender branches plus a separate generic sender; guarding only the generic fetch misses branch-specific transports. |
| `POST /api/backends/text-completions/generate` | `src/endpoints/backends/text-completions.js:272` | Separate server route and provider transport. |
| `POST /api/backends/kobold/generate` | `src/endpoints/backends/kobold.js:11` | Separate server route and configured Kobold transport. |
| `POST /api/novelai/generate` | `src/endpoints/novelai.js:167` | Separate server route and outbound transport. |
| `POST /api/horde/generate-text` | `public/scripts/horde.js:221-225` | Separate asynchronous submission and task-polling flow. |

Streaming uses separate backend-specific client senders. The generic non-streaming and streaming dispatchers are also distinct. Any protected route not covered by a verified synchronous hook remains a bypass.

## Why the approved guarantees cannot be met by these Extension APIs

1. **Pre-LLM egress:** Core must durably order `DISPATCH_STARTED` against Provider revocation and Core source invalidation, then synchronously invoke the real transport while the shared Coordinator lease is held. A browser callback or plugin-owned HTTP route that returns allow/deny before SillyTavern later performs its own fetch leaves a revoke race.
2. **Final-response revalidation:** Core must revalidate before the first Host response write. A browser event after the native server has returned the response is too late.
3. **Complete route coverage:** the supported Extension callbacks do not wrap all five native route families, all 13 Chat Completions sender branches, streaming, retries and response-release paths.
4. **Patch Manager boundary:** Patch Manager is restricted to the integrated Logic-Engine Extension package directories. It can install/update/repair/uninstall Extension-owned files, but it cannot edit native ST source, insert middleware into native routers, patch Express internals, or rewrite provider senders. Those actions are outside the approved Extension-only boundary.

## Result and required operating state

- The Extension Gateway/Host Adapter separation can be implemented and tested without native ST changes.
- The Extension Gateway candidate is a routing-only, fail-closed ingress. Host Adapter now resolves exactly one active World/Actor binding from Core before dispatch and signs it; Core independently re-resolves it. This identity-binding step does not establish a protected native model send.
- The Core dispatch primitive is not wired to every actual SillyTavern provider transport.
- No supported Extension-only mechanism has been identified that supplies both synchronous pre-LLM transport interception and final-response revalidation across all native sender families.

**Therefore:** do not enable protected Memory generation, do not claim the Final-Send Hook is complete, and do not treat a successful Gateway/Core retrieval call as authorization to send a model request. Keep protected generation `DISABLED / FAIL-CLOSED`.

The minimum technical change that would make the hook feasible is a trusted server-side interception contract at the native dispatch and response-release boundaries. The current constraints prohibit the known ways to create that contract (native-source patching, upstream modification, reverse proxy/provider relay, or alternate connector). No compliant implementation path remains until SillyTavern exposes such a supported Extension hook or one of those constraints is explicitly changed.
