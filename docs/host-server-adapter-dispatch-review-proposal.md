# Host-server adapter: dispatch integration review proposal

**Status: REVIEW ONLY — NO PRODUCTION WIRING.**  
**Target SillyTavern commit:** `06bde939fb1e9c4c8d8641d810f0a916b5bce127`  
**Target files:** `src/endpoints/backends/chat-completions.js`, `src/endpoints/backends/text-completions.js`  
**Safety state:** Host `NON_READY`; Stage 2 `NO-GO`; production Memory → NPC `DISABLED / FAIL-CLOSED`.

This document is a review proposal only. It does not add an adapter, modify the SillyTavern send path, introduce an API/schema/store, or enable traffic. Per issue #264, no implementation or production wiring may be added until Core has explicitly approved the exact implementation diff in a separate review.

## 1. Source audit finding

At the pinned SillyTavern commit, both backend families expose a `POST /generate` route and dispatch through provider-specific send paths:

- Chat Completions: `src/endpoints/backends/chat-completions.js`, route registered at approximately line 2242 in the audited snapshot.
- Text Completions: `src/endpoints/backends/text-completions.js`, route registered at approximately line 272 in the audited snapshot.

The chat-completions module contains multiple provider-specific outbound request sites; the text-completions module has separate send calls. Therefore, the existing Logic-Engine Gateway is not currently proven to be the sole outbound path. A patch covering only one provider or one `fetch` call would be incomplete.

Line numbers are audit hints, not a stable contract. Every implementation review must verify the pinned commit and inspect all outbound paths at that exact revision.

## 2. Proposed narrow boundary

The proposed Host-server adapter would be a server-side integration at the pinned SillyTavern boundary. It must preserve the user's selected backend and the existing response/streaming contract while routing supported generation dispatch through the Logic-Engine Gateway.

Trust requirements:

1. Bind adapter identity, conversation identity, world/actor scope, request purpose, and the exact prompt/context version from trusted server-side state. The implementation must identify the concrete source of each value; a value being present in the request is not evidence of authority.
2. Never treat browser-supplied identity, scope, authorization, readiness, provider selection, endpoint, or prompt provenance as authority.
3. Bind the dispatch to the exact source/candidate set and version evidence used by the Gateway pre-dispatch decision.
4. Keep the lock/serialization critical section through the durable `DISPATCH_STARTED` decision and actual transport-start callback; release the lock before awaiting the response.
5. If transport outcome is ambiguous, report `UNKNOWN` and do not automatically replay the provider request.
6. Missing, stale, revoked, incomplete, or unverifiable context must fail closed before any provider call.
7. There must be no direct-provider fallback if Gateway dispatch is unavailable or rejects the request.

The adapter must not independently declare Host readiness. Existing Host inventory/lifecycle work in PR #632 remains owned by that separate workstream and must not be duplicated or altered here.

## 3. Client request provenance is a separate trust gate

The pinned source confirms that the browser builds the generation payload and sends it to the backend: `public/scripts/openai.js` calls `createGenerationParameters(...)` and posts `JSON.stringify(generate_data)` to `/api/backends/chat-completions/generate` (around lines 3144–3152). The chat backend selects a provider from `request.body.chat_completion_source` (around lines 2259 onward). The text backend reads `api_type` and `api_server` from `request.body` and forwards request data (around lines 280–329).

Therefore, a server-side hash of the received body can bind the exact bytes that arrived, but it does **not** prove that those bytes were generated from the authorized conversation, world, actor, source versions, or selected backend. The implementation review must identify an existing server-owned authority for that binding. If the pinned Host has no such authority and cannot reconstruct/validate the required context, the affected route must be denied before any provider call; it must not infer authority from a client payload or invent a new contract implicitly.

This provenance gate is distinct from the no-direct-egress gate: even a Gateway-only transport can send an unauthorized client-authored prompt if context provenance is not established.

## 4. Required route coverage

The implementation diff must inventory every outbound generation path reachable from both pinned backend routes, including provider-specific paths, streaming and non-streaming modes, retry/fallback behavior, and any alternate route that can send a prompt to a model.

For each path, the review must record one of:
- routed through the Gateway exactly once; or
- explicitly denied as unsupported before any provider transport call.

An unaccounted-for outbound path is a failure, not an accepted limitation.

## 4.1 Concrete outbound-call inventory at the pinned revision

Source audit at `06bde939fb1e9c4c8d8641d810f0a916b5bce127` (line numbers are relative to that exact commit):

- Chat backend blob SHA: `0d98c77f7b64502c5b0f504eaa1f67df0f26041e`.
- Text backend blob SHA: `c92fc3a14fabd0ad120f877874bc16353eed4831`.
- Browser payload builder blob SHA: `bab82eec57e0927b809b0571534e96f1b13360e1`.

Candidate outbound generation call sites reachable through the chat-completions handler include chat backend lines **410, 733, 852, 942, 1042/1045, 1153, 1259, 1364, 1476, 1577, 1658, 1752, and 2689**. The paired calls at 1042/1045 and the text backend's 402/405/409 are separate stream/non-stream branches and must be inspected for mutual exclusivity and bypass behavior, not mechanically counted as independent requests. The text-completions `POST /generate` has outbound completion calls at lines **402, 405, and 409**. These are the candidate send sites to classify in the implementation diff; this list does not count model-list, model-info, health, abort, or download calls as generation dispatches.

The chat route itself begins at line 2242 and selects provider-specific send functions from `request.body.chat_completion_source`. The text route begins at line 272 and reads `api_type` and `api_server` from `request.body`. The browser assigns `generate_data.chat_id = getCurrentChatId()` at `public/scripts/openai.js:2902`; the chat backend uses that body value at lines 2473–2474 only to derive `x-session-affinity`. That is not a server-side authorization/provenance check.

**Audit disposition:** the existing endpoint code inspected here does not establish that prompt messages match a server-owned conversation/world/source-version record. The future patch must either demonstrate and use an existing server-owned authority or deny the affected route before provider I/O. It must also classify every listed generation send site as Gateway-routed exactly once or denied before transport.

## 5. Required acceptance evidence

Tests must run against the exact pinned SillyTavern commit and use a recording fake transport; no real provider credentials or live model calls are permitted.

| Scenario | Required result |
|---|---|
| Valid server-bound context, supported backend | Gateway dispatch exactly once; selected backend and response semantics preserved |
| Missing or malformed trusted context | Request denied; zero provider calls |
| Stale source/candidate version or incomplete inventory | Request denied; zero provider calls |
| Revocation/readiness loss before durable dispatch-start | Request denied; zero provider calls and no dispatch-start record |
| Revocation after dispatch-start | No second provider call; outcome recorded according to the approved Gateway contract |
| Ambiguous transport failure/timeout | Outcome becomes UNKNOWN; no automatic replay |
| Streaming response | Chunks, termination, and error semantics preserved without bypassing Gateway |
| Non-streaming response | Existing response shape and error semantics preserved |
| Every provider route and fallback/retry path | Gateway exactly once or explicit deny; never direct fallback |
| Client attempts to forge identity/scope/readiness/backend selection | Server-side values win; forged values cannot authorize dispatch |
| Client changes prompt body while retaining valid conversation metadata | Provenance must be validated against an existing server-owned authority; body hashing alone is insufficient; otherwise zero provider calls |
| Gateway unavailable or rejects dispatch | Fail closed; zero direct-provider fallback calls |

Acceptance requires both route-level tests and an outbound-source audit demonstrating that no supported provider path can bypass the Gateway. A passing unit test or a green source-level check alone is insufficient.

## 6. Explicit non-goals

This proposal does not:
- enable Memory → NPC;
- mark Host ready or Stage 2 GO;
- modify PR #632 or its Host lifecycle/inventory implementation;
- introduce new Core APIs, schemas, stores, journals, cursors, outboxes, or lifecycle hooks;
- claim production readiness, complete installed-client coverage, or independent anti-rollback protection;
- authorize merging to `main`.

## 7. Review decision requested

Core review should answer these questions against the future exact implementation diff:

1. Is there an existing server-owned source that can bind the browser-built prompt to the authorized conversation/world/source versions, or must that route remain denied?
2. Is the server-side trust boundary and context binding contract correct?
3. Is route coverage exhaustive for the pinned SillyTavern revision?
4. Are dispatch-start serialization and ambiguous-outcome rules sufficient to prevent duplicate or unauthorized sends?
5. Do the acceptance tests prove zero provider calls on every denied path and prove no direct egress bypass?
6. Are all new API/schema/lifecycle changes explicitly identified and approved before implementation?

Until those questions are answered against an exact code diff and the required tests pass, the integration remains blocked and production Memory → NPC remains disabled.
