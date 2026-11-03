# Gateway / Generation / Final-Send integration decision

**Status:** selected architecture; production composition remains blocked.
**Inputs:** #844, #855, #868, #870.  
**Pinned Host:** SillyTavern 1.19.0, commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.

## Decision

Use one in-process Core Memory Dispatch Gateway at the SillyTavern server-side final-send boundary, installed by the explicitly authorized managed local source patch.

- The pinned ST Hook is the only native generation egress seam.
- Host Adapter #870 is the authoritative source for authenticated session, installation, account and conversation identity. The native generation hook is not yet bound to that in-process Host context; browser-supplied Memory markers are rejected.
- The NPC Context Receiver is composed inside Core from the authenticated Host scope and adapter-pinned `MemoryNpcConsumer`; it is not the JSON result of `POST /v1/host/memory-npc/retrieve`, and it is not a second generation ingress. Its builder-issued context must retain in-process object identity.
- The Gateway owns durable `DISPATCH_STARTED`, shared Coordinator ordering, exactly-once transport handoff, ambiguous-outcome recovery, and final response write authorization.
- The root SillyTavern server-plugin entrypoint (`index.mjs`) is the startup owner: it read-only verifies the single multi-route Patch Manager state and registers the fail-closed Hook adapter. Hook registration now requires `authorizeResponseWrite`; the Hook binds that method and has no native-writer fallback. The current adapter implements an explicit pass-through writer only while protected Memory is disabled or while emitting the preparation 503; when enabled, protected requests fail closed before the native sender. Ordinary native transport also requires a one-shot permit created by successful preparation of that exact request. The plugin must not apply a patch after native generation modules have already been imported; install/update happens before restart. Normal shutdown leaves the patch installed; explicit Extension deletion owns uninstall.
- The multi-route Patch Manager incorporates #868's durable-state direction: state, journal and byte-exact backups live under `SillyTavern/data/logic-engine/final-send-patch`, outside the removable Extension directory; restore uses a durable transaction journal and fsync-backed atomic replacement. #868's standalone manager was scoped to the Chat Completions endpoint, so it was not transplanted wholesale because it would drop the four additional native text-generation routes.
- #851's independent Extension Gateway ingress is not inserted into the generation path. It adds a second ingress but does not own the native provider transport or the final Express response write.

The Gateway receives a non-serializable, request-scoped transport capability from the native ST sender. The capability is invoked only after durable dispatch-start while the shared Coordinator is held. The network Promise is awaited after the lease is released. The response Hook guards actual `response.write()` and `response.end()` operations; each protected write revalidates Core/Provider evidence under the same Coordinator before invoking the native writer.

## Pinned generation-route inventory

The local patch wraps these five native ST generation handlers:

| Native route | Gateway sender identities |
|---|---|
| `POST /api/backends/chat-completions/generate` | 26 exact sender IDs: `claude`, `google-ai-studio`, `vertex-ai`, `ai21`, `mistral`, `cohere`, `cometapi`, `deepseek`, `aimlapi`, `xai`, `chutes`, `minimax`, `electronhub`, `azure-openai`, `openai`, `openrouter`, `custom`, `perplexity`, `groq`, `fireworks`, `nanogpt`, `pollinations`, `moonshot`, `zai`, `siliconflow`, `workers-ai` |
| `POST /api/backends/text-completions/generate` | `text-completions` |
| `POST /api/backends/kobold/generate` | `kobold` |
| `POST /api/novelai/generate` | `novelai-text` |
| `POST /api/horde/generate-text` | Hooked for fail-closed classification, but deliberately excluded from protected Memory. It creates an asynchronous task; the actual model output is returned later by `POST /api/horde/task-status`. |

The canonical registry currently contains 29 sender identities: all 26 pinned `CHAT_COMPLETION_SOURCES` values plus three synchronous text-generation handlers (`text-completions`, `kobold`, `novelai-text`). CometAPI is an OpenAI-compatible sender branch inside the Chat Completions handler and is explicitly registered as `cometapi`. Horde text is ordinary-only: `/api/horde/generate-text` returns a task ID and `/api/horde/task-status` later returns the model output without the originating request-scoped Final-Send context. `/api/horde/cancel-task` is cancellation control only. Until a durable server-owned task receipt binds the asynchronous task to the originating Gateway dispatch and final response revalidation, protected Memory is denied before Horde task creation. Unknown sender identities are not admitted for protected Memory. Image generation, TTS/audio, embeddings, translation, model-discovery requests and third-party extension routes are not part of this text-generation registry. Protected Memory must not be sent through them.

### Audited native endpoints outside the protected text-generation registry

These routes are present in the pinned modules but do not receive protected NPC text context:

- `POST /api/backends/chat-completions/process` — prompt post-processing only; it does not dispatch to a provider.
- `GET /api/backends/text-completions/props` and `/status` — configuration/status.
- `POST /api/backends/kobold/transcribe-audio` and `/embed` — audio transcription and embedding, not NPC text generation.
- `POST /api/novelai/generate-image` and `/generate-voice` — image and voice generation.
- `POST /api/horde/generate-image` and `/caption-image` — image generation/captioning.
- `POST /api/horde/task-status` — asynchronous text-result retrieval, ordinary-only because protected Horde task creation is denied.
- `POST /api/horde/cancel-task` — cancellation control only.

The Hook patch is scoped to the five text-generation handler entrypoints listed above. It does not classify these unrelated endpoints as protected text senders.

### Cross-block blockers found while wiring the NPC Context Receiver

1. `src/application/npc-generation-context.js::validateLaneB` currently admits candidate records without `source_version`. Gateway's synchronous Provider evidence reader binds each candidate to the current source version, so the issued NPC context cannot prove that the prompt projection and Provider candidate refer to the same source revision. The NPC/Core block must add and validate `source_version` in the Lane B candidate contract, and the Provider reader must compare it.
2. The opaque handoff intentionally does not expose the context to Host, but the Host prompt adapter needs a safe prompt projection. No `projectDispatchHandoff`/equivalent method currently exposes the Lane A facts plus Lane B candidates as `contentBlocks`. The NPC/Core block must provide a non-capability projection from the same issued context; Gateway must compare that projection with the context recovered by consuming the handoff.
3. `MemoryDispatchGateway` now consumes `npcContextHandoff` under the shared Coordinator lease, validates request/scope/Lane B candidate lineage and prompt projection, and calls `revalidateLaneAForDispatch` both before `DISPATCH_STARTED` and immediately before final response release. It currently rejects non-empty Lane A `items` because no approved Lane A prompt projection exists yet. Production remains fail-closed until Core/NPC adds source-version lineage to Lane B candidates and exposes the safe combined projection.
4. The native ST generation request is not yet bound to the authenticated Host conversation in-process. `index.mjs` currently validates a browser-supplied `x-logic-engine-conversation-uuid` header format, but that is not proof of Host ownership. The generation `prepare` hook must obtain the conversation through Host Adapter #870's authenticated session context and Core's HostSessionContext binding; it must not copy the browser header into NPC scope.

The resolver contract is explicit: `{ status: 'unprotected' }` is the only state allowed to use native transport; `{ status: 'ready', context }` must pass Gateway; `non_ready`, `null`, `undefined`, malformed envelopes, and unknown states all stop before native transport. This closes the ambiguous-null fallback that could otherwise turn a failed protected-context lookup into an ordinary request.

### Protected prompt construction and Host metadata scrubbing

`createProtectedMemoryFinalSend` now requires a non-empty server-resolved `contentBlocks` array for every protected request; an empty protected projection is `NON_READY` and cannot be treated as an admitted source set. It serializes only each block's `epistemic_kind`, `evidence_assessment`, and `content`; inserts a system message after existing system/developer instructions for Chat Completions; and prefixes the `prompt`/`input` fields for Text Completions, Kobold, and NovelAI text. Horde is rejected before this step.

Before dispatch it recursively removes Host-only fields (`logic_engine_*`, memory-dispatch/NPC-context markers, conversation/world/actor/generation/session/chat/installation/account identifiers) from the provider JSON body and strips corresponding Host headers. The exact post-injection body is passed to the Gateway, validated against the consumed NPC context, and passed unchanged to the captured native transport capability. The durable ledger stores a logical generation-identity digest (generation ID/type plus Host scope), never raw prompt text or provider-specific body bytes. The disabled JSON endpoint's authenticated request signature separately binds sender, host route, model, stream flag, body digest, source/candidate sets, and prompt-block digest; that endpoint still returns 503 and cannot dispatch. Regression tests cover all 29 registered sender identities and verify that Host metadata is absent while provider credentials remain.

This closes the prompt serialization/injection seam, but it does **not** replace the opaque NPC Context handoff. The production Host composition must still source `contentBlocks` from the same in-process Core context that the Gateway consumes and independently revalidates; that handoff consumption remains a P0 blocker.

## Integration contract between #870 and #844

The #870 Host Adapter/Core integration provides the underlying contracts:
- authenticated Host session and persistent installation/account identity;
- conversation-to-World and World-to-Actor binding in Core;
- an authenticated Host assertion with durable nonce replay protection;
- Core-owned NPC Memory retrieval through `MemoryNpcConsumer`;
- authenticated World/Actor/conversation scope and the existing retrieval Result Envelope. These are inputs to the in-process NPC Generation Context Builder, not a serialized Final-Send handoff.

Important limitation: #851's Extension Gateway is not part of the selected generation path. The current candidate removes its direct dispatch call and retains only fail-closed behavior after protected failure. Neither a browser interceptor nor a JSON `/dispatch` route can carry the builder-issued context identity into the in-process Gateway.

The #844 Gateway already provides:
- file-backed durable dispatch ledger with `synchronous=FULL`;
- shared Coordinator lease for dispatch-start and final writes;
- durable `DISPATCH_STARTED` before one synchronous transport handoff;
- `UNKNOWN` recovery after crash/restart and replay suppression;
- Core/Provider/policy/source/candidate revalidation before response release;
- actual response-write authorization for non-streaming and streaming;
- terminal suppression on revoke or failed revalidation.

These pieces are not yet composed into a production bootstrap. In particular, the native generation request must be bound to the exact authenticated Host conversation before the NPC Context Receiver is called. The existing #870 dispatch proxy expects a trusted conversation UUID in its request envelope; the current native ST generation handlers do not yet have a demonstrated server-side mapping from their request to that UUID. Do not copy a browser-provided conversation identifier into the protected context without an independent Host-side identity/inventory check.

The production bootstrap must supply, from trusted server configuration:
1. the live pinned Host Adapter and its authenticated request-context resolver;
2. the Core in-process NPC Generation Context runtime: asynchronous `prepareForDispatch(request)` builds/receives the context and issues a one-shot opaque handoff; the Gateway consumes it synchronously under the shared Coordinator. The context itself is never serialized;
3. a verified correlation from the actual native generation request to the authenticated Host conversation and exact request/response lifecycle; a browser-supplied request ID may only select a server-stored, one-time receipt and cannot itself establish identity;
4. the real `MemoryDispatchGateway` instance with configured Core/Provider read-only evidence readers and the exact shared Coordinator database;
5. one stable request ID and one protected-dispatch decision per Host response;
6. a fail-closed rule that `NON_READY`, missing identity, missing receiver, stale evidence, unknown sender or absent Gateway cannot downgrade to native fetch.

No browser-to-Core call, second generation ingress, relay, extra API port or Base URL substitution is introduced.

## Retry / cancellation / ambiguous outcomes

- Once protected `DISPATCH_STARTED` is committed, a second protected model handoff for the same Express response is terminal. It cannot mint a fresh request ID to retry.
- A sender retry after a completed or ambiguous protected handoff is denied; no automatic resend is allowed.
- The request-scoped `AbortSignal`, when the native sender provides one, is checked before durable dispatch-start and again at final response revalidation / each Host write; it is also passed to the single transport. Abort before start produces zero egress and no ledger row. Abort after `DISPATCH_STARTED` is terminal and becomes `UNKNOWN`; it never authorizes replay. Bytes already written to a streaming response cannot be recalled.
- Revocation ordered before dispatch-start means zero provider calls.
- Revocation ordered after dispatch-start cannot recall the upstream call, but blocks every subsequent Host response write.
- A crash with a stranded `DISPATCH_STARTED` row converts it to `UNKNOWN` on startup and blocks replay of the same logical generation ID/type and Host scope, even if a caller changes request ID, sender family, model, or provider-specific body serialization.

## Current acceptance evidence and blockers

| Requirement | Evidence | State |
|---|---|---|
| Five pinned native generation handlers are wrapped | Source patch covers five handlers; uploaded 1.19.0 archive matches all 12 baseline hashes. The current real-handler harness exercises Chat Completions only; Text Completions, Kobold and NovelAI need route-specific fake-provider egress tests. | Source hashes verified; updated patch exact-head apply/test and three route harnesses pending |
| 29 sender identities are explicitly registered (26 Chat Completions + three synchronous routes) | Gateway registry and adapter mapping tests; CometAPI included, Horde excluded | Code and regression tests added; exact-head CI pending |
| NPC context content reaches the actual provider body | Final-Send serializes trusted `contentBlocks` into the native Chat/Text/Kobold/NovelAI payload; tests cover all 29 sender identities | Implementation and regression tests added; exact-head CI pending; source projection still blocked |
| Host identity metadata is absent from provider body and headers | Recursive JSON scrub plus Host-header scrub; provider credentials retained | Implementation and regression tests added; exact-head CI pending |
| Protected NON_READY cannot fall back to native sender | Only explicit `unprotected` classification permits native transport; the exact request must have completed Host preparation and its one-shot permit is consumed at dispatch; unknown/null/non-ready resolution fails closed | Implementation and regression tests added; exact-head CI pending |
| Missing Final-Send writer cannot silently fall back | Hook registration requires and binds `authorizeResponseWrite`; there is no native writer fallback | Patch and fail-closed bootstrap regression tests added; exact-head CI pending |
| Native abort exemption cannot bypass protected dispatch | Only empty-body `POST /abort` controls are exempt; generation POSTs with bodies always enter the Gateway | Patch and regression test updated; exact-head CI pending |
| Durable dispatch-start / crash recovery | Gateway unit and child-process crash/restart tests | Regression tests present; exact-head CI pending |
| Durable Patch Manager state/backup and interrupted restore recovery | Patch Manager stores state/backups in ST data; new tests cover Extension removal and restart during restore | Exact-head CI pending |
| Revoke before dispatch-start | Real Provider revoke race tests | Regression tests present; exact-head CI pending |
| Revoke during inference suppresses response | Gateway revalidation tests | Regression tests present; exact-head CI pending |
| Revoke between chunks suppresses later stream writes | Gateway stream write tests | Regression tests present; exact-head CI pending |
| Actual non-stream Express end is revalidated | Hook wraps Express `response.end`; Gateway `authorizeResponseWrite` is called from the wrapper; Chat Completions real-handler harness simulates revoke immediately before `response.end` and expects client egress suppression | Implemented; exact-head CI pending; production Core/Provider wiring not proven |
| Horde asynchronous result retrieval is excluded from protected Memory | `/generate-text` is ordinary-only; actual output arrives later through `/task-status` without a durable task receipt | Protected dispatch is denied before task creation; exact-head CI pending |
| Retry cannot send twice per Host response | New adapter WeakSet guard and regression test | Implemented; exact-head CI pending |
| NPC Context Receiver is wired into native generation | Gateway now consumes the one-shot handoff and revalidates Lane A at dispatch start and final response release. Remaining blockers: the production Host Adapter does not yet compose the NPC runtime and native Hook/Gateway in-process; Lane B candidates omit `source_version` required by the synchronous Provider reader; no safe combined Lane A + Lane B `contentBlocks` projection is exposed. Gateway currently rejects non-empty Lane A items. The HTTP `npc_context` projection is not an authorization capability and cannot replace the handoff. | BLOCKED |
| Production Core/Provider evidence readers and shared Coordinator are supplied to the Gateway | Gateway constructor supports them; plugin bootstrap currently registers a fail-closed adapter instead | BLOCKED |
| Live SillyTavern session/provider/revoke/cancellation acceptance | No live deployment evidence | BLOCKED |

**Safety state:** `NON_READY`; Memory → NPC remains `DISABLED / FAIL-CLOSED`. This decision does not authorize merge, production route enrollment or activation.
