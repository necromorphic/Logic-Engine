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

## Provider sender egress inventory

The pinned server dispatcher has 13 early-return provider branches before the generic request builder. These branches do not converge on the generic `fetch(endpointUrl, config)` at line 611 of this file's source audit target; each sender has its own outbound request path.

Pinned `src/endpoints/backends/chat-completions.js` sender entry points and source-level `fetch()` sites:

| Sender | Function line | Fetch line(s) |
|---|---:|---:|
| Claude | 230 | 410 |
| MakerSuite / Vertex AI | 454 | 733 |
| AI21 | 800 | 852 |
| Mistral | 881 | 942 |
| Cohere | 971 | 1042, 1045 |
| DeepSeek | 1071 | 1153 |
| xAI | 1183 | 1259 |
| AIMLAPI | 1289 | 1364 |
| ElectronHub | 1394 | 1476 |
| Chutes | 1506 | 1577 |
| MiniMax | 1607 | 1658 |
| Azure OpenAI | 1687 | 1752, 1857, 1960, 1984, 2038, 2076, 2689, 2735, 2761, 2784, 2807, 2831, 2862, 2891, 2923, 2954 |

The generic sender path also performs `fetch(endpointUrl, config)` after the provider-specific URL, headers and body have been assembled. Some senders have multiple fetches for model-specific or multimodal operations; the inventory is a call-site map, not yet a semantic classification of each request.

**Integration consequence:** adding a guard only around the generic `fetch(endpointUrl, config)` misses the early-return senders. A correct Host patch must either (a) route every generation egress site through one shared final-dispatch wrapper, preserving each sender's endpoint/headers/body/stream behavior, or (b) provide a common transport injection used by all sender functions and prove that no generation egress bypass remains. The protected wrapper must obtain the trusted Core/Provider authorization and dispatch-start permit before the outbound `fetch()` is invoked; prompt-preparation events and route entry alone are not sufficient.

This is a source inventory only. It does not claim those fetch sites have already been intercepted or that a common wrapper has been implemented.



## Current persisted message/swipe identity extraction added to the inventory candidate

The inventory candidate now parses each bounded JSONL chat file after its file-handle read and before finalizing the double-scan manifest:

- Reads the first ST metadata record and extracts only `chat_metadata.logic_engine_conversation_id` (UUID), never the mutable filename as identity.
- For each persisted message, reads the existing `_logicEngineLifecycle.messageId` and the current `versions[]` metadata.
- Recomputes SHA-256 for every persisted swipe payload and requires exact equality with the stored digest.
- Verifies message/version UUID shape, uniqueness across the scanned file set, version indexes, active swipe selection, and parent-ID shape.
- Emits only conversation UUID, message/version IDs, role, active index, parent links and content digests. Raw message text is never returned.
- Legacy/un-enrolled messages without durable lifecycle IDs are reported as `INCOMPLETE`; the scanner does not synthesize identities. A malformed identity or digest mismatch rejects the inventory.
- Parsing is bounded by 16 MiB per JSONL line, 100,000 messages per chat, 256 swipes per message and 1,000,000 identified versions across the inventory.

This advances the candidate from file-level identity only to **current persisted logical message/swipe identity**. It still does not provide:
- installation ID binding (the installation ID is held in browser storage, not in the chat JSONL file);
- pre-enrollment message/swipe history or deleted/replaced version tombstones unless supplied by the separate durable lifecycle journal;
- import/export/copy/branch/restore/replay lineage;
- an atomic directory snapshot or protection against coordinated path replacement;
- Core world/session authorization, accepted-head authority or production dispatch authorization.

Therefore the overall result remains `DOUBLE_SCAN_CANDIDATE` / `NON_AUTHORITATIVE`. Even `CURRENT_FILE_IDENTITIES_VERIFIED` means only that the identities and digests embedded in the currently scanned files are internally consistent; it is not a trusted Host identity attestation or complete historical inventory.

## Existing Host lifecycle bridge coverage boundary

The current `st-lifecycle-bridge.mjs` declares only these instrumented operations:

`create-message`, `message-send`, `message-receive`, `create-swipe`, `select-swipe`, `delete-swipe`, `delete-message`, `edit-message`, `rename-chat`.

The bridge's own readiness regression explicitly expects these paths to remain missing:

- `generation-start`, `generation-end`, `generation-stop`, `partial-generation`
- `cancel-generation`, `persistence-ordering`
- `export`, `copy-branch`, `chat-switch`, `external-edit`
- `rollback`, `restart`, `replay`, `restore`

The pinned-source audit additionally confirms that the Host patch guards some chat-locator deletion operations rather than recording complete deletion lineage. The lifecycle bridge can emit digest-only tombstones for message/swipe changes that pass through its hooks, but that is not a complete all-chat historical inventory.

Enrollment explicitly reports pre-enrollment history as `UNKNOWN_UNRECOVERABLE`; it does not reconstruct earlier revisions. The bridge's current publisher operates on the loaded `chat` array. The newer pinned filesystem route additionally parses each persisted JSONL chat and validates current conversation UUID, message IDs, swipe/version IDs, parent links, active swipe index and payload digests. These are still partial current-state views: deleted-message tombstones, pre-enrollment revisions and unsupported mutation paths are not reconstructed. They must not be combined into an authoritative all-time inventory until a trusted completeness contract covers every mutation and recovery path.

**Disposition:** lifecycle journal = REVIEW_ONLY; pre-enrollment history = UNKNOWN_UNRECOVERABLE; missing mutation paths = NON_READY; Core digest publication = CAPTURED_REVIEW_ONLY at best. No Provider READY or Memory → NPC disclosure may be derived from these states.

## Current implementation boundary

PR #800 carries the bounded pinned-ST current-file inventory and persisted logical message/swipe identity parser. The Host session endpoint is server-generated inside the authenticated signed cookie session and is bound to the account handle; it is a login-session identity, not installation attestation. PR #799 adds a separate Core reconciliation transport candidate and checks that the ST proxy's session UUID prefixes the conversation ID. None of these candidates adds a final-send Gateway, complete mutation coverage, deleted/pre-enrollment history, import/export/copy/restore lineage, durable installation identity, or production Core/Provider readiness.

The current inventory uses file handles for bounded reads but pathname-based directory enumeration and a second path scan. It is not an atomic filesystem snapshot. The route's build SHA is an operator-supplied deployment assertion, not runtime source attestation.

**Disposition: HOST_SOURCE_ROUTE_IDENTIFIED; HOST_INVENTORY_NON_READY; FINAL_SEND_GATE_NOT_WIRED.** Do not enable production Memory → NPC.


## Host route authentication boundary

The uploaded archive also matches pinned `src/server-main.js` by Git blob SHA `bcf5bed8d6248af1db5ed0d59796e2c284bde95b`. In that source, `app.use(requireLoginMiddleware)` is installed at line 248 before `setupPrivateEndpoints(app)` is called at line 278. The candidate inventory router is mounted by `setupPrivateEndpoints`, so the route is behind SillyTavern's login middleware in the pinned build. The handler additionally requires `request.user.directories` and `request.user.profile.handle`.

This establishes the Host's ordinary authenticated-user boundary. The added `/session` handler issues a server-generated UUID in the signed cookie session, requires `session.handle === request.user.profile.handle`, and rotates the UUID if the account changes. The inventory route now requires the same authenticated session/account match plus the valid server-generated Host session UUID/handle pair, so `/session` must be initialized first. The ID is a login-session identity, not a durable installation attestation. The separate lifecycle proxy also requires that this session UUID prefix the conversation ID before forwarding digest capture/reconciliation to Core. World/actor authorization, accepted-head authority, complete historical inventory and final-send dispatch remain unproven; the response must remain NON_READY.


## Dispatch-start process boundary and Node runtime compatibility

The dispatch-start contract has an additional process-boundary constraint. The Gateway's synchronous transport-start callback must invoke the actual outbound transport while the shared Coordinator lease is held, then release the lease before awaiting the network response. A remote Core HTTP call that returns an authorization result to SillyTavern and only then lets SillyTavern call its provider is not equivalent: the Coordinator lease has already been released before the real provider fetch begins, leaving a revocation race.

Therefore the eventual implementation must choose one of two architectures and prove it:

1. **Host-process Gateway:** run the trusted Gateway/dispatch-start primitive in the SillyTavern server process and share the same Coordinator/dispatch authority with Core and Provider. The actual provider transport callback must be invoked synchronously inside the Gateway lease. This requires the Host process to run a supported Node runtime and have access to the protected shared authority files; it also requires proving that the Gateway's SQLite engine and accepted-head clients are compatible with the Host runtime.
2. **Core-owned transport:** move the final provider transport itself into the Core/Gateway process so that the actual network request is initiated inside the lease. SillyTavern would hand over a narrowly scoped, authenticated request to that transport boundary; provider credentials and request signing would need a separate reviewed contract.

The pinned SillyTavern 1.19.0 `package.json` declares `engines.node: >=20`, while Logic-Engine requires `>=22.13.0` for its current `node:sqlite` implementation. Thus the Host-process Gateway option is **not supported by SilencingTavern's declared minimum runtime**; it may only be considered when the deployed Host runtime is explicitly verified as Node >=22.13.0, or after a compatible secure SQLite layer is selected. Do not infer runtime support from the package minimum or from a successful patch-apply workflow.

A simple Core HTTP authorize-then-send proxy is explicitly rejected as a substitute for the synchronous transport-start linearization property. This architecture decision must be resolved before implementing the final-send patch across the 13 provider-specific early-return senders and the OpenAI-compatible fetch path.
