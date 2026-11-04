# Gateway / Generation / Final-Send integration decision

**Status:** Production Host/Core/NPC/Gateway/Final-Send composition and all three synchronous evidence-reader connections are implemented in the candidate branch; production activation remains gated on exact-head CI and live deployment acceptance.  
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
| POST /api/backends/chat-completions/generate | 26: Claude, Google AI Studio, Vertex AI, AI21, Mistral, Cohere, CometAPI, DeepSeek, xAI, AIMLAPI, ElectronHub, Chutes, MiniMax, Azure OpenAI, OpenAI, OpenRouter, Custom, Perplexity, Groq, Fireworks, NanoGPT, Pollinations, Moonshot, Z.AI, SiliconFlow, Cloudflare Workers AI |
| POST /api/backends/text-completions/generate | text-completions |
| POST /api/backends/kobold/generate | kobold |
| POST /api/novelai/generate | novelai-text |
| POST /api/horde/generate-text | horde-text |

The canonical registry contains 30 sender identities (26 Chat Completions identities and four additional text-generation handlers). Unknown sender identities are not admitted for protected Memory. Image generation, TTS/audio, embeddings, translation, model discovery and third-party extension routes are outside this text-generation registry and cannot use protected Memory.

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

## Production Host evidence reader implementation (Gateway follow-up)

The previous embedded runtime supplied a deliberately-denying Host reader even though the Host lifecycle journal already persisted and verified signed root-inventory attestations. The Gateway follow-up now:

- exports a strict HMAC verifier for the exact Root Inventory Attestation envelope;
- binds the attestation's source-manifest digest to the deployment-owned `ENGINE_HOST_ROOT_IDENTITIES` registry entry;
- requires the SillyTavern proxy's `LOGIC_ENGINE_ADAPTER_TOKEN` to equal the Core `ENGINE_ADAPTER_TOKENS[adapterId]` key, preventing two different credentials from being used for signing and verification;
- makes `readAuthoritySnapshotUnderLease()` return `READY` only when the persisted inventory chain, latest attestation, lifecycle head, registry identity, adapter ID and source-manifest digest all agree;
- returns the exact root inventory sequence and manifest digest which the Gateway compares against the generation's Host context.

The reader performs no write, reconciliation, or nested Coordinator acquisition. It executes under the lease already held by `MemoryDispatchGateway`. Missing registry enrollment, an absent/expired/malformed attestation, invalid signature, source-manifest mismatch, stale inventory head, or any unresolved authority state remains `NON_READY`.

A focused verifier test covers valid HMAC, tampering, account substitution, wrong key, accessor properties and malformed signatures.

**Production composition advanced:** the root SillyTavern plugin now constructs `createEmbeddedGatewayRuntime()`, registers its `MemoryDispatchGateway`, and connects the authenticated Host preparation path to `createNpcGenerationContextHostBridge()`. The exact Host response is bound to the one-shot handoff; the authenticated Host session remains in AsyncLocalStorage through Gateway dispatch and Final-Send release. `unavailableGateway` remains only for the explicitly disabled Memory mode.

The model projection keeps the lanes separate: Lane A is serialized as Core-authorized knowledge acquisitions with acquisition/fact/subject/predicate/value and provenance fields; internal acquisition/visibility authorization references remain in the Gateway evidence envelope and are not copied into the model prompt. Lane B is serialized as Provider-backed evidence with its epistemic kind and evidence assessment. The Gateway still revalidates Lane A under the shared Coordinator lease. Native fallback is permitted only after the in-process runtime has returned a complete, revalidated empty Lane A and Lane B. Any incomplete/unknown state is terminal. PR #880's fresh-account lifecycle genesis support, exact-head CI, and full route/revoke/crash acceptance remain dependencies; this PR is not yet P0 acceptance. Host session revocation is read from the separate `ENGINE_HOST_ASSERTION_NONCE_DB_PATH` database at dispatch-start and every final-response release. The Core revocation writer now acquires the same shared Coordinator lease before committing a revocation, so a revoke and a response release have a deterministic order.

## Remaining production blockers

The production composition is now present in the integration branch; the earlier statements that the root plugin still installs `unavailableGateway` or that Core/Provider readers are not wired are historical and superseded.

The active composition when `LOGIC_ENGINE_MEMORY_NPC_ENABLED=true` is:

`authenticated SillyTavern request → Host Adapter → Core World/Actor binding → in-process NPC Context Runtime → one-shot Host request/response handoff → MemoryDispatchGateway → exact provider transport → final response release`.

The root `index.mjs` constructs `createEmbeddedGatewayRuntime()` inside the SillyTavern server process. That factory opens:
- Core SQLite through a read-only `SQLiteStore`;
- the Provider SQLite through `SQLiteMemoryProvider(observerOnly: true)`, without startup reconciliation or mutation;
- the shared Coordinator database;
- the durable dispatch ledger;
- the Host lifecycle journal and Host assertion/revocation ledger.

It composes three synchronous evidence readers under the same Coordinator lease:
1. `MemoryNpcConsumer.readDispatchEvidenceSync()`: accepted Core head, canonical World/Actor bindings, complete canonical-entity inventory, exact active source versions, and policy-authority fingerprint.
2. `SQLiteMemoryProvider.readDispatchEvidenceSync()`: accepted Provider head, ready/current index, query grant, per-record grants and authorization generations, exact candidates/source lineage, and evidence cursor.
3. `HostLifecycleJournal.readAuthoritySnapshotUnderLease()` plus the Host session revocation reader: signed authoritative root inventory, deployment-pinned source manifest, exact root head, no pending Host mutation, and current session revocation state.

The NPC handoff is created and consumed in the same ST server process. It is bound to the exact request and response objects, and the authenticated Host AsyncLocalStorage capability remains active through dispatch and final release. The serialized HTTP Gateway remains signature-only and cannot carry the in-process transport closure or handoff. No parallel ingress from #851 is used.

The native sender path is fail-closed:
- only the five pinned native text-generation handlers enter the managed hook;
- only the exact registered sender identities are eligible for protected dispatch;
- an unknown sender, missing/invalid context, rejected evidence, or incomplete Lane A/Lane B result is terminal and cannot fall through to native transport;
- the only native fallback is an explicitly complete, independently revalidated empty result from both lanes;
- the exact post-transformation provider body is passed once to Gateway, after durable `DISPATCH_STARTED`;
- the Gateway revalidates Core, Provider, Host, policy, Lane A and accepted heads before release and again immediately before every protected response write/end;
- Host session revocation is serialized by the shared Coordinator and checked both before dispatch and before release;
- ambiguous transport outcomes and process crashes remain `UNKNOWN` and cannot be replayed.

### Remaining P0 acceptance gates

1. Exact-head CI for the current integration commit must finish green. Queued workflows are not passing evidence.
2. Run the full sender matrix against the pinned SillyTavern 1.19.0 installation: all five native handlers and all 30 sender identities, including unknown-sender rejection.
3. Run real-provider streaming and non-streaming acceptance, including client disconnect/cancellation, response transform, error paths and duplicate end/write behavior.
4. Prove revoke-before-start produces zero upstream calls; revoke during inference blocks response release; revoke between stream chunks blocks the next chunk.
5. Prove retry, ambiguous/UNKNOWN outcome, crash/restart and new request IDs cannot cause a second upstream dispatch.
6. Verify the deployment has identical Host/Core adapter signing credentials, the deployment-owned root identity/source-manifest registry, the same absolute Coordinator path across processes, the same accepted-head authority, and the exact durable Host assertion/revocation ledger path.
7. Complete live Windows/SillyTavern root-inventory and VSS acceptance. Repository fixtures do not substitute for a real installation.

The current integration branch includes the fresh-account lifecycle genesis constraints: lifecycle sequence zero is accepted only with the all-zero genesis head; root inventory baseline sequence remains positive; no synthetic lifecycle event or review-only-to-ready relabelling is permitted.

#851 parallel ingress is not included. Protected Memory must remain disabled unless the deployment configuration and all evidence readers report READY. A successful source-level or unit-test audit alone does not authorize production activation.

## Current acceptance state

| Requirement | Current implementation evidence | State |
|---|---|---|
| Five pinned native handlers and 30 sender identities | Managed source patch, exact sender registry, route/identity tests and pinned-source audit | Implemented; exact-head CI pending |
| Authenticated Host request and conversation binding | Server-side signed ST session, complete inventory, Core World/Actor binding | Implemented; live ST acceptance pending |
| NPC Context Receiver and one-shot handoff | In-process NPC runtime/receiver, exact request/response WeakMap handoff | Implemented; exact-head CI pending |
| Lane A + Lane B model projection | Separate serialization, Lane A provenance and lease-bound revalidation | Implemented; full model/provider acceptance pending |
| Core evidence reader | Synchronous accepted-head, binding, inventory and source-version verification | Wired to Gateway |
| Provider evidence reader | Read-only observer, accepted head, index, grants, authorization generation and candidate cursor | Wired to Gateway |
| Host evidence reader | Signed root inventory, deployment manifest pin, lifecycle journal and session revocation | Wired to Gateway; live authoritative inventory acceptance pending |
| Shared Coordinator | Core, Provider, Host revocation, dispatch ledger and Final-Send use the same configured Coordinator path | Implemented; deployment identity check pending |
| Durable dispatch/replay protection | `DISPATCH_STARTED`, content-free ledger, UNKNOWN recovery, digest replay block | Implemented; crash/restart acceptance pending |
| Final response release | Revalidation before response release and immediately before every protected write/end | Implemented; real ST streaming acceptance pending |
| Sender bypass / native fallback | Unknown routes terminal; fallback only for independently revalidated complete-empty two-lane result | Unit/source coverage present; full five-handler acceptance pending |
| Live deployment acceptance | Real Windows SillyTavern, provider, root inventory/VSS, revoke and cancellation matrix | BLOCKED |


**Safety state:** NON_READY; Memory → NPC remains DISABLED / FAIL-CLOSED. PR merge, production route enrollment and activation are not authorized by this candidate.
