# SillyTavern 1.19.0 — source route and lifecycle audit

Pinned source: `SillyTavern/SillyTavern@06bde939fb1e9c4c8d8641d810f0a916b5bce127`.

The uploaded `SillyTavern-release.zip` was checked against that commit using Git blob SHA-1. Exact matches:

| File | Git blob SHA |
|---|---|
| `public/script.js` | `777a2d5983a6283ef9b26726e75192da1e3f3cea` |
| `src/server-startup.js` | `4bfc843b86ef76102889a4d931204f8ed04e3b61` |
| `src/endpoints/chats.js` | `390abc3cb2aeefd0edeffe4294186f199a14b3ec` |
| `src/endpoints/characters.js` | `765160d0a75dff151f1a0b54923596792939dba4` |

## Actual generation dispatch

Evidence class: source-inspected, not runtime-observed.

- `public/script.js:6116` — `sendGenerationRequest()`. For most backends it sends a browser request through `fetch(getGenerateUrl(main_api), ...)`; OpenAI is delegated to `sendOpenAIRequest()`, and Horde has a separate path.
- `public/script.js` — `sendStreamingRequest()` delegates to backend-specific streaming implementations.
- `public/scripts/openai.js:3138` — `sendOpenAIRequest()` posts to the same-origin `/api/backends/chat-completions/generate` route.
- `src/endpoints/backends/chat-completions.js:2242` — server-side `POST /generate` dispatches by `chat_completion_source`. Its switch at approximately line 2260 returns directly from 13 provider-specific sender functions (Claude, AI21, MakerSuite, VertexAI, MistralAI, Cohere, DeepSeek, AIMLAPI, xAI, Chutes, MiniMax, ElectronHub, Azure OpenAI); these do not pass through the common fallback fetch block.
- The remaining OpenAI-compatible branch constructs a provider-specific request and performs the common `fetch(endpointUrl, config)` at approximately line 2689. Streaming and non-streaming share this point for that branch.

Consequences for the integration design:

1. `CHAT_COMPLETION_PROMPT_READY` and `GENERATE_AFTER_COMBINE_PROMPTS` are prompt-preparation hooks, not final-send authorization. They run before backend transport and can be bypassed by other generation paths.
2. A final authorization/dispatch gate must be placed after trusted request/session/world binding and immediately before the selected provider sender initiates outbound I/O. A single middleware at the top of `/generate` is not enough: 13 switch branches return from independent sender functions, while the OpenAI-compatible fallback uses a separate common fetch point. The integration must either refactor these branches behind one transport-start interface or instrument every sender and prove the complete provider matrix. Streaming and non-streaming must both be covered.
3. The current Logic-Engine Gateway dispatch-start primitive is not connected to this ST route. A browser extension hook alone is insufficient to prove zero-egress on denial or revocation.

## Observed Host lifecycle source points

Evidence class: source-inspected.

| Operation | Pinned source location | What the source shows | Remaining evidence gap |
|---|---|---|---|
| Message deletion | `public/script.js:1607` (`deleteLastMessage`), `public/script.js:1627+` (`deleteMessage`) | In-memory message removal and deletion event emission | Durable file deletion/history and restart proof |
| Generation result / swipe creation | `public/script.js:6642` (`saveReply`) | Result is committed into chat/swipe structures | Runtime ordering against journal and native persistence |
| Message edit | `public/script.js:8397` (`messageEditDone`) | Emits edit/update events, then saves chat | Pre-mutation durable lineage and restart proof |
| Swipe deletion | `public/script.js:9339` (`deleteSwipe`) | Removes swipe, changes active index, emits deletion event | Durable lineage and crash ordering |
| Swipe selection | `public/script.js:10039` (`endSwipe`) | Completes selection and updates UI | Stable branch identity across restart |
| Chat save | `public/script.js:9412` (`saveChatConditional`) | Saves individual/group chat and browser-side caches | Import/copy/restore/external-edit coverage |

Event names are declared in `public/scripts/events.js`: `MESSAGE_SENT`, `MESSAGE_RECEIVED`, `MESSAGE_EDITED`, `MESSAGE_DELETED`, `MESSAGE_UPDATED`, `MESSAGE_SWIPE_DELETED`, `CHAT_CHANGED`, `CHAT_DELETED`, `GROUP_CHAT_DELETED`, `GENERATION_STARTED`, `GENERATION_STOPPED`, and `GENERATION_ENDED`.

Event names alone do not prove exactly-once delivery, durable ordering, complete coverage, or UI delivery. In particular, `MESSAGE_RECEIVED` is not proof that the user saw a message.

## Final-send integration requirement

The inspected chat-completions route has multiple outbound initiation sites. Provider-specific helpers contain their own `fetch` calls (including distinct streaming paths), and the generic OpenAI-compatible branch has its own final `fetch`. Wrapping only the common fetch or only the route handler leaves provider-specific bypasses. Before enabling protected Memory, add a source-level inventory test that enumerates all outbound sender functions reachable from this route and fails when a new sender/fetch path is added without a dispatch-gate mapping. Add runtime tests for each supported protected provider asserting: (a) denial/revocation means zero outbound calls; (b) the transport-start callback is invoked synchronously under the shared Coordinator lease; (c) the lease is released before awaiting the response/stream; and (d) ambiguous started requests are not retried.

## Current implementation boundary

PR #780 carries a bounded, read-only current-file inventory candidate and its pinned ST route patch. It does not yet add a final-send gateway, message/swipe revision journal coverage for all mutation paths, import/export/copy/restore lineage, durable Host installation/session identity, or production Core/Provider wiring.

The current inventory uses file handles for bounded reads but pathname-based directory enumeration and a second path scan. It is not an atomic filesystem snapshot. The route's build SHA is an operator-supplied deployment assertion, not runtime source attestation.

**Disposition: HOST_SOURCE_ROUTE_IDENTIFIED; HOST_INVENTORY_NON_READY; FINAL_SEND_GATE_NOT_WIRED.** Do not enable production Memory → NPC.


## Host route authentication boundary

The uploaded archive also matches pinned `src/server-main.js` by Git blob SHA `bcf5bed8d6248af1db5ed0d59796e2c284bde95b`. In that source, `app.use(requireLoginMiddleware)` is installed at line 248 before `setupPrivateEndpoints(app)` is called at line 278. The candidate inventory router is mounted by `setupPrivateEndpoints`, so the route is behind SillyTavern's login middleware in the pinned build. The handler additionally requires `request.user.directories` and `request.user.profile.handle`.

This establishes the Host's ordinary authenticated-user boundary for the candidate endpoint; it does **not** establish a stable installation ID, durable session ID, cryptographic session binding, world/actor authorization, or Core trust. `host_user_handle` is an account/profile identifier, not a durable session identity. The inventory response must remain NON_READY until those missing bindings are supplied by a separately reviewed deployment contract.


## Dispatch-start process boundary and Node runtime compatibility

The dispatch-start contract has an additional process-boundary constraint. The Gateway's synchronous transport-start callback must invoke the actual outbound transport while the shared Coordinator lease is held, then release the lease before awaiting the network response. A remote Core HTTP call that returns an authorization result to SillyTavern and only then lets SillyTavern call its provider is not equivalent: the Coordinator lease has already been released before the real provider fetch begins, leaving a revocation race.

Therefore the eventual implementation must choose one of two architectures and prove it:

1. **Host-process Gateway:** run the trusted Gateway/dispatch-start primitive in the SillyTavern server process and share the same Coordinator/dispatch authority with Core and Provider. The actual provider transport callback must be invoked synchronously inside the Gateway lease. This requires the Host process to run a supported Node runtime and have access to the protected shared authority files; it also requires proving that the Gateway's SQLite engine and accepted-head clients are compatible with the Host runtime.
2. **Core-owned transport:** move the final provider transport itself into the Core/Gateway process so that the actual network request is initiated inside the lease. SillyTavern would hand over a narrowly scoped, authenticated request to that transport boundary; provider credentials and request signing would need a separate reviewed contract.

The pinned SillyTavern 1.19.0 `package.json` declares `engines.node: >=20`, while Logic-Engine requires `>=22.13.0` for its current `node:sqlite` implementation. Thus the Host-process Gateway option is **not supported by SilencingTavern's declared minimum runtime**; it may only be considered when the deployed Host runtime is explicitly verified as Node >=22.13.0, or after a compatible secure SQLite layer is selected. Do not infer runtime support from the package minimum or from a successful patch-apply workflow.

A simple Core HTTP authorize-then-send proxy is explicitly rejected as a substitute for the synchronous transport-start linearization property. This architecture decision must be resolved before implementing the final-send patch across the 13 provider-specific early-return senders and the OpenAI-compatible fetch path.
