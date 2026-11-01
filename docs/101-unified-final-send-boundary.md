# Unified final-send boundary — pinned SillyTavern route audit

**Status:** implementation workstream; not production-ready.  
**Target Host:** SillyTavern commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127` (1.19.0-1-g06bde939).  
**Logic-Engine base:** `main` at `0c3debcb01946f6f8c94811b192e7277422e990a`.  
**Rule:** do not continue or transplant old PR #646. This work starts from current Logic-Engine main.

## 1. Actual final-send topology

The pinned Host has one Express generation endpoint:

- `POST /generate` in `src/endpoints/backends/chat-completions.js`, beginning at line 2242.
- It applies post-processing/schema flattening, then dispatches by `request.body.chat_completion_source`.
- Provider-specific branches return from dedicated send functions; remaining sources use the generic OpenAI-compatible builder and call `fetch(endpointUrl, config)`.
- The protected boundary therefore must be inserted after provider-specific request construction/serialization and before the first upstream request is initiated. Merely wrapping the generic fallback does not cover the dedicated send functions.

## 2. Dedicated protected sender functions

The pinned `/generate` switch directly dispatches to these provider-specific senders:

| Host source family | Sender | Upstream call location |
|---|---|---:|
| Claude | `sendClaudeRequest` | ~410 |
| Google AI Studio / MakerSuite | `sendMakerSuiteRequest` | ~733 |
| Vertex AI | `sendMakerSuiteRequest` | ~733 |
| AI21 | `sendAI21Request` | ~852 |
| Mistral | `sendMistralAIRequest` | ~942 |
| Cohere | `sendCohereRequest` | ~1042–1045 |
| DeepSeek | `sendDeepSeekRequest` | ~1153 |
| xAI | `sendXaiRequest` | ~1259 |
| AIMLAPI | `sendAimlapiRequest` | ~1364 |
| ElectronHub | `sendElectronHubRequest` | ~1476 |
| Chutes | `sendChutesRequest` | ~1577 |
| MiniMax | `sendMinimaxRequest` | ~1658 |
| Azure OpenAI | `sendAzureOpenAIRequest` | ~1752 |

## 3. Generic OpenAI-compatible sender families

The non-dedicated branch constructs a provider-specific endpoint, credentials, headers, body parameters and final `RequestInit`, serializes `requestBody` into `config.body`, then performs the final `fetch(endpointUrl, config)` near line 2689.

The pinned branch includes these source families in that generic builder:

- OpenAI (including reverse-proxy mode)
- OpenRouter
- Custom endpoint
- Perplexity
- Groq
- Fireworks
- NanoGPT
- Pollinations (authenticated and anonymous variants)
- Moonshot
- Z.AI
- SiliconFlow
- Cloudflare Workers AI

The generic builder also contains a disabled CometAPI branch; it throws before any final send. It must remain non-sendable unless separately enabled and audited.

## 4. Non-generation fetches excluded from this boundary

The same file also contains model-discovery/status fetches (for example model lists and provider status checks). They are not protected prompt-generation sends and must not be accidentally treated as generation requests. The implementation must classify them separately rather than blanket-intercepting every `fetch()` in the file.

## 5. Required implementation shape

1. A single Host-owned final-send helper is called by every dedicated sender and the generic sender.
2. Provider handlers complete URL selection, credential/header resolution, provider transformations and exact body serialization before creating a dormant request-scoped transport capability.
3. The capability closes over server-owned endpoint, headers, method, exact serialized bytes, abort signal and response handling. It is not accepted from browser JSON and is not serializable.
4. The Gateway validates current Core/Provider authority, acquires the shared coordinator, commits durable `DISPATCH_STARTED`, then invokes the capability exactly once while still holding the coordinator. The network response is awaited only after releasing the coordinator.
5. Revocation/source invalidation and dispatch-start must use the same coordinator order. Before start: zero egress. After start: no recall claim; uncertain start/response is `UNKNOWN`, with no automatic retry.
6. Streaming and non-streaming must use the same final-send boundary. Streaming response forwarding is part of the request-scoped capability and must not create a second sender.
7. Startup recovery converts stranded `DISPATCH_STARTED` rows to `UNKNOWN`; no replay of ambiguous requests.
8. Unrecognized or not-yet-wired sender paths fail closed for protected Memory. There is no direct-fetch fallback.

## 6. Current Logic-Engine gap found on main

At `src/security/memory-dispatch-gateway.js` on the stated main SHA:

- `SUPPORTED_PROTECTED_MEMORY_ROUTES` contains only `host-selected-chat-generation`.
- The Gateway currently receives a constructor-injected `sendUpstream` callback, not a request-scoped Host-created transport capability.
- The Gateway does persist `DISPATCH_STARTED` under the shared coordinator and invokes `sendUpstream` before releasing the coordinator; it records ambiguous outcomes as `UNKNOWN` and blocks replay.
- Existing route tests prove that an unsupported route, denied grant and pending authority result in zero calls, and test the start-under-lock ordering.
- These are Gateway-level tests, not proof that the pinned SillyTavern provider senders are all routed through it.

Consequently the existing Gateway is a useful durable dispatch primitive, but it does **not** yet satisfy the requested single final-send boundary or all-sender-route coverage.

## 7. Google Provider Egress Relay separation

The Google Provider Egress Relay may be the transport implementation selected by the trusted Google AI Studio sender. It does not create or validate Memory grants, Core bindings, Provider evidence, candidate eligibility, revocation order, or dispatch ledger state. Memory authorization remains exclusively in the Logic-Engine Gateway. Relay availability or success cannot turn a denied Memory request into an allowed request.

## 8. Acceptance matrix

| Requirement | Current evidence | Result |
|---|---|---|
| Fresh branch from current main; no #646 transplant | Branch `security/unified-final-send-boundary-current-main` created from `0c3debcb...` | PASS |
| Single Host final-send helper | No Host patch applied yet | BLOCKED |
| Every dedicated sender covered | Source inventory above; senders still own fetch | BLOCKED |
| Every generic source covered | Source inventory above; generic fetch remains direct | BLOCKED |
| Durable `DISPATCH_STARTED` | Existing Gateway transaction | PARTIAL |
| Revoke/start serialization | Existing coordinator lock in Gateway; full Host/Core/Provider shared-order proof still required | PARTIAL |
| Retry and ambiguous outcome | Gateway records `UNKNOWN`, blocks digest replay; full Host retry policy not yet proven | PARTIAL |
| Streaming | Existing Gateway response callback; no all-sender integration proof | BLOCKED |
| Crash recovery | Gateway startup converts stranded `DISPATCH_STARTED` to `UNKNOWN` | PARTIAL |
| Zero-egress regression across all protected senders | Only Gateway unsupported-route/denial tests exist; no pinned Host route matrix | BLOCKED |
| Relay separate from Memory authorization | Required architectural boundary documented; implementation wiring not yet present | BLOCKED |

**Safety state:** Host integration NON_READY; Memory → NPC remains DISABLED / FAIL-CLOSED. No merge or production activation is authorized by this document.
