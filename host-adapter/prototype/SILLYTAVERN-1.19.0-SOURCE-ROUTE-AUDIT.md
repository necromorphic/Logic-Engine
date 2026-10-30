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
- `src/endpoints/backends/chat-completions.js:2242` — server-side `POST /generate` dispatches by `chat_completion_source` to provider-specific sender functions.

Consequences for the integration design:

1. `CHAT_COMPLETION_PROMPT_READY` and `GENERATE_AFTER_COMBINE_PROMPTS` are prompt-preparation hooks, not final-send authorization. They run before backend transport and can be bypassed by other generation paths.
2. A final authorization/dispatch gate must be placed in the server-side transport path, after trusted request/session/world binding and immediately before the selected provider sender initiates outbound I/O. It must cover the non-OpenAI, OpenAI, streaming and non-streaming paths actually supported by the target build.
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

## Current implementation boundary

PR #780 carries a bounded, read-only current-file inventory candidate and its pinned ST route patch. It does not yet add a final-send gateway, message/swipe revision journal coverage for all mutation paths, import/export/copy/restore lineage, durable Host installation/session identity, or production Core/Provider wiring.

The current inventory uses file handles for bounded reads but pathname-based directory enumeration and a second path scan. It is not an atomic filesystem snapshot. The route's build SHA is an operator-supplied deployment assertion, not runtime source attestation.

**Disposition: HOST_SOURCE_ROUTE_IDENTIFIED; HOST_INVENTORY_NON_READY; FINAL_SEND_GATE_NOT_WIRED.** Do not enable production Memory → NPC.
