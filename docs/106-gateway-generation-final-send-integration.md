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
- Horde text: asynchronous task submission; excluded from protected Final-Send because its result is delivered through a later task-status path, not the synchronous sender response.

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
| POST /api/horde/generate-text | EXCLUDED — asynchronous task submission; no synchronous Final-Send response |

The pinned-source audit observes 29 sender identities, but the protected synchronous Final-Send registry admits 28. Horde is explicitly excluded because it creates an asynchronous task whose later result does not pass through this sender's response-write hook. A protected request routed to Horde is rejected as an unregistered sender; it must not fall back to native generation. Unknown sender identities are not admitted for protected Memory. Image generation, TTS/audio, embeddings, translation, model discovery and third-party extension routes are outside this text-generation registry and cannot use protected Memory.

## Host / Core composition changes in this candidate

1. The browser generate_interceptor prototype and its independent /dispatch route have been removed from the integration path. The public Host plugin now exposes only session, identity, inventory, lifecycle and version-ledger operations.
2. The Extension listens to CHAT_COMPLETION_SETTINGS_READY and GENERATE_AFTER_DATA; both are awaited by the pinned ST event source before payload serialization.
3. The Host authentication gate accepts the generation locator as a separate argument, validates it against the authenticated request's complete Host inventory, and binds root ID, inventory sequence and manifest digest to the request capability.
4. prepareGenerationContext(request, route) runs on the actual Express generation request. It invokes the authenticated Host/Core resolution and retrieval path without sending Memory content to the browser.
5. Core Provider candidates now carry source_version through MemoryNpcConsumer output. The receiver requires it and includes it in Gateway source/candidate metadata.
6. The Gateway contract now requires a synchronous readHostEvidence callback under the shared Coordinator lease. Host identity and root inventory head are included in the request digest and checked before durable DISPATCH_STARTED.
7. The Final-Send serializer injects admitted content into the exact outbound request body and strips Host-only correlation fields.

## Synchronous evidence-reader contract

`MemoryDispatchGateway` invokes all three readers while holding the shared Coordinator lease, both before the durable `DISPATCH_STARTED` commit and again during final-response revalidation (including immediately before each protected `response.write()` / `response.end()`). A Promise/thenable, missing field, stale head, partial inventory, or mismatch is a denial. These callbacks are trusted in-process functions; they are not browser or HTTP inputs.

| Reader | Required return contract | Required independent verification |
|---|---|---|
| `readCoreEvidence({ worldId, actorId, purpose, sources, hostContext, coordinatorLease })` | `{ world_id, actor_id, readiness: 'READY', inventory_status: 'READY', head, sources, policy_authority: { authority_id, generation, fingerprint } }` | Current canonical World/Actor binding; every exact source entity/version; complete source inventory; Core accepted head; durable, versioned policy authority. `head` must equal the accepted Core head. |
| `readProviderEvidence({ worldId, actorId, purpose, sources, candidates, coordinatorLease })` | `{ world_id, actor_id, purpose, granted: true, readiness: 'READY', head, sources, candidates }` | Accepted Provider head; healthy/current index and reconciliation state; query grant; each exact record grant and authorization generation; exact candidate and source-version set. `head` must equal the accepted Provider head. |
| `readHostEvidence({ hostContext, worldId, actorId, purpose, coordinatorLease })` | `{ status: 'READY', adapter_id, core_conversation_id, world_id, actor_id, root_id, root_inventory_sequence, root_manifest_sha256 }` | Re-derive authenticated installation/account/session/conversation scope and verify the persisted Host root-inventory journal is still authoritative at the exact sequence and manifest digest carried in `hostContext`. |

The accepted-head authority is checked separately through the synchronous read-only authority endpoint; both Core and Provider must be enrolled and have no pending operation. Core and Provider readers must return source/candidate arrays exactly matching the request after canonical normalization. The Core policy tuple is compared again at final release; a process-local policy identity is insufficient because it cannot prove cross-process durability or revoke ordering. The Host reader is also re-run at final release, so an inventory change during model inference blocks client egress.

No reader may manufacture `READY` from a local scan, deployment claim, first baseline, review-only inventory, stale cache, or asynchronous Core HTTP response. Core and Provider now expose synchronous evidence-reader methods on their trusted live instances, but the root ST plugin does not yet compose those same instances with the Gateway. The Host journal reader explicitly returns NON_READY while the current journal authority remains review-only.

## Remaining production blockers

The repository has two distinct server-plugin entrypoints. `host-adapter/extension-gateway/server-plugin/index.mjs` owns only the bounded public Host ingress routes. The actual SillyTavern native-hook owner is the repository-root `index.mjs` installed as `plugins/logic-engine/index.mjs`: it imports `receiveNpcContext()`, creates `createSillyTavernFinalSendAdapter()`, resolves the native SillyTavern sender registry/response writer, and registers that adapter through `registerLogicEngineFinalSendAdapter()`. This closes the prior adapter-unavailable gap and connects the NPC receiver to the managed native Hook. It does **not** activate protected model egress: the root plugin injects `unavailableGateway`, whose dispatch and response-write methods always deny. Memory-enabled generation remains protected even when Lane B is complete-empty: the receiver does not yet carry Lane A, so an empty Lane B result cannot prove that the full NPC context is empty. The root plugin now returns the received envelope rather than an unprotected `null`; the unavailable Gateway denies it before upstream transport. There is no native fallback. The Gateway now also requires an explicit Lane A projection (including authorization references) and rejects a missing lane instead of silently defaulting it to empty. The current `receiveNpcContext()` still emits Lane B only, so protected dispatch remains NON_READY until the Core Context Builder/Receiver handoff is restored and wired into the native sender process. The remaining blocker is replacing that deliberate stub with a production `MemoryDispatchGateway` composed from the live Core consumer, Provider instance and an authoritative Host reader under the same shared Coordinator. In addition, the current ST plugin still obtains retrieval over HTTP from a separate Core process; the Core/NPC one-shot handoff is not created and consumed in the native sender process. Until this process-boundary gap and Host inventory authority are closed, the Gateway remains NON_READY / FAIL-CLOSED.

The real Gateway cannot be activated until all of the following are implemented and proven on one exact commit:

1. **Core evidence reader:** `MemoryNpcConsumer.readDispatchEvidenceSync()` now checks the accepted Core head, active Host→World and adapter→Actor bindings, complete paginated canonical inventory and exact source versions under the shared Coordinator. It emits a fingerprint for the current policy authority. This is an instance method, not yet wired to the ST Gateway. The policy authority remains process-scoped, so durable cross-process policy generation is still unresolved.
2. **Provider evidence reader:** `SQLiteMemoryProvider.readDispatchEvidenceSync()` now verifies the accepted Provider head, ready/current index state, query grant, exact record grants, persisted authorization generations, direct-source lineage and synchronous Core source-version validator under the shared Coordinator. `createMemoryNpcProviderAdapter()` exposes this trusted seam. It has focused accepted-head/revoke tests, but production composition is not wired.
3. **Host evidence reader:** `HostLifecycleJournal.readAuthoritySnapshotUnderLease()` now verifies the journal under an existing Coordinator lease without nesting a lock. It deliberately returns NON_READY because the current root inventory is review-only. A READY Host reader cannot be supplied until the Host root-inventory authority contract is upgraded.
4. **Host root inventory authority:** the current root inventory implementation distinguishes AUTHORITATIVE_COMPLETE from BASELINED_REVIEW_ONLY / UNCHANGED_REVIEW_ONLY. The Host Adapter intentionally accepts only the authoritative state. The Core review-only inventory state must be resolved by its owner; it must not be relabelled READY in Host.
5. **Shared Coordinator and accepted-head deployment:** the ST process must use the same coordinator and accepted-head authority as Core and Provider, with independent paths and validated configuration.
6. **Real final-send acceptance:** prove revoke-before-start gives zero upstream calls; revoke during inference blocks final response; streaming and non-streaming writes revalidate immediately before native writes; retry/cancellation/UNKNOWN/crash/restart cannot repeat dispatch; and all five real ST handlers remain covered.

#851's parallel ingress is not included. The old browser /dispatch retrieval route is removed; the only generation ingress is the native SillyTavern request and the only protected model egress is the managed Final-Send Hook.

## Current acceptance state

| Requirement | Evidence | State |
|---|---|---|
| Five pinned native handlers and 29 source identities (28 synchronous protected senders; Horde excluded) | Exact pinned-source audit and fake-provider harness | PASS at source/test level |
| Host conversation locator attached to native generation data | Pinned ST awaited event hooks and Extension source | Implemented; exact-head CI pending |
| Server-side Host request binding | Host authentication gate + inventory-backed resolver on actual Express request | Implemented; exact-head CI pending |
| NPC Context Receiver | Exact ready-envelope validation, admission/source-version matching, content bounds | Root ST plugin imports and invokes receiver; protected non-empty result remains denied by Gateway stub |
| Exact provider body serialization | Route-specific context injection and Host metadata scrubbing | Root ST plugin registers adapter; non-empty context cannot reach transport while Gateway is stubbed |
| Durable DISPATCH_STARTED, crash/replay handling | Gateway unit and child-process tests | PASS at Gateway unit level |
| Host inventory revalidation under Coordinator | Lease-bound Host journal evidence method | Implemented fail-closed; returns NON_READY for review-only inventory |
| Core/Provider evidence readers | Synchronous methods on MemoryNpcConsumer and SQLiteMemoryProvider; adapter facade exposes both | Instance seams implemented; production ST composition BLOCKED |
| Real shared Coordinator Gateway in ST plugin | Root ST plugin registers Final-Send adapter but supplies `unavailableGateway`; no production evidence-reader composition | BLOCKED |
| Live SillyTavern/provider/revoke/cancellation acceptance | No live deployment evidence | BLOCKED |

**Safety state:** NON_READY; Memory → NPC remains DISABLED / FAIL-CLOSED. PR merge, production route enrollment and activation are not authorized by this candidate.
