# Gateway / Generation / Final-Send integration decision

**Status:** Host request correlation and NPC Context serialization are integrated in the candidate branch; production Gateway composition remains NON_READY.  
**Inputs:** #844, #855, #868, #870.  
**Pinned Host:** SillyTavern 1.19.0, commit 06bde939fb1e9c4c8d8641d810f0a916b5bce127.

## Architecture decision

Use the managed pinned-source Final-Send Hook as the only native generation egress seam. Do not use a browser-owned generation interceptor or a second model ingress.

The browser Extension only attaches four correlation fields to SillyTavern's awaited native generation-data events: conversation UUID, one-time request UUID, bounded context size and generation type. These values are locators/correlation metadata, not identity or Memory authority. If the browser cannot prepare them, ordinary generation remains unchanged while Memory is disabled; if protected Memory is enabled, the server rejects the missing locator as NON_READY.

The actual native Express generation request is authenticated by the server-side Host Adapter. It validates the supplied conversation UUID against the complete server-side Host inventory, binds it to the signed ST session and persistent installation/account identity, and carries the verified root inventory head. It then resolves the Core World/Actor binding and retrieves the NPC result through Core's authenticated Host assertion path.

The NPC Context Receiver accepts only the exact Core status=ready Result Envelope. It checks admitted/candidate identity pairs, exact source versions, scope, content shape and size. It derives World/Actor from Core's binding response, not browser fields. The resulting context is held in a request-scoped WeakMap and is never accepted from request JSON.

For non-empty results, the Final-Send serializer injects the admitted content into the actual serialized provider body after native provider transformations:
- Chat Completions: a server-created system message after existing leading system messages.
- Text Completions and Kobold: the prompt field.
- NovelAI text: the input field.
- Horde text: the prompt field.

Host-only correlation fields are removed from the outbound provider JSON. The exact post-injection body is passed to the Gateway and its digest is bound to the dispatch record. Content itself is not written to the durable dispatch ledger.

An authorized complete-empty result contains no protected content and can use the ordinary native path. A non-ready result, malformed envelope, missing identity, unknown route or non-empty protected result without a real Gateway must never fall through to native transport.

## Pinned generation-route inventory

The managed patch wraps these five native ST handlers:

| Native route | Sender identities |
|---|---|
| POST /api/backends/chat-completions/generate | 25: Claude, Google AI Studio, Vertex AI, AI21, Mistral, Cohere, DeepSeek, xAI, AIMLAPI, ElectronHub, Chutes, MiniMax, Azure OpenAI, OpenAI, OpenRouter, Custom, Perplexity, Groq, Fireworks, NanoGPT, Pollinations, Moonshot, Z.AI, SiliconFlow, Cloudflare Workers AI |
| POST /api/backends/text-completions/generate | text-completions |
| POST /api/backends/kobold/generate | kobold |
| POST /api/novelai/generate | novelai-text |
| POST /api/horde/generate-text | horde-text |

The canonical registry contains 29 sender identities. Unknown sender identities are not admitted for protected Memory. Image generation, TTS/audio, embeddings, translation, model discovery and third-party extension routes are outside this text-generation registry and cannot use protected Memory.

## Host / Core composition changes in this candidate

1. The browser generate_interceptor prototype and its independent /dispatch route have been removed from the integration path. The public Host plugin now exposes only session, identity, inventory, lifecycle and version-ledger operations.
2. The Extension listens to CHAT_COMPLETION_SETTINGS_READY and GENERATE_AFTER_DATA; both are awaited by the pinned ST event source before payload serialization.
3. The Host authentication gate accepts the generation locator as a separate argument, validates it against the authenticated request's complete Host inventory, and binds root ID, inventory sequence and manifest digest to the request capability.
4. prepareGenerationContext(request, route) runs on the actual Express generation request. It invokes the authenticated Host/Core resolution and retrieval path without sending Memory content to the browser.
5. Core Provider candidates now carry source_version through MemoryNpcConsumer output. The receiver requires it and includes it in Gateway source/candidate metadata.
6. The Gateway contract now requires a synchronous readHostEvidence callback under the shared Coordinator lease. Host identity and root inventory head are included in the request digest and checked before durable DISPATCH_STARTED.
7. The Final-Send serializer injects admitted content into the exact outbound request body and strips Host-only correlation fields.

## Remaining production blockers

The current `host-adapter/extension-gateway/server-plugin/index.mjs` composes and registers only the Host Adapter's public routes. It does not import `receiveNpcContext()`, create `createSillyTavernFinalSendAdapter()`, or register an adapter through `registerLogicEngineFinalSendAdapter()` in the patched SillyTavern hook. The NPC receiver and Final-Send adapter exist as separate tested modules, but their production server-plugin composition is not wired. Consequently the managed hook reports adapter unavailable if installed without the separate #855 fail-closed registration path; the current #855 registration path preserves ordinary unprotected generation but does not provide protected Memory dispatch or final-write authorization. This gap must be closed with one server-plugin registration owner before claiming a connected NPC→Gateway→Final-Send path. The production Gateway must still remain NON_READY until real Core/Provider/Host readers are composed under the shared Coordinator.

The real Gateway cannot be activated until all of the following are implemented and proven on one exact commit:

1. **Core evidence reader:** synchronous read-only access under the shared Coordinator to accepted Core head, canonical source versions, current World/Actor binding and the versioned policy authority. The policy authority is currently process-scoped; a durable, Coordinator-ordered fingerprint/generation reader is not yet implemented.
2. **Provider evidence reader:** synchronous verification of accepted Provider head, current index/reconciliation state, query grant, record grants and authorization generations for every exact candidate/source pair.
3. **Host evidence reader:** synchronous verification of the authenticated Host tuple and root inventory journal head under the same Coordinator. The Gateway now requires this reader, but the production reader is not yet supplied.
4. **Host root inventory authority:** the current root inventory implementation distinguishes AUTHORITATIVE_COMPLETE from BASELINED_REVIEW_ONLY / UNCHANGED_REVIEW_ONLY. The Host Adapter intentionally accepts only the authoritative state. The Core review-only inventory state must be resolved by its owner; it must not be relabelled READY in Host.
5. **Shared Coordinator and accepted-head deployment:** the ST process must use the same coordinator and accepted-head authority as Core and Provider, with independent paths and validated configuration.
6. **Real final-send acceptance:** prove revoke-before-start gives zero upstream calls; revoke during inference blocks final response; streaming and non-streaming writes revalidate immediately before native writes; retry/cancellation/UNKNOWN/crash/restart cannot repeat dispatch; and all five real ST handlers remain covered.

#851's parallel ingress is not included. The old browser /dispatch retrieval route is removed; the only generation ingress is the native SillyTavern request and the only protected model egress is the managed Final-Send Hook.

## Current acceptance state

| Requirement | Evidence | State |
|---|---|---|
| Five pinned native handlers and 29 sender identities | Exact pinned-source audit and fake-provider harness | PASS at source/test level |
| Host conversation locator attached to native generation data | Pinned ST awaited event hooks and Extension source | Implemented; exact-head CI pending |
| Server-side Host request binding | Host authentication gate + inventory-backed resolver on actual Express request | Implemented; exact-head CI pending |
| NPC Context Receiver | Exact ready-envelope validation, admission/source-version matching, content bounds | Module implemented; server-plugin composition NOT WIRED |
| Exact provider body serialization | Route-specific context injection and Host metadata scrubbing | Adapter module implemented; production registration NOT WIRED |
| Durable DISPATCH_STARTED, crash/replay handling | Gateway unit and child-process tests | PASS at Gateway unit level |
| Host inventory revalidation under Coordinator | New required readHostEvidence callback and pre-start denial test | Contract/test seam added; production reader BLOCKED |
| Core/Provider evidence readers | No production composition supplied | BLOCKED |
| Real shared Coordinator Gateway in ST plugin | No production Gateway composition or Final-Send adapter registration in current server-plugin entrypoint | BLOCKED |
| Live SillyTavern/provider/revoke/cancellation acceptance | No live deployment evidence | BLOCKED |

**Safety state:** NON_READY; Memory → NPC remains DISABLED / FAIL-CLOSED. PR merge, production route enrollment and activation are not authorized by this candidate.
