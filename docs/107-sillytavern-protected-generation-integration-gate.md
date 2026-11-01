# SillyTavern 1.19.0 — protected generation integration gate

**Status: NOT IMPLEMENTED / FAIL-CLOSED.** This document records the source-backed implementation boundary for the approved local Patch Manager path. It does not authorize a provider relay, URL substitution, new API port, server plugin, or upstream SillyTavern change.

## Pinned inputs

- SillyTavern commit: `06bde939fb1e9c4c8d8641d810f0a916b5bce127`
- Source file: `src/endpoints/backends/chat-completions.js`
- Logic-Engine Gateway: `src/security/memory-dispatch-gateway.js`
- Existing Host digest proxy: `host-adapter/prototype/st-server-digest-proxy.mjs`

## Confirmed source topology

The pinned `POST /api/backends/chat-completions/generate` route performs prompt post-processing and then dispatches through 13 early-return provider branches:

- Claude
- AI21
- MakerSuite
- Vertex AI
- Mistral
- Cohere
- DeepSeek
- AIMLAPI
- xAI
- Chutes
- MiniMax
- ElectronHub
- Azure OpenAI

Those branches invoke independent sender functions and do not reach the generic request builder/fetch. The remaining OpenAI-compatible path constructs the endpoint, headers, body, stream settings and calls its own `fetch(endpointUrl, config)`. Streaming and non-streaming share that fetch only for this generic path. Some sender implementations contain additional fetches for provider-specific operations.

Therefore neither route-entry middleware nor wrapping only the generic fetch is a complete final-send gate. A browser generation hook is also not authoritative.

## Existing Gateway boundary

`MemoryDispatchGateway` already provides the required dispatch-start primitive shape:

1. Validate request identity, body, actor/world/purpose and exact source/candidate sets.
2. Acquire the shared Core/Provider Coordinator lock.
3. Check accepted-head state and synchronously read trusted Core and Provider evidence.
4. Persist `DISPATCH_STARTED` before invoking the injected transport-start callback.
5. Invoke that callback synchronously while the Coordinator lock is held.
6. Release the lock before awaiting the provider response.
7. Record `COMPLETED` or ambiguous `UNKNOWN`; never automatically retry an ambiguous send.

The constructor deliberately requires trusted evidence readers and a non-async transport-start function. It has no production factory that binds those dependencies to the authenticated SillyTavern request. The current supported protected route is `host-selected-chat-generation`; the primitive is not yet wired to SillyTavern.

The existing `st-server-digest-proxy.mjs` is not this Gateway. It forwards digest-only Host inventory/capture requests to Core and cannot authorize or transport model generation.

## Required implementation inside the approved patch

The local source patch must create one in-process final-dispatch boundary for the protected generation path. It must preserve the original provider URL, headers, request body, streaming semantics and native response handling; the transport callback must initiate the original provider fetch, not forward it through Core.

The boundary must receive trusted identity from the authenticated server-side ST session and a Core-resolved binding. It must not accept world, actor, purpose, source or candidate authority from browser request fields. It must bind the exact serialized outbound body and model/stream values to the Gateway request signature and accepted source/candidate set.

The patch must account for every reachable generation egress site. A pinned-source inventory test must fail when a new sender or fetch site is added without an explicit gate mapping. Each protected provider path must prove that deny/stale/revoked evidence produces zero outbound calls. Streaming, non-streaming, cancellation, sender errors and ambiguous transport start must be tested.

Unprotected generation must retain native SillyTavern behavior. No global fetch monkey-patch is acceptable: it would also capture unrelated model discovery, tokenization, metadata and extension requests and would not establish the correct protected request context.

## Runtime compatibility gate

SillyTavern 1.19.0 declares Node `>=20`; Logic-Engine uses `node:sqlite` and requires Node `>=22.13.0`. The Patch Manager must refuse to install/activate the protected-generation package unless the actual ST runtime is verified as Node `>=22.13.0`. This is a compatibility preflight, not a reason to silently move the transport into a separate Core relay.

## Required evidence before enabling

- Exact pinned-source patch applies cleanly and verifies every touched file digest.
- Static sender/fetch inventory has no unclassified generation egress.
- All supported protected sender tests prove zero upstream calls on deny and synchronous transport start under the shared Coordinator lease on allow.
- Real two-process Core/Provider mutation-vs-dispatch race tests pass; writer-first means zero provider calls, gateway-first means durable dispatch-start before exactly one transport invocation.
- Crash/restart and ambiguous sends remain UNKNOWN and are never retried automatically.
- Authenticated ST session, Core binding, adapter, world, actor, purpose, model, source versions and exact final body remain bound end-to-end.
- The final response is revalidated against the same approved generation context before it is exposed to the Host.
- Full Runtime CI passes on the exact PR head.

Until all gates pass, protected Memory dispatch remains `DISABLED / FAIL-CLOSED`. Do not represent Patch Manager framework tests or lifecycle/inventory CI as evidence of protected generation integration.
