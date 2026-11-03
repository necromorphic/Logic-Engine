# Unified final-send boundary — pinned SillyTavern route audit

**Status:** historical route audit; its original source-patch rejection is superseded by the explicit 2026-11-01 owner authorization for a managed local source-level patch of the installed SillyTavern tree. The patch is deployed locally only; the SillyTavern upstream repository is not modified. Current implementation and remaining gates are tracked in [document 104](./104-final-send-extension-boundary-feasibility.md) and [PR #844](https://github.com/necromorphic/Logic-Engine/pull/844).  
**Target Host:** SillyTavern commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127` (1.19.0-1-g06bde939).  
**Logic-Engine base:** `main` at `0c3debcb01946f6f8c94811b192e7277422e990a`.  
**Rule:** do not continue or transplant old PR #646. This work starts from current Logic-Engine main.

## 1. Actual final-send topology

The pinned Host has one Express generation endpoint:

- `POST /generate` in `src/endpoints/backends/chat-completions.js`, beginning at line 2242.
- It applies post-processing/schema flattening, then dispatches by `request.body.chat_completion_source`.
- Provider-specific branches return from dedicated send functions; remaining sources use the generic OpenAI-compatible builder and call `fetch(endpointUrl, config)`.
- The original audit concluded that a source-level boundary would need to be inserted after provider-specific request construction/serialization and before the first upstream request. That insertion requires modifying SillyTavern and is therefore not an approved solution. The sender inventory remains useful as a coverage checklist, but the source-patching integration proposal is superseded by document 102.

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

## 5. Implemented Logic-Engine boundary pieces (current branch)

- `MemoryDispatchGateway.dispatchProtectedRequest` now requires an in-process `transport` function on each request. Missing, async, or otherwise invalid capabilities fail before the ledger row and before transport invocation.
- The Gateway invokes that capability exactly once synchronously after committing durable `DISPATCH_STARTED` and while holding the shared coordinator; it awaits the returned Promise only after releasing the coordinator.
- The serialized loopback HTTP endpoint no longer attempts protected dispatch. It authenticates/signature-checks the envelope, then returns `503 IN_PROCESS_TRANSPORT_REQUIRED`; JSON cannot carry a function capability.
- Added `host-adapter/protected-memory-final-send.mjs`: trusted Host handlers supply the resolved endpoint/headers and exact serialized POST body; a mandatory synchronous resolver classifies Memory from trusted server-side request context. Only explicit `null` permits ordinary direct fetch; missing/indeterminate classification fails closed. The helper creates a dormant request-scoped transport capability and passes it in-process to the Gateway.
- Gateway now requires a complete Core policy authority tuple `authority_id + generation + fingerprint` before dispatch and repeats the exact tuple check after upstream completion.
- **FINAL RESPONSE REVALIDATION** now reacquires the shared Coordinator after inference, rejects pending/changed accepted heads, and re-reads Core readiness/source lineage, Provider grant/candidates, and the exact policy tuple before Host release. A failed revalidation suppresses the response and leaves the request `UNKNOWN` / non-replayable.
- Streaming no longer forwards the upstream response inside the transport Promise. After successful final revalidation, Gateway invokes the Host response writer synchronously while holding the Coordinator lease, then awaits stream I/O after releasing the lease. A revoke during inference therefore prevents the first response write; a stream-forward failure is recorded as ambiguous.
- Added an actual Gateway integration test over all 29 protected sender identities. Each family traverses the shared helper and real Gateway; the test asserts exactly one upstream fetch and one completed ledger row per family. Added revoke-during-send, policy-rotation-during-send, stream-withheld-on-revoke, stream-write-under-lease, and real child-process crash/restart tests.
- Added bridge/adapter tests for exact body preservation, dormant capability, unknown-route zero-egress, indeterminate-classification zero-egress, once-only streaming forwarding, and ordinary non-Memory behavior.

These changes implement and test the Logic-Engine-side dispatch/revalidation primitive. They do **not** wire the helper into the supplied SillyTavern 1.19.0 native sender call sites. No source patch to SillyTavern is allowed; the inspected Extension Manager/server-plugin APIs still do not prove an unbypassable native final-send hook. Native Host route coverage and end-to-end zero-egress therefore remain blocked.

## 6. Required implementation shape

1. A single Host-owned final-send helper is called by every dedicated sender and the generic sender.
2. Provider handlers complete URL selection, credential/header resolution, provider transformations and exact body serialization before creating a dormant request-scoped transport capability.
3. The capability closes over server-owned endpoint, headers, method, exact serialized bytes, abort signal and response handling. It is not accepted from browser JSON and is not serializable.
4. The Gateway validates current Core/Provider authority, acquires the shared coordinator, commits durable `DISPATCH_STARTED`, then invokes the capability exactly once while still holding the coordinator. The network response is awaited only after releasing the coordinator.
5. Revocation/source invalidation and dispatch-start must use the same coordinator order. Before start: zero egress. After start: no recall claim; uncertain start/response is `UNKNOWN`, with no automatic retry.
6. Streaming and non-streaming use the same final-send boundary. Streaming fetch returns the upstream response without forwarding; Gateway performs FINAL RESPONSE REVALIDATION, starts the first Host write synchronously under the Coordinator lease, and awaits stream I/O only after lease release. No second sender is permitted.
7. Startup recovery converts stranded `DISPATCH_STARTED` rows to `UNKNOWN`; no replay of ambiguous requests.
8. Unrecognized or not-yet-wired sender paths fail closed for protected Memory. There is no direct-fetch fallback.

## 7. Current Logic-Engine gap found on main

At `src/security/memory-dispatch-gateway.js` on the stated main SHA:

- `SUPPORTED_PROTECTED_MEMORY_ROUTES` contains only `host-selected-chat-generation`.
- The Gateway currently receives a constructor-injected `sendUpstream` callback, not a request-scoped Host-created transport capability.
- The Gateway does persist `DISPATCH_STARTED` under the shared coordinator and invokes `sendUpstream` before releasing the coordinator; it records ambiguous outcomes as `UNKNOWN` and blocks replay.
- Existing route tests prove that an unsupported route, denied grant and pending authority result in zero calls, and test the start-under-lock ordering.
- These are Gateway-level tests, not proof that the pinned SillyTavern provider senders are all routed through it.

Consequently the existing Gateway is a useful durable dispatch primitive, but it does **not** yet satisfy the requested single final-send boundary or all-sender-route coverage.

## 8. Google Provider Egress Relay separation

The Google Provider Egress Relay may be the transport implementation selected by the trusted Google AI Studio sender. It does not create or validate Memory grants, Core bindings, Provider evidence, candidate eligibility, revocation order, or dispatch ledger state. Memory authorization remains exclusively in the Logic-Engine Gateway. Relay availability or success cannot turn a denied Memory request into an allowed request.

## 9. Acceptance matrix

| Requirement | Current evidence | Result |
|---|---|---|
| Fresh branch from current main; no #646 transplant | Branch `security/unified-final-send-boundary-current-main` created from `0c3debcb...` | PASS |
| Single Host final-send helper | Shared helper added in Logic-Engine host-adapter; pinned SillyTavern senders not wired | PARTIAL |
| Every dedicated sender covered | Registry/helper covers 26 Chat Completions source identities plus three synchronous text-generation routes (29 total); actual pinned sender call sites still direct | BLOCKED |
| Every generic source covered | Registry/helper covers generic source families; actual generic fetch still direct | BLOCKED |
| Durable `DISPATCH_STARTED` | Existing Gateway transaction; capability invoked after commit under shared coordinator | PARTIAL |
| Revoke/start serialization | Existing coordinator lock in Gateway; full Host/Core/Provider shared-order proof still required | PARTIAL |
| Retry and ambiguous outcome | Gateway records `UNKNOWN`, blocks digest replay; full Host retry policy not yet proven | PARTIAL |
| Streaming | Adapter waits for stream forwarding within transport Promise; pinned Host integration not done | PARTIAL |
| Crash recovery | Gateway startup converts stranded `DISPATCH_STARTED` to `UNKNOWN` | PARTIAL |
| Upstream call-count regression across sender families | 29 registered sender identities traverse the real Gateway/helper integration test; exactly one upstream call and completed ledger row per family. Native ST sender call sites remain unconnected | PARTIAL |
| Relay separate from Memory authorization | Required architectural boundary documented; implementation wiring not yet present | BLOCKED |

**Safety state:** Host integration NON_READY; Memory → NPC remains DISABLED / FAIL-CLOSED. No merge or production activation is authorized by this document.
